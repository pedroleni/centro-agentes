import type { Instantanea } from '@centro/compartido'
import { useEffect, useState } from 'react'
import { obtenerInstantanea } from './api.js'

export type EstadoInstantanea = {
  datos: Instantanea | null
  error: boolean
  actualizadaMs: number | null
}

export function usarInstantanea(intervaloMs = 5_000): EstadoInstantanea {
  const [estado, establecerEstado] = useState<EstadoInstantanea>({
    datos: null,
    error: false,
    actualizadaMs: null,
  })

  useEffect(() => {
    let activo = true
    let temporizador: ReturnType<typeof setTimeout> | undefined

    async function actualizar(): Promise<void> {
      try {
        const datos = await obtenerInstantanea()
        if (activo) {
          establecerEstado({ datos, error: false, actualizadaMs: datos.generadaMs })
        }
      } catch {
        if (activo) {
          establecerEstado((anterior) => ({ ...anterior, error: true }))
        }
      } finally {
        if (activo) {
          temporizador = setTimeout(() => void actualizar(), intervaloMs)
        }
      }
    }

    void actualizar()
    return () => {
      activo = false
      if (temporizador !== undefined) {
        clearTimeout(temporizador)
      }
    }
  }, [intervaloMs])

  return estado
}
