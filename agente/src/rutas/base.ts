import path from 'node:path'
import type { SO } from '@centro/compartido'

export type RutasBase = {
  home: string
  claude: string
  codex: string
  temporales: string[]
}

export function normalizarRutaWindows(ruta: string): string {
  let normalizada = ruta
  if (normalizada.startsWith('\\\\?\\UNC\\')) {
    normalizada = `\\\\${normalizada.slice(8)}`
  } else if (normalizada.startsWith('\\\\?\\')) {
    normalizada = normalizada.slice(4)
  }

  return normalizada.replace(/^([a-z]):\\/, (_, unidad: string) => `${unidad.toUpperCase()}:\\`)
}

export function rutasBase(
  so: SO,
  home: string,
  env: Record<string, string | undefined>,
): RutasBase {
  const moduloPath = so === 'windows' ? path.win32 : path

  return {
    home,
    claude: moduloPath.join(home, '.claude'),
    codex: env.CODEX_HOME ?? moduloPath.join(home, '.codex'),
    temporales:
      so === 'windows'
        ? [env.TEMP, env.TMP].filter((ruta): ruta is string => Boolean(ruta))
        : ['/tmp', '/private/tmp'],
  }
}
