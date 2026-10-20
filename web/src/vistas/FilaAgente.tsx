import type { Agente } from '@centro/compartido'
import { etiquetaEstado, nombreModelo, porcentajeContexto, tiempoAgente } from '../logica/formato.js'
import { Avatar } from './Avatar.js'

type PropiedadesFilaAgente = {
  agente: Agente
  ahora: number
}

function claseEstado(agente: Agente): string {
  if (agente.estado === 'trabajando' || agente.estado === 'en-curso') {
    return 'run'
  }
  if (agente.estado === 'esperandote') {
    return 'wait'
  }
  return 'done'
}

export function FilaAgente({ agente, ahora }: PropiedadesFilaAgente) {
  const porcentaje = porcentajeContexto(agente)
  const detallesModelo = [nombreModelo(agente.modelo), agente.esfuerzo].filter(Boolean).join(' · ')

  return (
    <a
      className="ca-agent-wrap"
      href={`#/agente/${encodeURIComponent(agente.id)}`}
      onClick={(evento) => evento.stopPropagation()}
    >
      <div className="ca-ag">
        <Avatar rol={agente.rol} estado={agente.estado} tamano={28} />
        <span className="meta"><b title={agente.titulo}>{agente.titulo}</b></span>
        <span className={`ca-st ${claseEstado(agente)}`}><i />{etiquetaEstado(agente.estado)}</span>
      </div>
      <div className="ca-ag ca-ag-detail">
        <span />
        <span className="ca-ctx">
          {detallesModelo !== '' && <span>{detallesModelo}</span>}
          {porcentaje !== null && (
            <>
              <span className="track" aria-hidden="true">
                <span style={{ width: `${Math.min(100, porcentaje)}%` }} />
              </span>
              <span>{porcentaje}%</span>
            </>
          )}
        </span>
        <span className="ca-ctx">⏱ {tiempoAgente(agente, ahora)}</span>
      </div>
      {agente.ultimaAccion !== null && (
        <span className="ca-agent-action" title={agente.ultimaAccion.texto}>
          {agente.ultimaAccion.texto}
        </span>
      )}
    </a>
  )
}
