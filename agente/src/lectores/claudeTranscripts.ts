import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { TareaSesion } from '@centro/compartido'
import { crearLectorIncremental } from '../util/incremental.js'

export type ResumenClaude = {
  sessionId: string
  agenteSubId: string | null
  titulo: string | null
  ultimoPrompt: string | null
  modelo: string | null
  contextoUsado: number | null
  rama: string | null
  pr: { numero: number; url: string } | null
  cwd: string | null
  inicioMs: number | null
  ultimaActividadMs: number | null
  tareas: TareaSesion[]
  ficherosEditados: string[]
  commits: { fechaMs: number; dir: string }[]
}

export type TranscriptEncontrado = {
  sessionId: string
  agenteSubId: string | null
  ruta: string
  mtimeMs: number
}

type EstadoResumen = Omit<ResumenClaude, 'sessionId' | 'agenteSubId'>

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null
}

function aFechaMs(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor
  if (typeof valor !== 'string') return null
  const fechaMs = Date.parse(valor)
  return Number.isNaN(fechaMs) ? null : fechaMs
}

function numeroUso(uso: Record<string, unknown>, campo: string): number {
  const valor = uso[campo]
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0
}

function mapearTareas(valor: unknown): TareaSesion[] {
  if (!Array.isArray(valor)) return []

  const tareas: TareaSesion[] = []
  for (const tarea of valor) {
    if (!esRegistro(tarea) || typeof tarea.content !== 'string') continue

    let estado: TareaSesion['estado']
    if (tarea.status === 'in_progress') estado = 'en-curso'
    else if (tarea.status === 'pending') estado = 'pendiente'
    else if (tarea.status === 'completed') estado = 'hecha'
    else continue

    tareas.push({ texto: tarea.content, estado })
  }
  return tareas
}

function dividirComandos(comando: string): string[] {
  const partes: string[] = []
  let inicio = 0
  let comilla: '"' | "'" | null = null
  let escapado = false
  for (let indice = 0; indice < comando.length; indice += 1) {
    const caracter = comando[indice]
    if (escapado) {
      escapado = false
      continue
    }
    if (caracter === '\\' && comilla !== "'") {
      escapado = true
      continue
    }
    if (caracter === '"' || caracter === "'") {
      comilla = comilla === caracter ? null : comilla ?? caracter
      continue
    }
    if (comilla !== null) continue
    const esSeparador = caracter === ';' || caracter === '\n' || caracter === '|'
      || (caracter === '&' && comando[indice + 1] === '&')
    if (!esSeparador) continue
    partes.push(comando.slice(inicio, indice))
    if ((caracter === '|' || caracter === '&') && comando[indice + 1] === caracter) indice += 1
    inicio = indice + 1
  }
  partes.push(comando.slice(inicio))
  return partes
}

function tokenizar(comando: string): string[] {
  const tokens: string[] = []
  let actual = ''
  let comilla: '"' | "'" | null = null
  let escapado = false
  for (const caracter of comando.trim()) {
    if (escapado) {
      actual += caracter
      escapado = false
      continue
    }
    if (caracter === '\\' && comilla !== "'") {
      escapado = true
      continue
    }
    if (caracter === '"' || caracter === "'") {
      comilla = comilla === caracter ? null : comilla ?? caracter
      continue
    }
    if (/\s/.test(caracter) && comilla === null) {
      if (actual.length > 0) tokens.push(actual)
      actual = ''
      continue
    }
    actual += caracter
  }
  if (escapado) actual += '\\'
  if (actual.length > 0) tokens.push(actual)
  return tokens
}

function resolverDirectorio(ruta: string, base: string, home: string): string {
  const expandida = ruta === '~'
    ? home
    : ruta.startsWith('~/') || ruta.startsWith('~\\')
      ? path.join(home, ruta.slice(2))
      : ruta
  return path.isAbsolute(expandida) ? path.normalize(expandida) : path.resolve(base, expandida)
}

