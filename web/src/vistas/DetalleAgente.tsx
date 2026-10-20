import type { Agente, Proyecto } from '@centro/compartido'
import type { ResultadoLinea } from '../api.js'
import { etiquetaEstado, nombreModelo, porcentajeContexto, tiempoAgente } from '../logica/formato.js'
import { nombreRol } from '../logica/roles.js'
import { Avatar } from './Avatar.js'
import { LineaTiempo } from './LineaTiempo.js'

type PropiedadesDetalleAgente = {
  agente: Agente | null
  proyectos: Proyecto[]
  linea: ResultadoLinea | null
  cargarAnteriores: () => void
  ahora: number
}

function estaActivo(agente: Agente): boolean {
  return agente.estado === 'trabajando'
    || agente.estado === 'esperandote'
    || agente.estado === 'en-curso'
}

function AnilloContexto({ porcentaje }: { porcentaje: number | null }) {
  const valor = Math.min(100, Math.max(0, porcentaje ?? 0))
  return (
    <svg className="da-contexto" width="64" height="64" viewBox="0 0 64 64" role="img"
      aria-label={porcentaje === null ? 'Contexto desconocido' : `${porcentaje}% de contexto`}>
      <circle className="fondo" cx="32" cy="32" r="25" pathLength="100" />
      <circle className="valor" cx="32" cy="32" r="25" pathLength="100"
        strokeDasharray={`${valor} 100`} />
      <text x="32" y="30">{porcentaje === null ? '?' : porcentaje}</text>
      <text className="leyenda" x="32" y="42">{porcentaje === null ? 'contexto' : '%'}</text>
    </svg>
  )
}

export function DetalleAgente({
  agente,
  proyectos,
  linea,
  cargarAnteriores,
  ahora,
}: PropiedadesDetalleAgente) {
  if (agente === null) {
    return (
      <main className="cd-not-found">
        <h1>Este agente ya no está disponible</h1>
        <a href="#/">Volver</a>
      </main>
    )
  }

  const proyectosAgente = proyectos.filter((proyecto) => agente.proyectoIds.includes(proyecto.id))
  const porcentaje = porcentajeContexto(agente)
  const estado = agente.estado === 'trabajando' || agente.estado === 'en-curso'
    ? 'run'
    : agente.estado === 'esperandote' ? 'wait' : 'done'

  return (
    <main className="da-pagina">
      <a className="da-volver" href="#/">‹ Todos los agentes</a>
      <header className="da-cabecera">
        <Avatar rol={agente.rol} estado={agente.estado} tamano={120} />
        <div className="da-identidad">
          <h1>{nombreRol(agente.rol)}</h1>
          <p className="da-titulo">{agente.titulo}</p>
          <div className="da-proyectos">
            {proyectosAgente.length === 0 ? (
              <span className="ca-chip">Sin proyecto</span>
            ) : proyectosAgente.map((proyecto) => (
              <a className="ca-chip" href={`#/proyecto/${proyecto.id}`} key={proyecto.id}>
                {proyecto.nombre}
              </a>
            ))}
          </div>
          <div className="da-modelo">
            {nombreModelo(agente.modelo) !== '' && <span>{nombreModelo(agente.modelo)}</span>}
            {agente.esfuerzo !== null && <span>Esfuerzo {agente.esfuerzo}</span>}
          </div>
        </div>
        <AnilloContexto porcentaje={porcentaje} />
        <div className={`da-estado ${estado}`}>
          <span><i aria-hidden="true" />{etiquetaEstado(agente.estado)}</span>
          <time>{tiempoAgente(agente, ahora)}</time>
        </div>
      </header>

      <section className="da-resumen" aria-labelledby="da-resumen-titulo">
        <h2 id="da-resumen-titulo">Qué ha hecho</h2>
        <div className="da-contadores">
          <div><strong>{agente.resumenActividad.comandos}</strong><span>⌨ comandos</span></div>
          <div><strong>{agente.resumenActividad.ediciones}</strong><span>✎ ediciones</span></div>
          <div><strong>{agente.resumenActividad.mensajes}</strong><span>💬 mensajes</span></div>
        </div>
        {agente.resumenActividad.ficheros.length > 0 && (
          <div className="da-ficheros">
            {agente.resumenActividad.ficheros.map((fichero) => (
              <span className="ca-chip mono" key={fichero}>{fichero}</span>
            ))}
          </div>
        )}
      </section>

      <section className="da-actividad" aria-labelledby="da-actividad-titulo">
        <div className="da-seccion-cabecera">
          <h2 id="da-actividad-titulo">Línea de tiempo</h2>
          {linea?.antes !== null && linea !== null && (
            <button className="cd-btn" type="button" onClick={cargarAnteriores}>
              Cargar anteriores
            </button>
          )}
        </div>
        {linea === null ? (
          <p className="da-vacia">Cargando actividad…</p>
        ) : (
          <LineaTiempo agente={agente} eventos={linea.eventos} activo={estaActivo(agente)} />
        )}
      </section>
    </main>
  )
}
