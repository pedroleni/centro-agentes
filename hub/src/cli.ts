import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crearAlmacen } from './almacen.js'
import { crearLimitador, crearSesiones, hashContrasena } from './auth.js'
import { crearConexiones } from './conexiones.js'
import { carpetaCentro, guardarConfigHub, leerConfigHub } from './config.js'
import { crearManejadorHub } from './manejador.js'
import { arrancarHub } from './servidor.js'

function opcion(argumentos: string[], nombre: string): string | null {
  const indice = argumentos.indexOf(nombre)
  if (indice === -1) return null
  const valor = argumentos[indice + 1]
  if (valor === undefined || valor.startsWith('--')) throw new Error(`Falta el valor de ${nombre}`)
  return valor
}

async function leerStdin(): Promise<string> {
  const trozos: Buffer[] = []
  for await (const trozo of process.stdin) trozos.push(trozo as Buffer)
  return Buffer.concat(trozos).toString('utf8').trim()
}

async function configurar(argumentos: string[]): Promise<void> {
  const ruta = opcion(argumentos, '--config') ?? path.join(carpetaCentro(), 'hub.json')
  const sinTailscale = argumentos.includes('--sin-tailscale')
  const hostPublico = opcion(argumentos, '--host-publico')
  const propietario = opcion(argumentos, '--propietario')
  if (!sinTailscale && (hostPublico === null || propietario === null)) {
    throw new Error('Uso: configurar --host-publico <mac-mini.tailnet.ts.net> --propietario <tu-cuenta-tailscale> [--puerto 4700] [--sin-tailscale]')
  }
  // La contraseña llega por stdin para que no quede en el historial del shell.
  process.stderr.write('Escribe la contraseña del panel y pulsa Ctrl-D:\n')
  const contrasena = await leerStdin()
  if (contrasena.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres')
  await guardarConfigHub(ruta, {
    puerto: Number(opcion(argumentos, '--puerto') ?? 4700),
    hostPublico,
    propietarioTailscale: propietario,
    exigirTailscale: !sinTailscale,
    contrasena: hashContrasena(contrasena),
  })
  process.stdout.write(`Configuración guardada en ${ruta}\n`)
}

async function servir(argumentos: string[]): Promise<void> {
  const rutaConfig = opcion(argumentos, '--config') ?? path.join(carpetaCentro(), 'hub.json')
  const cfg = await leerConfigHub(rutaConfig)
  const almacen = crearAlmacen(opcion(argumentos, '--datos') ?? path.join(path.dirname(rutaConfig), 'hub.sqlite'))
  const conexiones = crearConexiones()
  const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const manejar = crearManejadorHub({
    cfg,
    almacen,
    sesiones: crearSesiones(),
    limitador: crearLimitador(),
    conexiones,
    dirWeb: path.join(raizRepo, 'web', 'dist'),
    leerEstatico: async (ruta) => {
      try {
        return await readFile(ruta)
      } catch {
        return null
      }
    },
  })
  await arrancarHub({ cfg, almacen, conexiones, manejar })
  process.stdout.write(`Hub: http://127.0.0.1:${cfg.puerto}${cfg.hostPublico ? ` · https://${cfg.hostPublico}` : ''}\n`)
}

const [orden, ...resto] = process.argv.slice(2)
const accion = orden === 'configurar' ? configurar : orden === 'servir' ? servir : null
if (accion === null) {
  process.stderr.write('Uso: cli.ts configurar|servir [opciones]\n')
  process.exitCode = 1
} else {
  accion(resto).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