function directoriosDeCommits(comando: string, cwd: string, home: string): string[] {
  let directorioActual = cwd
  const directorios: string[] = []
  for (const parte of dividirComandos(comando)) {
    const tokens = tokenizar(parte)
    if (tokens.length === 0) continue
    if (tokens[0] === 'cd') {
      const indiceRuta = tokens[1] === '--' ? 2 : 1
      directorioActual = resolverDirectorio(tokens[indiceRuta] ?? '~', directorioActual, home)
      continue
    }

    const indiceGit = tokens.indexOf('git')
    if (indiceGit < 0) continue
    let directorioGit = directorioActual
    let indice = indiceGit + 1
    while (indice < tokens.length) {
      const token = tokens[indice]
      if (token === '-C') {
        const ruta = tokens[indice + 1]
        if (ruta === undefined) break
        directorioGit = resolverDirectorio(ruta, directorioActual, home)
        indice += 2
        continue
      }
      if (token?.startsWith('-C') && token.length > 2) {
        directorioGit = resolverDirectorio(token.slice(2), directorioActual, home)
        indice += 1
        continue
      }
      if (token?.startsWith('-')) {
        indice += 1
        continue
      }
      if (token === 'commit') directorios.push(directorioGit)
      break
    }
  }
  return directorios
}

function aplicarHerramienta(estado: EstadoResumen, valor: unknown): void {
  if (!esRegistro(valor) || valor.type !== 'tool_use' || typeof valor.name !== 'string') return
  if (!esRegistro(valor.input)) return

  if (valor.name === 'TodoWrite') {
    estado.tareas = mapearTareas(valor.input.todos)
    return
  }

  if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(valor.name)) return
  const ruta = valor.input.file_path ?? valor.input.notebook_path
  if (typeof ruta === 'string' && !estado.ficherosEditados.includes(ruta)) {
    estado.ficherosEditados.push(ruta)
  }
}

function estadoInicial(): EstadoResumen {
  return {
    titulo: null,
    ultimoPrompt: null,
    modelo: null,
    contextoUsado: null,
    rama: null,
    pr: null,
    cwd: null,
    inicioMs: null,
    ultimaActividadMs: null,
    tareas: [],
    ficherosEditados: [],
    commits: [],
  }
}

function aplicarLinea(estado: EstadoResumen, valor: unknown, home: string): void {
  if (!esRegistro(valor)) return

  if (valor.type === 'ai-title' && typeof valor.aiTitle === 'string') {
    estado.titulo = valor.aiTitle
  }
  if (valor.type === 'last-prompt' && typeof valor.lastPrompt === 'string') {
    estado.ultimoPrompt = valor.lastPrompt
  }
  if (typeof valor.gitBranch === 'string' && valor.gitBranch.length > 0) {
    estado.rama = valor.gitBranch
  }
  if (estado.cwd === null && typeof valor.cwd === 'string') {
    estado.cwd = valor.cwd
  }

  const fechaMs = aFechaMs(valor.timestamp)
  if (fechaMs !== null) {
    if (estado.inicioMs === null) estado.inicioMs = fechaMs
    estado.ultimaActividadMs = fechaMs
  }

  if (valor.type === 'pr-link') {
    const numero =
      typeof valor.prNumber === 'string' || typeof valor.prNumber === 'number'
        ? Number(valor.prNumber)
        : Number.NaN
    if (Number.isFinite(numero) && typeof valor.prUrl === 'string') {
      estado.pr = { numero, url: valor.prUrl }
    }
  }

  if (valor.type !== 'assistant' || !esRegistro(valor.message)) return
  const mensaje = valor.message
  if (typeof mensaje.model === 'string') estado.modelo = mensaje.model
  if (esRegistro(mensaje.usage)) {
    estado.contextoUsado =
      numeroUso(mensaje.usage, 'input_tokens') +
      numeroUso(mensaje.usage, 'cache_creation_input_tokens') +
      numeroUso(mensaje.usage, 'cache_read_input_tokens')
  }
  if (Array.isArray(mensaje.content)) {
    for (const contenido of mensaje.content) {
      aplicarHerramienta(estado, contenido)
      if (
        esRegistro(contenido) &&
        contenido.type === 'tool_use' &&
        contenido.name === 'Bash' &&
        esRegistro(contenido.input) &&
        typeof contenido.input.command === 'string' &&
        fechaMs !== null
      ) {
        const cwdLinea = typeof valor.cwd === 'string' ? valor.cwd : estado.cwd
        if (cwdLinea !== null) {
          for (const dir of directoriosDeCommits(
            contenido.input.command,
            cwdLinea,
            home,
          )) {
            estado.commits.push({ fechaMs, dir })
          }
        }
      }
    }
  }
}

