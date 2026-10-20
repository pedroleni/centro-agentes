import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  Instantanea,
  ventanaContexto,
  type Agente,
  type EstadoAgente,
  type Pendiente,
  type Proyecto,
  type SO,
} from '@centro/compartido'
import type { TerminalInfo } from '@centro/compartido'
import { asignarProyectos } from './asignacion.js'
import type { ConfigAgente } from './config.js'
import { leerSesionesVivas, type SesionViva } from './lectores/claudeSesiones.js'
import {
  crearLectorClaude,
  leerMetaSubagente,
  listarTranscripts,
  type MetaSubagente,
  type ResumenClaude,
  type TranscriptEncontrado,
} from './lectores/claudeTranscripts.js'
import { leerHilosCodex, type HiloCodex } from './lectores/codexHilos.js'
import {
  hilosAbiertos,
  procesosCodex,
  type ProcesoCodex,
} from './lectores/codexProcesos.js'
import { crearLectorRollouts, type ResumenRollout } from './lectores/codexRollouts.js'
import { estadoTarea, leerTareasCodex, type TareaCodex } from './lectores/codexTareas.js'
import { estadoGit } from './lectores/git.js'
import { leerHandoff, leerPlanes } from './lectores/pendientes.js'
import { descubrirProyectos, type ProyectoBase } from './lectores/proyectos.js'
import type { RutasBase } from './rutas/base.js'
import { crearGuardian } from './rutas/guardian.js'
import { enmascararSecretos } from './util/enmascarar.js'
import { rolClaude, rolCodex } from './actividad.js'

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1_000
const UN_DIA_MS = 24 * 60 * 60 * 1_000
const ACTIVIDAD_RECIENTE_MS = 30_000
const lectorRollouts = crearLectorRollouts()
const lectoresClaude = new Map<string, ReturnType<typeof crearLectorClaude>>()

type Ejecutar = (cmd: string, args: string[]) => Promise<string>

export type DependenciasInstantanea = {
  cfg: ConfigAgente
  rutas: RutasBase
  so: SO
  ahoraMs: number
  pidVivo: (pid: number) => boolean
  ejecutar: Ejecutar
  registrarFuente?: (
    agenteId: string,
    fuente: { tipo: 'claude' | 'codex-rollout' | 'codex-log'; ruta: string },
  ) => void
  listarTerminales?: () => Promise<TerminalInfo[]>
}

type ProyectoEnConstruccion = ProyectoBase & {
  git: Proyecto['git']
  pendientes: Pendiente[]
  ultimaActividadMs: number
}

type TareaConProyecto = {
  tarea: TareaCodex
  proyecto: ProyectoBase
  rutaValidada: string
}

async function esDirectorio(ruta: string): Promise<boolean> {
  try {
    return (await stat(ruta)).isDirectory()
  } catch {
    return false
  }
}

async function rutaPermitida(
  guardian: ReturnType<typeof crearGuardian>,
  ruta: string,
): Promise<string | null> {
  try {
    return await guardian.comprobar(ruta)
  } catch {
    return null
  }
}

function maximo(fechas: Array<number | null | undefined>, predeterminado = 0): number {
  const validas = fechas.filter((fecha): fecha is number => fecha !== null && fecha !== undefined)
  return validas.length === 0 ? predeterminado : Math.max(...validas)
}

function enmascararNullable(texto: string | null): string | null {
  return texto === null ? null : enmascararSecretos(texto)
}

function idMaquina(nombre: string): string {
  return createHash('sha1').update(nombre).digest('hex').slice(0, 12)
}

function lectorClaudePara(home: string): ReturnType<typeof crearLectorClaude> {
  const existente = lectoresClaude.get(home)
  if (existente !== undefined) return existente
  const lector = crearLectorClaude(home)
  lectoresClaude.set(home, lector)
  return lector
}

function contieneDirectorio(base: string, dir: string, so: SO): boolean {
  const rutas = so === 'windows' ? path.win32 : path
  const baseNormalizada = so === 'windows' ? base.toLocaleLowerCase() : base
  const dirNormalizado = so === 'windows' ? dir.toLocaleLowerCase() : dir
  const relativa = rutas.relative(baseNormalizada, dirNormalizado)
  return relativa === '' || (!relativa.startsWith('..') && !rutas.isAbsolute(relativa))
}

