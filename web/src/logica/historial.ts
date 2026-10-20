import { enlazarCommits } from '@centro/compartido'
import type { Agente, Commit } from '@centro/compartido'
import { fechaCorta } from './formato.js'

export type Evento =
  | { tipo: 'commit'; fechaMs: number; commit: Commit }
  | { tipo: 'sesion'; fechaMs: number; agente: Agente; commits: Commit[] }

export type Dia = {
  clave: string
  etiqueta: string
  eventos: Evento[]
}

function inicioDelDia(ms: number): number {
  const fecha = new Date(ms)
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime()
}

function claveDia(ms: number): string {
  const fecha = new Date(ms)
  const anio = fecha.getFullYear().toString().padStart(4, '0')
  const mes = (fecha.getMonth() + 1).toString().padStart(2, '0')
  const dia = fecha.getDate().toString().padStart(2, '0')
  return `${anio}-${mes}-${dia}`
}

function etiquetaDia(ms: number, ahora: number): string {
  const diaEvento = inicioDelDia(ms)
  const hoy = inicioDelDia(ahora)
  if (diaEvento === hoy) {
    return 'Hoy'
  }

  const ayer = new Date(hoy)
  ayer.setDate(ayer.getDate() - 1)
  if (diaEvento === ayer.getTime()) {
    return 'Ayer'
  }

  const semana = new Intl.DateTimeFormat('es-ES', { weekday: 'long' }).format(new Date(ms))
  return `${semana} ${fechaCorta(ms)}`
}

export function historialPorDia(
  commits: Commit[],
  agentes: Agente[],
  proyectoId: string,
  ahora: number,
): Dia[] {
  const agentesDelProyecto = agentes.filter(
    (agente) => agente.proyectoIds.includes(proyectoId)
      || (agente.commitsPorProyecto[proyectoId]?.length ?? 0) > 0,
  )
  const enlaces = enlazarCommits(commits, agentesDelProyecto, proyectoId)
  const commitsEnlazados = new Set(
    [...enlaces.values()].flat().map((commit) => commit.hash),
  )
  const eventosSesiones = agentesDelProyecto.flatMap((agente): Evento[] => {
    const commitsPorDia = new Map<string, Commit[]>()
    for (const commit of enlaces.get(agente.id) ?? []) {
      const clave = claveDia(commit.fechaMs)
      const commitsDelDia = commitsPorDia.get(clave) ?? []
      commitsDelDia.push(commit)
      commitsPorDia.set(clave, commitsDelDia)
    }

    const eventos: Evento[] = [...commitsPorDia.values()].map((commitsDelDia) => ({
      tipo: 'sesion',
      fechaMs: Math.max(...commitsDelDia.map((commit) => commit.fechaMs)),
      agente,
      commits: commitsDelDia,
    }))
    if (!commitsPorDia.has(claveDia(agente.ultimaActividadMs))) {
      eventos.push({
        tipo: 'sesion',
        fechaMs: agente.ultimaActividadMs,
        agente,
        commits: [],
      })
    }
    return eventos
  })
  const eventos: Evento[] = [
    ...commits
      .filter((commit) => !commitsEnlazados.has(commit.hash))
      .map((commit): Evento => ({ tipo: 'commit', fechaMs: commit.fechaMs, commit })),
    ...eventosSesiones,
  ].sort((a, b) => b.fechaMs - a.fechaMs)

  const dias = new Map<string, Dia>()
  for (const evento of eventos) {
    const clave = claveDia(evento.fechaMs)
    const dia = dias.get(clave) ?? {
      clave,
      etiqueta: etiquetaDia(evento.fechaMs, ahora),
      eventos: [],
    }
    dia.eventos.push(evento)
    dias.set(clave, dia)
  }

  return [...dias.values()].sort(
    (a, b) => (b.eventos[0]?.fechaMs ?? 0) - (a.eventos[0]?.fechaMs ?? 0),
  )
}
