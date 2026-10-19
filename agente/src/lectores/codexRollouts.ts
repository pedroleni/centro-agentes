import { crearLectorIncremental } from '../util/incremental.js'

export type ResumenRollout = {
  ultimoPrompt: string | null
  contexto: { usados: number; ventana: number } | null
  turnoAbierto: boolean
  ultimaActividadMs: number | null
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null
}

function estadoInicial(): ResumenRollout {
  return {
    ultimoPrompt: null,
    contexto: null,
    turnoAbierto: false,
    ultimaActividadMs: null,
  }
}

function aplicarEvento(estado: ResumenRollout, valor: unknown): void {
  if (!esRegistro(valor) || valor.type !== 'event_msg' || !esRegistro(valor.payload)) return

  const fechaMs =
    typeof valor.timestamp === 'string' || typeof valor.timestamp === 'number'
      ? new Date(valor.timestamp).getTime()
      : Number.NaN
  if (Number.isFinite(fechaMs)) estado.ultimaActividadMs = fechaMs

  const payload = valor.payload
  if (payload.type === 'user_message' && typeof payload.message === 'string') {
    estado.ultimoPrompt = payload.message
  } else if (payload.type === 'token_count' && esRegistro(payload.info)) {
    const uso = payload.info.last_token_usage
    const ventana = payload.info.model_context_window
    if (
      esRegistro(uso) &&
      typeof uso.total_tokens === 'number' &&
      Number.isFinite(uso.total_tokens) &&
      typeof ventana === 'number' &&
      Number.isFinite(ventana)
    ) {
      estado.contexto = { usados: uso.total_tokens, ventana }
    }
  } else if (payload.type === 'task_started') {
    estado.turnoAbierto = true
  } else if (payload.type === 'task_complete') {
    estado.turnoAbierto = false
  }
}

export function crearLectorRollouts(): {
  resumen(ruta: string): Promise<ResumenRollout>
} {
  const lector = crearLectorIncremental(estadoInicial, aplicarEvento)
  return {
    async resumen(ruta: string): Promise<ResumenRollout> {
      const resumen = await lector.leer(ruta)
      return {
        ...resumen,
        contexto: resumen.contexto === null ? null : { ...resumen.contexto },
      }
    },
  }
}
