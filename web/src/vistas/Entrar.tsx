import { useState, type FormEvent } from 'react'
import { entrar, ErrorApi } from '../api.js'

const MENSAJES: Record<number, string> = {
  401: 'Contraseña incorrecta',
  403: 'Solo se puede entrar desde la red Tailscale de Pedro',
  429: 'Demasiados intentos, espera un minuto',
}

// Pantalla de entrada del hub. Aparece cuando la API responde 401.
export function Entrar({ alEntrar }: { alEntrar(): void }) {
  const [contrasena, establecerContrasena] = useState('')
  const [error, establecerError] = useState<string | null>(null)
  const [enviando, establecerEnviando] = useState(false)

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    establecerEnviando(true)
    establecerError(null)
    try {
      await entrar(contrasena)
      establecerContrasena('')
      alEntrar()
    } catch (fallo) {
      establecerError(fallo instanceof ErrorApi ? MENSAJES[fallo.estado] ?? 'No se pudo entrar' : 'Sin conexión con el hub')
    } finally {
      establecerEnviando(false)
    }
  }

  return (
    <main className="en-pantalla">
      <form className="en-panel" onSubmit={(evento) => void enviar(evento)}>
        <div className="logo" aria-hidden="true">◈</div>
        <h1>Centro de agentes</h1>
        <label htmlFor="en-contrasena">Contraseña</label>
        <input
          id="en-contrasena"
          type="password"
          autoComplete="current-password"
          value={contrasena}
          onChange={(e) => establecerContrasena(e.target.value)}
          autoFocus
        />
        <button type="submit" className="cd-btn pri" disabled={enviando || contrasena === ''}>Entrar</button>
        {error !== null && <p className="en-error" role="alert">{error}</p>}
      </form>
    </main>
  )
}
