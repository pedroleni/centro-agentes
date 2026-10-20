import path from 'node:path'
import { resolverEstatico, tipoContenido } from './estaticos.js'

// Respuestas HTTP comunes al panel local y al hub: cabeceras de seguridad, JSON
// sin caché y servicio de los estáticos del front con su política de caché.

export type Respuesta = {
  estado: number
  cabeceras: Record<string, string>
  cuerpo: string | Buffer
}

export const CABECERAS_SEGURIDAD = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

export function respuesta(
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

export function json(estado: number, cuerpo: unknown): Respuesta {
  return respuesta(estado, JSON.stringify(cuerpo), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
}

export function mensajeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function decodificarRuta(url: string): string | null {
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

export function cacheControl(rutaDecodificada: string, fallback: boolean): string {
  if (fallback || rutaDecodificada === '/' || rutaDecodificada === '/index.html') {
    return 'no-cache'
  }
  if (rutaDecodificada.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable'
  }
  if (rutaDecodificada.startsWith('/agentes/')) return 'public, max-age=86400'
  return 'no-cache'
}

export async function manejarEstatico(
  dep: { dirWeb: string; leerEstatico(ruta: string): Promise<Buffer | null> },
  url: string,
  rutaDecodificada: string,
): Promise<Respuesta> {
  const ruta = resolverEstatico(dep.dirWeb, url)
  if (ruta === null) return respuesta(404, 'No encontrado')

  try {
    const contenido = await dep.leerEstatico(ruta)
    if (contenido !== null) {
      return respuesta(200, contenido, {
        'Content-Type': tipoContenido(ruta),
        'Cache-Control': cacheControl(rutaDecodificada, false),
      })
    }

    if (path.extname(rutaDecodificada) !== '') return respuesta(404, 'No encontrado')

    const indice = resolverEstatico(dep.dirWeb, '/')
    if (indice === null) return respuesta(404, 'No encontrado')
    const contenidoIndice = await dep.leerEstatico(indice)
    return contenidoIndice === null
      ? respuesta(404, 'No encontrado')
      : respuesta(200, contenidoIndice, {
          'Content-Type': tipoContenido(indice),
          'Cache-Control': cacheControl(rutaDecodificada, true),
        })
  } catch {
    return respuesta(500, 'Error interno')
  }
}
