import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { SO } from '@centro/compartido'
import { cargarConfig } from './config.js'
import { construirInstantanea } from './instantanea.js'
import { rutasBase } from './rutas/base.js'

const execFileAsync = promisify(execFile)

function sistemaOperativo(plataforma: NodeJS.Platform): SO {
  if (plataforma === 'darwin') return 'macos'
  if (plataforma === 'win32') return 'windows'
  return 'linux'
}

function rutaConfig(argumentos: string[]): string | null {
  const indice = argumentos.indexOf('--config')
  if (indice !== -1) {
    const ruta = argumentos[indice + 1]
    if (ruta === undefined) throw new Error('Falta la ruta después de --config')
    return path.resolve(ruta)
  }

  const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const predeterminada = path.join(raizRepo, 'agente.config.json')
  return existsSync(predeterminada) ? predeterminada : null
}

function pidVivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function ejecutar(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { timeout: 5_000, encoding: 'utf8' })
  return stdout
}

export async function main(argumentos = process.argv.slice(2)): Promise<void> {
  if (argumentos[0] !== 'instantanea') {
    throw new Error('Uso: cli.ts instantanea [--config <ruta>]')
  }

  const home = os.homedir()
  const so = sistemaOperativo(process.platform)
  const cfg = cargarConfig(rutaConfig(argumentos.slice(1)), home)
  const instantanea = await construirInstantanea({
    cfg,
    rutas: rutasBase(so, home, process.env),
    so,
    ahoraMs: Date.now(),
    pidVivo,
    ejecutar,
  })
  process.stdout.write(`${JSON.stringify(instantanea, null, 2)}\n`)
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const mensaje = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Error: ${mensaje}\n`)
    process.exitCode = 1
  })
}
