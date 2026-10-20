import type { Commit } from '@centro/compartido'
import { useEffect, useRef, useState } from 'react'
import { obtenerCommits } from './api.js'
import { usarInstantanea } from './usarInstantanea.js'
import { FichaProyecto } from './vistas/FichaProyecto.js'
import { VistaGeneral } from './vistas/VistaGeneral.js'

export function App() {
  const [ruta, establecerRuta] = useState(window.location.hash || '#/')
  const [commits, establecerCommits] = useState<Commit[]>([])
  const [errorCommits, establecerErrorCommits] = useState(false)
  const ultimaPeticionCommits = useRef<{
    proyectoId: string
    hash: string | null
    actualizadaMs: number | null
    fallo: boolean
  } | null>(null)
  const instantanea = usarInstantanea()
  const coincidenciaProyecto = /^#\/proyecto\/([^/]+)$/.exec(ruta)
  const proyectoId = coincidenciaProyecto?.[1] ?? null
  const proyectoAbierto = proyectoId === null
    ? null
    : instantanea.datos?.proyectos.find((proyecto) => proyecto.id === proyectoId) ?? null
  const hashProyecto = proyectoAbierto?.git.ultimoCommit?.hash ?? null

  useEffect(() => {
    const actualizarRuta = () => {
      window.scrollTo(0, 0)
      establecerRuta(window.location.hash || '#/')
    }
    window.addEventListener('hashchange', actualizarRuta)
    return () => window.removeEventListener('hashchange', actualizarRuta)
  }, [])

  useEffect(() => {
    establecerCommits([])
    establecerErrorCommits(false)
    ultimaPeticionCommits.current = null
  }, [proyectoId])

  useEffect(() => {
    if (proyectoId === null || proyectoAbierto === null) return

    const anterior = ultimaPeticionCommits.current
    const cambioProyecto = anterior?.proyectoId !== proyectoId
    const cambioHash = anterior?.hash !== hashProyecto
    const nuevaInstantanea = anterior?.actualizadaMs !== instantanea.actualizadaMs
    const reintento = anterior?.fallo === true && nuevaInstantanea
    if (anterior !== null && !cambioProyecto && !cambioHash && !reintento) return

    const peticion = {
      proyectoId,
      hash: hashProyecto,
      actualizadaMs: instantanea.actualizadaMs,
      fallo: false,
    }
    ultimaPeticionCommits.current = peticion

    void obtenerCommits(proyectoId)
      .then((nuevosCommits) => {
        if (ultimaPeticionCommits.current !== peticion) return
        establecerCommits(nuevosCommits)
        establecerErrorCommits(false)
      })
      .catch(() => {
        if (ultimaPeticionCommits.current !== peticion) return
        peticion.fallo = true
        establecerErrorCommits(true)
      })
  }, [hashProyecto, instantanea.actualizadaMs, proyectoAbierto, proyectoId])

  let contenido
  if (proyectoId !== null) {
    if (instantanea.datos === null) {
      contenido = instantanea.error ? null : <p className="ca-empty">Cargando…</p>
    } else {
      contenido = (
      <FichaProyecto
        proyecto={proyectoAbierto}
        agentes={instantanea.datos.agentes}
        commits={commits}
        errorCommits={errorCommits}
        ahora={Date.now()}
      />
      )
    }
  } else {
    contenido = <VistaGeneral {...instantanea} error={false} ahora={Date.now()} />
  }

  return (
    <>
      {instantanea.error && (
        <div className="ca-error" role="status">
          Sin conexión con el agente · reintentando
        </div>
      )}
      {contenido}
    </>
  )
}