function idsTranscript(ruta: string): { sessionId: string; agenteSubId: string | null } {
  const nombre = path.basename(ruta)
  const coincidencia = /^agent-(.+)\.jsonl$/.exec(nombre)
  if (coincidencia !== null && path.basename(path.dirname(ruta)) === 'subagents') {
    return {
      sessionId: path.basename(path.dirname(path.dirname(ruta))),
      agenteSubId: coincidencia[1] ?? null,
    }
  }
  return { sessionId: path.basename(nombre, '.jsonl'), agenteSubId: null }
}

export function crearLectorClaude(home = homedir()): { resumen(ruta: string): Promise<ResumenClaude> } {
  const lector = crearLectorIncremental(estadoInicial, (estado, valor) => {
    aplicarLinea(estado, valor, home)
  })

  return {
    async resumen(ruta: string): Promise<ResumenClaude> {
      const estado = await lector.leer(ruta)
      return {
        ...idsTranscript(ruta),
        ...estado,
        pr: estado.pr === null ? null : { ...estado.pr },
        tareas: estado.tareas.map((tarea) => ({ ...tarea })),
        ficherosEditados: [...estado.ficherosEditados],
        commits: estado.commits.map((commit) => ({ ...commit })),
      }
    },
  }
}

async function listarDirectorio(ruta: string): Promise<Dirent[]> {
  try {
    return await readdir(ruta, { withFileTypes: true })
  } catch {
    return []
  }
}

async function anadirSiReciente(
  encontrados: TranscriptEncontrado[],
  ruta: string,
  sessionId: string,
  agenteSubId: string | null,
  desdeMs: number,
): Promise<void> {
  try {
    const datos = await stat(ruta)
    if (datos.mtimeMs >= desdeMs) {
      encontrados.push({ sessionId, agenteSubId, ruta, mtimeMs: datos.mtimeMs })
    }
  } catch {
    // El transcript puede desaparecer mientras se recorre el directorio.
  }
}

export async function listarTranscripts(
  dirProyectos: string,
  desdeMs: number,
): Promise<TranscriptEncontrado[]> {
  const encontrados: TranscriptEncontrado[] = []
  const proyectos = await listarDirectorio(dirProyectos)

  for (const proyecto of proyectos) {
    if (!proyecto.isDirectory()) continue
    const rutaProyecto = path.join(dirProyectos, proyecto.name)
    const entradas = await listarDirectorio(rutaProyecto)

    for (const entrada of entradas) {
      if (entrada.isFile() && path.extname(entrada.name) === '.jsonl') {
        await anadirSiReciente(
          encontrados,
          path.join(rutaProyecto, entrada.name),
          path.basename(entrada.name, '.jsonl'),
          null,
          desdeMs,
        )
        continue
      }
      if (!entrada.isDirectory()) continue

      const rutaSubagentes = path.join(rutaProyecto, entrada.name, 'subagents')
      const subagentes = await listarDirectorio(rutaSubagentes)
      for (const subagente of subagentes) {
        const coincidencia = /^agent-(.+)\.jsonl$/.exec(subagente.name)
        if (!subagente.isFile() || coincidencia === null) continue
        await anadirSiReciente(
          encontrados,
          path.join(rutaSubagentes, subagente.name),
          entrada.name,
          coincidencia[1] ?? null,
          desdeMs,
        )
      }
    }
  }

  return encontrados.sort((a, b) => a.ruta.localeCompare(b.ruta))
}
