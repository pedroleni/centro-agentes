import type { Agente, Commit } from './esquemas.js'

const ANTES_COMMIT_MS = 120_000
const DESPUES_COMMIT_MS = 5_000

export function enlazarCommits(
  commits: Commit[],
  agentes: Agente[],
  proyectoId: string,
): Map<string, Commit[]> {
  const enlaces = new Map<string, Commit[]>()

  for (const commit of commits) {
    let agenteElegido: Agente | null = null
    let distanciaElegida = Number.POSITIVE_INFINITY

    for (const agente of agentes) {
      for (const marcaMs of agente.commitsPorProyecto[proyectoId] ?? []) {
        if (
          marcaMs < commit.fechaMs - ANTES_COMMIT_MS ||
          marcaMs > commit.fechaMs + DESPUES_COMMIT_MS
        ) {
          continue
        }
        const distancia = Math.abs(marcaMs - commit.fechaMs)
        if (distancia < distanciaElegida) {
          agenteElegido = agente
          distanciaElegida = distancia
        }
      }
    }

    if (agenteElegido !== null) {
      const asignados = enlaces.get(agenteElegido.id) ?? []
      asignados.push(commit)
      enlaces.set(agenteElegido.id, asignados)
    }
  }

  return enlaces
}
