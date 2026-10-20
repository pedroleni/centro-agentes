import type { RespuestaMaquinas } from '@centro/compartido'
import { useCallback, useEffect, useState } from 'react'
import { ErrorApi, obtenerMaquinas } from './api.js'

export type EstadoMaquinas = {
  datos: RespuestaMaquinas | null
  error: boolean
  sinSesion: boolean
  actualizadaMs: number | null
  recargar(): void
}

// Consulta /api/maquinas cada `intervaloMs`. Un 401 no es un error de conexión:
// significa que hay que entrar (hub con contraseña).
export function usarMaquinas(intervaloMs = 5_000): EstadoMaquinas {
  const [estado, establecerEstado] = useState<Omit<EstadoMaquinas, 'recargar'>>({
    datos: null,
    error: false,
    sinSesion: false,
    actualizadaMs: null,
  })
  const [vuelta, establecerVuelta] = useState(0)
  const recargar = useCallback(() => establecerVuelta((n) => n + 1), [])

  useEffect(() => {
    // Bandera propia de cada ejecución del efecto: un bucle anterior (p. ej. tras
    // recargar al entrar) no puede seguir consultando en paralelo.
    let activo = true
    let temporizador: ReturnType<typeof setTimeout> | undefined

    async function actualizar(): Promise<void> {
      try {
        const datos = await obtenerMaquinas()
        if (activo) establecerEstado({ datos, error: false, sinSesion: false, actualizadaMs: Date.now() })
      } catch (error) {
        if (!activo) return
        const sinSesion = error instanceof ErrorApi && error.estado === 401
        establecerEstado((anterior) => ({ ...anterior, error: !sinSesion, sinSesion }))
      } finally {
        if (activo) temporizador = setTimeout(() => void actualizar(), intervaloMs)
      }
    }

    void actualizar()
    return () => {
      activo = false
      if (temporizador !== undefined) clearTimeout(temporizador)
    }
  }, [intervaloMs, vuelta])

  return { ...estado, recargar }
}
