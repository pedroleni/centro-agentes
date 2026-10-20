// @vitest-environment jsdom
import type { Agente, Instantanea } from '@centro/compartido'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '#/')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const PROYECTO_ID = '012345abcdef'

function instantanea(hash: string, generadaMs: number, agentes: Agente[] = []): Instantanea {
  return {
    version: 1,
    maquina: { id: 'mac', nombre: 'Mac de pruebas', so: 'macos', avisos: [] },
    generadaMs,
    proyectos: [{
      id: PROYECTO_ID,
      nombre: 'centro-agentes',
      ruta: '/proyectos/centro-agentes',
      grupo: 'Proyectos IA',
      git: {
        rama: 'main',
        ultimoCommit: { hash, mensaje: hash, fechaMs: generadaMs },
        cambios: 0,
        adelante: 0,
        atras: 0,
        ramas: ['main'],
        actividad14d: Array.from({ length: 14 }, () => 0),
      },
      pendientes: [],
      ultimaActividadMs: generadaMs,
    }],
    agentes,
  }
}

function respuesta(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
  } as Response
}


function crearAgente(id: string, titulo: string): Agente {
  return {
    id, tipo: 'codex', modo: 'interactivo', titulo, cwd: '/proyectos/centro-agentes',
    proyectoIds: [PROYECTO_ID], estado: 'en-curso', rol: 'codex', ultimaAccion: null,
    resumenActividad: { comandos: 0, ediciones: 0, mensajes: 1, ficheros: [] },
    modelo: 'gpt-5', esfuerzo: 'alto', contexto: null, tokensTotales: null, ultimoPrompt: null,
    rama: 'main', pr: null, inicioMs: 1, ultimaActividadMs: 2, padreId: null, entrada: null,
    puedeContinuar: false, tareas: [], commitsPorProyecto: {},
  }
}

function lineaCon(texto: string, fechaMs = 10) {
  return { antes: null, eventos: [{ fechaMs, tipo: 'asistente', texto, detalle: null }] }
}

