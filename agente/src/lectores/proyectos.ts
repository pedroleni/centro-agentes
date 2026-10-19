import { createHash } from 'node:crypto'
import { access, readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'smol-toml'
import type { ConfigAgente } from '../config.js'
import type { RutasBase } from '../rutas/base.js'

export type ProyectoBase = {
  id: string
  nombre: string
  ruta: string
  grupo: string
}

export function idProyecto(rutaReal: string): string {
  return createHash('sha1').update(rutaReal).digest('hex').slice(0, 12)
}

function estaDentro(ruta: string, base: string): boolean {
  const relativa = path.relative(base, ruta)
  return relativa === '' || (!relativa.startsWith('..') && !path.isAbsolute(relativa))
}

async function canonicalizarSiExiste(ruta: string): Promise<string | null> {
  try {
    return await realpath(ruta)
  } catch {
    return null
  }
}

async function canonicalizarLimites(rutas: string[]): Promise<string[]> {
  return Promise.all(
    rutas.map(async (ruta) => (await canonicalizarSiExiste(ruta)) ?? path.resolve(ruta)),
  )
}

async function contieneGit(ruta: string): Promise<boolean> {
  try {
    await access(path.join(ruta, '.git'))
    return true
  } catch {
    return false
  }
}

async function proyectosDeCodex(dirCodex: string): Promise<string[]> {
  try {
    const contenido = await readFile(path.join(dirCodex, 'config.toml'), 'utf8')
    const config = parse(contenido)
    const proyectos = config.projects
    if (typeof proyectos !== 'object' || proyectos === null || Array.isArray(proyectos)) return []
    return Object.keys(proyectos)
  } catch {
    return []
  }
}

export async function descubrirProyectos(
  cfg: ConfigAgente,
  rutas: RutasBase,
): Promise<ProyectoBase[]> {
  const encontrados = new Set<string>()
  const temporales = await canonicalizarLimites(rutas.temporales)
  const ocultos = await canonicalizarLimites(cfg.ocultos)
  const home = (await canonicalizarSiExiste(rutas.home)) ?? path.resolve(rutas.home)

  const excluida = (ruta: string): boolean =>
    ruta === home ||
    temporales.some((temporal) => estaDentro(ruta, temporal)) ||
    ocultos.some((oculto) => estaDentro(ruta, oculto))

  const agregar = async (ruta: string): Promise<boolean> => {
    const rutaReal = await canonicalizarSiExiste(ruta)
    if (rutaReal === null || excluida(rutaReal) || !(await contieneGit(rutaReal))) return false
    encontrados.add(rutaReal)
    return true
  }

  const recorrer = async (directorio: string, profundidad: number): Promise<void> => {
    const rutaReal = await canonicalizarSiExiste(directorio)
    if (rutaReal === null || excluida(rutaReal)) return
    if (await agregar(rutaReal)) return
    if (profundidad >= cfg.profundidad) return

    try {
      const entradas = await readdir(rutaReal, { withFileTypes: true })
      await Promise.all(
        entradas
          .filter((entrada) => entrada.isDirectory())
          .map((entrada) => recorrer(path.join(rutaReal, entrada.name), profundidad + 1)),
      )
    } catch {
      // Una carpeta puede desaparecer o perder permisos durante el escaneo.
    }
  }

  await Promise.all(cfg.raices.map((raiz) => recorrer(raiz, 0)))
  const configuradosEnCodex = await proyectosDeCodex(rutas.codex)
  await Promise.all(configuradosEnCodex.map((ruta) => agregar(ruta)))

  return [...encontrados]
    .sort((a, b) => a.localeCompare(b))
    .map((ruta) => ({
      id: idProyecto(ruta),
      nombre: path.basename(ruta),
      ruta,
      grupo: path.basename(path.dirname(ruta)),
    }))
}
