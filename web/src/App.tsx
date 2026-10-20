import { useEffect, useState } from 'react'
import { usarInstantanea } from './usarInstantanea.js'
import { VistaGeneral } from './vistas/VistaGeneral.js'

export function App() {
  const [ruta, establecerRuta] = useState(window.location.hash || '#/')
  const instantanea = usarInstantanea()

  useEffect(() => {
    const actualizarRuta = () => establecerRuta(window.location.hash || '#/')
    window.addEventListener('hashchange', actualizarRuta)
    return () => window.removeEventListener('hashchange', actualizarRuta)
  }, [])

  if (ruta.startsWith('#/proyecto/')) {
    return <p>Cargando…</p>
  }

  return <VistaGeneral {...instantanea} ahora={Date.now()} />
}
