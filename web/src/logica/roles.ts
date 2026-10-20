import type { Rol } from '@centro/compartido'

const NOMBRES_ROL: Record<Rol, string> = {
  claude: 'Claude',
  'claude-explorador': 'Explorador',
  'claude-arquitecto': 'Arquitecto',
  'claude-inspector': 'Inspector',
  'claude-ayudante': 'Ayudante',
  codex: 'Codex',
  'codex-obrero': 'Obrero',
  'codex-guardian': 'Guardián',
}

export function nombreRol(rol: Rol): string {
  return NOMBRES_ROL[rol]
}

export function colorRol(rol: Rol): string {
  return rol.startsWith('claude') ? '#d97757' : '#111'
}
