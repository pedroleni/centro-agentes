import type { TarjetaDatos } from '../logica/agrupar.js'
import { fechaRelativa } from '../logica/formato.js'
import { rutaProyecto } from '../logica/rutas.js'
import { FilaAgente } from './FilaAgente.js'

type PropiedadesTarjetaProyecto = {
  tarjeta: TarjetaDatos
  ahora: number
  maquinaId?: string | null
}

function alturaActividad(valor: number, maximo: number): number {
  if (valor === 0 || maximo === 0) {
    return 2
  }
  return Math.max(4, Math.round(16 * valor / maximo))
}

export function TarjetaProyecto({ tarjeta, ahora, maquinaId = null }: PropiedadesTarjetaProyecto) {
  const { proyecto, agentes } = tarjeta
  const agentesVisibles = agentes.slice(0, 4)
  const agentesRestantes = agentes.length - agentesVisibles.length
  const maximoActividad = Math.max(...proyecto.git.actividad14d)
  const ultimoCommit = proyecto.git.ultimoCommit
  const href = rutaProyecto(maquinaId, proyecto.id)

  return (
    <article
      className={`ca-card ca-card-clickable${tarjeta.activo ? ' live' : ''}`}
      data-testid={`tarjeta-proyecto-${proyecto.id}`}
      onClick={() => { window.location.hash = href }}
    >
      <a className="ca-card-link" href={href} aria-label={proyecto.nombre} />
      <div className="ca-head">
        <span className="name mono" title={proyecto.nombre}>
          {proyecto.nombre}
        </span>
      </div>
      {tarjeta.ultimoPrompt !== null && (
        <div className="ca-prompt" title={tarjeta.ultimoPrompt}>{tarjeta.ultimoPrompt}</div>
      )}
      <div className="ca-chips">
        {proyecto.git.rama !== null && <span className="ca-chip mono">⑂ {proyecto.git.rama}</span>}
        {proyecto.git.cambios > 0 && <span className="ca-chip">{proyecto.git.cambios} sin commit</span>}
        {tarjeta.pendientes > 0 && (
          <span className="ca-chip warn">⚑ {tarjeta.pendientes} pendientes</span>
        )}
      </div>
      {agentesVisibles.length > 0 && (
        <div className="ca-agents">
          {agentesVisibles.map((agente) => (
            <FilaAgente maquinaId={maquinaId} key={agente.id} agente={agente} ahora={ahora} />
          ))}
          {agentesRestantes > 0 && <span className="ca-more">+{agentesRestantes} más</span>}
        </div>
      )}
      <div className="ca-foot">
        <span title={ultimoCommit?.mensaje}>
          {ultimoCommit === null
            ? `Sin actividad · ${fechaRelativa(proyecto.ultimaActividadMs, ahora)}`
            : `Último commit ${fechaRelativa(ultimoCommit.fechaMs, ahora)}`}
        </span>
        <span className="ca-spark" aria-label="Actividad de los últimos 14 días">
          {proyecto.git.actividad14d.map((valor, indice) => (
            <i key={indice} style={{ height: `${alturaActividad(valor, maximoActividad)}px` }} />
          ))}
        </span>
      </div>
    </article>
  )
}
