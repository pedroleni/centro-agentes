import path from 'node:path'
import type { Accion, ResumenActividad, Rol } from '@centro/compartido'
import { enmascararSecretos } from './util/enmascarar.js'

const MAXIMO_TEXTO_ACCION = 160

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : ''
}

function primeraLinea(valor: unknown): string {
  return texto(valor).split(/\r?\n/, 1)[0] ?? ''
}

function nombreBase(ruta: unknown): string {
  if (typeof ruta !== 'string') return ''
  return path.win32.basename(path.basename(ruta))
}

export function normalizarTextoAccion(valor: string): string {
  const enmascarado = enmascararSecretos(valor)
  return enmascarado.length <= MAXIMO_TEXTO_ACCION
    ? enmascarado
    : `${enmascarado.slice(0, MAXIMO_TEXTO_ACCION)}…`
}

export function accionDeToolUse(nombre: string, input: unknown, fechaMs: number): Accion {
  const datos = esRegistro(input) ? input : {}
  let tipo: Accion['tipo']
  let detalle: string

  if (nombre === 'Bash') {
    tipo = 'comando'
    detalle = primeraLinea(datos.command)
  } else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(nombre)) {
    tipo = 'edicion'
    detalle = nombreBase(datos.file_path ?? datos.notebook_path)
  } else if (nombre === 'Read') {
    tipo = 'lectura'
    detalle = nombreBase(datos.file_path)
  } else if (nombre === 'Grep' || nombre === 'Glob') {
    tipo = 'busqueda'
    detalle = texto(datos.pattern)
  } else if (nombre === 'Agent' || nombre === 'Task') {
    tipo = 'subagente'
    detalle = texto(datos.description)
  } else if (nombre === 'SubagentHandback') {
    tipo = 'mensaje'
    detalle = 'Entregó su informe'
  } else if (nombre === 'AskUserQuestion') {
    tipo = 'pregunta'
    const preguntas = Array.isArray(datos.questions) ? datos.questions : []
    const primera = preguntas.find(esRegistro)
    detalle = primera === undefined ? '' : texto(primera.question)
  } else {
    tipo = 'otro'
    detalle = nombre
  }

  return { tipo, texto: normalizarTextoAccion(detalle), fechaMs }
}

export function resumenActividadVacio(): ResumenActividad {
  return { comandos: 0, ediciones: 0, mensajes: 0, ficheros: [] }
}

export function registrarActividad(
  resumen: ResumenActividad,
  accion: Accion,
  ficherosEditados: string[] = accion.tipo === 'edicion' ? [accion.texto] : [],
): void {
  if (accion.tipo === 'comando') resumen.comandos += 1
  if (accion.tipo === 'edicion') resumen.ediciones += 1
  if (accion.tipo === 'mensaje') resumen.mensajes += 1

  for (const fichero of ficherosEditados) {
    const base = nombreBase(fichero)
    if (base.length === 0) continue
    resumen.ficheros = [base, ...resumen.ficheros.filter((actual) => actual !== base)].slice(0, 6)
  }
}

export function rolClaude(agentType: string | null, descripcion: string | null): Rol {
  if (agentType === null) return 'claude'
  if (agentType === 'Explore') return 'claude-explorador'
  if (agentType === 'Plan') return 'claude-arquitecto'
  if (/revis|review|audit/i.test(`${agentType} ${descripcion ?? ''}`)) {
    return 'claude-inspector'
  }
  return 'claude-ayudante'
}

export function rolCodex(source: string, modelo: string | null, esTarea: boolean): Rol {
  if (/guardian/i.test(source) || modelo === 'codex-auto-review') return 'codex-guardian'
  if (esTarea || source === 'exec') return 'codex-obrero'
  return 'codex'
}
