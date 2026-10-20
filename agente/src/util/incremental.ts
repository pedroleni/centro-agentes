import { open } from 'node:fs/promises'
import { leerLineasDesde } from './lineas.js'

type Registro<S> = {
  offset: number
  tamano: number
  estado: S
  bytesUltimaLectura: number
}

export function crearLectorIncremental<S>(
  inicial: () => S,
  aplicar: (estado: S, obj: unknown) => void,
): {
  leer(ruta: string): Promise<S>
  bytesUltimaLectura(ruta: string): number
} {
  const registros = new Map<string, Registro<S>>()

  return {
    async leer(ruta: string): Promise<S> {
      const fichero = await open(ruta, 'r')
      let tamano: number
      try {
        tamano = (await fichero.stat()).size
      } finally {
        await fichero.close()
      }

      let registro = registros.get(ruta)
      if (registro === undefined || tamano < registro.tamano) {
        registro = {
          offset: 0,
          tamano: 0,
          estado: inicial(),
          bytesUltimaLectura: 0,
        }
        registros.set(ruta, registro)
      }

      const offsetInicial = registro.offset
      for await (const { linea, finByte } of leerLineasDesde(ruta, offsetInicial)) {
        let objeto: unknown
        try {
          objeto = JSON.parse(linea) as unknown
        } catch {
          registro.offset = finByte
          continue
        }
        aplicar(registro.estado, objeto)
        registro.offset = finByte
      }

      registro.bytesUltimaLectura = Math.max(0, tamano - offsetInicial)
      registro.tamano = tamano
      return registro.estado
    },

    bytesUltimaLectura(ruta: string): number {
      return registros.get(ruta)?.bytesUltimaLectura ?? 0
    },
  }
}
