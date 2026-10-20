import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Accion, ResumenActividad } from '@centro/compartido'
import {
  accionDeToolUse,
  normalizarTextoAccion,
  registrarActividad,
  resumenActividadVacio,
} from '../actividad.js'
import { leerLineasDesde } from '../util/lineas.js'

export type TareaCodex = {
  archivo: string
  threadId: string | null
  prompt: string
  esfuerzo: string
  modelo: string
  ultimoMensaje: string | null
  completada: boolean
  mtimeMs: number
  ultimaAccion: Accion | null
  resumenActividad: ResumenActividad
}

type ResumenLog = Omit<TareaCodex, 'archivo' | 'mtimeMs'>

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null
}

async function listarLogs(directorio: string): Promise<Dirent[]> {
  try {
    return await readdir(directorio, { withFileTypes: true })
  } catch {
    return []
  }
}

export function fechaEventoLogCodex(evento: Record<string, unknown>): number {
  const valor = evento.timestamp ?? evento.created_at
  const fechaMs =
    typeof valor === 'string' || typeof valor === 'number'
      ? new Date(valor).getTime()
      : Number.NaN
  return Number.isFinite(fechaMs) ? fechaMs : 0
}

export function ficherosCambioLogCodex(item: Record<string, unknown>): string[] {
  const resultado: string[] = []
  if (typeof item.path === 'string') resultado.push(item.path)
  if (Array.isArray(item.changes)) {
    for (const cambio of item.changes) {
      if (esRegistro(cambio) && typeof cambio.path === 'string') resultado.push(cambio.path)
    }
  }
  return resultado
}

function actualizarAccion(
  resumen: ResumenLog,
  accion: Accion,
  ficherosEditados?: string[],
): void {
  resumen.ultimaAccion = accion
  registrarActividad(resumen.resumenActividad, accion, ficherosEditados)
}

async function leerLog(archivo: string): Promise<TareaCodex | null> {
  let resumen: ResumenLog | null = null

  try {
    for await (const { linea } of leerLineasDesde(archivo, 0)) {
      let evento: unknown
      try {
        evento = JSON.parse(linea) as unknown
      } catch {
        continue
      }
      if (!esRegistro(evento)) continue

      if (resumen === null) {
        if (
          evento.type !== 'task_meta' ||
          typeof evento.prompt !== 'string' ||
          typeof evento.effort !== 'string' ||
          typeof evento.model !== 'string'
        ) {
          return null
        }
        resumen = {
          threadId: null,
          prompt: evento.prompt,
          esfuerzo: evento.effort,
          modelo: evento.model,
          ultimoMensaje: null,
          completada: false,
          ultimaAccion: null,
          resumenActividad: resumenActividadVacio(),
        }
        continue
      }

      if (evento.type === 'thread.started' && typeof evento.thread_id === 'string') {
        resumen.threadId = evento.thread_id
      } else if (evento.type === 'turn.completed') {
        resumen.completada = true
      } else if (evento.type === 'item.completed' && esRegistro(evento.item)) {
        const item = evento.item
        const fechaMs = fechaEventoLogCodex(evento)
        if (item.type === 'command_execution' && typeof item.command === 'string') {
          actualizarAccion(resumen, accionDeToolUse('Bash', { command: item.command }, fechaMs))
        } else if (item.type === 'file_change') {
          const ficheros = ficherosCambioLogCodex(item)
          const nombres = ficheros.map((fichero) => path.win32.basename(path.basename(fichero)))
          actualizarAccion(resumen, {
            tipo: 'edicion',
            texto: normalizarTextoAccion(nombres.join(', ')),
            fechaMs,
          }, ficheros)
        } else if (item.type === 'agent_message' && typeof item.text === 'string') {
          resumen.ultimoMensaje = item.text
          actualizarAccion(resumen, {
            tipo: 'mensaje',
            texto: normalizarTextoAccion(item.text),
            fechaMs,
          })
        }
      }
    }

    if (resumen === null) return null
    const datos = await stat(archivo)
    if (resumen.ultimaAccion !== null && resumen.ultimaAccion.fechaMs === 0) {
      resumen.ultimaAccion.fechaMs = datos.mtimeMs
    }
    return { archivo, ...resumen, mtimeMs: datos.mtimeMs }
  } catch {
    return null
  }
}

export async function leerTareasCodex(rutaProyecto: string): Promise<TareaCodex[]> {
  const directorio = path.join(rutaProyecto, '.codex-logs')
  const entradas = await listarLogs(directorio)
  const tareas: TareaCodex[] = []

  for (const entrada of entradas) {
    if (!entrada.isFile() || path.extname(entrada.name) !== '.jsonl') continue
    const tarea = await leerLog(path.join(directorio, entrada.name))
    if (tarea !== null) tareas.push(tarea)
  }

  return tareas.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export function estadoTarea(
  completada: boolean,
  ultimaActividadMs: number,
  ahoraMs: number,
): 'en-curso' | 'terminado' | 'interrumpido' {
  if (completada) return 'terminado'
  return ahoraMs - ultimaActividadMs < 120_000 ? 'en-curso' : 'interrumpido'
}
