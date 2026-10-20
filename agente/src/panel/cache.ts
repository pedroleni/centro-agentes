import type { Instantanea } from '@centro/compartido'

export function crearCacheInstantanea(
  construir: () => Promise<Instantanea>,
  ttlMs = 5_000,
  ahora = Date.now,
): { obtener(): Promise<Instantanea> } {
  let valor: Instantanea | undefined
  let caducaMs = 0
  let construccion: Promise<Instantanea> | undefined

  return {
    obtener(): Promise<Instantanea> {
      if (valor !== undefined && ahora() < caducaMs) return Promise.resolve(valor)
      if (construccion !== undefined) return construccion

      construccion = (async () => {
        try {
          const nueva = await construir()
          valor = nueva
          caducaMs = ahora() + ttlMs
          return nueva
        } finally {
          construccion = undefined
        }
      })()
      return construccion
    },
  }
}
