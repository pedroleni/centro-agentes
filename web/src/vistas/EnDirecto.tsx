import type { Accion, Agente, Proyecto } from '@centro/compartido'
import { etiquetaEstado, fechaRelativa, porcentajeContexto, tiempoAgente } from '../logica/formato.js'
import { nombreRol } from '../logica/roles.js'
import { Avatar } from './Avatar.js'

type PropiedadesEnDirecto = {
  agentes: Agente[]
  proyectos: Proyecto[]
  ahora: number
}

const ICONOS_ACCION: Record<Accion['tipo'], string> = {
  comando: '⌨',
  edicion: '✎',
  lectura: '👁',
  busqueda: '🔍',
  subagente: '🤖',
  pregunta: '❓',
  mensaje: '💬',
  otro: '•',
}

function AnilloContexto({ porcentaje }: { porcentaje: number | null }) {
  const valor = Math.min(100, Math.max(0, porcentaje ?? 0))
  return (
    <svg
      className="ca-direct-context"
      width="44"
      height="44"
      viewBox="0 0 44 44"
      role="img"
      aria-label={porcentaje === null ? 'Contexto desconocido' : `${porcentaje}% de contexto`}
    >
      <circle className="fondo" cx="22" cy="22" r="17" pathLength="100" />
      <circle className="valor" cx="22" cy="22" r="17" pathLength="100" strokeDasharray={`${valor} 100`} />
      <text x="22" y="22">{porcentaje === null ? '?' : porcentaje}</text>
      {porcentaje !== null && <text className="simbolo" x="22" y="29">%</text>}
    </svg>
  )
}

function proyectoDelAgente(agente: Agente, proyectos: Proyecto[]): Proyecto | null {
  return proyectos.find((proyecto) => agente.proyectoIds.includes(proyecto.id)) ?? null
}

export function EnDirecto({ agentes, proyectos, ahora }: PropiedadesEnDirecto) {
  const activos = agentes.filter((agente) =>
    agente.estado === 'trabajando'
      || agente.estado === 'esperandote'
      || agente.estado === 'en-curso',
  )
  const terminadosRecientes = agentes.filter((agente) =>
    agente.estado === 'terminado'
      && ahora - agente.ultimaActividadMs < 15 * 60_000,
  )
  const visibles = [...activos, ...terminadosRecientes]

  return (
    <section className="ca-direct" aria-labelledby="titulo-en-directo">
      <h2 id="titulo-en-directo">En directo</h2>
      {visibles.length === 0 ? (
        <p className="ca-direct-empty">Ningún agente trabajando ahora mismo</p>
      ) : (
        <div className="ca-direct-grid">
          {visibles.map((agente) => {
            const proyecto = proyectoDelAgente(agente, proyectos)
            const accion = agente.ultimaAccion
            const porcentaje = porcentajeContexto(agente)
            const familia = agente.rol.startsWith('claude') ? 'claude' : 'codex'
            const estado = agente.estado === 'trabajando' || agente.estado === 'en-curso'
              ? 'run'
              : agente.estado === 'esperandote' ? 'wait' : 'done'

            return (
              <a
                key={agente.id}
                className={`ca-direct-card ${familia} ${estado}`}
                href={`#/agente/${encodeURIComponent(agente.id)}`}
              >
                <Avatar rol={agente.rol} estado={agente.estado} tamano={88} />
                <span className="ca-direct-info">
                  <span className="ca-direct-role">{nombreRol(agente.rol)}</span>
                  <strong title={agente.titulo}>{agente.titulo}</strong>
                  <span className="ca-direct-project">{proyecto?.nombre ?? 'Sin proyecto'}</span>
                  <span className="ca-direct-action" title={accion?.texto}>
                    <span aria-hidden="true">{accion === null ? '💬' : ICONOS_ACCION[accion.tipo]}</span>
                    <span>{accion?.texto ?? 'Sin acciones todavía'}</span>
                    {accion !== null && <time>{fechaRelativa(accion.fechaMs, ahora)}</time>}
                  </span>
                  <span className={`ca-direct-state ${estado}`}>
                    <i aria-hidden="true" />
                    {etiquetaEstado(agente.estado)} · {tiempoAgente(agente, ahora)}
                  </span>
                </span>
                <AnilloContexto porcentaje={porcentaje} />
              </a>
            )
          })}
        </div>
      )}
    </section>
  )
}
