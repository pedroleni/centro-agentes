import type { Instantanea } from '@centro/compartido'
import { describe, expect, it, vi } from 'vitest'
import { crearCacheInstantanea } from '../../src/panel/cache.js'

function instantanea(generadaMs: number): Instantanea {
  return {
    version: 1,
    maquina: { id: 'maquina', nombre: 'Pruebas', so: 'macos', avisos: [] },
    generadaMs,
    proyectos: [],
    agentes: [],
  }
}

describe('crearCacheInstantanea', () => {
  it('comparte una sola construccion entre llamadas simultaneas', async () => {
    let resolver: ((valor: Instantanea) => void) | undefined
    const construir = vi.fn(
      () => new Promise<Instantanea>((resolve) => {
        resolver = resolve
      }),
    )
    const cache = crearCacheInstantanea(construir)

    const primera = cache.obtener()
    const segunda = cache.obtener()
    const tercera = cache.obtener()

    expect(construir).toHaveBeenCalledTimes(1)
    resolver?.(instantanea(1))
    await expect(Promise.all([primera, segunda, tercera])).resolves.toEqual([
      instantanea(1),
      instantanea(1),
      instantanea(1),
    ])
  })

  it('reconstruye al cumplirse el ttl', async () => {
    let tiempo = 1_000
    const construir = vi.fn(async () => instantanea(tiempo))
    const cache = crearCacheInstantanea(construir, 5_000, () => tiempo)

    await expect(cache.obtener()).resolves.toEqual(instantanea(1_000))
    tiempo = 5_999
    await expect(cache.obtener()).resolves.toEqual(instantanea(1_000))
    tiempo = 6_000
    await expect(cache.obtener()).resolves.toEqual(instantanea(6_000))

    expect(construir).toHaveBeenCalledTimes(2)
  })

  it('no cachea un fallo y reintenta en la siguiente llamada', async () => {
    const construir = vi
      .fn<() => Promise<Instantanea>>()
      .mockRejectedValueOnce(new Error('fallo sintetico'))
      .mockResolvedValueOnce(instantanea(2))
    const cache = crearCacheInstantanea(construir)

    await expect(cache.obtener()).rejects.toThrow('fallo sintetico')
    await expect(cache.obtener()).resolves.toEqual(instantanea(2))
    expect(construir).toHaveBeenCalledTimes(2)
  })
})
