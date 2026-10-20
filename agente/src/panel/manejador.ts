import path from 'node:path'
import type { Commit, Instantanea } from '@centro/compartido'
import { resolverEstatico, tipoContenido } from './estaticos.js'

export type Peticion = {
  metodo: string
  url: string
  host: string | undefined
}

export type Respuesta = {
  estado: number
  cabeceras: Record<string, string>
  cuerpo: string | Buffer
}

type DependenciasManejador = {
  puerto: number
  obtenerInstantanea(): Promise<Instantanea>
  obtenerCommits(proyectoId: string): Promise<Commit[] | null>
  leerEstatico(ruta: string): Promise<Buffer | null>
  dirWeb: string
}

const CABECERAS_SEGURIDAD = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

function respuesta(
  estado: number,
  cuerpo: string | Buffer,
  cabeceras: Record<string, string> = {},
): Respuesta {
  return {
    estado,
    cabeceras: { ...CABECERAS_SEGURIDAD, ...cabeceras },
    cuerpo,
  }
}

function json(estado: number, cuerpo: unknown): Respuesta {
  return respuesta(estado, JSON.stringify(cuerpo), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
}

function mensajeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function decodificarRuta(url: string): string | null {
  const sinQuery = url.split('?', 1)[0]
  if (sinQuery === undefined) return null
  try {
    const decodificada = decodeURIComponent(sinQuery)
    if (decodificada.includes('\0') || decodificada.includes('\\')) return null
    return decodificada
  } catch {
    return null
  }
}

async function manejarApi(
  dep: DependenciasManejador,
  ruta: string,
): Promise<Respuesta> {
  if (ruta === '/api/instantanea') {
    try {
      return json(200, await dep.obtenerInstantanea())
    } catch (error) {
      return json(500, { error: mensajeError(error) })
    }
  }

  const coincidencia = /^\/api\/proyectos\/([0-9a-f]{12})\/commits$/.exec(ruta)
  if (coincidencia?.[1] !== undefined) {
    try {
      const commits = await dep.obtenerCommits(coincidencia[1])
      return commits === null ? json(404, { error: 'Proyecto no encontrado' }) : json(200, { commits })
    } catch (error) {
      return json(500, { error: mensajeError(error) })
    }
  }

  return json(404, { error: 'No encontrado' })
}

async function manejarEstatico(
  dep: DependenciasManejador,
  url: string,
  rutaDecodificada: string,
): Promise<Respuesta> {
  const ruta = resolverEstatico(dep.dirWeb, url)
  if (ruta === null) return respuesta(404, 'No encontrado')

  try {
    const contenido = await dep.leerEstatico(ruta)
    if (contenido !== null) {
      return respuesta(200, contenido, { 'Content-Type': tipoContenido(ruta) })
    }

    if (path.extname(rutaDecodificada) !== '') return respuesta(404, 'No encontrado')

    const indice = resolverEstatico(dep.dirWeb, '/')
    if (indice === null) return respuesta(404, 'No encontrado')
    const contenidoIndice = await dep.leerEstatico(indice)
    return contenidoIndice === null
      ? respuesta(404, 'No encontrado')
      : respuesta(200, contenidoIndice, { 'Content-Type': tipoContenido(indice) })
  } catch {
    return respuesta(500, 'Error interno')
  }
}

function sinCuerpoParaHead(peticion: Peticion, original: Respuesta): Respuesta {
  return peticion.metodo === 'HEAD' ? { ...original, cuerpo: '' } : original
}

export function crearManejador(
  dep: DependenciasManejador,
): (peticion: Peticion) => Promise<Respuesta> {
  const hostsPermitidos = new Set([
    `127.0.0.1:${dep.puerto}`,
    `localhost:${dep.puerto}`,
  ])

  return async (peticion) => {
    let resultado: Respuesta
    if (peticion.host === undefined || !hostsPermitidos.has(peticion.host)) {
      resultado = respuesta(403, 'Host no permitido')
    } else if (peticion.metodo !== 'GET' && peticion.metodo !== 'HEAD') {
      resultado = respuesta(405, 'Metodo no permitido', { Allow: 'GET, HEAD' })
    } else {
      const ruta = decodificarRuta(peticion.url)
      if (ruta === null) {
        const esApi = peticion.url.split('?', 1)[0]?.startsWith('/api') === true
        resultado = esApi
          ? json(404, { error: 'No encontrado' })
          : respuesta(404, 'No encontrado')
      } else if (ruta.startsWith('/api')) {
        resultado = await manejarApi(dep, ruta)
      } else {
        resultado = await manejarEstatico(dep, peticion.url, ruta)
      }
    }
    return sinCuerpoParaHead(peticion, resultado)
  }
}
