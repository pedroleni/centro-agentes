import type { Commit, Instantanea } from '@centro/compartido'
import type { ResultadoLinea } from '../linea.js'
import {
  decodificarRuta,
  json,
  manejarEstatico,
  mensajeError,
  respuesta,
  type Respuesta,
} from './respuestas.js'

export type Peticion = {
  metodo: string
  url: string
  host: string | undefined
}

export type { Respuesta } from './respuestas.js'

type DependenciasManejador = {
  puerto: number
  obtenerInstantanea(): Promise<Instantanea>
  obtenerCommits(proyectoId: string): Promise<Commit[] | null>
  obtenerLinea(agenteId: string, antes: number | null): Promise<ResultadoLinea | null>
  leerEstatico(ruta: string): Promise<Buffer | null>
  dirWeb: string
}

async function manejarApi(
  dep: DependenciasManejador,
  ruta: string,
  url: string,
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

  const coincidenciaLinea = /^\/api\/agentes\/([^/]+)\/linea$/.exec(ruta)
  if (coincidenciaLinea?.[1] !== undefined) {
    const antes = parametroAntes(url)
    if (antes === undefined) return json(400, { error: 'El parametro antes no es valido' })
    try {
      const linea = await dep.obtenerLinea(coincidenciaLinea[1], antes)
      return linea === null
        ? json(404, { error: 'Agente no encontrado' })
        : json(200, linea)
    } catch {
      return json(500, { error: 'No se pudo leer la linea de tiempo' })
    }
  }

  return json(404, { error: 'No encontrado' })
}

function parametroAntes(url: string): number | null | undefined {
  const indiceQuery = url.indexOf('?')
  if (indiceQuery === -1) return null
  const parametros = new URLSearchParams(url.slice(indiceQuery + 1))
  if (!parametros.has('antes')) return null
  const valores = parametros.getAll('antes')
  const valor = valores[0]
  if (valores.length !== 1 || valor === undefined || !/^(?:0|[1-9]\d*)$/.test(valor)) {
    return undefined
  }
  const numero = Number(valor)
  return Number.isSafeInteger(numero) ? numero : undefined
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
        resultado = await manejarApi(dep, ruta, peticion.url)
      } else {
        resultado = await manejarEstatico(dep, peticion.url, ruta)
      }
    }
    return sinCuerpoParaHead(peticion, resultado)
  }
}
