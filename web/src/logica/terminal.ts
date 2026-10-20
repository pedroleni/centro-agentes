import { CIERRE_TERMINAL } from '@centro/compartido'

export type EstadoTerminal = 'conectando' | 'conectado' | 'reconectando' | 'terminado' | 'no-encontrado' | 'desconectada' | 'sin-sesion'

// Qué hace la vista cuando se cierra el WebSocket: los cierres con motivo conocido
// lo dicen y paran; cualquier otro (red, reinicio del hub…) vuelve a intentarlo.
export function estadoTrasCierre(codigo: number): EstadoTerminal {
  if (codigo === CIERRE_TERMINAL.terminada) return 'terminado'
  if (codigo === CIERRE_TERMINAL.noEncontrado) return 'no-encontrado'
  if (codigo === CIERRE_TERMINAL.maquinaDesconectada) return 'desconectada'
  if (codigo === CIERRE_TERMINAL.sesionCaducada) return 'sin-sesion'
  return 'reconectando'
}
