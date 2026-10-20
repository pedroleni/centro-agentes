import path from 'node:path'
import { stat } from 'node:fs/promises'
import type { Accion } from '@centro/compartido'
import { accionDeToolUse, normalizarTextoAccion } from './actividad.js'
import {
  esRegistro,
  extraerAccionRollout,
  fechaEventoRollout,
} from './lectores/codexRollouts.js'
import {
  fechaEventoLogCodex,
  ficherosCambioLogCodex,
} from './lectores/codexTareas.js'
import { enmascararSecretos } from './util/enmascarar.js'
import { ultimasLineas } from './util/lineas.js'

export type Fuente = {
  tipo: 'claude' | 'codex-rollout' | 'codex-log'
  ruta: string
}

export type EventoLinea = {
  fechaMs: number
  tipo:
    | 'usuario'
    | 'asistente'
    | 'comando'
    | 'edicion'
    | 'lectura'
    | 'busqueda'
    | 'subagente'
    | 'pregunta'
    | 'otro'
  texto: string
  detalle: string | null
}

export type ResultadoLinea = {
  eventos: EventoLinea[]
  antes: number | null
}

type RegistrarFuente = (agenteId: string, fuente: Fuente) => void

export function crearRegistroFuentes(): {
  construir<T>(construir: (registrar: RegistrarFuente) => Promise<T>): Promise<T>
  obtener(agenteId: string): Fuente | null
} {
  let fuentes = new Map<string, Fuente>()

  return {
    async construir<T>(construir: (registrar: RegistrarFuente) => Promise<T>): Promise<T> {
      const nuevas = new Map<string, Fuente>()
      const resultado = await construir((agenteId, fuente) => nuevas.set(agenteId, fuente))
      fuentes = nuevas
      return resultado
    },
    obtener(agenteId: string): Fuente | null {
      return fuentes.get(agenteId) ?? null
    },
  }
}

function fechaMs(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor
  if (typeof valor !== 'string') return null
  const convertida = Date.parse(valor)
  return Number.isNaN(convertida) ? null : convertida
}

function textoVisible(valor: string): string {
  return enmascararSecretos(valor)
}

function detalleComando(valor: string): string {
  return enmascararSecretos(valor).slice(0, 2_000)
}

function textosDeContenido(contenido: unknown): string[] {
  if (typeof contenido === 'string') return [contenido]
  if (!Array.isArray(contenido)) return []
  return contenido.flatMap((bloque) =>
    esRegistro(bloque) && bloque.type === 'text' && typeof bloque.text === 'string'
      ? [bloque.text]
      : [],
  )
}

function contenidoResultado(valor: unknown): string | null {
  const textos = textosDeContenido(valor)
  return textos.length === 0 ? null : textos.join('\n')
}

function resultadosClaude(lineas: unknown[]): Map<string, string> {
  const resultados = new Map<string, string>()
  for (const linea of lineas) {
    if (!esRegistro(linea) || linea.type !== 'user' || !esRegistro(linea.message)) continue
    const contenido = linea.message.content
    if (!Array.isArray(contenido)) continue
    for (const bloque of contenido) {
      if (
        !esRegistro(bloque) ||
        bloque.type !== 'tool_result' ||
        typeof bloque.tool_use_id !== 'string'
      ) continue
      const texto = contenidoResultado(bloque.content)
      if (texto !== null) resultados.set(bloque.tool_use_id, texto)
    }
  }
  return resultados
}

function tipoDeAccion(accion: Accion): EventoLinea['tipo'] {
  return accion.tipo === 'mensaje' ? 'asistente' : accion.tipo
}

function eventosClaude(lineas: unknown[]): EventoLinea[] {
  const resultados = resultadosClaude(lineas)
  const eventos: EventoLinea[] = []

  for (const linea of lineas) {
    if (!esRegistro(linea) || !esRegistro(linea.message)) continue
    const fecha = fechaMs(linea.timestamp)
    if (fecha === null) continue
    const contenido = linea.message.content

    if (linea.type === 'user') {
      for (const texto of textosDeContenido(contenido)) {
        eventos.push({ fechaMs: fecha, tipo: 'usuario', texto: textoVisible(texto), detalle: null })
      }
      continue
    }
    if (linea.type !== 'assistant') continue

    if (typeof contenido === 'string') {
      eventos.push({
        fechaMs: fecha,
        tipo: 'asistente',
        texto: textoVisible(contenido),
        detalle: null,
      })
      continue
    }
    if (!Array.isArray(contenido)) continue
    for (const bloque of contenido) {
      if (!esRegistro(bloque)) continue
      if (bloque.type === 'text' && typeof bloque.text === 'string') {
        eventos.push({
          fechaMs: fecha,
          tipo: 'asistente',
          texto: textoVisible(bloque.text),
          detalle: null,
        })
      } else if (bloque.type === 'tool_use' && typeof bloque.name === 'string') {
        const accion = accionDeToolUse(bloque.name, bloque.input, fecha)
        const resultado = typeof bloque.id === 'string' ? resultados.get(bloque.id) : undefined
        eventos.push({
          fechaMs: fecha,
          tipo: tipoDeAccion(accion),
          texto: accion.texto,
          detalle:
            accion.tipo === 'comando' && resultado !== undefined
              ? detalleComando(resultado)
              : null,
        })
      }
    }
  }
  return eventos
}

