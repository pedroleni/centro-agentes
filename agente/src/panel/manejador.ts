import type { Commit, Instantanea } from '@centro/compartido'
import { z } from 'zod'
import type { ResultadoLinea } from '../linea.js'
import type { PedidoTerminal, ResultadoTerminal } from '../terminales/servicio.js'
import { mismaClave } from './clave.js'
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
  origin?: string | undefined
  // Cabecera X-Clave-Panel (ver clave.ts).
  clave?: string | undefined
  cuerpo?: string | null
}

export type { Respuesta } from './respuestas.js'

type DependenciasManejador = {
  puerto: number
  obtenerInstantanea(): Promise<Instantanea>
  obtenerCommits(proyectoId: string): Promise<Commit[] | null>
  obtenerLinea(agenteId: string, antes: number | null): Promise<ResultadoLinea | null>
  leerEstatico(ruta: string): Promise<Buffer | null>
  dirWeb: string
  terminales?: {
    crear(pedido: PedidoTerminal): Promise<ResultadoTerminal>
    cerrar(terminalId: string): Promise<void>
  }
  // Clave de este arranque (ver clave.ts). Sin ella, nadie puede usar terminales.
  clave?: string
}

const Pedido = z.union([
  z.object({ accion: z.literal('continuar'), agenteId: z.string().min(1).max(200) }),
  z.object({ accion: z.literal('nueva'), tipo: z.enum(['claude', 'codex']), proyectoId: z.string().min(1).max(64) }),
])

// Únicas escrituras del panel local: crear y cerrar terminales, siempre con un
// Origin exacto de este mismo panel (ninguna otra web puede hacerlo) y con la
// clave de este arranque (ningún otro proceso de la máquina puede hacerlo).
async function manejarEscritura(dep: DependenciasManejador, peticion: Peticion): Promise<Respuesta> {
  const origenes = new Set([`http://127.0.0.1:${dep.puerto}`, `http://localhost:${dep.puerto}`])
  const ruta = decodificarRuta(peticion.url)
  const crear = ruta === null ? null : /^\/api\/maquinas\/([^/]+)\/terminales$/.exec(ruta)
  const cerrar = ruta === null ? null : /^\/api\/maquinas\/([^/]+)\/terminales\/([^/]+)$/.exec(ruta)
  const valida = (peticion.metodo === 'POST' && crear !== null) || (peticion.metodo === 'DELETE' && cerrar !== null)
  if (!valida) return respuesta(405, 'Metodo no permitido', { Allow: 'GET, HEAD' })
  if (peticion.origin === undefined || !origenes.has(peticion.origin)) return json(403, { error: 'Origen no permitido' })
  if (!mismaClave(peticion.clave, dep.clave)) {
    return json(401, { error: 'Abre el panel con el enlace que muestra `npm run panel` al arrancar' })
  }
  if (dep.terminales === undefined) return json(404, { error: 'No encontrado' })
  const instantanea = await dep.obtenerInstantanea().catch(() => null)
  const maquinaId = (crear ?? cerrar)?.[1]
  if (instantanea === null || maquinaId !== instantanea.maquina.id) return json(404, { error: 'Máquina no encontrada' })

  if (cerrar !== null) {
    const terminalId = cerrar[2] ?? ''
    if (!/^[0-9a-f]{12}$/.test(terminalId)) return json(404, { error: 'Terminal no encontrado' })
    await dep.terminales.cerrar(terminalId).catch(() => undefined)
    return respuesta(204, '')
  }

  let pedido: PedidoTerminal
  try {
    const leido = Pedido.parse(JSON.parse(peticion.cuerpo ?? ''))
    pedido = leido.accion === 'continuar' ? leido : { accion: 'nueva', tipo: leido.tipo, proyectoId: leido.proyectoId }
  } catch {
    return json(400, { error: 'Petición no válida' })
  }
  const resultado = await dep.terminales.crear(pedido)
  return resultado.ok ? json(201, resultado.terminal) : json(resultado.estado, { error: resultado.error })
}

async function manejarApi(
  dep: DependenciasManejador,
  rutaPedida: string,
  url: string,
): Promise<Respuesta> {
  // Misma API que el hub (`/api/maquinas…`) para que el front sea uno solo. En modo
  // local hay una única máquina y sus rutas delegan en las de siempre.
  let ruta = rutaPedida
  if (ruta === '/api/maquinas') {
    try {
      const instantanea = await dep.obtenerInstantanea()
      const { id, nombre, so } = instantanea.maquina
      return json(200, {
        modo: 'local',
        maquinas: [{ id, nombre, so, conectada: true, ultimoLatidoMs: instantanea.generadaMs, instantanea }],
      })
    } catch (error) {
      return json(500, { error: mensajeError(error) })
    }
  }
  const deMaquina = /^\/api\/maquinas\/([^/]+)(\/.+)$/.exec(ruta)
  if (deMaquina) {
    const instantanea = await dep.obtenerInstantanea().catch(() => null)
    if (instantanea === null || deMaquina[1] !== instantanea.maquina.id) return json(404, { error: 'Máquina no encontrada' })
    ruta = `/api${deMaquina[2] ?? ''}`
  }

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
    } else if (peticion.metodo === 'POST' || peticion.metodo === 'DELETE') {
      resultado = await manejarEscritura(dep, peticion)
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
