import { mkdtemp, rm } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { crearAlmacen, type Almacen } from '../src/almacen.js'
import { crearLimitador, crearSesiones, hashContrasena } from '../src/auth.js'
import { crearConexiones } from '../src/conexiones.js'
import type { ConfigHub } from '../src/config.js'
import { crearManejadorHub } from '../src/manejador.js'
import { arrancarHub } from '../src/servidor.js'

// Pruebas con sockets reales: el sandbox de Codex no puede abrir puertos.
const sinPuertos = process.env.CODEX_SANDBOX !== undefined

const abiertos: { servidor: Server; almacen: Almacen; dir: string }[] = []
afterEach(async () => {
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
  const manejar = crearManejadorHub({ cfg, almacen, sesiones: crearSesiones(), limitador: crearLimitador(), conexiones, dirWeb: dir, leerEstatico: async () => null })
  const servidor = await arrancarHub({ cfg, almacen, conexiones, manejar })
  abiertos.push({ servidor, almacen, dir })
  return { cfg, almacen, puerto }
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
})
