import type { Agente, Pendiente, Proyecto } from '@centro/compartido'
import { fechaCorta } from '../logica/formato.js'

type PropiedadesTareas = {
  proyecto: Proyecto
  agentes: Agente[]
}

function porcentaje(pendiente: Pendiente): number {
  if (pendiente.hechas === null || pendiente.total === null || pendiente.total === 0) {
    return 0
  }
  return Math.min(100, Math.round(100 * pendiente.hechas / pendiente.total))
}

function Progreso({ pendiente }: { pendiente: Pendiente }) {
  const progreso = pendiente.hechas !== null && pendiente.total !== null
    ? `${pendiente.hechas}/${pendiente.total}`
    : null
  const terminada = pendiente.total !== null && pendiente.hechas === pendiente.total

  return (
    <div className={`cd-task${terminada ? '' : ' todo'}`}>
      <span className="n">{pendiente.titulo}</span>
      <span className="d">
        {pendiente.fechaMs !== null && `${fechaCorta(pendiente.fechaMs)}${progreso === null ? '' : ' · '}`}
        {progreso}
      </span>
      {progreso !== null && (
        <div className="bar" aria-label={`Progreso ${progreso}`}>
          <span style={{ width: `${porcentaje(pendiente)}%` }} />
        </div>
      )}
    </div>
  )
}

export function Tareas({ proyecto, agentes }: PropiedadesTareas) {
  const handoffs = proyecto.pendientes.filter((pendiente) => pendiente.origen === 'handoff')
  const planes = proyecto.pendientes.filter((pendiente) => pendiente.origen === 'plan')
  const sesionesVivas = agentes.filter(
    (agente) => agente.proyectoIds.includes(proyecto.id)
      && ['trabajando', 'esperandote', 'en-curso'].includes(agente.estado),
  )

  return (
    <section className="cd-panel">
      <h2>Tareas <span>planes + handoff</span></h2>
      {handoffs.map((handoff, indice) => (
        <div className="cd-flag" key={`${handoff.titulo}:${indice}`}>
          ⚑ Del HANDOFF{handoff.fechaMs === null ? '' : ` · ${fechaCorta(handoff.fechaMs)}`}: {handoff.titulo}
          {handoff.quizaDesactualizado && <small>Puede estar desactualizado</small>}
        </div>
      ))}
      {planes.map((plan, indice) => <Progreso key={`${plan.titulo}:${indice}`} pendiente={plan} />)}
      {sesionesVivas.flatMap((agente) => agente.tareas.map((tarea, indice) => (
        <div className={`cd-task${tarea.estado === 'hecha' ? '' : ' todo'}`} key={`${agente.id}:${indice}`}>
          <span className="n">{tarea.texto}</span>
          <span className="d">{agente.tipo === 'claude' ? 'Claude' : 'Codex'} · {tarea.estado}</span>
        </div>
      )))}
    </section>
  )
}
