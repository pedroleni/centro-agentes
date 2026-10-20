import { mkdtemp, rm } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { MensajeHub } from '@centro/compartido'
import { crearAlmacen, type Almacen } from '../src/almacen.js'
import { crearLimitador, crearSesiones, hashContrasena } from '../src/auth.js'
import { crearConexiones } from '../src/conexiones.js'
import type { ConfigHub } from '../src/config.js'
import { crearManejadorHub } from '../src/manejador.js'
import { arrancarHub } from '../src/servidor.js'

// Pruebas con sockets reales: el sandbox de Codex no puede abrir puertos.
const sinPuertos = process.env.CODEX_SANDBOX !== undefined

const abiertos: { servidor: Server; almacen: Almacen; dir: string }[] = []
const clientes: WebSocket[] = []
afterEach(async () => {
  for (const cliente of clientes.splice(0)) cliente.terminate()
  for (const { servidor, almacen, dir } of abiertos.splice(0)) {
    servidor.closeAllConnections()
    await new Promise((r) => servidor.close(r))
    almacen.cerrar()
    await rm(dir, { recursive: true, force: true })
  }
})

async function arrancar(cambios: Partial<ConfigHub> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'centro-servidor-'))
  const puerto = 20_000 + Math.floor(Math.random() * 20_000)
  const cfg: ConfigHub = { puerto, hostPublico: null, propietarioTailscale: 'pedro@example.com', exigirTailscale: false, contrasena: hashContrasena('secreta'), ...cambios }
  const almacen = crearAlmacen(path.join(dir, 'hub.sqlite'))
  const conexiones = crearConexiones()
  const sesiones = crearSesiones()
  const manejar = crearManejadorHub({ cfg, almacen, sesiones, limitador: crearLimitador(), conexiones, dirWeb: dir, leerEstatico: async () => null })
  const servidor = await arrancarHub({ cfg, almacen, conexiones, sesiones, manejar })
  abiertos.push({ servidor, almacen, dir })
  return { cfg, almacen, puerto, sesiones }
}

function esperar<T>(condicion: () => T | undefined, ms = 2_000): Promise<T> {
  return new Promise((resolver, rechazar) => {
    const limite = Date.now() + ms
    const mirar = () => {
      const valor = condicion()
      if (valor !== undefined) return resolver(valor)
      if (Date.now() > limite) return rechazar(new Error('tiempo agotado'))
      setTimeout(mirar, 10)
    }
    mirar()
  })
}

const abierto = (ws: WebSocket) => new Promise<void>((resolver, rechazar) => { ws.once('open', () => resolver()); ws.once('error', rechazar) })
const cerrado = (ws: WebSocket) => new Promise<number>((resolver) => { ws.once('close', (codigo) => resolver(codigo)) })

// Un agente falso conectado de verdad al hub, que apunta lo que le llega.
async function agenteFalso(puerto: number, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${puerto}/api/agente`, { headers: { Authorization: `Bearer ${token}` } })
  clientes.push(ws)
  const recibidos: MensajeHub[] = []
  ws.on('message', (datos) => { recibidos.push(JSON.parse(datos.toString()) as MensajeHub) })
  await abierto(ws)
  return { ws, recibidos }
}

function navegador(puerto: number, maquinaId: string, cookie: string, consulta = '?cols=100&rows=30') {
  const ws = new WebSocket(`ws://127.0.0.1:${puerto}/api/maquinas/${maquinaId}/terminales/aaaaaaaaaaaa/ws${consulta}`, {
    origin: `http://127.0.0.1:${puerto}`,
    headers: { Cookie: cookie },
  })
  clientes.push(ws)
  const bytes: Buffer[] = []
  ws.on('message', (datos, binario) => { if (binario) bytes.push(datos as Buffer) })
  ws.on('error', () => undefined)
  return { ws, bytes }
}

function apretonNavegador(puerto: number, cabeceras: Record<string, string>): Buffer {
  const lineas = Object.entries(cabeceras).map(([k, v]) => `${k}: ${v}\r\n`).join('')
  return Buffer.from(`GET /api/maquinas/aaaaaaaaaaaa/terminales/aaaaaaaaaaaa/ws HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${lineas}\r\n`)
}

function enviarCrudo(puerto: number, datos: Buffer[], esperaMs = 300): Promise<string> {
  return new Promise((resolver) => {
    const socket = connect(puerto, '127.0.0.1')
    let recibido = ''
    socket.on('data', (d) => { recibido += d.toString('latin1') })
    socket.on('error', () => undefined)
    socket.on('connect', () => { for (const d of datos) socket.write(d) })
    setTimeout(() => { socket.destroy(); resolver(recibido) }, esperaMs)
  })
}

