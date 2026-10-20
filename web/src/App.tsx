import type { Commit } from '@centro/compartido'
import { useCallback, useEffect, useRef, useState } from 'react'
import { obtenerCommits, obtenerLinea, type ResultadoLinea } from './api.js'
import { usarInstantanea } from './usarInstantanea.js'
import { DetalleAgente } from './vistas/DetalleAgente.js'
import { FichaProyecto } from './vistas/FichaProyecto.js'
import { VistaGeneral } from './vistas/VistaGeneral.js'

export function App() {
  const [ruta, establecerRuta] = useState(window.location.hash || '#/')
  const [commits, establecerCommits] = useState<Commit[]>([])
  const [errorCommits, establecerErrorCommits] = useState(false)
  const [linea, establecerLinea] = useState<ResultadoLinea | null>(null)
  const [agenteNoDisponible, establecerAgenteNoDisponible] = useState(false)
  const ultimaPeticionCommits = useRef<{
    proyectoId: string
    hash: string | null
    actualizadaMs: number | null
    fallo: boolean
  } | null>(null)
  const instantanea = usarInstantanea()
  const coincidenciaProyecto = /^#\/proyecto\/([^/]+)$/.exec(ruta)
  const proyectoId = coincidenciaProyecto?.[1] ?? null
  const coincidenciaAgente = /^#\/agente\/([^/]+)$/.exec(ruta)
  let agenteId: string | null = null
  try {
    agenteId = coincidenciaAgente?.[1] === undefined
      ? null
      : decodeURIComponent(coincidenciaAgente[1])
  } catch {
    agenteId = null
  }
  const proyectoAbierto = proyectoId === null
    ? null
    : instantanea.datos?.proyectos.find((proyecto) => proyecto.id === proyectoId) ?? null
  const hashProyecto = proyectoAbierto?.git.ultimoCommit?.hash ?? null
  const agenteAbierto = agenteId === null
    ? null
    : instantanea.datos?.agentes.find((agente) => agente.id === agenteId) ?? null
  const agenteActivo = agenteAbierto !== null && (
    agenteAbierto.estado === 'trabajando'
    || agenteAbierto.estado === 'esperandote'
    || agenteAbierto.estado === 'en-curso'
  )

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

  const combinarLinea = useCallback((nueva: ResultadoLinea, conservarAntes: boolean) => {
    establecerLinea((anterior) => {
      if (anterior === null) return nueva
      const eventos = [...anterior.eventos, ...nueva.eventos]
      const vistos = new Set<string>()
      const unicos = eventos.filter((evento) => {
        const clave = `${evento.fechaMs}\u0000${evento.texto}`
        if (vistos.has(clave)) return false
        vistos.add(clave)
        return true
      }).sort((a, b) => a.fechaMs - b.fechaMs)
      return {
        eventos: unicos,
        antes: conservarAntes ? anterior.antes : nueva.antes,
      }
    })
  }, [])

  useEffect(() => {
    establecerLinea(null)
    establecerAgenteNoDisponible(false)
    if (agenteId === null) return
    let vigente = true
    void obtenerLinea(agenteId, null)
      .then((resultado) => {
        if (vigente) combinarLinea(resultado, false)
      })
      .catch(() => {
        if (vigente) establecerAgenteNoDisponible(true)
      })
    return () => { vigente = false }
  }, [agenteId, combinarLinea])

  useEffect(() => {
    if (agenteId === null || !agenteActivo) return
    const temporizador = setInterval(() => {
      void obtenerLinea(agenteId, null)
        .then((resultado) => combinarLinea(resultado, true))
        .catch(() => establecerAgenteNoDisponible(true))
    }, 3_000)
    return () => clearInterval(temporizador)
  }, [agenteActivo, agenteId, combinarLinea])

  const cargarAnteriores = useCallback(() => {
    if (agenteId === null || linea?.antes == null) return
    void obtenerLinea(agenteId, linea.antes)
      .then((resultado) => combinarLinea(resultado, false))
      .catch(() => establecerAgenteNoDisponible(true))
  }, [agenteId, combinarLinea, linea?.antes])

  let contenido
  if (coincidenciaAgente !== null) {
    if (instantanea.datos === null && !instantanea.error) {
      contenido = <p className="ca-empty da-cargando">Cargando…</p>
    } else {
      contenido = (
        <DetalleAgente
          agente={agenteNoDisponible ? null : agenteAbierto}
          proyectos={instantanea.datos?.proyectos ?? []}
          linea={linea}
          cargarAnteriores={cargarAnteriores}
          ahora={Date.now()}
        />
      )
    }
  } else if (proyectoId !== null) {
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
    contenido = <VistaGeneral {...instantanea} ahora={Date.now()} />
  }

  return (
    <>
      {instantanea.error && (proyectoId !== null || coincidenciaAgente !== null) && (
        <div className="ca-error" role="status">
          Sin conexión con el agente · reintentando
        </div>
      )}
      {contenido}
    </>
  )
}
