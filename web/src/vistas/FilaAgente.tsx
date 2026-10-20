import type { Agente } from '@centro/compartido'
import {
  duracionCorta,
  etiquetaEstado,
  porcentajeContexto,
} from '../logica/formato.js'

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
  const icono = agente.tipo === 'claude' ? '✱' : '◎'
  const claseTipo = agente.tipo === 'claude' ? 'cl' : 'cx'
  const detallesModelo = [agente.modelo, agente.esfuerzo].filter(Boolean).join(' · ')

  return (
    <div className="ca-agent-wrap">
      <div className="ca-ag">
        <span className={`ca-av ${claseTipo}`} aria-hidden="true">{icono}</span>
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
        {agente.inicioMs !== null && (
          <span className="ca-ctx">⏱ {duracionCorta(ahora - agente.inicioMs)}</span>
        )}
      </div>
    </div>
  )
}
