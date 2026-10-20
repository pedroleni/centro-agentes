import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
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
        }
        continue
      }

      if (evento.type === 'thread.started' && typeof evento.thread_id === 'string') {
        resumen.threadId = evento.thread_id
      } else if (evento.type === 'turn.completed') {
        resumen.completada = true
      } else if (
        evento.type === 'item.completed' &&
        esRegistro(evento.item) &&
        evento.item.type === 'agent_message' &&
        typeof evento.item.text === 'string'
      ) {
        resumen.ultimoMensaje = evento.item.text
      }
    }

    if (resumen === null) return null
    const datos = await stat(archivo)
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
