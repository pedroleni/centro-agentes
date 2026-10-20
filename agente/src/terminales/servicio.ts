import { statSync } from 'node:fs'
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

function carpetaExiste(ruta: string): boolean {
  try {
    return statSync(ruta).isDirectory()
  } catch {
    return false
  }
}

export async function crearTerminalPedido(
  pedido: PedidoTerminal,
  instantanea: Pick<Instantanea, 'maquina' | 'agentes' | 'proyectos' | 'terminales'>,
  gestor: Pick<GestorTerminales, 'crear'>,
  opciones: { existeCarpeta?(ruta: string): boolean } = {},
): Promise<ResultadoTerminal> {
  let orden
  if (pedido.accion === 'continuar') {
    // Si ya la continúa un terminal del panel, se vuelve a él (el gestor lo
    // comprueba también contra tmux, por si la instantánea va unos segundos tarde).
    const abierto = instantanea.terminales?.find((terminal) => terminal.agenteId === pedido.agenteId)
    if (abierto !== undefined) return { ok: true, terminal: abierto }
    const agente = instantanea.agentes.find((candidato) => candidato.id === pedido.agenteId)
    if (agente === undefined) return { ok: false, estado: 404, error: 'Sesión no encontrada en esta máquina' }
    orden = ordenTerminal({ accion: 'continuar', agente }, instantanea.maquina.so)
  } else {
    const proyecto = instantanea.proyectos.find((candidato) => candidato.id === pedido.proyectoId)
    if (proyecto === undefined) return { ok: false, estado: 404, error: 'Proyecto no encontrado en esta máquina' }
    orden = ordenTerminal({ accion: 'nueva', tipo: pedido.tipo, proyecto }, instantanea.maquina.so)
  }
  if ('error' in orden) {
    return { ok: false, estado: orden.error === 'Esta sesión sigue abierta en otro sitio' ? 409 : 400, error: orden.error }
  }
  // Una sesión de hace días puede apuntar a una carpeta movida o borrada. En
  // Windows, node-pty crea la pseudoconsola antes de fallar y no la libera.
  if (!(opciones.existeCarpeta ?? carpetaExiste)(orden.cwd)) {
    return { ok: false, estado: 400, error: 'La carpeta ya no existe en esta máquina' }
  }
  try {
    return { ok: true, terminal: await gestor.crear(orden) }
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    return mensaje.startsWith('Ya hay') ? { ok: false, estado: 429, error: mensaje } : { ok: false, estado: 500, error: 'No se pudo abrir el terminal' }
  }
}