function agruparCommitsPorProyecto(
  commits: ResumenClaude['commits'],
  proyectos: ProyectoBase[],
  so: SO,
): Record<string, number[]> {
  const resultado: Record<string, number[]> = {}
  for (const commit of commits) {
    const proyecto = proyectos
      .filter((candidato) => contieneDirectorio(candidato.ruta, commit.dir, so))
      .sort((a, b) => b.ruta.length - a.ruta.length)[0]
    if (proyecto === undefined) continue
    const fechas = resultado[proyecto.id] ?? []
    fechas.push(commit.fechaMs)
    resultado[proyecto.id] = fechas
  }
  return resultado
}

async function construirProyectos(
  bases: ProyectoBase[],
  ahoraMs: number,
  guardian: ReturnType<typeof crearGuardian>,
): Promise<ProyectoEnConstruccion[]> {
  return Promise.all(
    bases.map(async (base) => {
      const git = await estadoGit(base.ruta, ahoraMs)
      const [planes, handoff] = await Promise.all([
        leerPlanes(base.ruta, guardian),
        leerHandoff(base.ruta, git.ultimoCommit?.fechaMs ?? null, guardian),
      ])
      const pendientes = handoff === null ? planes : [...planes, handoff]
      return {
        ...base,
        git,
        pendientes: pendientes.map((pendiente) => ({
          ...pendiente,
          titulo: enmascararSecretos(pendiente.titulo),
        })),
        ultimaActividadMs: git.ultimoCommit?.fechaMs ?? 0,
      }
    }),
  )
}

async function transcriptsRelevantes(
  dirProyectos: string,
  desdeMs: number,
  sesionesVivas: SesionViva[],
): Promise<TranscriptEncontrado[]> {
  const recientes = await listarTranscripts(dirProyectos, desdeMs)
  const idsRecientes = new Set(recientes.map((transcript) => transcript.sessionId))
  const idsVivosSinTranscript = new Set(
    sesionesVivas
      .filter((sesion) => sesion.vivo && !idsRecientes.has(sesion.sessionId))
      .map((sesion) => sesion.sessionId),
  )
  if (idsVivosSinTranscript.size === 0) return recientes

  const antiguosVivos = (await listarTranscripts(dirProyectos, 0)).filter(
    (transcript) => idsVivosSinTranscript.has(transcript.sessionId),
  )
  const porRuta = new Map(recientes.map((transcript) => [transcript.ruta, transcript]))
  for (const transcript of antiguosVivos) porRuta.set(transcript.ruta, transcript)
  return [...porRuta.values()]
}

function agenteClaude(
  resumen: ResumenClaude,
  encontrado: TranscriptEncontrado,
  sesion: SesionViva | undefined,
  proyectos: ProyectoBase[],
  cfg: ConfigAgente,
  so: SO,
  meta: MetaSubagente,
): Agente {
  const viva = sesion?.vivo === true ? sesion : undefined
  const estado: EstadoAgente =
    viva === undefined ? 'cerrada' : viva.status === 'busy' ? 'trabajando' : 'esperandote'
  const cwd = resumen.cwd ?? viva?.cwd ?? ''
  const titulo = meta.descripcion ?? resumen.titulo ?? viva?.nombre ?? resumen.sessionId
  const idBase = `claude:${resumen.sessionId}`

  return {
    id: resumen.agenteSubId === null ? idBase : `${idBase}:${resumen.agenteSubId}`,
    tipo: 'claude',
    modo: 'interactivo',
    titulo: enmascararSecretos(titulo),
    cwd,
    proyectoIds: asignarProyectos(cwd, resumen.ficherosEditados, proyectos),
    estado,
    rol: rolClaude(meta.agentType, meta.descripcion),
    ultimaAccion: resumen.ultimaAccion,
    resumenActividad: resumen.resumenActividad,
    modelo: resumen.modelo,
    esfuerzo: null,
    contexto:
      resumen.contextoUsado === null
        ? null
        : {
            usados: resumen.contextoUsado,
            ventana:
              resumen.modelo === null
                ? null
                : ventanaContexto(resumen.modelo, cfg.ventanasContexto),
          },
    tokensTotales: null,
    ultimoPrompt: enmascararNullable(resumen.ultimoPrompt),
    rama: resumen.rama,
    pr: resumen.pr,
    inicioMs: resumen.inicioMs ?? viva?.inicioMs ?? null,
    ultimaActividadMs: maximo(
      [resumen.ultimaActividadMs, viva?.actualizadaMs, encontrado.mtimeMs],
      encontrado.mtimeMs,
    ),
    padreId: resumen.agenteSubId === null ? null : idBase,
    entrada: viva?.entrada ?? null,
    puedeContinuar: estado === 'cerrada' && resumen.agenteSubId === null,
    tareas: resumen.tareas.map((tarea) => ({
      ...tarea,
      texto: enmascararSecretos(tarea.texto),
    })),
    commitsPorProyecto: agruparCommitsPorProyecto(resumen.commits, proyectos, so),
  }
}

