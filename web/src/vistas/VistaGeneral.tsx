import type { Instantanea } from '@centro/compartido'
import { useMemo, useState } from 'react'
import { agruparProyectos } from '../logica/agrupar.js'
import { filtrarGrupos, type FiltroProyectos } from '../logica/filtrar.js'
import { fechaRelativa } from '../logica/formato.js'
import { FilaAgente } from './FilaAgente.js'
import { TarjetaProyecto } from './TarjetaProyecto.js'

type PropiedadesVistaGeneral = {
  datos: Instantanea | null
  error: boolean
  actualizadaMs: number | null
  ahora: number
}

const FILTROS: Array<{ id: FiltroProyectos; etiqueta: string }> = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'activos', etiqueta: 'Con agentes activos' },
  { id: 'esperandome', etiqueta: 'Esperándome' },
  { id: 'pendientes', etiqueta: 'Con pendientes' },
]

export function VistaGeneral({ datos, error, actualizadaMs, ahora }: PropiedadesVistaGeneral) {
  const [filtro, establecerFiltro] = useState<FiltroProyectos>('todos')
  const [busqueda, establecerBusqueda] = useState('')
  const agrupacion = useMemo(
    () => datos === null ? null : agruparProyectos(datos, ahora),
    [datos, ahora],
  )
  const grupos = useMemo(
    () => agrupacion === null ? [] : filtrarGrupos(agrupacion.grupos, filtro, busqueda),
    [agrupacion, filtro, busqueda],
  )
  const agentesRaiz = datos?.agentes.filter((agente) => agente.padreId === null) ?? []
  const trabajando = agentesRaiz.filter((agente) => agente.estado === 'trabajando').length
  const esperando = agentesRaiz.filter((agente) => agente.estado === 'esperandote').length

  return (
    <main>
      <header className="ca-bar">
        <div className="logo" aria-hidden="true">◈</div>
        <h1>Centro de agentes</h1>
        <span className="stat">● {trabajando} trabajando</span>
        <span className="stat">◌ {esperando} esperándote</span>
        <label className="search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label="Buscar proyecto, sesión o commit"
            placeholder="Buscar proyecto, sesión o commit…"
            value={busqueda}
            onChange={(evento) => establecerBusqueda(evento.target.value)}
          />
        </label>
      </header>
      <nav className="ca-filters" aria-label="Filtros de proyectos">
        {FILTROS.map((opcion) => (
          <button
            key={opcion.id}
            type="button"
            className={`ca-chipf${filtro === opcion.id ? ' on' : ''}`}
            aria-pressed={filtro === opcion.id}
            onClick={() => establecerFiltro(opcion.id)}
          >
            {opcion.etiqueta}
          </button>
        ))}
      </nav>
      <div className="ca-body">
        {error && <div className="ca-error" role="status">Sin conexión con el agente · reintentando</div>}
        {datos === null || agrupacion === null ? (
          <p className="ca-empty">Cargando…</p>
        ) : (
          <>
            <div className="ca-machine">
              <span>💻 {datos.maquina.nombre}</span>
              {actualizadaMs !== null && <small>actualizado {fechaRelativa(actualizadaMs, ahora)}</small>}
            </div>
            {datos.proyectos.length === 0 && datos.agentes.length === 0 && (
              <p className="ca-empty">No hay proyectos en las carpetas escaneadas</p>
            )}
            {grupos.map((grupo) => (
              <section key={grupo.nombre}>
                <h2 className="ca-group">
                  📁 {grupo.nombre}
                  <small>· {grupo.tarjetas.length + grupo.inactivas.length} proyectos</small>
                </h2>
                {grupo.tarjetas.length > 0 && (
                  <div className="ca-grid">
                    {grupo.tarjetas.map((tarjeta) => (
                      <TarjetaProyecto key={tarjeta.proyecto.id} tarjeta={tarjeta} ahora={ahora} />
                    ))}
                  </div>
                )}
                {grupo.inactivas.length > 0 && (
                  <div className="ca-quiet">
                    {grupo.inactivas.map((tarjeta) => (
                      <span key={tarjeta.proyecto.id}>{tarjeta.proyecto.nombre}</span>
                    ))}
                  </div>
                )}
              </section>
            ))}
            {agrupacion.sinProyecto.length > 0 && (
              <section>
                <h2 className="ca-group">Sin proyecto</h2>
                <div className="ca-card ca-orphans">
                  <div className="ca-agents">
                    {agrupacion.sinProyecto.map((agente) => (
                      <FilaAgente key={agente.id} agente={agente} ahora={ahora} />
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
