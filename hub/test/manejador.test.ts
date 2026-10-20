import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MensajeHub } from '@centro/compartido'
import { crearAlmacen } from '../src/almacen.js'
import { crearLimitador, crearSesiones, hashContrasena } from '../src/auth.js'
import { crearConexiones } from '../src/conexiones.js'
import type { ConfigHub } from '../src/config.js'
import { crearManejadorHub, type PeticionHub } from '../src/manejador.js'

const temporales: string[] = []
afterEach(async () => {
  await Promise.all(temporales.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

const HOST = 'mini.tail1234.ts.net'
const ORIGEN = `https://${HOST}`
const cfg: ConfigHub = {
  puerto: 4700,
  hostPublico: HOST,
  propietarioTailscale: 'pedro@example.com',
  exigirTailscale: true,
  contrasena: hashContrasena('secreta'),
}

async function preparar() {
  const dir = await mkdtemp(path.join(tmpdir(), 'centro-hub-'))
  temporales.push(dir)
  const almacen = crearAlmacen(path.join(dir, 'hub.sqlite'))
  const conexiones = crearConexiones()
  const manejar = crearManejadorHub({
    cfg,
    almacen,
    sesiones: crearSesiones(),
    limitador: crearLimitador(),
    conexiones,
    dirWeb: '/web',
    leerEstatico: async (ruta) => (ruta === '/web/index.html' ? Buffer.from('<!doctype html>') : null),
  })
  const pedir = (p: Partial<PeticionHub>) => manejar({
    metodo: 'GET', url: '/', host: HOST, origin: undefined, cookie: undefined,
    tailscaleLogin: 'pedro@example.com', ip: '100.64.0.1', cuerpo: null, ...p,
  })
  async function entrar(): Promise<string> {
    const r = await pedir({ metodo: 'POST', url: '/api/sesion', origin: ORIGEN, cuerpo: JSON.stringify({ contrasena: 'secreta' }) })
    expect(r.estado).toBe(204)
    return r.cabeceras['Set-Cookie']!.split(';')[0]!
  }
  return { almacen, conexiones, pedir, entrar }
}

function cuerpo(r: { cuerpo: string | Buffer }): unknown {
  return JSON.parse(String(r.cuerpo))
}

describe('API del hub', () => {
  it('entra con la contraseña correcta y rechaza la incorrecta; al sexto intento, 429', async () => {
    const { pedir, entrar } = await preparar()
    await entrar()
    const mala = { metodo: 'POST', url: '/api/sesion', origin: ORIGEN, cuerpo: JSON.stringify({ contrasena: 'x' }), ip: '1.2.3.4' }
    for (let i = 0; i < 5; i += 1) expect((await pedir(mala)).estado).toBe(401)
    expect((await pedir(mala)).estado).toBe(429)
  })

  it('sin sesión la API da 401, con Host ajeno 403 y fuera de Tailscale 403', async () => {
    const { pedir } = await preparar()
    expect((await pedir({ url: '/api/maquinas' })).estado).toBe(401)
    expect((await pedir({ url: '/api/maquinas', host: 'evil.com' })).estado).toBe(403)
    expect((await pedir({ url: '/', tailscaleLogin: 'otro@example.com' })).estado).toBe(403)
  })

  it('sirve el front sin sesión para poder mostrar la pantalla de entrada', async () => {
    const { pedir } = await preparar()
    const r = await pedir({ url: '/m/abc/agente/x' })
    expect(r.estado).toBe(200)
    expect(String(r.cuerpo)).toContain('<!doctype html>')
  })

  it('crea un código, el agente se da de alta sin sesión y aparece en /api/maquinas sin secretos', async () => {
    const { pedir, entrar } = await preparar()
    const cookie = await entrar()
    const codigo = cuerpo(await pedir({ metodo: 'POST', url: '/api/maquinas/codigos', cookie, origin: ORIGEN })) as { codigo: string }
    const alta = await pedir({
      metodo: 'POST', url: '/api/alta',
      cuerpo: JSON.stringify({ codigo: codigo.codigo, nombre: 'MacBook', so: 'macos' }),
    })
    expect(alta.estado).toBe(200)
    const { token, maquinaId } = cuerpo(alta) as { token: string; maquinaId: string }
    const lista = await pedir({ url: '/api/maquinas', cookie })
    expect(lista.estado).toBe(200)
    expect(cuerpo(lista)).toMatchObject({ modo: 'hub', maquinas: [{ id: maquinaId, nombre: 'MacBook', conectada: false }] })
    expect(String(lista.cuerpo)).not.toContain(token)
    expect((await pedir({ metodo: 'POST', url: '/api/alta', cuerpo: JSON.stringify({ codigo: codigo.codigo, nombre: 'X', so: 'macos' }) })).estado).toBe(400)
  })

  it('pide commits y línea al agente y traduce sus errores a 502, 504 y 404', async () => {
    const { pedir, entrar, almacen, conexiones } = await preparar()
    const cookie = await entrar()
    const { maquinaId } = almacen.canjearCodigo(almacen.crearCodigoAlta().codigo, 'Mini', 'macos')!
    const proyecto = 'aaaaaaaaaaaa'
    expect((await pedir({ url: `/api/maquinas/${maquinaId}/proyectos/${proyecto}/commits`, cookie })).estado).toBe(502)

    const enviados: MensajeHub[] = []
    conexiones.conectar(maquinaId, { enviar: (m) => { enviados.push(m) }, cerrar: () => {} })
    const promesa = pedir({ url: `/api/maquinas/${maquinaId}/proyectos/${proyecto}/commits`, cookie })
    await Promise.resolve()
    const id = (enviados[0] as { id: string }).id
    conexiones.recibir(maquinaId, JSON.stringify({ tipo: 'respuesta', id, ok: true, datos: { commits: [] } }))
    const r = await promesa
    expect(r.estado).toBe(200)
    expect(cuerpo(r)).toEqual({ commits: [] })

    const linea = pedir({ url: `/api/maquinas/${maquinaId}/agentes/claude%3Ax/linea?antes=10`, cookie })
    await Promise.resolve()
    const peticion = enviados[1] as { id: string; agenteId: string; antes: number }
    expect(peticion).toMatchObject({ op: 'linea', agenteId: 'claude:x', antes: 10 })
    conexiones.recibir(maquinaId, JSON.stringify({ tipo: 'respuesta', id: peticion.id, ok: false, error: 'No encontrado' }))
    expect((await linea).estado).toBe(404)

    expect((await pedir({ url: `/api/maquinas/${maquinaId}/agentes/a/linea?antes=-1`, cookie })).estado).toBe(400)
    expect((await pedir({ url: '/api/maquinas/..%2F..%2Fx/proyectos/aaaaaaaaaaaa/commits', cookie })).estado).toBe(404)
  })

  it('crea y cierra terminales a través del agente, con Origin propio y auditoría', async () => {
    const { pedir, entrar, almacen, conexiones } = await preparar()
    const cookie = await entrar()
    const { maquinaId } = almacen.canjearCodigo(almacen.crearCodigoAlta().codigo, 'Mini', 'macos')!
    const ruta = `/api/maquinas/${maquinaId}/terminales`
    const continuar = JSON.stringify({ accion: 'continuar', agenteId: 'claude:abc' })
    expect((await pedir({ metodo: 'POST', url: ruta, cookie, cuerpo: continuar })).estado).toBe(403)
    expect((await pedir({ metodo: 'POST', url: ruta, cookie, origin: 'https://evil.com', cuerpo: continuar })).estado).toBe(403)
    expect((await pedir({ metodo: 'POST', url: ruta, cookie, origin: ORIGEN, cuerpo: continuar })).estado).toBe(502)

    const enviados: MensajeHub[] = []
    conexiones.conectar(maquinaId, { enviar: (m) => { enviados.push(m) }, cerrar: () => {} })
    const responder = (datos: unknown) => {
      const { id } = enviados.at(-1) as { id: string }
      conexiones.recibir(maquinaId, JSON.stringify({ tipo: 'respuesta', id, ok: true, datos }))
    }
    const terminal = { id: 'bbbbbbbbbbbb', titulo: 'Claude · web', tipo: 'claude', agenteId: 'claude:abc', proyectoId: null, creadoMs: 1 }

    let promesa = pedir({ metodo: 'POST', url: ruta, cookie, origin: ORIGEN, cuerpo: continuar })
    await Promise.resolve()
    expect(enviados.at(-1)).toMatchObject({ tipo: 'peticion', op: 'terminal-crear', accion: 'continuar', agenteId: 'claude:abc' })
    responder({ ok: true, terminal })
    let r = await promesa
    expect(r.estado).toBe(201)
    expect(cuerpo(r)).toEqual(terminal)

    promesa = pedir({ metodo: 'POST', url: ruta, cookie, origin: ORIGEN, cuerpo: JSON.stringify({ accion: 'nueva', tipo: 'codex', proyectoId: 'aaaaaaaaaaaa' }) })
    await Promise.resolve()
    expect(enviados.at(-1)).toMatchObject({ op: 'terminal-crear', accion: 'nueva', tipo_agente: 'codex', proyectoId: 'aaaaaaaaaaaa' })
    responder({ ok: false, estado: 429, error: 'Ya hay 6 terminales abiertos en esta máquina' })
    r = await promesa
    expect(r.estado).toBe(429)
    expect(cuerpo(r)).toEqual({ error: 'Ya hay 6 terminales abiertos en esta máquina' })

    promesa = pedir({ metodo: 'DELETE', url: `${ruta}/bbbbbbbbbbbb`, cookie, origin: ORIGEN })
    await Promise.resolve()
    expect(enviados.at(-1)).toMatchObject({ op: 'terminal-cerrar', terminalId: 'bbbbbbbbbbbb' })
    responder({ cerrado: true })
    expect((await promesa).estado).toBe(204)

    // Se audita cada intento que pasa las barreras, también el de la máquina desconectada.
    const eventos = cuerpo(await pedir({ url: '/api/auditoria', cookie })) as { evento: string; detalle: Record<string, unknown> }[]
    const terminales = eventos.filter((e) => e.evento.startsWith('terminal-'))
    expect(terminales.map((e) => e.evento)).toEqual(['terminal-cerrar', 'terminal-crear', 'terminal-crear', 'terminal-crear'])
    expect(terminales[0]?.detalle).toMatchObject({ maquinaId, terminalId: 'bbbbbbbbbbbb' })
    expect(terminales[1]?.detalle).toMatchObject({ maquinaId, accion: 'nueva', tipo: 'codex', proyectoId: 'aaaaaaaaaaaa' })
  })

  it('no se fía de cuerpos mal formados ni de lo que conteste el agente sobre terminales', async () => {
    const { pedir, entrar, almacen, conexiones } = await preparar()
    const cookie = await entrar()
    const { maquinaId } = almacen.canjearCodigo(almacen.crearCodigoAlta().codigo, 'Mini', 'macos')!
    const ruta = `/api/maquinas/${maquinaId}/terminales`
    const enviados: MensajeHub[] = []
    conexiones.conectar(maquinaId, { enviar: (m) => { enviados.push(m) }, cerrar: () => {} })

    const malo = JSON.stringify({ accion: 'ejecutar', comando: 'rm -rf /' })
    expect((await pedir({ metodo: 'POST', url: ruta, cookie, origin: ORIGEN, cuerpo: malo })).estado).toBe(400)
    expect((await pedir({ metodo: 'DELETE', url: `${ruta}/..%2F..`, cookie, origin: ORIGEN })).estado).toBe(404)
    expect((await pedir({ metodo: 'DELETE', url: `${ruta}/XYZ`, cookie, origin: ORIGEN })).estado).toBe(404)
    expect((await pedir({ metodo: 'GET', url: ruta, cookie })).estado).toBe(405)
    expect(enviados).toEqual([])

    const continuar = JSON.stringify({ accion: 'continuar', agenteId: 'claude:abc' })
    for (const datos of [
      { ok: false, estado: 200, error: 'Hecho' },
      { ok: true, terminal: { id: '../../etc', titulo: 'x', tipo: 'claude', agenteId: null, proyectoId: null, creadoMs: 1 } },
      'nada',
    ]) {
      const promesa = pedir({ metodo: 'POST', url: ruta, cookie, origin: ORIGEN, cuerpo: continuar })
      await Promise.resolve()
      const { id } = enviados.at(-1) as { id: string }
      conexiones.recibir(maquinaId, JSON.stringify({ tipo: 'respuesta', id, ok: true, datos }))
      expect((await promesa).estado).toBe(502)
    }
  })

  it('revoca una máquina, cierra su conexión con 4401 y exige Origin propio', async () => {
    const { pedir, entrar, almacen, conexiones } = await preparar()
    const cookie = await entrar()
    const { maquinaId, token } = almacen.canjearCodigo(almacen.crearCodigoAlta().codigo, 'Win', 'windows')!
    const cierres: number[] = []
    conexiones.conectar(maquinaId, { enviar: () => {}, cerrar: (c) => { cierres.push(c) } })
    expect((await pedir({ metodo: 'DELETE', url: `/api/maquinas/${maquinaId}`, cookie, origin: 'https://evil.com' })).estado).toBe(403)
    expect((await pedir({ metodo: 'DELETE', url: `/api/maquinas/${maquinaId}`, cookie, origin: ORIGEN })).estado).toBe(204)
    expect(cierres).toEqual([4401])
    expect(almacen.maquinaDeToken(token)).toBeNull()
    const eventos = cuerpo(await pedir({ url: '/api/auditoria', cookie })) as { evento: string }[]
    expect(eventos.map((e) => e.evento)).toEqual(expect.arrayContaining(['revocar', 'entrada']))
  })

  it('cierra la sesión y rechaza métodos no permitidos', async () => {
    const { pedir, entrar } = await preparar()
    const cookie = await entrar()
    expect((await pedir({ url: '/api/sesion', cookie })).estado).toBe(200)
    expect((await pedir({ metodo: 'PUT', url: '/api/maquinas', cookie, origin: ORIGEN })).estado).toBe(405)
    expect((await pedir({ metodo: 'DELETE', url: '/api/sesion', cookie, origin: ORIGEN })).estado).toBe(204)
    expect((await pedir({ url: '/api/maquinas', cookie })).estado).toBe(401)
  })
  it('con Tailscale exigido, el alta desde otra identidad o sin ella da 403', async () => {
    const { pedir, almacen } = await preparar()
    const { codigo } = almacen.crearCodigoAlta()
    const cuerpo = JSON.stringify({ codigo, nombre: 'Intruso', so: 'macos' })
    expect((await pedir({ metodo: 'POST', url: '/api/alta', tailscaleLogin: 'otro@example.com', cuerpo })).estado).toBe(403)
    expect((await pedir({ metodo: 'POST', url: '/api/alta', tailscaleLogin: undefined, cuerpo })).estado).toBe(403)
    expect(almacen.listarMaquinas()).toHaveLength(0)
  })
  it('limita también los intentos fallidos de contraseña en global, aunque cambie la IP', async () => {
    const { pedir } = await preparar()
    let ultimo = 0
    for (let i = 0; i < 21; i += 1) {
      ultimo = (await pedir({ metodo: 'POST', url: '/api/sesion', origin: ORIGEN, ip: `10.0.0.${i}`, cuerpo: JSON.stringify({ contrasena: 'mala' }) })).estado
    }
    expect(ultimo).toBe(429)
  })

  it('manda la cabecera anti-clickjacking', async () => {
    const { pedir } = await preparar()
    const r = await pedir({ url: '/' })
    expect(r.cabeceras['Content-Security-Policy']).toContain("frame-ancestors 'none'")
  })
})
