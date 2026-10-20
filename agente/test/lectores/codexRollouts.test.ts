import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { crearLectorRollouts } from '../../src/lectores/codexRollouts.js'

const temporales: string[] = []

async function crearDirectorioTemporal(): Promise<string> {
  const directorio = await mkdtemp(path.join(tmpdir(), 'centro-codex-rollouts-'))
  temporales.push(directorio)
  return directorio
}

function linea(objeto: unknown): string {
  return `${JSON.stringify(objeto)}\n`
}

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((directorio) => rm(directorio, { recursive: true })))
})

describe('crearLectorRollouts', () => {
  it('resume prompt, contexto, turno y ultima actividad con el formato real', async () => {
    const directorio = await crearDirectorioTemporal()
    const ruta = path.join(directorio, 'rollout.jsonl')
    await writeFile(
      ruta,
      [
        {
          timestamp: '2026-10-19T08:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Haz la tarea' },
        },
        {
          timestamp: '2026-10-19T08:01:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: { total_tokens: 20116 },
              model_context_window: 258400,
            },
          },
        },
        {
          timestamp: '2026-10-19T08:02:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        },
      ]
        .map(linea)
        .join(''),
    )

    const lector = crearLectorRollouts()
    await expect(lector.resumen(ruta)).resolves.toEqual({
      ultimoPrompt: 'Haz la tarea',
      contexto: { usados: 20116, ventana: 258400 },
      turnoAbierto: true,
      ultimaActividadMs: Date.parse('2026-10-19T08:02:00.000Z'),
    })

    await appendFile(
      ruta,
      linea({
        timestamp: '2026-10-19T08:03:00.000Z',
        type: 'event_msg',
        payload: { type: 'task_complete' },
      }),
    )
    await expect(lector.resumen(ruta)).resolves.toMatchObject({ turnoAbierto: false })
  })
})