function apretonDeManos(puerto: number, extra = ''): Buffer {
  return Buffer.from(`GET /api/agente HTTP/1.1\r\nHost: 127.0.0.1:${puerto}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nAuthorization: Bearer falso\r\n${extra}\r\n`)
}

describe.skipIf(sinPuertos)('servidor del hub (sockets reales)', () => {
  it('una trama inválida tras un apretón de manos con token falso no tumba el hub', async () => {
    const { puerto } = await arrancar()
    const tramaSinMascara = Buffer.from([0x81, 0x05, 0x68, 0x6f, 0x6c, 0x61, 0x21])
    await enviarCrudo(puerto, [apretonDeManos(puerto), tramaSinMascara])
    const r = await fetch(`http://127.0.0.1:${puerto}/api/sesion`, { headers: { host: `127.0.0.1:${puerto}` } })
    expect(r.status).toBe(401)
  })

  it('limita los intentos de conexión rechazados por IP y no audita los que sobran', async () => {
    const { puerto, almacen } = await arrancar()
    for (let i = 0; i < 40; i += 1) await enviarCrudo(puerto, [apretonDeManos(puerto)], 20)
    const rechazos = almacen.ultimosEventos(1_000).filter((e) => e.evento === 'conexion-rechazada')
    expect(rechazos.length).toBeLessThanOrEqual(30)
  })

  it('con Tailscale exigido, el WebSocket de un agente de otra identidad se rechaza aunque el token sea válido', async () => {
    const { puerto, almacen } = await arrancar({ exigirTailscale: true })
    const { token } = almacen.canjearCodigo(almacen.crearCodigoAlta().codigo, 'Mac', 'macos')!
    const respuesta = await enviarCrudo(puerto, [Buffer.from(apretonDeManos(puerto, 'Tailscale-User-Login: intruso@example.com\r\n').toString().replace('Bearer falso', `Bearer ${token}`))])
    expect(respuesta).toMatch(/^HTTP\/1\.1 403/)
  })

  it('el WebSocket de un terminal exige Host, Tailscale, sesión y Origin propios', async () => {
    const { puerto, sesiones } = await arrancar({ exigirTailscale: true })
    const cookie = `ca_sesion=${sesiones.crear()}`
    const bien = { Host: `127.0.0.1:${puerto}`, Origin: `http://127.0.0.1:${puerto}`, Cookie: cookie, 'Tailscale-User-Login': 'pedro@example.com' }
    const primeraLinea = async (cabeceras: Record<string, string>) => (await enviarCrudo(puerto, [apretonNavegador(puerto, cabeceras)])).split('\r\n', 1)[0]
    expect(await primeraLinea({ ...bien, Cookie: 'ca_sesion=inventada' })).toMatch(/^HTTP\/1\.1 401/)
    expect(await primeraLinea({ ...bien, Origin: 'https://evil.com' })).toMatch(/^HTTP\/1\.1 403/)
    expect(await primeraLinea({ ...bien, Host: 'evil.com' })).toMatch(/^HTTP\/1\.1 403/)
    expect(await primeraLinea({ ...bien, 'Tailscale-User-Login': 'intruso@example.com' })).toMatch(/^HTTP\/1\.1 403/)
    const sinOrigen: Record<string, string> = { ...bien }
    delete sinOrigen.Origin
    expect(await primeraLinea(sinOrigen)).toMatch(/^HTTP\/1\.1 403/)
    // Con todo en regla se acepta (la máquina no está conectada: se cierra después).
    expect(await primeraLinea(bien)).toMatch(/^HTTP\/1\.1 101/)
  })

  it('lleva un terminal entre el navegador y el agente, y lo cierra con 4000, 4502 o al soltarlo', async () => {
    const { puerto, almacen, sesiones } = await arrancar()
    const { maquinaId, token } = almacen.canjearCodigo(almacen.crearCodigoAlta().codigo, 'Mac', 'macos')!
    const cookie = `ca_sesion=${sesiones.crear()}`

    // Sin el agente conectado: apretón de manos y cierre 4502.
    expect(await cerrado(navegador(puerto, maquinaId, cookie).ws)).toBe(4502)

    const agente = await agenteFalso(puerto, token)
    const deTipo = <T extends MensajeHub['tipo']>(tipo: T, desde = 0) =>
      agente.recibidos.slice(desde).find((m): m is Extract<MensajeHub, { tipo: T }> => m.tipo === tipo)

    const uno = navegador(puerto, maquinaId, cookie)
    await abierto(uno.ws)
    const adjuntar = await esperar(() => deTipo('terminal-adjuntar'))
    expect(adjuntar).toMatchObject({ terminalId: 'aaaaaaaaaaaa', cols: 100, rows: 30 })
    agente.ws.send(JSON.stringify({ tipo: 'terminal-salida', canal: adjuntar.canal, datos: Buffer.from('hola ñ').toString('base64') }))
    await esperar(() => (Buffer.concat(uno.bytes).toString() === 'hola ñ' ? true : undefined))
    uno.ws.send(JSON.stringify({ tipo: 'entrada', datos: 'ls\r' }))
    const entrada = await esperar(() => deTipo('terminal-entrada'))
    expect(entrada.canal).toBe(adjuntar.canal)
    expect(Buffer.from(entrada.datos, 'base64').toString()).toBe('ls\r')
    uno.ws.send(JSON.stringify({ tipo: 'tamano', cols: 90, rows: 20 }))
    expect(await esperar(() => deTipo('terminal-tamano'))).toMatchObject({ canal: adjuntar.canal, cols: 90, rows: 20 })
    const finUno = cerrado(uno.ws)
    agente.ws.send(JSON.stringify({ tipo: 'terminal-fin', canal: adjuntar.canal, motivo: 'terminada' }))
    expect(await finUno).toBe(4000)

    // Medidas absurdas en la URL se acotan; al irse el navegador, el agente suelta el canal.
    const vistos = agente.recibidos.length
    const dos = navegador(puerto, maquinaId, cookie, '?cols=99999&rows=x')
    await abierto(dos.ws)
    const adjuntarDos = await esperar(() => deTipo('terminal-adjuntar', vistos))
    expect(adjuntarDos).toMatchObject({ cols: 400, rows: 24 })
    dos.ws.close()
    expect(await esperar(() => deTipo('terminal-soltar', vistos))).toEqual({ tipo: 'terminal-soltar', canal: adjuntarDos.canal })

    // Si el agente se va, el navegador se entera con 4502.
    const tres = navegador(puerto, maquinaId, cookie)
    await abierto(tres.ws)
    const finTres = cerrado(tres.ws)
    agente.ws.close()
    expect(await finTres).toBe(4502)

    const eventos = almacen.ultimosEventos(100).filter((e) => e.evento === 'terminal-entrar')
    expect(eventos.length).toBeGreaterThanOrEqual(3)
    expect(eventos[0]?.detalle).toMatchObject({ maquinaId, terminalId: 'aaaaaaaaaaaa' })
  })

  it('cierra el terminal con 4401 cuando la sesión del navegador se cierra', async () => {
    const { puerto, almacen, sesiones } = await arrancar()
    const { maquinaId, token } = almacen.canjearCodigo(almacen.crearCodigoAlta().codigo, 'Mac', 'macos')!
    const agente = await agenteFalso(puerto, token)
    const sesion = sesiones.crear()
    const nav = navegador(puerto, maquinaId, `ca_sesion=${sesion}`)
    await abierto(nav.ws)
    const fin = cerrado(nav.ws)
    sesiones.cerrar(sesion)
    nav.ws.send(JSON.stringify({ tipo: 'entrada', datos: 'whoami\r' }))
    expect(await fin).toBe(4401)
    expect(agente.recibidos.some((m) => m.tipo === 'terminal-entrada')).toBe(false)

    // Tampoco sigue llegando la salida: al primer dato tras cerrar sesión, 4401.
    const otraSesion = sesiones.crear()
    const dos = navegador(puerto, maquinaId, `ca_sesion=${otraSesion}`)
    await abierto(dos.ws)
    const { canal } = await esperar(() => agente.recibidos.filter((m): m is Extract<MensajeHub, { tipo: 'terminal-adjuntar' }> => m.tipo === 'terminal-adjuntar')[1])
    const finDos = cerrado(dos.ws)
    sesiones.cerrar(otraSesion)
    agente.ws.send(JSON.stringify({ tipo: 'terminal-salida', canal, datos: Buffer.from('secreto').toString('base64') }))
    expect(await finDos).toBe(4401)
    expect(dos.bytes).toEqual([])
  })

  it('apunta en la auditoría la IP que añade el proxy (la última de X-Forwarded-For)', async () => {
    const { puerto, almacen } = await arrancar()
    await fetch(`http://127.0.0.1:${puerto}/api/sesion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${puerto}`, 'X-Forwarded-For': '1.2.3.4, 100.64.0.9' },
      body: JSON.stringify({ contrasena: 'mala' }),
    })
    expect(almacen.ultimosEventos(10).find((e) => e.evento === 'entrada-fallida')?.detalle).toEqual({ ip: '100.64.0.9' })
  })
})
