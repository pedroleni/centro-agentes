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
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'",
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
})
