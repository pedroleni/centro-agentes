import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { leerHilosCodex } from '../../src/lectores/codexHilos.js'

const temporales: string[] = []
const conexiones: DatabaseSync[] = []

async function crearDirectorioTemporal(): Promise<string> {
  const directorio = await mkdtemp(path.join(tmpdir(), 'centro-codex-hilos-'))
  temporales.push(directorio)
  return directorio
}

function crearBase(ruta: string, wal = false): DatabaseSync {
  const base = new DatabaseSync(ruta)
  conexiones.push(base)
  if (wal) base.exec('PRAGMA journal_mode = WAL')
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
  return base
}

function insertarHilo(
  base: DatabaseSync,
  hilo: {
    id: string
    actualizadoMs: number
    archivado?: number
    source?: string
    cwd?: string
  },
): void {
  base
    .prepare(
      `INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      hilo.id,
      `Titulo ${hilo.id}`,
      hilo.cwd ?? '/proyecto',
      'gpt-5.6-sol',
      'medium',
      1234,
      'main',
      hilo.source ?? 'cli',
      hilo.archivado ?? 0,
      1_000,
      hilo.actualizadoMs,
      `/rollouts/${hilo.id}.jsonl`,
    )
}

afterEach(async () => {
  for (const conexion of conexiones.splice(0)) conexion.close()
  await Promise.all(temporales.splice(0).map((directorio) => rm(directorio, { recursive: true })))
})

describe('leerHilosCodex', () => {
  it('lee la base con mayor numero, filtra archivados y resuelve el padre', async () => {
    const directorio = await crearDirectorioTemporal()
    const base5 = crearBase(path.join(directorio, 'state_5.sqlite'))
    insertarHilo(base5, { id: 'de-la-cinco', actualizadoMs: 9_000 })

    const base7 = crearBase(path.join(directorio, 'state_7.sqlite'))
    insertarHilo(base7, { id: 'padre', actualizadoMs: 2_000 })
    insertarHilo(base7, { id: 'hijo', actualizadoMs: 3_000 })
    insertarHilo(base7, { id: 'archivado', actualizadoMs: 4_000, archivado: 1 })
    insertarHilo(base7, { id: 'antiguo', actualizadoMs: 500 })
    base7
      .prepare('INSERT INTO thread_spawn_edges VALUES (?, ?, ?)')
      .run('padre', 'hijo', 'active')

    expect(leerHilosCodex(directorio, 1_000)).toEqual([
      {
        id: 'hijo',
        titulo: 'Titulo hijo',
        cwd: '/proyecto',
        modelo: 'gpt-5.6-sol',
        esfuerzo: 'medium',
        tokens: 1234,
        rama: 'main',
        source: 'cli',
        creadoMs: 1_000,
        actualizadoMs: 3_000,
        rollout: '/rollouts/hijo.jsonl',
        padreId: 'padre',
      },
      {
        id: 'padre',
        titulo: 'Titulo padre',
        cwd: '/proyecto',
        modelo: 'gpt-5.6-sol',
        esfuerzo: 'medium',
        tokens: 1234,
        rama: 'main',
        source: 'cli',
        creadoMs: 1_000,
        actualizadoMs: 2_000,
        rollout: '/rollouts/padre.jsonl',
        padreId: null,
      },
    ])
  })

  it('lee en modo WAL mientras otra conexion sigue escribiendo', async () => {
    const directorio = await crearDirectorioTemporal()
    const escritor = crearBase(path.join(directorio, 'state_12.sqlite'), true)
    insertarHilo(escritor, { id: 'visible-en-wal', actualizadoMs: 8_000 })
    escritor.exec('BEGIN IMMEDIATE')
    insertarHilo(escritor, { id: 'aun-sin-commit', actualizadoMs: 9_000 })

    expect(leerHilosCodex(directorio, 0).map((hilo) => hilo.id)).toEqual(['visible-en-wal'])

    escritor.exec('ROLLBACK')
  })

  it('devuelve una lista vacia si no hay base de datos', async () => {
    const directorio = await crearDirectorioTemporal()
    await mkdir(path.join(directorio, 'otro'), { recursive: true })

    expect(leerHilosCodex(directorio, 0)).toEqual([])
  })
})
