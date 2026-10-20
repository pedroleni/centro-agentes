import { useEffect, useState } from 'react'

type PropiedadesEnVivo = {
  actualizadaMs: number
  error: boolean
  ahora: number
}

export function EnVivo({ actualizadaMs, error, ahora }: PropiedadesEnVivo) {
  const [segundosTranscurridos, establecerSegundosTranscurridos] = useState(0)

  useEffect(() => {
    establecerSegundosTranscurridos(0)
    const intervalo = window.setInterval(() => {
      establecerSegundosTranscurridos((segundos) => segundos + 1)
    }, 1_000)
    return () => window.clearInterval(intervalo)
  }, [actualizadaMs, ahora])

  if (error) {
    return <span className="ca-live ca-live-error"><i aria-hidden="true">●</i> Sin conexión · reintentando</span>
  }

  const segundos = Math.floor(Math.max(
    0,
    ahora + segundosTranscurridos * 1_000 - actualizadaMs,
  ) / 1_000)

  return (
    <span className="ca-live">
      <i key={actualizadaMs} className="ca-live-pulse" aria-hidden="true">●</i>
      <span>En vivo · actualizado hace {segundos} s</span>
    </span>
  )
}
