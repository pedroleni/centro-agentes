import type { Agente, Commit, Proyecto } from '@centro/compartido'
import { Historial } from './Historial.js'
import { Sesiones } from './Sesiones.js'
import { Tareas } from './Tareas.js'

type PropiedadesFichaProyecto = {
  proyecto: Proyecto | null
  agentes: Agente[]
  commits: Commit[]
  ahora: number
}

export function FichaProyecto({ proyecto, agentes, commits, ahora }: PropiedadesFichaProyecto) {
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
        <nav className="cd-tabs" aria-label="Secciones del proyecto">
          <span className="on">Resumen</span><span>Historial</span><span>Tareas</span><span>Sesiones</span><span>Ramas</span>
        </nav>
      </header>
      <div className="cd-main">
        <Historial commits={commits} agentes={agentes} proyectoId={proyecto.id} ahora={ahora} />
        <div className="cd-side">
          <Tareas proyecto={proyecto} agentes={agentes} />
          <Sesiones agentes={agentes} proyectoId={proyecto.id} />
        </div>
      </div>
    </main>
  )
}
