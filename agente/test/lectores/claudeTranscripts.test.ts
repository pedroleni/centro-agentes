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
  it('atribuye git commit al último cd del mismo comando, incluidas rutas con espacios', async () => {
    const directorio = await crearDirectorioTemporal()
    const ruta = path.join(directorio, 'sesion-cd.jsonl')
    const fecha = '2026-10-19T09:00:00.000Z'
    await writeFile(ruta, jsonl([{
      type: 'assistant',
      cwd: '/r/a',
      timestamp: fecha,
      message: {
        content: [{
          type: 'tool_use',
          name: 'Bash',
          input: { command: 'cd "/r/Proyectos IA/b" && git add . && git commit -m x' },
        }],
      },
    }]))

    const resumen = await crearLectorClaude('/r').resumen(ruta)

    expect(resumen.commits).toEqual([
      { fechaMs: Date.parse(fecha), dir: '/r/Proyectos IA/b' },
    ])
  })

  it.each([
    ['cd ~/Desktop/"Proyectos IA"/centro-agentes && git commit -m x'],
    ["cd ~/Desktop/'Proyectos IA'/centro-agentes && git commit -m x"],
  ])('interpreta comillas parciales y ~ al atribuir un commit: %s', async (command) => {
    const directorio = await crearDirectorioTemporal()
    const ruta = path.join(directorio, 'sesion-home.jsonl')
    const fecha = '2026-10-19T09:00:00.000Z'
    await writeFile(ruta, jsonl([{
      type: 'assistant',
      cwd: '/otro',
      timestamp: fecha,
      message: {
        content: [{ type: 'tool_use', name: 'Bash', input: { command } }],
      },
    }]))

    const resumen = await crearLectorClaude('/home/pedro').resumen(ruta)

    expect(resumen.commits).toEqual([{
      fechaMs: Date.parse(fecha),
      dir: '/home/pedro/Desktop/Proyectos IA/centro-agentes',
    }])
  })

  it('da prioridad a la carpeta indicada con git -C', async () => {
    const directorio = await crearDirectorioTemporal()
    const ruta = path.join(directorio, 'sesion-c.jsonl')
    const fecha = '2026-10-19T09:00:00.000Z'
    await writeFile(ruta, jsonl([{
      type: 'assistant',
      cwd: '/r/a',
      timestamp: fecha,
      message: {
        content: [{
          type: 'tool_use',
          name: 'Bash',
          input: { command: 'git -C /r/b commit -m x' },
        }],
      },
    }]))

    const resumen = await crearLectorClaude('/r').resumen(ruta)

    expect(resumen.commits).toEqual([{ fechaMs: Date.parse(fecha), dir: '/r/b' }])
  })

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
              { type: 'tool_use', name: 'Bash', input: { command: 'git status' } },
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
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'git add . && git commit -m "x"' },
              },
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
      commits: [{
        fechaMs: Date.parse('2026-10-19T09:00:00.000Z'),
        dir: '/Proyectos IA/Año ñ',
      }],
      ultimaAccion: {
        tipo: 'comando',
        texto: 'git add . && git commit -m "x"',
        fechaMs: Date.parse('2026-10-19T09:00:00.000Z'),
      },
      resumenActividad: {
        comandos: 2,
        ediciones: 3,
        mensajes: 0,
        ficheros: ['b.ts', 'a.ts'],
      },
    })
  })

  it('prefiere el texto posterior del asistente como última acción y cuenta la actividad', async () => {
    const directorio = await crearDirectorioTemporal()
    const ruta = path.join(directorio, 'sesion-actividad.jsonl')
    await writeFile(ruta, jsonl([
      {
        type: 'assistant',
        timestamp: '2026-10-19T09:00:00.000Z',
        message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] },
      },
      {
        type: 'assistant',
        timestamp: '2026-10-19T09:01:00.000Z',
        message: { content: [{ type: 'text', text: 'Las pruebas han terminado.' }] },
      },
    ]))

    const resumen = await crearLectorClaude('/home/pedro').resumen(ruta)

    expect(resumen.ultimaAccion).toEqual({
      tipo: 'mensaje',
      texto: 'Las pruebas han terminado.',
      fechaMs: Date.parse('2026-10-19T09:01:00.000Z'),
    })
    expect(resumen.resumenActividad).toEqual({
      comandos: 1,
      ediciones: 0,
      mensajes: 1,
      ficheros: [],
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
  it('conserva solo la copia mas reciente de una sesion movida entre carpetas', async () => {
    const directorio = await crearDirectorioTemporal()
    const antigua = path.join(directorio, '-Users-p-Antiguo', 'sid.jsonl')
    const reciente = path.join(directorio, '-Users-p-Nuevo', 'sid.jsonl')
    await mkdir(path.dirname(antigua), { recursive: true })
    await mkdir(path.dirname(reciente), { recursive: true })
    await writeFile(antigua, jsonl([{ type: 'ai-title', aiTitle: 'Titulo antiguo' }]))
    await writeFile(reciente, jsonl([{ type: 'ai-title', aiTitle: 'Titulo reciente' }]))

    const baseMs = Date.parse('2026-10-19T08:00:00.000Z')
    await utimes(antigua, baseMs / 1_000, baseMs / 1_000)
    await utimes(reciente, (baseMs + 5_000) / 1_000, (baseMs + 5_000) / 1_000)

    const encontrados = await listarTranscripts(directorio, 0)

    expect(encontrados).toHaveLength(1)
    expect(encontrados[0]?.ruta).toBe(reciente)
    await expect(crearLectorClaude().resumen(encontrados[0]!.ruta)).resolves.toMatchObject({
      sessionId: 'sid',
      titulo: 'Titulo reciente',
    })
  })

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