describe('App', () => {
  it('carga la línea del agente, la refresca cada tres segundos y no duplica eventos', async () => {
    vi.useFakeTimers()
    const agente: Agente = {
      id: 'codex:sesion-1',
      tipo: 'codex',
      modo: 'interactivo',
      titulo: 'Construir el detalle',
      cwd: '/proyectos/centro-agentes',
      proyectoIds: [PROYECTO_ID],
      estado: 'en-curso',
      rol: 'codex',
      ultimaAccion: null,
      resumenActividad: { comandos: 0, ediciones: 0, mensajes: 1, ficheros: [] },
      modelo: 'gpt-5',
      esfuerzo: 'alto',
      contexto: null,
      tokensTotales: null,
      ultimoPrompt: null,
      rama: 'main',
      pr: null,
      inicioMs: 1,
      ultimaActividadMs: 2,
      padreId: null,
      entrada: null,
      puedeContinuar: false,
      tareas: [],
      commitsPorProyecto: {},
    }
    window.location.hash = '#/agente/codex%3Asesion-1'
    let peticionesLinea = 0
    vi.stubGlobal('fetch', vi.fn(async (entrada: string | URL | Request) => {
      const url = String(entrada)
      if (url === '/api/instantanea') return respuesta(instantanea('hash-1', 2, [agente]))
      if (url === '/api/agentes/codex%3Asesion-1/linea') {
        peticionesLinea += 1
        return respuesta({
          antes: null,
          eventos: [
            { fechaMs: 10, tipo: 'asistente', texto: 'Evento inicial', detalle: null },
            ...(peticionesLinea > 1
              ? [{ fechaMs: 20, tipo: 'asistente', texto: 'Evento nuevo', detalle: null }]
              : []),
          ],
        })
      }
      return respuesta({}, 404)
    }))

    render(<App />)
    await act(async () => { await Promise.resolve() })

    expect(screen.getByText('Evento inicial')).toBeTruthy()
    expect(peticionesLinea).toBe(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })

    expect(screen.getAllByText('Evento inicial')).toHaveLength(1)
    expect(screen.getByText('Evento nuevo')).toBeTruthy()
    expect(peticionesLinea).toBe(2)
  })

  it('muestra el aviso de conexión en la ficha si la API falla antes de recibir datos', async () => {
    window.location.hash = `#/proyecto/${PROYECTO_ID}`
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin conexión')))

    render(<App />)

    expect(await screen.findByText('Sin conexión con el agente · reintentando')).toBeTruthy()
    expect(screen.queryByText('Cargando…')).toBeNull()
  })

  it('reintenta los commits tras un 500 y muestra el historial cuando después responde', async () => {
    vi.useFakeTimers()
    window.location.hash = `#/proyecto/${PROYECTO_ID}`
    let peticionesInstantanea = 0
    let peticionesCommits = 0
    vi.stubGlobal('fetch', vi.fn(async (entrada: string | URL | Request) => {
      const url = String(entrada)
      if (url === '/api/instantanea') {
        peticionesInstantanea += 1
        return respuesta(instantanea('hash-1', peticionesInstantanea))
      }
      peticionesCommits += 1
      if (peticionesCommits === 1) return respuesta({}, 500)
      return respuesta({
        commits: [{ hash: 'abc1234', mensaje: 'Commit recuperado', fechaMs: 1, autor: 'Pruebas' }],
      })
    }))

    render(<App />)
    await act(async () => { await Promise.resolve() })

    expect(screen.getByText('No se pudo cargar el historial · reintentando')).toBeTruthy()
    expect(peticionesCommits).toBe(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    expect(screen.getByText('Commit recuperado')).toBeTruthy()
    expect(peticionesCommits).toBe(2)
  })

  it('vuelve a pedir los commits cuando cambia el hash de la instantánea', async () => {
    vi.useFakeTimers()
    window.location.hash = `#/proyecto/${PROYECTO_ID}`
    let peticionesInstantanea = 0
    let peticionesCommits = 0
    vi.stubGlobal('fetch', vi.fn(async (entrada: string | URL | Request) => {
      const url = String(entrada)
      if (url === '/api/instantanea') {
        peticionesInstantanea += 1
        const hash = peticionesInstantanea === 1 ? 'hash-1' : 'hash-2'
        return respuesta(instantanea(hash, peticionesInstantanea))
      }
      peticionesCommits += 1
      return respuesta({ commits: [] })
    }))

    render(<App />)
    await act(async () => { await Promise.resolve() })
    expect(peticionesCommits).toBe(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    expect(peticionesCommits).toBe(2)
  })

  it('vuelve arriba del todo con cada cambio de hash', () => {
    const scrollTo = vi.mocked(window.scrollTo)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin conexión')))
    render(<App />)

    act(() => {
      window.location.hash = `#/proyecto/${PROYECTO_ID}`
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })
  it('tras un 500 en la línea sigue reintentando y la muestra cuando responde', async () => {
    vi.useFakeTimers()
    const agente = crearAgente('codex:a', 'Agente A')
    window.location.hash = '#/agente/codex%3Aa'
    let peticiones = 0
    vi.stubGlobal('fetch', vi.fn(async (entrada: string | URL | Request) => {
      const url = String(entrada)
      if (url === '/api/instantanea') return respuesta(instantanea('h', 2, [agente]))
      if (url.startsWith('/api/agentes/codex%3Aa/linea')) {
        peticiones += 1
        return peticiones === 1 ? respuesta({ error: 'x' }, 500) : respuesta(lineaCon('Ya responde'))
      }
      return respuesta({}, 404)
    }))
    render(<App />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText('Este agente ya no está disponible')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    expect(screen.getByText('Ya responde')).toBeTruthy()
    expect(screen.queryByText('Este agente ya no está disponible')).toBeNull()
  })

  it('solo un 404 de la línea marca el agente como no disponible', async () => {
    const agente = crearAgente('codex:a', 'Agente A')
    window.location.hash = '#/agente/codex%3Aa'
    vi.stubGlobal('fetch', vi.fn(async (entrada: string | URL | Request) => {
      const url = String(entrada)
      if (url === '/api/instantanea') return respuesta(instantanea('h', 2, [agente]))
      return respuesta({ error: 'No encontrado' }, 404)
    }))
    render(<App />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText('Este agente ya no está disponible')).toBeTruthy()
  })

  it('una respuesta en vuelo del agente A no entra en la línea del agente B', async () => {
    vi.useFakeTimers()
    const a = crearAgente('codex:a', 'Agente A')
    const b = crearAgente('codex:b', 'Agente B')
    window.location.hash = '#/agente/codex%3Aa'
    let soltarA: (r: Response) => void = () => {}
    let peticionesA = 0
    vi.stubGlobal('fetch', vi.fn(async (entrada: string | URL | Request) => {
      const url = String(entrada)
      if (url === '/api/instantanea') return respuesta(instantanea('h', 2, [a, b]))
      if (url.startsWith('/api/agentes/codex%3Aa/linea')) {
        peticionesA += 1
        if (peticionesA === 1) return respuesta(lineaCon('Inicial de A'))
        return new Promise<Response>((resolver) => { soltarA = resolver })
      }
      if (url.startsWith('/api/agentes/codex%3Ab/linea')) return respuesta(lineaCon('Inicial de B', 30))
      return respuesta({}, 404)
    }))
    render(<App />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    expect(peticionesA).toBe(2)
    await act(async () => {
      window.location.hash = '#/agente/codex%3Ab'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await Promise.resolve()
    })
    await act(async () => { soltarA(respuesta(lineaCon('Tardía de A', 40))); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText('Inicial de B')).toBeTruthy()
    expect(screen.queryByText('Tardía de A')).toBeNull()
  })
})