function agenteClaudeSinTranscript(sesion: SesionViva, proyectos: ProyectoBase[]): Agente {
  const estado: EstadoAgente = sesion.status === 'busy' ? 'trabajando' : 'esperandote'
  return {
    id: `claude:${sesion.sessionId}`,
    tipo: 'claude',
    modo: 'interactivo',
    titulo: enmascararSecretos(sesion.nombre),
    cwd: sesion.cwd,
    proyectoIds: asignarProyectos(sesion.cwd, [], proyectos),
    estado,
    rol: 'claude',
    ultimaAccion: null,
    resumenActividad: { comandos: 0, ediciones: 0, mensajes: 0, ficheros: [] },
    modelo: null,
    esfuerzo: null,
    contexto: null,
    tokensTotales: null,
    ultimoPrompt: null,
    rama: null,
    pr: null,
    inicioMs: sesion.inicioMs,
    ultimaActividadMs: sesion.actualizadaMs,
    padreId: null,
    entrada: sesion.entrada,
    puedeContinuar: false,
    tareas: [],
    commitsPorProyecto: {},
  }
}

async function construirAgentesClaude(
  dep: DependenciasInstantanea,
  proyectos: ProyectoBase[],
  guardian: ReturnType<typeof crearGuardian>,
  hayClaude: boolean,
): Promise<{ agentes: Agente[]; idsVivos: Set<string> }> {
  if (!hayClaude) return { agentes: [], idsVivos: new Set() }

  const rutaSesiones = await rutaPermitida(guardian, path.join(dep.rutas.claude, 'sessions'))
  const sesiones =
    rutaSesiones === null
      ? []
      : await leerSesionesVivas(rutaSesiones, dep.pidVivo, async (ruta) => {
          const comprobada = await guardian.comprobar(ruta)
          return readFile(comprobada, 'utf8')
        })
  const sesionesVivas = sesiones.filter((sesion) => sesion.vivo)
  const porId = new Map(sesionesVivas.map((sesion) => [sesion.sessionId, sesion]))
  const idsVivos = new Set(porId.keys())

  const rutaProyectos = await rutaPermitida(guardian, path.join(dep.rutas.claude, 'projects'))
  if (rutaProyectos === null) {
    return {
      agentes: sesionesVivas.map((sesion) => agenteClaudeSinTranscript(sesion, proyectos)),
      idsVivos,
    }
  }

  const encontrados = await transcriptsRelevantes(
    rutaProyectos,
    dep.ahoraMs - SIETE_DIAS_MS,
    sesionesVivas,
  )
  const lectorClaude = lectorClaudePara(dep.rutas.home)
  const agentes = new Map<string, Agente>()
  for (const encontrado of encontrados) {
    const ruta = await rutaPermitida(guardian, encontrado.ruta)
    if (ruta === null) continue
    try {
      const resumen = await lectorClaude.resumen(ruta)
      let meta: MetaSubagente = { agentType: null, descripcion: null }
      if (resumen.agenteSubId !== null) {
        const rutaMeta = await rutaPermitida(
          guardian,
          path.join(path.dirname(ruta), `agent-${resumen.agenteSubId}.meta.json`),
        )
        if (rutaMeta !== null) meta = await leerMetaSubagente(rutaMeta)
      }
      const sesion = resumen.agenteSubId === null ? porId.get(resumen.sessionId) : undefined
      const agente = agenteClaude(resumen, encontrado, sesion, proyectos, dep.cfg, dep.so, meta)
      agentes.set(agente.id, agente)
      dep.registrarFuente?.(agente.id, { tipo: 'claude', ruta })
    } catch {
      // El transcript puede cambiar o desaparecer mientras se construye la instantánea.
    }
  }

  for (const sesion of sesionesVivas) {
    const id = `claude:${sesion.sessionId}`
    if (!agentes.has(id)) agentes.set(id, agenteClaudeSinTranscript(sesion, proyectos))
  }
  return { agentes: [...agentes.values()], idsVivos }
}

