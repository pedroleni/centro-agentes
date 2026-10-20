import type { Instantanea, TerminalInfo } from '@centro/compartido'
import type { GestorTerminales } from './gestor.js'
import { ordenTerminal } from './ordenes.js'

// Crea un terminal a partir de una petición con ids, buscando la sesión o el
// proyecto en la instantánea de esta misma máquina: nunca se fía de rutas ni de
// órdenes que vengan de fuera.

export type PedidoTerminal =
  | { accion: 'continuar'; agenteId: string }
  | { accion: 'nueva'; tipo: 'claude' | 'codex'; proyectoId: string }

export type ResultadoTerminal =
  | { ok: true; terminal: TerminalInfo }
  | { ok: false; estado: 400 | 404 | 409 | 429 | 500; error: string }

export async function crearTerminalPedido(
  pedido: PedidoTerminal,
  instantanea: Pick<Instantanea, 'agentes' | 'proyectos'>,
  gestor: Pick<GestorTerminales, 'crear'>,
): Promise<ResultadoTerminal> {
  let orden
  if (pedido.accion === 'continuar') {
    const agente = instantanea.agentes.find((candidato) => candidato.id === pedido.agenteId)
    if (agente === undefined) return { ok: false, estado: 404, error: 'Sesión no encontrada en esta máquina' }
    orden = ordenTerminal({ accion: 'continuar', agente })
  } else {
    const proyecto = instantanea.proyectos.find((candidato) => candidato.id === pedido.proyectoId)
    if (proyecto === undefined) return { ok: false, estado: 404, error: 'Proyecto no encontrado en esta máquina' }
    orden = ordenTerminal({ accion: 'nueva', tipo: pedido.tipo, proyecto })
  }
  if ('error' in orden) {
    return { ok: false, estado: orden.error === 'Esta sesión sigue abierta en otro sitio' ? 409 : 400, error: orden.error }
  }
  try {
    return { ok: true, terminal: await gestor.crear(orden) }
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    return mensaje.startsWith('Ya hay') ? { ok: false, estado: 429, error: mensaje } : { ok: false, estado: 500, error: 'No se pudo abrir el terminal' }
  }
}
