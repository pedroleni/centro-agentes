// @vitest-environment jsdom
import type { Instantanea } from '@centro/compartido'
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

function instantanea(hash: string, generadaMs: number): Instantanea {
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
    agentes: [],
  }
}

function respuesta(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
  } as Response
}

describe('App', () => {
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
})
