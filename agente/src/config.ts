import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type ConfigAgente = {
  nombreMaquina: string
  raices: string[]
  profundidad: number
  ocultos: string[]
  ventanasContexto: Record<string, number>
}

function configPredeterminada(home: string): ConfigAgente {
  return {
    nombreMaquina: os.hostname(),
    raices: ['Desktop', 'Downloads', 'Documents'].map((nombre) => path.join(home, nombre)),
    profundidad: 2,
    ocultos: [],
    ventanasContexto: {},
  }
}

function expandirHome(ruta: string, home: string): string {
  if (ruta === '~') return home
  if (ruta.startsWith('~/') || ruta.startsWith('~\\')) {
    return path.join(home, ruta.slice(2))
  }
  return ruta
}

export function cargarConfig(ruta: string | null, home: string): ConfigAgente {
  if (ruta === null || !existsSync(ruta)) return configPredeterminada(home)

  const config = JSON.parse(readFileSync(ruta, 'utf8')) as ConfigAgente
  return {
    ...config,
    raices: config.raices.map((raiz) => expandirHome(raiz, home)),
  }
}
