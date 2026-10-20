import type { MaquinaVista, RespuestaMaquinas } from '@centro/compartido'
import { useMemo, useState } from 'react'
import { agruparProyectos } from '../logica/agrupar.js'
import { filtrarGrupos, type FiltroProyectos } from '../logica/filtrar.js'
import { fechaRelativa } from '../logica/formato.js'
import { AnadirMaquina } from './AnadirMaquina.js'
import { EnDirecto } from './EnDirecto.js'
import { EnVivo } from './EnVivo.js'
import { FilaAgente } from './FilaAgente.js'
import { TarjetaProyecto } from './TarjetaProyecto.js'
import { rutaTerminal } from '../logica/rutas.js'

type PropiedadesVistaGeneral = {
  respuesta: RespuestaMaquinas | null
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

const ICONO_SO = { macos: '🍎', windows: '🪟', linux: '🐧' } as const

function estadoMaquina(maquina: MaquinaVista, ahora: number): string {
  if (maquina.conectada) return '● Conectada'
  if (maquina.ultimoLatidoMs === null) return '○ Todavía no se ha conectado'
  return `○ Desconectada · último latido ${fechaRelativa(maquina.ultimoLatidoMs, ahora)}`
}

function BloqueMaquina({ maquina, filtro, busqueda, ahora }: {
  maquina: MaquinaVista
  filtro: FiltroProyectos
  busqueda: string
  ahora: number
}) {
  const instantanea = maquina.instantanea
  const agrupacion = useMemo(() => (instantanea === null ? null : agruparProyectos(instantanea, ahora)), [instantanea, ahora])
  const grupos = useMemo(
    () => (agrupacion === null ? [] : filtrarGrupos(agrupacion.grupos, filtro, busqueda)),
    [agrupacion, filtro, busqueda],
  )

  return (
    <section className={`ma-bloque${maquina.conectada ? '' : ' ma-desconectada'}`} aria-label={maquina.nombre}>
      <div className="ca-machine">
        <span className="ma-nombre">
          <span aria-hidden="true">{ICONO_SO[maquina.so]}</span> <strong>{maquina.nombre}</strong>
        </span>
        <span className={`ma-estado${maquina.conectada ? ' on' : ''}`}>{estadoMaquina(maquina, ahora)}</span>
      </div>
      {(instantanea?.terminales ?? []).length > 0 && (
        <div className="ma-terminales" aria-label="Terminales abiertos">
          <span className="ma-terminales-titulo">Terminales abiertos</span>
          {(instantanea?.terminales ?? []).map((terminal) => (
            <a key={terminal.id} className="ma-terminal" href={rutaTerminal(maquina.id, terminal.id)} aria-label={`Entrar en ${terminal.titulo}`}>
              <span aria-hidden="true">⌨</span> {terminal.titulo} <strong>Entrar ›</strong>
            </a>
          ))}
        </div>
      )}
      {instantanea === null || agrupacion === null ? (
        <p className="ca-empty">Sin datos todavía de esta máquina</p>
      ) : (
        <>
          {instantanea.proyectos.length === 0 && instantanea.agentes.length === 0 && (
            <p className="ca-empty">No hay proyectos en las carpetas escaneadas</p>
          )}
          {grupos.map((grupo) => {
            const numeroProyectos = grupo.tarjetas.length + grupo.inactivas.length
            return (
              <section key={grupo.nombre}>
                <h2 className="ca-group">
                  📁 {grupo.nombre}
                  <small>· {numeroProyectos} {numeroProyectos === 1 ? 'proyecto' : 'proyectos'}</small>
                </h2>
                {grupo.tarjetas.length > 0 && (
                  <div className="ca-grid">
                    {grupo.tarjetas.map((tarjeta) => (
                      <TarjetaProyecto key={tarjeta.proyecto.id} tarjeta={tarjeta} ahora={ahora} maquinaId={maquina.id} />
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
            )
          })}
          {agrupacion.sinProyecto.length > 0 && (
            <section>
              <h2 className="ca-group">Sin proyecto</h2>
              <div className="ca-card ca-orphans">
                <div className="ca-agents">
                  {agrupacion.sinProyecto.map((agente) => (
                    <FilaAgente key={agente.id} agente={agente} ahora={ahora} maquinaId={maquina.id} />
                  ))}
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </section>
  )
}

export function VistaGeneral({ respuesta, error, actualizadaMs, ahora }: PropiedadesVistaGeneral) {
  const [filtro, establecerFiltro] = useState<FiltroProyectos>('todos')
  const [busqueda, establecerBusqueda] = useState('')
  const [anadiendo, establecerAnadiendo] = useState(false)
  const maquinas = respuesta?.maquinas ?? []
  const agentesRaiz = maquinas.flatMap((maquina) => maquina.instantanea?.agentes ?? []).filter((agente) => agente.padreId === null)
  const trabajando = agentesRaiz.filter((agente) => agente.estado === 'trabajando').length
  const esperando = agentesRaiz.filter((agente) => agente.estado === 'esperandote').length
  const fuentes = maquinas.flatMap((maquina) => (maquina.instantanea === null ? [] : [{
    maquina: { id: maquina.id, nombre: maquina.nombre },
    agentes: maquina.instantanea.agentes,
    proyectos: maquina.instantanea.proyectos,
  }]))

  return (
    <main>
      <header className="ca-bar">
        <div className="logo" aria-hidden="true">◈</div>
        <h1>Centro de agentes</h1>
        <span className="stat">● {trabajando} trabajando</span>
        <span className="stat">◌ {esperando} esperándote</span>
        {respuesta?.modo === 'hub' && (
          <button type="button" className="ca-anadir" onClick={() => establecerAnadiendo(true)}>
            ＋ Añadir máquina
          </button>
        )}
        <label className="search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label="Buscar proyecto, sesión o commit"
            placeholder="Buscar proyecto o sesión…"
            value={busqueda}
            onChange={(evento) => establecerBusqueda(evento.target.value)}
          />
        </label>
      </header>
      {anadiendo && respuesta?.modo === 'hub' && (
        <AnadirMaquina maquinas={maquinas} ahora={ahora} alCerrar={() => establecerAnadiendo(false)} />
      )}
      <div className="ca-body">
        {respuesta === null ? (
          error
            ? <p className="ca-empty">Sin conexión con el agente · reintentando</p>
            : <p className="ca-empty">Cargando…</p>
        ) : (
          <>
            <div className="ca-vivo-global">
              <EnVivo actualizadaMs={actualizadaMs ?? ahora} error={error} ahora={ahora} />
            </div>
            <EnDirecto fuentes={fuentes} ahora={ahora} />
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
            {maquinas.length === 0 && (
              <p className="ca-empty">Todavía no hay máquinas dadas de alta. Pulsa «Añadir máquina».</p>
            )}
            {maquinas.map((maquina) => (
              <BloqueMaquina key={maquina.id} maquina={maquina} filtro={filtro} busqueda={busqueda} ahora={ahora} />
            ))}
          </>
        )}
      </div>
    </main>
  )
}