async function leerTareasGuardadas(
  proyectos: ProyectoBase[],
  guardian: ReturnType<typeof crearGuardian>,
  desdeMs: number,
): Promise<TareaConProyecto[]> {
  const resultado: TareaConProyecto[] = []
  for (const proyecto of proyectos) {
    const dirLogs = await rutaPermitida(guardian, path.join(proyecto.ruta, '.codex-logs'))
    if (dirLogs === null) continue
    let entradas: Dirent[]
    try {
      entradas = await readdir(dirLogs, { withFileTypes: true })
    } catch {
      continue
    }
    let todosPermitidos = true
    const rutasValidadas = new Map<string, string>()
    for (const entrada of entradas) {
      if (!entrada.isFile() || path.extname(entrada.name) !== '.jsonl') continue
      const rutaLog = path.join(dirLogs, entrada.name)
      const rutaValidada = await rutaPermitida(guardian, rutaLog)
      if (rutaValidada === null) {
        todosPermitidos = false
        break
      }
      rutasValidadas.set(rutaLog, rutaValidada)
    }
    if (!todosPermitidos) continue

    const tareas = await leerTareasCodex(path.dirname(dirLogs))
    for (const tarea of tareas) {
      // Misma ventana que los hilos: las tareas viejas solo ensucian la vista.
      if (tarea.mtimeMs < desdeMs) continue
      const rutaValidada = rutasValidadas.get(tarea.archivo)
      if (rutaValidada !== undefined) resultado.push({ tarea, proyecto, rutaValidada })
    }
  }
  return resultado
}

function agenteDeHilo(
  hilo: HiloCodex,
  rollout: ResumenRollout,
  tarea: TareaConProyecto | undefined,
  abiertos: Set<string>,
  proyectos: ProyectoBase[],
  ahoraMs: number,
): Agente {
  const esTarea = hilo.source === 'exec' || tarea !== undefined
  const resumenActividad =
    tarea !== undefined &&
    rollout.resumenActividad.comandos < tarea.tarea.resumenActividad.comandos
      ? tarea.tarea.resumenActividad
      : rollout.resumenActividad
  const ultimaActividadMs = maximo([
    hilo.actualizadoMs,
    rollout.ultimaActividadMs,
    tarea?.tarea.mtimeMs,
  ])
  let estado: EstadoAgente
  if (esTarea) {
    const actividadTarea =
      tarea?.tarea.mtimeMs ?? rollout.ultimaActividadMs ?? hilo.actualizadoMs
    estado = estadoTarea(tarea?.tarea.completada ?? false, actividadTarea, ahoraMs)
  } else if (!abiertos.has(hilo.id)) {
    estado = 'cerrada'
  } else {
    estado =
      rollout.turnoAbierto || ahoraMs - ultimaActividadMs < ACTIVIDAD_RECIENTE_MS
        ? 'trabajando'
        : 'esperandote'
  }

  return {
    id: `codex:${hilo.id}`,
    tipo: 'codex',
    modo: esTarea ? 'tarea' : 'interactivo',
    titulo: enmascararSecretos(hilo.titulo),
    cwd: hilo.cwd,
    proyectoIds: asignarProyectos(hilo.cwd, [], proyectos),
    estado,
    rol: rolCodex(hilo.source, hilo.modelo, esTarea),
    ultimaAccion: rollout.ultimaAccion,
    resumenActividad,
    modelo: hilo.modelo,
    esfuerzo: hilo.esfuerzo,
    contexto: rollout.contexto,
    tokensTotales: hilo.tokens,
    ultimoPrompt: enmascararNullable(rollout.ultimoPrompt ?? tarea?.tarea.prompt ?? null),
    rama: hilo.rama,
    pr: null,
    inicioMs: hilo.creadoMs,
    ultimaActividadMs,
    padreId: hilo.padreId === null ? null : `codex:${hilo.padreId}`,
    entrada: hilo.source,
    puedeContinuar: esTarea ? estado !== 'en-curso' : estado === 'cerrada',
    tareas: [],
    commitsPorProyecto: {},
  }
}

