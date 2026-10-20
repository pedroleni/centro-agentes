// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usarInstantanea } from '../src/usarInstantanea.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('usarInstantanea', () => {
  it('marca error a los 8 segundos si fetch no responde', async () => {
    vi.useFakeTimers()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milisegundos) => {
      const controlador = new AbortController()
      setTimeout(() => controlador.abort(), milisegundos)
      return controlador.signal
    })
    vi.stubGlobal('fetch', vi.fn((_entrada, opciones) => new Promise<Response>((_resolver, rechazar) => {
      opciones?.signal?.addEventListener('abort', () => rechazar(opciones.signal?.reason))
    })))

    const { result } = renderHook(() => usarInstantanea())
    expect(result.current.error).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(7_999) })
    expect(result.current.error).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(result.current.error).toBe(true)
    expect(timeout).toHaveBeenCalledWith(8_000)
  })
})
