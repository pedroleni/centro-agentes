import type { Commit } from '@centro/compartido'
import { useEffect, useState } from 'react'
import { obtenerCommits } from './api.js'
import { usarInstantanea } from './usarInstantanea.js'
import { FichaProyecto } from './vistas/FichaProyecto.js'
import { VistaGeneral } from './vistas/VistaGeneral.js'

export function App() {
  const [ruta, establecerRuta] = useState(window.location.hash || '#/')
  const [commits, establecerCommits] = useState<Commit[]>([])
  const instantanea = usarInstantanea()
  const coincidenciaProyecto = /^#\/proyecto\/([^/]+)$/.exec(ruta)
  const proyectoId = coincidenciaProyecto?.[1] ?? null

  useEffect(() => {
    const actualizarRuta = () => establecerRuta(window.location.hash || '#/')
    window.addEventListener('hashchange', actualizarRuta)
    return () => window.removeEventListener('hashchange', actualizarRuta)
  }, [])

  useEffect(() => {
    let activo = true
    establecerCommits([])
    if (proyectoId === null) return () => { activo = false }

    void obtenerCommits(proyectoId)
      .then((nuevosCommits) => {
        if (activo) establecerCommits(nuevosCommits)
      })
      .catch(() => {
        if (activo) establecerCommits([])
      })
    return () => { activo = false }
  }, [proyectoId])

  if (proyectoId !== null) {
    if (instantanea.datos === null) return <p className="ca-empty">Cargando…</p>
    const proyecto = instantanea.datos.proyectos.find((candidato) => candidato.id === proyectoId) ?? null
    return (
      <FichaProyecto
        proyecto={proyecto}
        agentes={instantanea.datos.agentes}
        commits={commits}
        ahora={Date.now()}
      />
    )
  }

  return <VistaGeneral {...instantanea} ahora={Date.now()} />
}
