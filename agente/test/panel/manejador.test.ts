import type { Instantanea } from '@centro/compartido'
import { describe, expect, it, vi } from 'vitest'
import type { ResultadoLinea } from '../../src/linea.js'
import { crearManejador, type Peticion } from '../../src/panel/manejador.js'

const instantanea: Instantanea = {
  version: 1,
  maquina: { id: 'maquina', nombre: 'Pruebas', so: 'macos', avisos: [] },
  generadaMs: 1,
  proyectos: [],
  agentes: [],
}

function peticion(parcial: Partial<Peticion> = {}): Peticion {
  return {
    metodo: 'GET',
    url: '/api/instantanea',
    host: '127.0.0.1:4600',
    ...parcial,
  }
}

function dependencias(
  cambios: Partial<Parameters<typeof crearManejador>[0]> = {},
): Parameters<typeof crearManejador>[0] {
  return {
    puerto: 4600,
    obtenerInstantanea: async () => instantanea,
    obtenerCommits: async () => null,
    obtenerLinea: async () => null,
    leerEstatico: async (ruta) =>
      ruta === '/w/index.html' ? Buffer.from('<html>panel</html>') : null,
    dirWeb: '/w',
    ...cambios,
  }
}

const cabecerasSeguridad = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

describe('crearManejador', () => {
  it.each([
    'evil.com:4600',
    '127.0.0.1:4601',
    'localhost',
    'LOCALHOST:4600',
    undefined,
  ])('rechaza el Host no permitido %s', async (host) => {
    const manejar = crearManejador(dependencias())

    const respuesta = await manejar(peticion({ host }))

    expect(respuesta.estado).toBe(403)
    expect(respuesta.cabeceras).toMatchObject(cabecerasSeguridad)
  })

  it('acepta localhost con el puerto exacto', async () => {
    const manejar = crearManejador(dependencias())

    await expect(manejar(peticion({ host: 'localhost:4600' }))).resolves.toMatchObject({
      estado: 200,
    })
  })

  it.each(['POST', 'PUT', 'OPTIONS', 'get'])('rechaza el metodo %s', async (metodo) => {
    const manejar = crearManejador(dependencias())

    const respuesta = await manejar(peticion({ metodo }))

    expect(respuesta.estado).toBe(405)
    expect(respuesta.cabeceras).toMatchObject({ ...cabecerasSeguridad, Allow: 'GET, HEAD' })
  })

  it('devuelve la instantanea con JSON, no-store y todas las cabeceras de seguridad', async () => {
    const manejar = crearManejador(dependencias())

    const respuesta = await manejar(peticion())

    expect(respuesta.estado).toBe(200)
    expect(JSON.parse(String(respuesta.cuerpo))).toEqual(instantanea)
    expect(respuesta.cabeceras).toMatchObject({
      ...cabecerasSeguridad,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    expect(Object.keys(respuesta.cabeceras).some((nombre) => /access-control/i.test(nombre)))
      .toBe(false)
  })

  it('convierte el fallo de la instantanea en un 500 JSON sin exponer una traza', async () => {
    const manejar = crearManejador(
      dependencias({
        obtenerInstantanea: async () => {
          throw new Error('fallo sintetico')
        },
      }),
    )

    const respuesta = await manejar(peticion())

    expect(respuesta.estado).toBe(500)
    expect(JSON.parse(String(respuesta.cuerpo))).toEqual({ error: 'fallo sintetico' })
    expect(respuesta.cabeceras).toMatchObject({
      ...cabecerasSeguridad,
      'Cache-Control': 'no-store',
    })
  })

  it('devuelve los commits de un id valido', async () => {
    const commit = { hash: 'abc1234', mensaje: 'Cambio', fechaMs: 2, autor: 'Pruebas' }
    const obtenerCommits = vi.fn(async () => [commit])
    const manejar = crearManejador(dependencias({ obtenerCommits }))

    const respuesta = await manejar(
      peticion({ url: '/api/proyectos/012345abcdef/commits?ignorada=1' }),
    )

    expect(respuesta.estado).toBe(200)
    expect(JSON.parse(String(respuesta.cuerpo))).toEqual({ commits: [commit] })
    expect(obtenerCommits).toHaveBeenCalledWith('012345abcdef')
  })

  it.each([
    '/api/proyectos/../../x/commits',
    '/api/proyectos/%2e%2e/commits',
    '/api/proyectos/ABCDEF012345/commits',
    '/api/otra',
  ])('rechaza una ruta de API no valida: %s', async (url) => {
    const obtenerCommits = vi.fn(async () => [])
    const manejar = crearManejador(dependencias({ obtenerCommits }))

    const respuesta = await manejar(peticion({ url }))

    expect(respuesta.estado).toBe(404)
    expect(respuesta.cabeceras['Cache-Control']).toBe('no-store')
    expect(obtenerCommits).not.toHaveBeenCalled()
  })

  it('devuelve 404 si el proyecto no existe', async () => {
    const manejar = crearManejador(dependencias({ obtenerCommits: async () => null }))

    const respuesta = await manejar(
      peticion({ url: '/api/proyectos/012345abcdef/commits' }),
    )

    expect(respuesta.estado).toBe(404)
  })

  it('devuelve la linea de un id codificado y pasa antes como numero', async () => {
    const linea: ResultadoLinea = {
      eventos: [{ fechaMs: 1, tipo: 'usuario', texto: 'Hola', detalle: null }],
      antes: 25,
    }
    const obtenerLinea = vi.fn(async () => linea)
    const manejar = crearManejador(dependencias({ obtenerLinea }))

    const respuesta = await manejar(
      peticion({ url: '/api/agentes/claude%3Asesion-1/linea?antes=50' }),
    )

    expect(respuesta.estado).toBe(200)
    expect(JSON.parse(String(respuesta.cuerpo))).toEqual(linea)
    expect(obtenerLinea).toHaveBeenCalledWith('claude:sesion-1', 50)
  })

  it('devuelve 404 para un id de agente desconocido', async () => {
    const obtenerLinea = vi.fn(async () => null)
    const manejar = crearManejador(dependencias({ obtenerLinea }))

    const respuesta = await manejar(
      peticion({ url: '/api/agentes/claude%3Ano-existe/linea' }),
    )

    expect(respuesta.estado).toBe(404)
    expect(obtenerLinea).toHaveBeenCalledWith('claude:no-existe', null)
  })

  it('rechaza un id manipulado sin consultar el registro', async () => {
    const obtenerLinea = vi.fn(async () => null)
    const manejar = crearManejador(dependencias({ obtenerLinea }))

    const respuesta = await manejar(
      peticion({ url: '/api/agentes/..%2F..%2Fetc/linea' }),
    )

    expect(respuesta.estado).toBe(404)
    expect(obtenerLinea).not.toHaveBeenCalled()
  })

  it.each(['-1', '1.5', 'abc', ''])('rechaza antes=%s si no es un entero no negativo', async (antes) => {
    const obtenerLinea = vi.fn(async () => null)
    const manejar = crearManejador(dependencias({ obtenerLinea }))

    const respuesta = await manejar(
      peticion({ url: `/api/agentes/claude%3Asesion/linea?antes=${antes}` }),
    )

    expect(respuesta.estado).toBe(400)
    expect(obtenerLinea).not.toHaveBeenCalled()
  })

  it('sirve index.html como fallback de SPA para una ruta sin extension', async () => {
    const manejar = crearManejador(dependencias())

    const respuesta = await manejar(peticion({ url: '/proyecto/abc' }))

    expect(respuesta.estado).toBe(200)
    expect(String(respuesta.cuerpo)).toBe('<html>panel</html>')
    expect(respuesta.cabeceras['Content-Type']).toBe('text/html; charset=utf-8')
    expect(respuesta.cabeceras['Cache-Control']).toBe('no-cache')
  })

  it.each([
    ['/', 'no-cache'],
    ['/assets/x.js', 'public, max-age=31536000, immutable'],
    ['/agentes/claude.png', 'public, max-age=86400'],
  ])('asigna la cache esperada a %s', async (url, cacheControl) => {
    const manejar = crearManejador(dependencias({
      leerEstatico: async () => Buffer.from('contenido'),
    }))

    const respuesta = await manejar(peticion({ url }))

    expect(respuesta.estado).toBe(200)
    expect(respuesta.cabeceras['Cache-Control']).toBe(cacheControl)
  })

  it('devuelve 404 para un estatico con extension que no existe', async () => {
    const manejar = crearManejador(dependencias())

    await expect(manejar(peticion({ url: '/no-existe.js' }))).resolves.toMatchObject({
      estado: 404,
    })
  })

  it.each([
    '/../secreto',
    '/%2e%2e/secreto',
    '/assets/../index.html',
    '/assets/%2e%2e/index.html',
    '/a%00b',
    '/assets\\..\\secreto',
    '/assets%5c..%5csecreto',
  ])('no lee ni aplica fallback a la ruta estatica insegura %s', async (url) => {
    const leerEstatico = vi.fn(async () => null)
    const manejar = crearManejador(dependencias({ leerEstatico }))

    const respuesta = await manejar(peticion({ url }))

    expect(respuesta.estado).toBe(404)
    expect(leerEstatico).not.toHaveBeenCalled()
  })

  it('acepta HEAD pero elimina el cuerpo', async () => {
    const manejar = crearManejador(dependencias())

    const respuesta = await manejar(peticion({ metodo: 'HEAD' }))

    expect(respuesta.estado).toBe(200)
    expect(respuesta.cuerpo).toBe('')
    expect(respuesta.cabeceras).toMatchObject(cabecerasSeguridad)
  })
  describe('API de máquinas en modo local', () => {
    it('devuelve una sola máquina, conectada, con su instantánea', async () => {
      const manejar = crearManejador(dependencias())
      const r = await manejar(peticion({ url: '/api/maquinas' }))
      expect(r.estado).toBe(200)
      expect(JSON.parse(String(r.cuerpo))).toEqual({
        modo: 'local',
        maquinas: [{ id: 'maquina', nombre: 'Pruebas', so: 'macos', conectada: true, ultimoLatidoMs: 1, instantanea }],
      })
    })

    it('las rutas con id de máquina delegan en las de siempre y otra máquina da 404', async () => {
      const obtenerCommits = vi.fn(async () => [])
      const obtenerLinea = vi.fn(async () => ({ eventos: [], antes: null }) as ResultadoLinea)
      const manejar = crearManejador(dependencias({ obtenerCommits, obtenerLinea }))
      expect((await manejar(peticion({ url: '/api/maquinas/maquina/proyectos/aaaaaaaaaaaa/commits' }))).estado).toBe(200)
      expect(obtenerCommits).toHaveBeenCalledWith('aaaaaaaaaaaa')
      expect((await manejar(peticion({ url: '/api/maquinas/maquina/agentes/claude%3Ax/linea?antes=5' }))).estado).toBe(200)
      expect(obtenerLinea).toHaveBeenCalledWith('claude:x', 5)
      expect((await manejar(peticion({ url: '/api/maquinas/otra/proyectos/aaaaaaaaaaaa/commits' }))).estado).toBe(404)
    })
  })
  describe('terminales en modo local', () => {
    const ORIGEN = 'http://127.0.0.1:4600'
    const CLAVE = 'clave-de-prueba-0123456789'
    const COOKIE = `ca_panel=${CLAVE}`
    const info = { id: '0123456789ab', titulo: 'Claude · x', tipo: 'claude', agenteId: null, proyectoId: 'aaaaaaaaaaaa', creadoMs: 1 }
    function conTerminales() {
      const crear = vi.fn(async () => ({ ok: true as const, terminal: info }))
      const cerrar = vi.fn(async () => undefined)
      const manejar = crearManejador(dependencias({ terminales: { crear, cerrar } as never, clave: CLAVE }))
      return { manejar, crear, cerrar }
    }
    const cuerpo = JSON.stringify({ accion: 'nueva', tipo: 'claude', proyectoId: 'aaaaaaaaaaaa' })

    it('crea un terminal con POST y Origin propio, y lo cierra con DELETE', async () => {
      const { manejar, crear, cerrar } = conTerminales()
      const r = await manejar(peticion({ metodo: 'POST', url: '/api/maquinas/maquina/terminales', origin: ORIGEN, cookie: COOKIE, cuerpo }))
      expect(r.estado).toBe(201)
      expect(JSON.parse(String(r.cuerpo))).toEqual(info)
      expect(crear).toHaveBeenCalledWith({ accion: 'nueva', tipo: 'claude', proyectoId: 'aaaaaaaaaaaa' })
      expect((await manejar(peticion({ metodo: 'DELETE', url: '/api/maquinas/maquina/terminales/0123456789ab', origin: ORIGEN, cookie: COOKIE }))).estado).toBe(204)
      expect(cerrar).toHaveBeenCalledWith('0123456789ab')
    })

    it('rechaza Origin ajeno o ausente, otras rutas, otra máquina y cuerpos inválidos', async () => {
      const { manejar, crear } = conTerminales()
      expect((await manejar(peticion({ metodo: 'POST', url: '/api/maquinas/maquina/terminales', origin: 'https://evil.com', cuerpo }))).estado).toBe(403)
      expect((await manejar(peticion({ metodo: 'POST', url: '/api/maquinas/maquina/terminales', cuerpo }))).estado).toBe(403)
      expect((await manejar(peticion({ metodo: 'POST', url: '/api/instantanea', origin: ORIGEN, cookie: COOKIE, cuerpo }))).estado).toBe(405)
      expect((await manejar(peticion({ metodo: 'POST', url: '/api/maquinas/otra/terminales', origin: ORIGEN, cookie: COOKIE, cuerpo }))).estado).toBe(404)
      expect((await manejar(peticion({ metodo: 'POST', url: '/api/maquinas/maquina/terminales', origin: ORIGEN, cookie: COOKIE, cuerpo: '{"accion":"ejecutar","orden":"rm -rf ~"}' }))).estado).toBe(400)
      expect((await manejar(peticion({ metodo: 'DELETE', url: '/api/maquinas/maquina/terminales/..%2Fx', origin: ORIGEN }))).estado).toBe(405)
      expect(crear).not.toHaveBeenCalled()
    })

    it('sin la clave de este arranque del panel no crea ni cierra terminales', async () => {
      const { manejar, crear, cerrar } = conTerminales()
      const crearCon = (cookie: string | undefined) => manejar(peticion({ metodo: 'POST', url: '/api/maquinas/maquina/terminales', origin: ORIGEN, cookie, cuerpo }))
      expect((await crearCon(undefined)).estado).toBe(401)
      expect((await crearCon('ca_panel=otra-clave')).estado).toBe(401)
      expect((await crearCon(`otra=1; ca_panel=${CLAVE}x`)).estado).toBe(401)
      expect((await manejar(peticion({ metodo: 'DELETE', url: '/api/maquinas/maquina/terminales/0123456789ab', origin: ORIGEN }))).estado).toBe(401)
      expect(crear).not.toHaveBeenCalled()
      expect(cerrar).not.toHaveBeenCalled()
      expect((await crearCon(`otra=1; ca_panel=${CLAVE}`)).estado).toBe(201)

      // Sin clave configurada, el panel no deja crear terminales a nadie.
      const sinClave = crearManejador(dependencias({ terminales: { crear, cerrar } as never }))
      expect((await sinClave(peticion({ metodo: 'POST', url: '/api/maquinas/maquina/terminales', origin: ORIGEN, cookie: COOKIE, cuerpo }))).estado).toBe(401)
    })

    it('el enlace de arranque con la clave guarda la cookie y lleva al panel; con otra, 403', async () => {
      const { manejar } = conTerminales()
      const r = await manejar(peticion({ url: `/entrar?clave=${CLAVE}` }))
      expect(r.estado).toBe(302)
      expect(r.cabeceras.Location).toBe('/')
      expect(r.cabeceras['Set-Cookie']).toBe(`ca_panel=${CLAVE}; HttpOnly; SameSite=Strict; Path=/`)
      expect(r.cabeceras['Cache-Control']).toBe('no-store')
      for (const url of ['/entrar?clave=otra', '/entrar', `/entrar?clave=${CLAVE}&clave=x`]) {
        const mala = await manejar(peticion({ url }))
        expect(mala.estado).toBe(403)
        expect(mala.cabeceras['Set-Cookie']).toBeUndefined()
      }
    })

    it('pasa el estado de error del servicio (409 si la sesión sigue abierta)', async () => {
      const crear = vi.fn(async () => ({ ok: false as const, estado: 409 as const, error: 'Esta sesión sigue abierta en otro sitio' }))
      const manejar = crearManejador(dependencias({ terminales: { crear, cerrar: vi.fn() } as never, clave: CLAVE }))
      const r = await manejar(peticion({ metodo: 'POST', url: '/api/maquinas/maquina/terminales', origin: ORIGEN, cookie: COOKIE, cuerpo: JSON.stringify({ accion: 'continuar', agenteId: 'claude:x' }) }))
      expect(r.estado).toBe(409)
      expect(JSON.parse(String(r.cuerpo))).toEqual({ error: 'Esta sesión sigue abierta en otro sitio' })
    })
  })
})
