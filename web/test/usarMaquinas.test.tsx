// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usarMaquinas } from '../src/usarMaquinas.js'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function respuesta(cuerpo: unknown, estado = 200): Response {
  return { ok: estado >= 200 && estado < 300, status: estado, json: async () => cuerpo } as Response
}

const datos = { modo: 'hub', maquinas: [{ id: 'aaaaaaaaaaaa', nombre: 'Mini', so: 'macos', conectada: false, ultimoLatidoMs: null, instantanea: null }] }

describe('usarMaquinas', () => {
  it('carga las máquinas de /api/maquinas', async () => {
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () => respuesta(datos))
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() => usarMaquinas())
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/maquinas')
    expect(result.current.datos?.maquinas[0]?.nombre).toBe('Mini')
    expect(result.current.sinSesion).toBe(false)
  })

  it('con un 401 marca sinSesion y no error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({ error: 'Inicia sesión' }, 401)))
    const { result } = renderHook(() => usarMaquinas())
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(result.current.sinSesion).toBe(true)
    expect(result.current.error).toBe(false)
  })

  it('recargar vuelve a pedir enseguida (tras entrar)', async () => {
    vi.useFakeTimers()
    let llamadas = 0
    vi.stubGlobal('fetch', vi.fn(async () => { llamadas += 1; return llamadas === 1 ? respuesta({}, 401) : respuesta(datos) }))
    const { result } = renderHook(() => usarMaquinas())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.sinSesion).toBe(true)
    await act(async () => { result.current.recargar(); await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.sinSesion).toBe(false)
    expect(result.current.datos?.modo).toBe('hub')
  })
  it('marca error a los 30 segundos si /api/maquinas no responde (en frío tarda ~8 s)', async () => {
    vi.useFakeTimers()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milisegundos) => {
      const controlador = new AbortController()
      setTimeout(() => controlador.abort(), milisegundos)
      return controlador.signal
    })
    vi.stubGlobal('fetch', vi.fn((_entrada, opciones) => new Promise<Response>((_resolver, rechazar) => {
      opciones?.signal?.addEventListener('abort', () => rechazar(opciones.signal?.reason))
    })))

    const { result } = renderHook(() => usarMaquinas())
    expect(result.current.error).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(29_999) })
    expect(result.current.error).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(result.current.error).toBe(true)
    expect(timeout).toHaveBeenCalledWith(30_000)
  })
  it('al recargar con una petición en vuelo no deja dos bucles consultando', async () => {
    vi.useFakeTimers()
    let soltar: (r: Response) => void = () => {}
    let llamadas = 0
    vi.stubGlobal('fetch', vi.fn(() => {
      llamadas += 1
      if (llamadas === 1) return new Promise<Response>((r) => { soltar = r })
      return Promise.resolve(respuesta(datos))
    }))
    const { result } = renderHook(() => usarMaquinas(5_000))
    await act(async () => { result.current.recargar(); await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { soltar(respuesta(datos)); await vi.advanceTimersByTimeAsync(0) })
    const antes = llamadas
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(llamadas - antes).toBe(1)
  })
})