function salidasRollout(lineas: unknown[]): Map<string, string> {
  const salidas = new Map<string, string>()
  for (const linea of lineas) {
    if (!esRegistro(linea) || linea.type !== 'response_item' || !esRegistro(linea.payload)) {
      continue
    }
    const payload = linea.payload
    if (payload.type !== 'custom_tool_call_output' || typeof payload.call_id !== 'string') continue
    const salida =
      typeof payload.output === 'string'
        ? payload.output
        : typeof payload.content === 'string'
          ? payload.content
          : null
    if (salida !== null) salidas.set(payload.call_id, salida)
  }
  return salidas
}

function eventosRollout(lineas: unknown[]): EventoLinea[] {
  const salidas = salidasRollout(lineas)
  const eventos: EventoLinea[] = []

  for (const linea of lineas) {
    if (!esRegistro(linea) || !esRegistro(linea.payload)) continue
    const fecha = fechaEventoRollout(linea)
    if (fecha === null) continue
    const payload = linea.payload

    if (
      linea.type === 'event_msg' &&
      payload.type === 'user_message' &&
      typeof payload.message === 'string'
    ) {
      eventos.push({
        fechaMs: fecha,
        tipo: 'usuario',
        texto: textoVisible(payload.message),
        detalle: null,
      })
      continue
    }

    const extraida = extraerAccionRollout(linea)
    if (extraida === null) continue
    const callId =
      linea.type === 'response_item' &&
      payload.type === 'custom_tool_call' &&
      typeof payload.call_id === 'string'
        ? payload.call_id
        : null
    const salida = callId === null ? undefined : salidas.get(callId)
    eventos.push({
      fechaMs: fecha,
      tipo: tipoDeAccion(extraida.accion),
      texto: extraida.accion.texto,
      detalle:
        extraida.accion.tipo === 'comando' && salida !== undefined
          ? detalleComando(salida)
          : null,
    })
  }
  return eventos
}

function eventosLogCodex(lineas: unknown[], fechaPredeterminada: number): EventoLinea[] {
  const eventos: EventoLinea[] = []
  for (const linea of lineas) {
    if (
      !esRegistro(linea) ||
      linea.type !== 'item.completed' ||
      !esRegistro(linea.item)
    ) continue
    const item = linea.item
    const fechaLeida = fechaEventoLogCodex(linea)
    const fecha = fechaLeida === 0 ? fechaPredeterminada : fechaLeida

    if (item.type === 'command_execution' && typeof item.command === 'string') {
      const accion = accionDeToolUse('Bash', { command: item.command }, fecha)
      eventos.push({
        fechaMs: fecha,
        tipo: 'comando',
        texto: accion.texto,
        detalle:
          typeof item.aggregated_output === 'string'
            ? detalleComando(item.aggregated_output)
            : null,
      })
    } else if (item.type === 'file_change') {
      const ficheros = ficherosCambioLogCodex(item)
      const nombres = ficheros.map((fichero) => path.win32.basename(path.basename(fichero)))
      eventos.push({
        fechaMs: fecha,
        tipo: 'edicion',
        texto: normalizarTextoAccion(nombres.join(', ')),
        detalle: null,
      })
    } else if (item.type === 'agent_message' && typeof item.text === 'string') {
      eventos.push({
        fechaMs: fecha,
        tipo: 'asistente',
        texto: normalizarTextoAccion(item.text),
        detalle: null,
      })
    }
  }
  return eventos
}

function convertirLineas(
  fuente: Fuente,
  lineas: unknown[],
  fechaPredeterminada: number,
): EventoLinea[] {
  if (fuente.tipo === 'claude') return eventosClaude(lineas)
  if (fuente.tipo === 'codex-rollout') return eventosRollout(lineas)
  return eventosLogCodex(lineas, fechaPredeterminada)
}

export async function leerLinea(
  fuente: Fuente,
  antes: number | null,
  n = 200,
): Promise<ResultadoLinea> {
  const pagina = await ultimasLineas(fuente.ruta, n, antes ?? undefined)
  const fechaPredeterminada = fuente.tipo === 'codex-log' ? (await stat(fuente.ruta)).mtimeMs : 0
  const lineas: unknown[] = pagina.lineas.map((linea) => {
    try {
      return JSON.parse(linea) as unknown
    } catch {
      return null
    }
  })
  const eventos = convertirLineas(fuente, lineas, fechaPredeterminada)
    .map((evento, orden) => ({ evento, orden }))
    .sort((a, b) => a.evento.fechaMs - b.evento.fechaMs || a.orden - b.orden)
    .map(({ evento }) => evento)
  return {
    eventos,
    antes: pagina.desdeByte === 0 ? null : pagina.desdeByte,
  }
}