function agenteDeTareaSinHilo(
  item: TareaConProyecto,
  ahoraMs: number,
): Agente {
  const { tarea, proyecto } = item
  const estado = estadoTarea(tarea.completada, tarea.mtimeMs, ahoraMs)
  return {
    // El id no lleva la ruta del log: la API nunca debe exponer rutas.
    id: `codex-tarea:${createHash('sha1').update(tarea.archivo).digest('hex').slice(0, 16)}`,
    tipo: 'codex',
    modo: 'tarea',
    titulo: enmascararSecretos(tituloDePrompt(tarea.prompt)),
    cwd: proyecto.ruta,
    proyectoIds: [proyecto.id],
    estado,
    rol: rolCodex('exec', tarea.modelo, true),
    ultimaAccion: tarea.ultimaAccion,
    resumenActividad: tarea.resumenActividad,
    modelo: tarea.modelo,
    esfuerzo: tarea.esfuerzo,
    contexto: null,
    tokensTotales: null,
    ultimoPrompt: enmascararSecretos(tarea.prompt),
    rama: null,
    pr: null,
    inicioMs: null,
    ultimaActividadMs: tarea.mtimeMs,
    padreId: null,
    entrada: 'exec',
    puedeContinuar: estado !== 'en-curso',
    tareas: [],
    commitsPorProyecto: {},
  }
}

function tituloDePrompt(prompt: string): string {
  const primera = prompt.split(/\r?\n/).map((linea) => linea.trim()).find((linea) => linea.length > 0) ?? ''
  return primera.length <= 90 ? primera : `${primera.slice(0, 90)}…`
}

async function construirAgentesCodex(
  dep: DependenciasInstantanea,
  proyectos: ProyectoBase[],
  guardian: ReturnType<typeof crearGuardian>,
  hayCodex: boolean,
): Promise<Agente[]> {
  if (!hayCodex) return []

  const hilos = leerHilosCodex(dep.rutas.codex, dep.ahoraMs - SIETE_DIAS_MS)
  const tareas = await leerTareasGuardadas(proyectos, guardian, dep.ahoraMs - SIETE_DIAS_MS)
  const tareasPorHilo = new Map<string, TareaConProyecto>()
  for (const item of tareas) {
    if (item.tarea.threadId !== null && !tareasPorHilo.has(item.tarea.threadId)) {
      tareasPorHilo.set(item.tarea.threadId, item)
    }
  }

  const procesosDetectados = await procesosCodex(dep.so, dep.ejecutar, dep.ahoraMs)
  const procesos: ProcesoCodex[] = procesosDetectados ?? [
    {
      pid: 0,
      cwd: null,
      inicioMs: dep.ahoraMs - UN_DIA_MS,
      interactivo: true,
    },
  ]
  const abiertos = hilosAbiertos(hilos, procesos)
  const agentes: Agente[] = []
  for (const hilo of hilos) {
    const rutaRollout = await rutaPermitida(guardian, hilo.rollout)
    if (rutaRollout === null) continue
    try {
      const rollout = await lectorRollouts.resumen(rutaRollout)
      const agente = agenteDeHilo(
        hilo,
        rollout,
        tareasPorHilo.get(hilo.id),
        abiertos,
        proyectos,
        dep.ahoraMs,
      )
      agentes.push(agente)
      dep.registrarFuente?.(agente.id, { tipo: 'codex-rollout', ruta: rutaRollout })
    } catch {
      // Un rollout rechazado, incompleto o desaparecido omite solo su agente.
    }
  }

  const idsHilos = new Set(hilos.map((hilo) => hilo.id))
  for (const tarea of tareas) {
    if (tarea.tarea.threadId !== null && idsHilos.has(tarea.tarea.threadId)) continue
    const agente = agenteDeTareaSinHilo(tarea, dep.ahoraMs)
    agentes.push(agente)
    dep.registrarFuente?.(agente.id, { tipo: 'codex-log', ruta: tarea.rutaValidada })
  }
  return agentes
}

