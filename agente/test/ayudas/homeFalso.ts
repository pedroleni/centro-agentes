import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ConfigAgente } from '../../src/config.js'
import { idProyecto } from '../../src/lectores/proyectos.js'
import type { RutasBase } from '../../src/rutas/base.js'

export type HomeFalso = {
  raiz: string
  home: string
  ahoraMs: number
  proyectoA: string
  proyectoB: string
  idA: string
  idB: string
  rutas: RutasBase
  cfg: ConfigAgente
  rutaBaseCodex: string
  limpiar(): Promise<void>
  crearRolloutMalicioso(id: string): Promise<void>
}

function jsonl(objetos: unknown[]): string {
  return `${objetos.map((objeto) => JSON.stringify(objeto)).join('\n')}\n`
}

function crearBaseCodex(ruta: string): void {
  const base = new DatabaseSync(ruta)
  try {
    base.exec(`
      CREATE TABLE threads (
        id TEXT, title TEXT, cwd TEXT, model TEXT, reasoning_effort TEXT,
        tokens_used INTEGER, git_branch TEXT, source TEXT, archived INTEGER,
        created_at_ms INTEGER, updated_at_ms INTEGER, rollout_path TEXT
      );
      CREATE TABLE thread_spawn_edges (
        parent_thread_id TEXT, child_thread_id TEXT, status TEXT
      );
    `)
  } finally {
    base.close()
  }
}

function insertarHilo(
  rutaBase: string,
  hilo: {
    id: string
    titulo: string
    cwd: string
    modelo: string
    source: string
    creadoMs: number
    actualizadoMs: number
    rollout: string
  },
): void {
  const base = new DatabaseSync(rutaBase)
  try {
    base
      .prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        hilo.id,
        hilo.titulo,
        hilo.cwd,
        hilo.modelo,
        'high',
        321,
        'main',
        hilo.source,
        0,
        hilo.creadoMs,
        hilo.actualizadoMs,
        hilo.rollout,
      )
  } finally {
    base.close()
  }
}

export async function homeFalso(): Promise<HomeFalso> {
  const raiz = await realpath(await mkdtemp(path.join(tmpdir(), 'centro-home-falso-')))
  const home = path.join(raiz, 'home')
  const proyectos = path.join(home, 'Desktop', 'Proyectos IA')
  const proyectoA = path.join(proyectos, 'a')
  const proyectoB = path.join(proyectos, 'b')
  const claude = path.join(home, '.claude')
  const codex = path.join(home, '.codex')
  const sesionesClaude = path.join(claude, 'sessions')
  const proyectosClaude = path.join(claude, 'projects', '-home-Desktop-Proyectos-IA')
  const sesionesCodex = path.join(codex, 'sessions')
  const logsA = path.join(proyectoA, '.codex-logs')
  const ahoraMs = Date.now()

  await Promise.all([
    mkdir(path.join(proyectoA, '.git'), { recursive: true }),
    mkdir(path.join(proyectoB, '.git'), { recursive: true }),
    mkdir(sesionesClaude, { recursive: true }),
    mkdir(proyectosClaude, { recursive: true }),
    mkdir(sesionesCodex, { recursive: true }),
    mkdir(logsA, { recursive: true }),
  ])

  await writeFile(
    path.join(sesionesClaude, '4321.json'),
    JSON.stringify({
      pid: 4321,
      sessionId: 'viva-a',
      cwd: proyectoA,
      name: 'Claude vivo',
      status: 'busy',
      entrypoint: 'cli',
      startedAt: ahoraMs - 60_000,
      updatedAt: ahoraMs - 1_000,
    }),
  )
  await writeFile(
    path.join(proyectosClaude, 'viva-a.jsonl'),
    jsonl([
      {
        type: 'user',
        cwd: proyectoA,
        timestamp: new Date(ahoraMs - 60_000).toISOString(),
      },
      { type: 'ai-title', aiTitle: 'Sesion viva' },
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-5-5',
          usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 },
          content: [
            {
              type: 'tool_use',
              name: 'TodoWrite',
              input: {
                todos: [
                  { content: 'Pendiente vivo', status: 'pending' },
                  { content: 'Ya hecha', status: 'completed' },
                ],
              },
            },
          ],
        },
        timestamp: new Date(ahoraMs - 1_000).toISOString(),
      },
    ]),
  )
  await writeFile(
    path.join(proyectosClaude, 'cerrada-b.jsonl'),
    jsonl([
      {
        type: 'user',
        cwd: proyectos,
        timestamp: new Date(ahoraMs - 120_000).toISOString(),
      },
      { type: 'ai-title', aiTitle: 'Sesion cerrada' },
      { type: 'last-prompt', lastPrompt: 'Usa sk-ant-abc123def456ghi789' },
      {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-6',
          content: [
            { type: 'tool_use', name: 'Edit', input: { file_path: path.join(proyectoB, 'x.ts') } },
          ],
        },
        timestamp: new Date(ahoraMs - 90_000).toISOString(),
      },
    ]),
  )

  const rollout = path.join(sesionesCodex, 'hilo-exec.jsonl')
  await writeFile(
    rollout,
    jsonl([
      {
        timestamp: new Date(ahoraMs - 30_000).toISOString(),
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Implementa la tarea' },
      },
      {
        timestamp: new Date(ahoraMs - 20_000).toISOString(),
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { total_tokens: 111 }, model_context_window: 258_400 },
        },
      },
    ]),
  )
  await writeFile(
    path.join(logsA, 'tarea.jsonl'),
    jsonl([
      { type: 'task_meta', prompt: 'Implementa la tarea', effort: 'medium', model: 'otro-modelo' },
      { type: 'thread.started', thread_id: 'hilo-exec' },
    ]),
  )

  const rutaBaseCodex = path.join(codex, 'state_1.sqlite')
  crearBaseCodex(rutaBaseCodex)
  insertarHilo(rutaBaseCodex, {
    id: 'hilo-exec',
    titulo: 'Hilo de tarea',
    cwd: proyectoA,
    modelo: 'gpt-5.6-sol',
    source: 'exec',
    creadoMs: ahoraMs - 40_000,
    actualizadoMs: ahoraMs - 10_000,
    rollout,
  })

  const rutas: RutasBase = {
    home,
    claude,
    codex,
    temporales: [path.join(raiz, 'temporales')],
  }
  const cfg: ConfigAgente = {
    nombreMaquina: 'Maquina de pruebas',
    raices: [path.join(home, 'Desktop')],
    profundidad: 3,
    ocultos: [],
    ventanasContexto: {},
  }

  return {
    raiz,
    home,
    ahoraMs,
    proyectoA,
    proyectoB,
    idA: idProyecto(proyectoA),
    idB: idProyecto(proyectoB),
    rutas,
    cfg,
    rutaBaseCodex,
    async limpiar() {
      await rm(raiz, { recursive: true, force: true })
    },
    async crearRolloutMalicioso(id: string) {
      const auth = path.join(codex, 'auth.json')
      const enlace = path.join(sesionesCodex, `${id}.jsonl`)
      await writeFile(auth, jsonl([{ secreto: true }]))
      await symlink(auth, enlace)
      insertarHilo(rutaBaseCodex, {
        id,
        titulo: 'No debe salir',
        cwd: proyectoA,
        modelo: 'gpt-5.6-sol',
        source: 'cli',
        creadoMs: ahoraMs - 5_000,
        actualizadoMs: ahoraMs - 4_000,
        rollout: enlace,
      })
    },
  }
}
