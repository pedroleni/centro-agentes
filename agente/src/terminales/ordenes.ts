import path from 'node:path'
import type { Agente, Proyecto } from '@centro/compartido'

// Única fuente de las órdenes que el panel puede ejecutar en una máquina. El hub
// solo manda ids; aquí se montan las órdenes, con ids validados por expresión
// regular antes de entrar en la cadena del shell, y nunca hay otra orden posible.

const ID_SESION_CLAUDE = /^[0-9a-f-]{36}$/
const ID_HILO_CODEX = /^[0-9a-z-]{8,64}$/

export type PeticionTerminal =
  | { accion: 'continuar'; agente: Agente }
  | { accion: 'nueva'; tipo: 'claude' | 'codex'; proyecto: Proyecto }

export type OrdenTerminal = {
  cwd: string
  argv: string[]
  titulo: string
  tipo: 'claude' | 'codex'
  agenteId: string | null
  proyectoId: string | null
}

const NOMBRE = { claude: 'Claude', codex: 'Codex' } as const

// Login shell para que un LaunchAgent encuentre el PATH del usuario; `exec` para
// que, al salir de Claude o Codex, el terminal se cierre sin dejar un shell abierto.
function enShell(orden: string): string[] {
  return ['/bin/zsh', '-lc', `exec ${orden}`]
}

export function ordenTerminal(peticion: PeticionTerminal): OrdenTerminal | { error: string } {
  if (peticion.accion === 'nueva') {
    const { proyecto, tipo } = peticion
    if (!path.isAbsolute(proyecto.ruta)) return { error: 'La carpeta del proyecto no es válida' }
    return {
      cwd: proyecto.ruta,
      argv: enShell(tipo),
      titulo: `${NOMBRE[tipo]} · ${proyecto.nombre}`,
      tipo,
      agenteId: null,
      proyectoId: proyecto.id,
    }
  }

  const { agente } = peticion
  if (!agente.puedeContinuar) return { error: 'Esta sesión sigue abierta en otro sitio' }
  if (!path.isAbsolute(agente.cwd)) return { error: 'La carpeta de la sesión no es válida' }
  const [prefijo, id, ...resto] = agente.id.split(':')
  if (resto.length > 0 || id === undefined) return { error: 'Esta sesión no se puede continuar' }

  let orden: string
  if (prefijo === 'claude' && agente.tipo === 'claude' && ID_SESION_CLAUDE.test(id)) {
    orden = `claude --resume ${id}`
  } else if (prefijo === 'codex' && agente.tipo === 'codex' && ID_HILO_CODEX.test(id)) {
    orden = `codex resume ${id}`
  } else {
    return { error: 'Esta sesión no se puede continuar' }
  }
  return {
    cwd: agente.cwd,
    argv: enShell(orden),
    titulo: `${NOMBRE[agente.tipo]} · ${agente.titulo}`,
    tipo: agente.tipo,
    agenteId: agente.id,
    proyectoId: agente.proyectoIds[0] ?? null,
  }
}
