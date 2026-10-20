import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { estadoTarea, leerTareasCodex } from '../../src/lectores/codexTareas.js'

const temporales: string[] = []

async function crearDirectorioTemporal(): Promise<string> {
  const directorio = await mkdtemp(path.join(tmpdir(), 'centro-codex-tareas-'))
  temporales.push(directorio)
  return directorio
}

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((directorio) => rm(directorio, { recursive: true })))
})

describe('leerTareasCodex', () => {
  it('lee metadatos, hilo, ultimo mensaje y finalizacion del log', async () => {
    const proyecto = await crearDirectorioTemporal()
    const directorioLogs = path.join(proyecto, '.codex-logs')
    const ruta = path.join(directorioLogs, '20261019-tarea.jsonl')
    await mkdir(directorioLogs)
    await writeFile(
      ruta,
      [
        { type: 'task_meta', effort: 'medium', model: 'gpt-5.6-sol', prompt: 'Implementa' },
        { type: 'thread.started', thread_id: 'hilo-123' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'Primero' } },
        { type: 'item.completed', item: { type: 'command_execution', command: 'npm test' } },
        {
          type: 'item.completed',
          item: { type: 'file_change', changes: [{ path: '/repo/src/actividad.ts' }] },
        },
        { type: 'item.completed', item: { type: 'agent_message', text: 'Terminado' } },
        { type: 'turn.completed', usage: { input_tokens: 10 } },
      ]
        .map((objeto) => JSON.stringify(objeto))
        .join('\n') + '\n',
    )

    const tareas = await leerTareasCodex(proyecto)

    expect(tareas).toHaveLength(1)
    expect(tareas[0]).toEqual({
      archivo: ruta,
      threadId: 'hilo-123',
      prompt: 'Implementa',
      esfuerzo: 'medium',
      modelo: 'gpt-5.6-sol',
      ultimoMensaje: 'Terminado',
      completada: true,
      mtimeMs: expect.any(Number),
      ultimaAccion: {
        tipo: 'mensaje',
        texto: 'Terminado',
        fechaMs: expect.any(Number),
      },
      resumenActividad: {
        comandos: 1,
        ediciones: 1,
        mensajes: 2,
        ficheros: ['actividad.ts'],
      },
    })
  })

  it('convierte file_change en una última acción de edición', async () => {
    const proyecto = await crearDirectorioTemporal()
    const directorioLogs = path.join(proyecto, '.codex-logs')
    await mkdir(directorioLogs)
    await writeFile(
      path.join(directorioLogs, 'cambio.jsonl'),
      [
        { type: 'task_meta', effort: 'high', model: 'gpt-5.6', prompt: 'Edita' },
        {
          type: 'item.completed',
          item: { type: 'file_change', changes: [{ path: '/repo/src/uno.ts' }] },
        },
      ].map((objeto) => JSON.stringify(objeto)).join('\n') + '\n',
    )

    const [tarea] = await leerTareasCodex(proyecto)

    expect(tarea?.ultimaAccion).toMatchObject({ tipo: 'edicion', texto: 'uno.ts' })
  })

  it('devuelve una lista vacia si no existe el directorio de logs', async () => {
    const proyecto = await crearDirectorioTemporal()
    await expect(leerTareasCodex(proyecto)).resolves.toEqual([])
  })
})

describe('estadoTarea', () => {
  it('distingue tareas terminadas, en curso e interrumpidas', () => {
    const ahora = 2_000_000
    expect(estadoTarea(true, ahora - 180_000, ahora)).toBe('terminado')
    expect(estadoTarea(false, ahora - 60_000, ahora)).toBe('en-curso')
    expect(estadoTarea(false, ahora - 180_000, ahora)).toBe('interrumpido')
  })
})
