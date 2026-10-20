import type { EstadoAgente, Rol } from '@centro/compartido'
import { useEffect, useState } from 'react'
import { colorRol, nombreRol } from '../logica/roles.js'

type PropiedadesAvatar = {
  rol: Rol
  estado: EstadoAgente
  tamano: number
}

function claseEstado(estado: EstadoAgente): string {
  if (estado === 'trabajando' || estado === 'en-curso') return 'av-trabaja'
  if (estado === 'esperandote') return 'av-espera'
  return 'av-reposo'
}

export function Avatar({ rol, estado, tamano }: PropiedadesAvatar) {
  const [errorImagen, establecerErrorImagen] = useState(false)
  const esClaude = rol.startsWith('claude')

  useEffect(() => establecerErrorImagen(false), [rol])

  return (
    <span
      className={`av-marco ${claseEstado(estado)}`}
      style={{ width: tamano, height: tamano }}
    >
      <span className="av-circulo" style={{ backgroundColor: colorRol(rol) }}>
        {errorImagen ? (
          <span
            className="av-respaldo"
            aria-label={nombreRol(rol)}
            style={{ fontSize: Math.max(12, Math.round(tamano * .34)) }}
          >
            {esClaude ? '✱' : '◎'}
          </span>
        ) : (
          <img
            src={`/agentes/${rol}.png`}
            alt={nombreRol(rol)}
            onError={() => establecerErrorImagen(true)}
          />
        )}
      </span>
    </span>
  )
}
