import type { Agente, Commit } from '@centro/compartido'
import { historialPorDia } from '../logica/historial.js'
import { etiquetaEstado } from '../logica/formato.js'

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
  const dias = historialPorDia(commits, agentes, proyectoId, ahora)

  return (
    <section className="cd-panel">
      <h2>Historial de desarrollo <span>commits + agentes, en orden</span></h2>
      {dias.map((dia) => (
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
              const detalles = [agente.modelo, agente.esfuerzo, etiquetaEstado(agente.estado)]
                .filter(Boolean)
                .join(' · ')
              return (
                <div
                  className={`cd-ev ${agente.tipo === 'claude' ? 'cl' : 'cx'}`}
                  key={`sesion:${agente.id}`}
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
    </section>
  )
}
