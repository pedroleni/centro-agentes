import { useState } from 'react'
import { crearTerminal, type PedidoTerminal } from '../api.js'
import { rutaTerminal } from '../logica/rutas.js'

// Botón que abre un terminal en una máquina (continuar una sesión o una nueva) y
// lleva a él. Si el servidor lo rechaza, enseña su motivo junto al botón.
export function BotonTerminal({ maquinaId, pedido, children, principal = true }: {
  maquinaId: string
  pedido: PedidoTerminal
  children: React.ReactNode
  principal?: boolean
}) {
  const [abriendo, establecerAbriendo] = useState(false)
  const [error, establecerError] = useState<string | null>(null)

  async function abrir(evento: React.MouseEvent): Promise<void> {
    evento.preventDefault()
    evento.stopPropagation()
    establecerAbriendo(true)
    establecerError(null)
    try {
      const terminal = await crearTerminal(maquinaId, pedido)
      window.location.hash = rutaTerminal(maquinaId, terminal.id)
    } catch (fallo) {
      establecerError(fallo instanceof Error ? fallo.message : 'No se pudo abrir el terminal')
    } finally {
      establecerAbriendo(false)
    }
  }

  return (
    <span className="bt-terminal">
      <button type="button" className={`cd-btn${principal ? ' pri' : ''}`} disabled={abriendo} onClick={(e) => void abrir(e)}>
        {abriendo ? 'Abriendo…' : children}
      </button>
      {error !== null && <span className="bt-error" role="alert">{error}</span>}
    </span>
  )
}
