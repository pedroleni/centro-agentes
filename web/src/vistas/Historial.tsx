import type { Agente, Commit } from '@centro/compartido'
import { useEffect, useState } from 'react'
import { historialPorDia } from '../logica/historial.js'
import { etiquetaEstado, nombreModelo } from '../logica/formato.js'

type PropiedadesHistorial = {
  commits: Commit[]
  agentes: Agente[]
  proyectoId: string
  ahora: number
}

function hora(fechaMs: number): string {
  const fecha = new Date(fechaMs)
  return `${fecha.getHours().toString().padStart(2, '0')}:${fecha.getMinutes().toString().padStart(2, '0')}`
}

function CommitEnHistorial({ commit }: { commit: Commit }) {
  return (
    <div className="cd-commit">
      <code>{commit.hash}</code>{commit.mensaje}
    </div>
  )
}

export function Historial({ commits, agentes, proyectoId, ahora }: PropiedadesHistorial) {
  const [limite, establecerLimite] = useState(40)
  const dias = historialPorDia(commits, agentes, proyectoId, ahora)
  const totalEventos = dias.reduce((total, dia) => total + dia.eventos.length, 0)
  let restantes = limite
  const diasVisibles = dias.flatMap((dia) => {
    if (restantes <= 0) return []
    const eventos = dia.eventos.slice(0, restantes)
    restantes -= eventos.length
    return [{ ...dia, eventos }]
  })

  useEffect(() => {
    establecerLimite(40)
  }, [proyectoId])

  return (
    <section className="cd-panel">
      <h2>Historial de desarrollo <span>commits + agentes, en orden</span></h2>
      {diasVisibles.map((dia) => (
        <div key={dia.clave}>
          <div className="cd-day">{dia.etiqueta}</div>
          <div className="cd-tl">
            {dia.eventos.map((evento) => {
              if (evento.tipo === 'commit') {
                return (
                  <div className="cd-ev" key={`commit:${evento.commit.hash}`}>
                    <div className="row">
                      <span className="t">{hora(evento.fechaMs)}</span>
                      <span className="what"><b>Commit</b></span>
                    </div>
                    <CommitEnHistorial commit={evento.commit} />
                  </div>
                )
              }

              const { agente } = evento
              const tipo = agente.tipo === 'claude' ? 'Claude' : 'Codex'
              const detalles = [nombreModelo(agente.modelo), agente.esfuerzo, etiquetaEstado(agente.estado)]
                .filter(Boolean)
                .join(' · ')
              return (
                <div
                  className={`cd-ev ${agente.tipo === 'claude' ? 'cl' : 'cx'}`}
                  key={`sesion:${agente.id}:${evento.fechaMs}`}
                >
                  <div className="row">
                    <span className="t">{hora(evento.fechaMs)}</span>
                    <span className="what"><b>{tipo}</b> · {agente.titulo}</span>
                  </div>
                  <div className="sub">{detalles}</div>
                  {evento.commits.map((commit) => (
                    <CommitEnHistorial key={commit.hash} commit={commit} />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {limite < totalEventos && (
        <button
          className="cd-btn cd-more-history"
          type="button"
          onClick={() => establecerLimite((actual) => actual + 40)}
        >
          Mostrar más
        </button>
      )}
    </section>
  )
}
