import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  crearLectorClaude,
  listarTranscripts,
} from '../../src/lectores/claudeTranscripts.js'

const temporales: string[] = []

async function crearDirectorioTemporal(): Promise<string> {
  const directorio = await mkdtemp(path.join(tmpdir(), 'centro-claude-transcripts-'))
  temporales.push(directorio)
  return directorio
}

function jsonl(objetos: unknown[]): string {
  return `${objetos.map((objeto) => JSON.stringify(objeto)).join('\n')}\n`
}

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((directorio) => rm(directorio, { recursive: true })))
})

describe('crearLectorClaude', () => {
  it('resume los tipos reales del transcript y conserva los ultimos valores', async () => {
    const directorio = await crearDirectorioTemporal()
    const ruta = path.join(directorio, 'sesion-1.jsonl')
    await writeFile(
      ruta,
      jsonl([
        { type: 'ai-title', aiTitle: 'Titulo inicial' },
        { type: 'ai-title', aiTitle: 'Titulo definitivo' },
        { type: 'last-prompt', lastPrompt: 'Primer prompt' },
        { type: 'last-prompt', lastPrompt: 'Ultimo prompt' },
        {
          type: 'user',
          message: { content: 'Haz la tarea' },
          cwd: '/Proyectos IA/Año ñ',
          gitBranch: 'main',
          timestamp: '2026-10-19T08:00:00.000Z',
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-sonnet-4-6',
            usage: {
              input_tokens: 1,
              cache_creation_input_tokens: 10,
              cache_read_input_tokens: 100,
            },
            content: [
              {
                type: 'tool_use',
                name: 'TodoWrite',
                input: {
                  todos: [{ content: 'Lista anterior', status: 'pending' }],
                },
              },
            ],
          },
          cwd: '/otra/ruta/que/no-gana',
          gitBranch: '',
          timestamp: '2026-10-19T08:10:00.000Z',
        },
        { type: 'pr-link', prNumber: '18', prUrl: 'https://example.test/pull/18' },
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-6',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 900,
            },
            content: [
              {
                type: 'tool_use',
                name: 'TodoWrite',
                input: {
                  todos: [
                    { content: 'En proceso', status: 'in_progress' },
                    { content: 'Por hacer', status: 'pending' },
                    { content: 'Terminada', status: 'completed' },
                  ],
                },
              },
              { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/a.ts' } },
              { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/a.ts' } },
              { type: 'tool_use', name: 'Write', input: { file_path: '/repo/b.ts' } },
            ],
          },
          gitBranch: 'tarea/seis',
          timestamp: '2026-10-19T09:00:00.000Z',
        },
      ]),
    )

    const lector = crearLectorClaude()
    await expect(lector.resumen(ruta)).resolves.toEqual({
      sessionId: 'sesion-1',
      agenteSubId: null,
      titulo: 'Titulo definitivo',
      ultimoPrompt: 'Ultimo prompt',
      modelo: 'claude-opus-4-6',
      contextoUsado: 1002,
      rama: 'tarea/seis',
      pr: { numero: 18, url: 'https://example.test/pull/18' },
      cwd: '/Proyectos IA/Año ñ',
      inicioMs: Date.parse('2026-10-19T08:00:00.000Z'),
      ultimaActividadMs: Date.parse('2026-10-19T09:00:00.000Z'),
      tareas: [
        { texto: 'En proceso', estado: 'en-curso' },
        { texto: 'Por hacer', estado: 'pendiente' },
        { texto: 'Terminada', estado: 'hecha' },
      ],
      ficherosEditados: ['/repo/a.ts', '/repo/b.ts'],
    })
  })

  it('identifica el subagente por su ruta y procesa solo las lineas nuevas', async () => {
    const directorio = await crearDirectorioTemporal()
    const ruta = path.join(directorio, 'sid', 'subagents', 'agent-abc.jsonl')
    await mkdir(path.dirname(ruta), { recursive: true })
    await writeFile(ruta, jsonl([{ type: 'ai-title', aiTitle: 'Antes' }]))
    const lector = crearLectorClaude()

    const primero = await lector.resumen(ruta)
    expect(primero.agenteSubId).toBe('abc')
    expect(primero.sessionId).toBe('sid')

    await appendFile(ruta, jsonl([{ type: 'ai-title', aiTitle: 'Despues' }]))
    const segundo = await lector.resumen(ruta)
    expect(segundo.titulo).toBe('Despues')
  })
})

describe('listarTranscripts', () => {
  it('lista sesiones y subagentes recientes con el id de la sesion padre', async () => {
    const directorio = await crearDirectorioTemporal()
    const proyecto = path.join(directorio, '-Users-p-Proyectos-IA')
    const sesion = path.join(proyecto, 's1.jsonl')
    const subagente = path.join(proyecto, 's1', 'subagents', 'agent-x.jsonl')
    const antiguo = path.join(proyecto, 'antiguo.jsonl')
    await mkdir(path.dirname(subagente), { recursive: true })
    await writeFile(sesion, '{}\n')
    await writeFile(subagente, '{}\n')
    await writeFile(antiguo, '{}\n')

    const desdeMs = Date.parse('2026-10-19T08:00:00.000Z')
    const recienteMs = desdeMs + 5_000
    await utimes(sesion, recienteMs / 1_000, recienteMs / 1_000)
    await utimes(subagente, recienteMs / 1_000, recienteMs / 1_000)
    await utimes(antiguo, (desdeMs - 5_000) / 1_000, (desdeMs - 5_000) / 1_000)

    const encontrados = await listarTranscripts(directorio, desdeMs)

    expect(encontrados).toHaveLength(2)
    expect(encontrados).toEqual(
      expect.arrayContaining([
        { sessionId: 's1', agenteSubId: null, ruta: sesion, mtimeMs: recienteMs },
        { sessionId: 's1', agenteSubId: 'x', ruta: subagente, mtimeMs: recienteMs },
      ]),
    )
  })
})
