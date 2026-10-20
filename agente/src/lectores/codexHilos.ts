import { readdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type HiloCodex = {
  id: string
  titulo: string
  cwd: string
  modelo: string | null
  esfuerzo: string | null
  tokens: number
  rama: string | null
  source: string
  creadoMs: number
  actualizadoMs: number
  rollout: string
  padreId: string | null
}

type FilaHilo = {
  id: string
  titulo: string
  cwd: string
  modelo: string | null
  esfuerzo: string | null
  tokens: number
  rama: string | null
  source: string
  creadoMs: number
  actualizadoMs: number
  rollout: string
  padreId: string | null
}

function buscarBase(dirCodex: string): string | null {
  let nombres: string[]
  try {
    nombres = readdirSync(dirCodex)
  } catch {
    return null
  }

  let elegida: { nombre: string; numero: number } | null = null
  for (const nombre of nombres) {
    const coincidencia = /^state_(\d+)\.sqlite$/.exec(nombre)
    if (coincidencia === null) continue
    const numero = Number(coincidencia[1])
    if (elegida === null || numero > elegida.numero) elegida = { nombre, numero }
  }
  return elegida === null ? null : path.join(dirCodex, elegida.nombre)
}

export function leerHilosCodex(dirCodex: string, desdeMs: number): HiloCodex[] {
  const rutaBase = buscarBase(dirCodex)
  if (rutaBase === null) return []

  let base: DatabaseSync | null = null
  try {
    base = new DatabaseSync(rutaBase, { readOnly: true })
    const filas = base
      .prepare(
        `SELECT
          t.id AS id,
          t.title AS titulo,
          t.cwd AS cwd,
          t.model AS modelo,
          t.reasoning_effort AS esfuerzo,
          t.tokens_used AS tokens,
          t.git_branch AS rama,
          t.source AS source,
          t.created_at_ms AS creadoMs,
          t.updated_at_ms AS actualizadoMs,
          t.rollout_path AS rollout,
          e.parent_thread_id AS padreId
        FROM threads AS t
        LEFT JOIN thread_spawn_edges AS e ON e.child_thread_id = t.id
        WHERE t.archived = 0 AND t.updated_at_ms >= ?
        ORDER BY t.updated_at_ms DESC`,
      )
      .all(desdeMs) as FilaHilo[]

    return filas.map((fila) => ({ ...fila }))
  } catch {
    return []
  } finally {
    base?.close()
  }
}
