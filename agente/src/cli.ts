import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { SO } from '@centro/compartido'
import { cargarConfig } from './config.js'
import { construirInstantanea } from './instantanea.js'
import { commitsRecientes } from './lectores/git.js'
import { crearRegistroFuentes, leerLinea } from './linea.js'
import { crearCacheInstantanea } from './panel/cache.js'
import { crearObtenerLinea } from './panel/obtenerLinea.js'
import { crearManejador } from './panel/manejador.js'
import { arrancarPanel } from './panel/servidor.js'
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

function puertoPanel(argumentos: string[]): number {
  const indice = argumentos.indexOf('--puerto')
  if (indice === -1) return 4_600
  const texto = argumentos[indice + 1]
  const puerto = Number(texto)
  if (texto === undefined || !Number.isInteger(puerto) || puerto < 1 || puerto > 65_535) {
    throw new Error('El puerto debe ser un entero entre 1 y 65535')
  }
  return puerto
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
  const home = os.homedir()
  const so = sistemaOperativo(process.platform)
  const opciones = argumentos.slice(1)
  const cfg = cargarConfig(rutaConfig(opciones), home)
  const rutas = rutasBase(so, home, process.env)
  const construir = () => construirInstantanea({
    cfg,
    rutas,
    so,
    ahoraMs: Date.now(),
    pidVivo,
    ejecutar,
  })

  if (argumentos[0] === 'instantanea') {
    const instantanea = await construir()
    process.stdout.write(`${JSON.stringify(instantanea, null, 2)}\n`)
    return
  }

  if (argumentos[0] === 'panel') {
    const puerto = puertoPanel(opciones)
    const registroFuentes = crearRegistroFuentes()
    const construirRegistrada = () => registroFuentes.construir((registrarFuente) =>
      construirInstantanea({
        cfg,
        rutas,
        so,
        ahoraMs: Date.now(),
        pidVivo,
        ejecutar,
        registrarFuente,
      }))
    const cache = crearCacheInstantanea(construirRegistrada)
    const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    const dirWeb = path.join(raizRepo, 'web', 'dist')
    const manejador = crearManejador({
      puerto,
      obtenerInstantanea: cache.obtener,
      obtenerCommits: async (id) => {
        const instantanea = await cache.obtener()
        const proyecto = instantanea.proyectos.find((item) => item.id === id)
        if (proyecto === undefined) return null
        // Sin límite de fecha: un proyecto parado también debe enseñar su historial real.
        return commitsRecientes(proyecto.ruta, 0, 100)
      },
      obtenerLinea: crearObtenerLinea({
        obtenerInstantanea: cache.obtener,
        obtenerFuente: (id) => registroFuentes.obtener(id),
        leer: leerLinea,
      }),
      leerEstatico: async (ruta) => {
        try {
          return await readFile(ruta)
        } catch {
          return null
        }
      },
      dirWeb,
    })
    // Se empieza a construir la primera instantánea ya, sin esperar a la primera
    // visita: en frío puede tardar varios segundos.
    void cache.obtener().catch(() => undefined)
    await arrancarPanel({ puerto, manejador })
    process.stdout.write(`Panel: http://127.0.0.1:${puerto}\n`)
    return
  }

  throw new Error(
    'Uso: cli.ts instantanea [--config <ruta>] | panel [--puerto N] [--config <ruta>]',
  )
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const mensaje = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Error: ${mensaje}\n`)
    process.exitCode = 1
  })
}
