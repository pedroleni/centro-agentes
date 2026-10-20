import { execFileSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import type { Server } from 'node:http'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { arrancarPanel } from '../../src/panel/servidor.js'
import { crearGestorTerminalesReal } from '../../src/terminales/gestor.js'

// Sockets y tmux reales: se salta en el sandbox de Codex o sin tmux.
const sinEntorno = process.env.CODEX_SANDBOX !== undefined || (() => { try { execFileSync('tmux', ['-V']); return false } catch { return true } })()

// Un servidor de tmux solo para estas pruebas: no toca los terminales de verdad.
const SOCKET = `centro-agentes-prueba-panel-${process.pid}`
const servidores: Server[] = []
afterEach(async () => {
  for (const s of servidores.splice(0)) { s.closeAllConnections(); await new Promise((r) => s.close(r)) }
})
afterAll(async () => {
  try { execFileSync('tmux', ['-L', SOCKET, 'kill-server']) } catch { /* ya parado */ }
  await rm(path.join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${process.getuid?.() ?? 0}`, SOCKET), { force: true })
})

async function preparar() {
  const puerto = 20_000 + Math.floor(Math.random() * 20_000)
  const gestor = crearGestorTerminalesReal(SOCKET)
  const servidor = await arrancarPanel({
    puerto,
    manejador: async () => ({ estado: 404, cabeceras: {}, cuerpo: '' }),
    terminal: { maquinaId: async () => 'm1', adjuntar: gestor.adjuntar, clave: 'clave-de-prueba' },
  })
  servidores.push(servidor)
  const info = await gestor.crear({ cwd: '/tmp', argv: ['/bin/sh', '-c', 'cat'], titulo: 'prueba', tipo: 'claude', agenteId: null, proyectoId: null })
  return { puerto, gestor, id: info.id }
}

function abrir(url: string, origin: string, cookie = 'ca_panel=clave-de-prueba'): Promise<WebSocket | number> {
  return new Promise((resolver) => {
    const ws = new WebSocket(url, { origin, headers: { Cookie: cookie } })
    ws.on('open', () => resolver(ws))
    ws.on('unexpected-response', (_peticion, respuesta) => resolver(respuesta.statusCode ?? 0))
    ws.on('error', () => resolver(0))
  })
}

describe.skipIf(sinEntorno)('WebSocket de terminal del panel local', () => {
  it('rechaza un Origin ajeno en el apretón de manos', async () => {
    const { puerto, id } = await preparar()
    expect(await abrir(`ws://127.0.0.1:${puerto}/api/maquinas/m1/terminales/${id}/ws`, 'https://evil.com')).toBe(403)
    expect(await abrir(`ws://127.0.0.1:${puerto}/api/maquinas/otra/terminales/${id}/ws`, `http://127.0.0.1:${puerto}`)).toBe(404)
  })

  it('sin la clave del panel no se engancha: cierra con 4401 sin abrir el terminal', async () => {
    const { puerto, id } = await preparar()
    for (const cookie of ['', 'ca_panel=otra']) {
      const ws = await abrir(`ws://127.0.0.1:${puerto}/api/maquinas/m1/terminales/${id}/ws`, `http://127.0.0.1:${puerto}`, cookie)
      expect(ws).toBeInstanceOf(WebSocket)
      const socket = ws as WebSocket
      let recibido = ''
      socket.on('message', (d) => { recibido += d.toString() })
      expect(await new Promise<number>((r) => socket.on('close', (codigo) => r(codigo)))).toBe(4401)
      expect(recibido).toBe('')
    }
  })

  it('con el Origin del panel escribe en el terminal y recibe su salida; al cerrarlo, 4000', async () => {
    const { puerto, gestor, id } = await preparar()
    const ws = await abrir(`ws://127.0.0.1:${puerto}/api/maquinas/m1/terminales/${id}/ws?cols=80&rows=24`, `http://127.0.0.1:${puerto}`)
    expect(ws).toBeInstanceOf(WebSocket)
    const socket = ws as WebSocket
    let salida = ''
    socket.on('message', (d) => { salida += d.toString() })
    const cierre = new Promise<number>((r) => socket.on('close', (codigo) => r(codigo)))
    await new Promise((r) => setTimeout(r, 400))
    socket.send(JSON.stringify({ tipo: 'entrada', datos: 'eco-del-terminal\r' }))
    await new Promise((r) => setTimeout(r, 600))
    expect(salida).toContain('eco-del-terminal')
    await gestor.cerrar(id)
    expect(await cierre).toBe(4000)
  })
})