function anadirPendientesSesiones(
  proyectos: ProyectoEnConstruccion[],
  agentes: Agente[],
  idsVivos: Set<string>,
): void {
  const porId = new Map(proyectos.map((proyecto) => [proyecto.id, proyecto]))
  for (const agente of agentes) {
    if (agente.tipo !== 'claude') continue
    const sessionId = agente.id.split(':')[1]
    if (sessionId === undefined || !idsVivos.has(sessionId) || agente.padreId !== null) continue
    for (const tarea of agente.tareas) {
      if (tarea.estado === 'hecha') continue
      for (const proyectoId of agente.proyectoIds) {
        porId.get(proyectoId)?.pendientes.push({
          origen: 'sesion',
          titulo: enmascararSecretos(tarea.texto),
          fechaMs: agente.ultimaActividadMs,
          hechas: null,
          total: null,
          quizaDesactualizado: false,
        })
      }
    }
  }
}

function actualizarActividadProyectos(
  proyectos: ProyectoEnConstruccion[],
  agentes: Agente[],
): void {
  const porId = new Map(proyectos.map((proyecto) => [proyecto.id, proyecto]))
  for (const agente of agentes) {
    for (const proyectoId of agente.proyectoIds) {
      const proyecto = porId.get(proyectoId)
      if (proyecto !== undefined) {
        proyecto.ultimaActividadMs = Math.max(
          proyecto.ultimaActividadMs,
          agente.ultimaActividadMs,
        )
      }
    }
  }
}

export async function construirInstantanea(
  dep: DependenciasInstantanea,
): Promise<Instantanea> {
  const [hayClaude, hayCodex] = await Promise.all([
    esDirectorio(dep.rutas.claude),
    esDirectorio(dep.rutas.codex),
  ])
  const bases = await descubrirProyectos(dep.cfg, dep.rutas)

  const candidatasPermitidas = [
    path.join(dep.rutas.claude, 'projects'),
    path.join(dep.rutas.claude, 'sessions'),
    path.join(dep.rutas.codex, 'sessions'),
    ...bases.map((proyecto) => proyecto.ruta),
    ...bases.map((proyecto) => path.join(path.dirname(proyecto.ruta), 'HANDOFF.md')),
  ]
  const permitidas: string[] = []
  for (const candidata of candidatasPermitidas) {
    try {
      await stat(candidata)
      permitidas.push(candidata)
    } catch {
      // Una ruta opcional puede no existir o desaparecer durante el escaneo.
    }
  }
  const guardian = crearGuardian({ permitidas })
  const proyectos = await construirProyectos(bases, dep.ahoraMs, guardian)

  const [claude, codex] = await Promise.all([
    construirAgentesClaude(dep, bases, guardian, hayClaude),
    construirAgentesCodex(dep, bases, guardian, hayCodex),
  ])
  const agentes = [...claude.agentes, ...codex]
  anadirPendientesSesiones(proyectos, claude.agentes, claude.idsVivos)
  actualizarActividadProyectos(proyectos, agentes)

  const avisos: Array<'sin-claude' | 'sin-codex'> = []
  if (!hayClaude) avisos.push('sin-claude')
  if (!hayCodex) avisos.push('sin-codex')

  return Instantanea.parse({
    version: 1,
    maquina: {
      id: idMaquina(dep.cfg.nombreMaquina),
      nombre: dep.cfg.nombreMaquina,
      so: dep.so,
      avisos,
    },
    generadaMs: dep.ahoraMs,
    proyectos: proyectos.map((proyecto) => ({ ...proyecto })),
    agentes,
    terminales: dep.listarTerminales === undefined ? [] : await dep.listarTerminales().catch(() => []),
  })
}
