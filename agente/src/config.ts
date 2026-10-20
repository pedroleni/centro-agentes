import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SO } from '@centro/compartido'

export type ConfigAgente = {
  nombreMaquina: string
  raices: string[]
  profundidad: number
  ocultos: string[]
  ventanasContexto: Record<string, number>
}

function configPredeterminada(
  home: string,
  so: SO,
  env: Record<string, string | undefined>,
): ConfigAgente {
  const moduloPath = so === 'windows' ? path.win32 : path
  const raices = ['Desktop', 'Downloads', 'Documents'].map((nombre) =>
    moduloPath.join(home, nombre))
  const oneDrive = env.OneDrive || env.OneDriveConsumer || env.OneDriveCommercial
  if (so === 'windows' && oneDrive !== undefined) {
    raices.push(
      ...['Desktop', 'Documents', 'Escritorio', 'Documentos'].map((nombre) =>
        path.win32.join(oneDrive, nombre)),
    )
  }

  return {
    nombreMaquina: os.hostname(),
    raices,
    profundidad: 2,
    ocultos: [],
    ventanasContexto: {},
  }
}

function expandirHome(ruta: string, home: string, so: SO): string {
  const moduloPath = so === 'windows' ? path.win32 : path
  if (ruta === '~') return home
  if (ruta.startsWith('~/') || ruta.startsWith('~\\')) {
    return moduloPath.join(home, ruta.slice(2))
  }
  return ruta
}

export function cargarConfig(
  ruta: string | null,
  home: string,
  so: SO = 'macos',
  env: Record<string, string | undefined> = {},
): ConfigAgente {
  if (ruta === null || !existsSync(ruta)) return configPredeterminada(home, so, env)

  const config = JSON.parse(readFileSync(ruta, 'utf8')) as ConfigAgente
  return {
    ...config,
    raices: config.raices.map((raiz) => expandirHome(raiz, home, so)),
  }
}
