import type { Agente } from '@centro/compartido'
import { useEffect, useRef, useState } from 'react'
import type { EventoLinea } from '../api.js'
import { Avatar } from './Avatar.js'

type PropiedadesLineaTiempo = {
  agente: Agente
  eventos: EventoLinea[]
  activo: boolean
}

const ICONOS: Record<EventoLinea['tipo'], string> = {
  usuario: '●',
  asistente: '●',
  comando: '⌨',
  edicion: '✎',
  lectura: '👁',
  busqueda: '⌕',
  subagente: '◇',
  pregunta: '?',
  otro: '•',
}

function hora(fechaMs: number): string {
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(fechaMs)
}

function Comando({ evento }: { evento: EventoLinea }) {
  const [abierto, establecerAbierto] = useState(false)
  return (
    <div className="da-comando">
      <div className="da-comando-cabecera">
        <code>{evento.texto}</code>
        {evento.detalle !== null && (
          <button type="button" onClick={() => establecerAbierto((valor) => !valor)}>
            {abierto ? 'Ocultar salida' : 'Ver salida'}
          </button>
        )}
      </div>
      {abierto && evento.detalle !== null && <pre>{evento.detalle}</pre>}
    </div>
  )
}

export function LineaTiempo({ agente, eventos, activo }: PropiedadesLineaTiempo) {
  const contenedor = useRef<HTMLDivElement>(null)
  const sigueFinal = useRef(true)

  useEffect(() => {
    const elemento = contenedor.current
    if (activo && sigueFinal.current && elemento !== null) {
      elemento.scrollTop = elemento.scrollHeight
    }
  }, [activo, eventos])

  if (eventos.length === 0) {
    return <p className="da-vacia">Todavía no hay actividad en la línea de tiempo</p>
  }

  return (
    <div
      className="da-linea"
      ref={contenedor}
      onScroll={(evento) => {
        const elemento = evento.currentTarget
        sigueFinal.current = elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight < 48
      }}
    >
      {eventos.map((evento, indice) => {
        const clave = `${evento.fechaMs}:${evento.tipo}:${evento.texto}:${indice}`
        if (evento.tipo === 'otro') {
          return (
            <div className="da-sistema" key={clave}>
              <time>{hora(evento.fechaMs)}</time> Aviso del sistema
            </div>
          )
        }

        if (evento.tipo === 'usuario') {
          return (
            <article className="da-evento da-usuario" key={clave}>
              <div className="da-burbuja">
                <div className="da-etiqueta"><strong>Tú</strong><time>{hora(evento.fechaMs)}</time></div>
                <p>{evento.texto}</p>
              </div>
            </article>
          )
        }

        if (evento.tipo === 'asistente') {
          return (
            <article className="da-evento da-asistente" key={clave}>
              <Avatar rol={agente.rol} estado={agente.estado} tamano={28} />
              <div className="da-burbuja">
                <div className="da-etiqueta"><strong>Agente</strong><time>{hora(evento.fechaMs)}</time></div>
                <p>{evento.texto}</p>
              </div>
            </article>
          )
        }

        return (
          <article className={`da-evento da-herramienta da-${evento.tipo}`} key={clave}>
            <span className="da-icono" aria-hidden="true">{ICONOS[evento.tipo]}</span>
            <div className="da-herramienta-contenido">
              <time>{hora(evento.fechaMs)}</time>
              {evento.tipo === 'comando' ? (
                <Comando evento={evento} />
              ) : evento.tipo === 'edicion' ? (
                <span className="da-edicion">✎ {evento.texto}</span>
              ) : (
                <span>{evento.texto}</span>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
