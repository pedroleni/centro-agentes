import type { Agente } from '@centro/compartido'
import { etiquetaEstado, nombreModelo } from '../logica/formato.js'

type PropiedadesSesiones = {
  agentes: Agente[]
  proyectoId: string
}

function claseEstado(agente: Agente): string {
  if (agente.estado === 'trabajando' || agente.estado === 'en-curso') return 'run'
  if (agente.estado === 'esperandote') return 'wait'
  return 'done'
}

export function Sesiones({ agentes, proyectoId }: PropiedadesSesiones) {
  const agentesDelProyecto = agentes.filter((agente) => agente.proyectoIds.includes(proyectoId))

  return (
    <section className="cd-panel">
      <h2>Sesiones</h2>
      {agentesDelProyecto.map((agente) => {
        const esClaude = agente.tipo === 'claude'
        return (
          <article className="cd-sess" key={agente.id}>
            <div className="h">
              <span className={`ca-av ${esClaude ? 'cl' : 'cx'}`} aria-hidden="true">
                {esClaude ? '✱' : '◎'}
              </span>
              <span>{agente.titulo}</span>
              <span className={`ca-st ${claseEstado(agente)}`}><i />{etiquetaEstado(agente.estado)}</span>
            </div>
            <div className="m">
              {[esClaude ? 'Claude' : 'Codex', nombreModelo(agente.modelo), agente.esfuerzo]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {agente.puedeContinuar && (
              <div className="cmd">
                <button className="cd-btn pri" type="button" disabled title="Llega con el terminal">
                  Continuar
                </button>
              </div>
            )}
          </article>
        )
      })}
    </section>
  )
}
