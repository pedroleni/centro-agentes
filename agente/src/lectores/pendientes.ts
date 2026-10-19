import { access, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Pendiente } from '@centro/compartido'
import type { crearGuardian } from '../rutas/guardian.js'

const DIA = 86_400_000

function fechaDelNombre(nombre: string): number | null {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})-/.exec(nombre)
  if (coincidencia === null) return null
  const fecha = Date.UTC(Number(coincidencia[1]), Number(coincidencia[2]) - 1, Number(coincidencia[3]))
  return Number.isNaN(fecha) ? null : fecha
}

function pendientePlan(titulo: string, fechaMs: number, contenido: string): Pendiente | null {
  const hechas = (contenido.match(/^\s*- \[[xX]\]/gm) ?? []).length
  const sinHacer = (contenido.match(/^\s*- \[ \]/gm) ?? []).length
  const total = hechas + sinHacer
  if (total === 0) return null
  return { origen: 'plan', titulo, fechaMs, hechas, total, quizaDesactualizado: false }
}

export async function leerPlanes(
  rutaProyecto: string,
  guardian: ReturnType<typeof crearGuardian>,
): Promise<Pendiente[]> {
  const directorio = path.join(rutaProyecto, 'docs', 'superpowers', 'plans')
  let nombres: string[]
  try {
    nombres = await readdir(directorio)
  } catch {
    return []
  }

  const planes: Pendiente[] = []
  for (const nombre of nombres.sort()) {
    const fechaMs = fechaDelNombre(nombre)
    if (fechaMs === null || !nombre.endsWith('.md')) continue
    try {
      const ruta = await guardian.comprobar(path.join(directorio, nombre))
      const contenido = await readFile(ruta, 'utf8')
      const titulo = /^#\s+(.+)$/m.exec(contenido)?.[1]?.trim()
      if (titulo === undefined) continue
      const pendiente = pendientePlan(titulo, fechaMs, contenido)
      if (pendiente !== null) planes.push(pendiente)
    } catch {
      // El plan puede desaparecer durante el escaneo.
    }
  }
  return planes
}

function limpiarMarcado(texto: string): string {
  return texto.replace(/\*\*/g, '').replace(/`/g, '').trim()
}

function fechaDelDocumento(contenido: string, mtimeMs: number): number {
  const coincidencia = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(contenido)
  if (coincidencia === null) return mtimeMs
  return Date.UTC(Number(coincidencia[1]), Number(coincidencia[2]) - 1, Number(coincidencia[3]))
}

function secciones(contenido: string): { titulo: string; texto: string }[] {
  const lineas = contenido.split(/\r?\n/)
  const resultado: { titulo: string; texto: string }[] = []
  let actual: { titulo: string; lineas: string[] } | null = null
  for (const linea of lineas) {
    const encabezado = /^##\s+(.+)$/.exec(linea)
    if (encabezado !== null) {
      if (actual !== null) resultado.push({ titulo: actual.titulo, texto: actual.lineas.join('\n') })
      actual = { titulo: (encabezado[1] ?? '').trim(), lineas: [linea] }
    } else if (actual !== null) {
      actual.lineas.push(linea)
    }
  }
  if (actual !== null) resultado.push({ titulo: actual.titulo, texto: actual.lineas.join('\n') })
  return resultado
}

function tituloPendiente(contenido: string): string {
  const lineas = contenido.split(/\r?\n/)
  let activar = false
  for (const [indice, linea] of lineas.entries()) {
    if (/(lo que falta|pendiente|siguiente)/i.test(linea)) {
      activar = true
      continue
    }
    if (!activar) continue
    const lista = /^\s*(?:\d+[.)]|[-*+])\s+(.+)$/.exec(linea)
    if (lista !== null) {
      const partes = [lista[1] ?? '']
      // Las líneas sangradas que siguen al elemento son su continuación.
      for (const siguiente of lineas.slice(indice + 1)) {
        if (!/^\s+\S/.test(siguiente) || /^\s*(?:\d+[.)]|[-*+])\s+/.test(siguiente)) break
        partes.push(siguiente.trim())
      }
      return limpiarMarcado(partes.join(' '))
    }
  }
  const encabezado = /^(?:#{1,6})\s+(.+)$/m.exec(contenido)
  return encabezado === null ? '' : limpiarMarcado(encabezado[1] ?? '')
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta)
    return true
  } catch {
    return false
  }
}

export async function leerHandoff(
  rutaProyecto: string,
  ultimoCommitMs: number | null,
  guardian: ReturnType<typeof crearGuardian>,
): Promise<Pendiente | null> {
  const propio = path.join(rutaProyecto, 'HANDOFF.md')
  const padre = path.join(path.dirname(rutaProyecto), 'HANDOFF.md')
  const esPropio = await existe(propio)
  const candidata = esPropio ? propio : padre
  if (!esPropio && !(await existe(candidata))) return null

  let ruta: string
  try {
    ruta = await guardian.comprobar(candidata)
  } catch {
    return null
  }

  try {
    const contenido = await readFile(ruta, 'utf8')
    let seleccionado = contenido
    if (!esPropio) {
      const nombreProyecto = path.basename(rutaProyecto)
      const seccion = secciones(contenido).find((item) => item.titulo.includes(nombreProyecto))
      if (seccion === undefined) return null
      seleccionado = seccion.texto
    }
    const informacion = await stat(ruta)
    const fechaMs = fechaDelDocumento(contenido, informacion.mtimeMs)
    return {
      origen: 'handoff',
      titulo: tituloPendiente(seleccionado),
      fechaMs,
      hechas: null,
      total: null,
      quizaDesactualizado: ultimoCommitMs !== null && ultimoCommitMs > fechaMs + DIA,
    }
  } catch {
    // El fichero puede ser ilegible o desaparecer durante el escaneo.
    return null
  }
}
