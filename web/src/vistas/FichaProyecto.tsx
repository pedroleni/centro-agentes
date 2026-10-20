import type { Agente, Commit, Proyecto } from '@centro/compartido'
import { Historial } from './Historial.js'
import { Sesiones } from './Sesiones.js'
import { Tareas } from './Tareas.js'

type PropiedadesFichaProyecto = {
  proyecto: Proyecto | null
  agentes: Agente[]
  commits: Commit[]
  errorCommits?: boolean
  ahora: number
  maquinaId?: string | null
}

export function FichaProyecto({
  proyecto,
  agentes,
  commits,
  errorCommits = false,
  ahora,
  maquinaId = null,
}: PropiedadesFichaProyecto) {
  if (proyecto === null) {
    return (
      <main className="cd-not-found">
        <h1>Proyecto no encontrado</h1>
        <a href="#/">Volver</a>
      </main>
    )
  }

  return (
    <main>
      <header className="cd-top">
        <div className="cd-crumb">Proyectos › {proyecto.grupo} ›</div>
        <div className="cd-title">
          <h1 className="mono">{proyecto.nombre}</h1>
          {proyecto.git.rama !== null && <span className="ca-chip mono">⑂ {proyecto.git.rama}</span>}
          <span className="ca-chip">{proyecto.git.ramas.length} ramas</span>
          <span className="ca-chip">{proyecto.git.cambios} sin commit</span>
        </div>
      </header>
      {errorCommits && (
        <div className="ca-error cd-history-error" role="status">
          No se pudo cargar el historial · reintentando
        </div>
      )}
      <div className="cd-main">
        <Historial commits={commits} agentes={agentes} proyectoId={proyecto.id} ahora={ahora} maquinaId={maquinaId} />
        <div className="cd-side">
          <Tareas proyecto={proyecto} agentes={agentes} />
          <Sesiones agentes={agentes} proyectoId={proyecto.id} maquinaId={maquinaId} />
        </div>
      </div>
    </main>
  )
}
