import path from 'node:path'
import type { Accion, ResumenActividad } from '@centro/compartido'
import {
  accionDeToolUse,
  normalizarTextoAccion,
  registrarActividad,
  resumenActividadVacio,
} from '../actividad.js'
import { crearLectorIncremental } from '../util/incremental.js'

export type ResumenRollout = {
  ultimoPrompt: string | null
  contexto: { usados: number; ventana: number } | null
  turnoAbierto: boolean
  ultimaActividadMs: number | null
  ultimaAccion: Accion | null
  resumenActividad: ResumenActividad
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
    ultimaAccion: null,
    resumenActividad: resumenActividadVacio(),
  }
}

function fechaEvento(valor: Record<string, unknown>): number | null {
  const fechaMs =
    typeof valor.timestamp === 'string' || typeof valor.timestamp === 'number'
      ? new Date(valor.timestamp).getTime()
      : Number.NaN
  return Number.isFinite(fechaMs) ? fechaMs : null
}

function actualizarAccion(
  estado: ResumenRollout,
  accion: Accion,
  ficherosEditados?: string[],
): void {
  if (estado.ultimaAccion === null || accion.fechaMs >= estado.ultimaAccion.fechaMs) {
    estado.ultimaAccion = accion
  }
  registrarActividad(estado.resumenActividad, accion, ficherosEditados)
}

function argumentos(valor: unknown): Record<string, unknown> {
  if (esRegistro(valor)) return valor
  if (typeof valor !== 'string') return {}
  try {
    const convertido = JSON.parse(valor) as unknown
    return esRegistro(convertido) ? convertido : {}
  } catch {
    return {}
  }
}

function ficherosPatch(patch: string): string[] {
  const resultado: string[] = []
  for (const coincidencia of patch.matchAll(/^\*\*\* (?:Update|Add) File: (.+)$/gm)) {
    const ruta = coincidencia[1]?.trim()
    if (ruta !== undefined && ruta.length > 0) resultado.push(ruta)
  }
  return resultado
}

function comandoDeCustomToolCall(input: string): string {
  const coincidencia = /"cmd"\s*:\s*("(?:\\.|[^"\\])*")/.exec(input)
  if (coincidencia?.[1] !== undefined) {
    try {
      const comando = JSON.parse(coincidencia[1]) as unknown
      if (typeof comando === 'string') return comando
    } catch {
      // Si la cadena está incompleta, se muestra la primera línea del input.
    }
  }
  return input.split(/\r?\n/, 1)[0] ?? ''
}

function aplicarEvento(estado: ResumenRollout, valor: unknown): void {
  if (!esRegistro(valor) || !esRegistro(valor.payload)) return

  const fechaMs = fechaEvento(valor)
  if (fechaMs !== null) estado.ultimaActividadMs = fechaMs

  const payload = valor.payload
  if (valor.type === 'response_item' && fechaMs !== null) {
    if (payload.type === 'function_call') {
      const datos = argumentos(payload.arguments)
      const comando = datos.cmd ?? datos.command
      if (typeof comando === 'string') {
        actualizarAccion(estado, accionDeToolUse('Bash', { command: comando }, fechaMs))
      }
    } else if (
      payload.type === 'custom_tool_call' &&
      payload.name === 'exec' &&
      typeof payload.input === 'string'
    ) {
      actualizarAccion(
        estado,
        accionDeToolUse('Bash', { command: comandoDeCustomToolCall(payload.input) }, fechaMs),
      )
    } else if (payload.type === 'custom_tool_call' && payload.name === 'apply_patch') {
      const datos = argumentos(payload.arguments)
      const contenido =
        typeof payload.input === 'string'
          ? payload.input
          : typeof datos.patch === 'string'
            ? datos.patch
            : typeof datos.input === 'string'
              ? datos.input
              : ''
      const ficheros = ficherosPatch(contenido)
      const nombres = ficheros.map((fichero) => path.win32.basename(path.basename(fichero)))
      const accion: Accion = {
        tipo: 'edicion',
        texto: normalizarTextoAccion(nombres.join(', ')),
        fechaMs,
      }
      actualizarAccion(estado, accion, ficheros)
    }
    return
  }

  if (valor.type !== 'event_msg') return
  if (payload.type === 'user_message' && typeof payload.message === 'string') {
    estado.ultimoPrompt = payload.message
  } else if (
    payload.type === 'patch_apply_end' &&
    payload.success === true &&
    (Array.isArray(payload.changes) || esRegistro(payload.changes)) &&
    fechaMs !== null
  ) {
    // En los rollouts reales `changes` es un objeto { ruta: cambio }; se acepta
    // también la forma de lista por compatibilidad.
    const rutas = Array.isArray(payload.changes) ? payload.changes : Object.keys(payload.changes)
    const ficheros = rutas.filter((cambio): cambio is string => typeof cambio === 'string')
    const nombres = ficheros.map((fichero) => path.win32.basename(path.basename(fichero)))
    actualizarAccion(estado, {
      tipo: 'edicion',
      texto: normalizarTextoAccion(nombres.join(', ')),
      fechaMs,
    }, ficheros)
  } else if (payload.type === 'agent_message' && typeof payload.message === 'string' && fechaMs !== null) {
    actualizarAccion(estado, {
      tipo: 'mensaje',
      texto: normalizarTextoAccion(payload.message),
      fechaMs,
    })
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
        ultimaAccion: resumen.ultimaAccion === null ? null : { ...resumen.ultimaAccion },
        resumenActividad: {
          ...resumen.resumenActividad,
          ficheros: [...resumen.resumenActividad.ficheros],
        },
      }
    },
  }
}
