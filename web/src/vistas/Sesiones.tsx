import type { Agente } from '@centro/compartido'
import { etiquetaEstado, nombreModelo } from '../logica/formato.js'
import { Avatar } from './Avatar.js'
import { rutaAgente } from '../logica/rutas.js'

type PropiedadesSesiones = {
  agentes: Agente[]
  proyectoId: string
  maquinaId?: string | null
}

function claseEstado(agente: Agente): string {
  if (agente.estado === 'trabajando' || agente.estado === 'en-curso') return 'run'
  if (agente.estado === 'esperandote') return 'wait'
  return 'done'
}

export function Sesiones({ agentes, proyectoId, maquinaId = null }: PropiedadesSesiones) {
  const agentesDelProyecto = agentes.filter((agente) => agente.proyectoIds.includes(proyectoId))

  return (
    <section className="cd-panel">
      <h2>Sesiones</h2>
      {agentesDelProyecto.map((agente) => {
        const esClaude = agente.tipo === 'claude'
        const href = rutaAgente(maquinaId, agente.id)
        return (
          <article className="cd-sess" key={agente.id}>
            <div className="h">
              <a className="cd-sess-link" href={href} aria-label={agente.titulo}>
                <Avatar rol={agente.rol} estado={agente.estado} tamano={28} />
                <span>{agente.titulo}</span>
              </a>
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
