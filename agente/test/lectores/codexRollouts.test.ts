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
  it('resume comandos custom_tool_call y ediciones patch_apply_end del formato real', async () => {
    const directorio = await crearDirectorioTemporal()
    const ruta = path.join(directorio, 'rollout-real.jsonl')
    const fechaComando = '2026-10-19T08:00:00.000Z'
    const fechaEdicion = '2026-10-19T08:01:00.000Z'
    await writeFile(ruta, [
      {
        timestamp: fechaComando,
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          input: 'const r = await tools.exec_command({"cmd":"npm test\\necho despues","workdir":"/repo"})\ntext(r.output);',
        },
      },
      {
        timestamp: fechaEdicion,
        type: 'event_msg',
        payload: {
          type: 'patch_apply_end',
          changes: ['/repo/src/uno.ts', '/repo/src/dos.ts'],
          success: true,
        },
      },
    ].map(linea).join(''))

    const resumen = await crearLectorRollouts().resumen(ruta)

    expect(resumen.ultimaAccion).toEqual({
      tipo: 'edicion',
      texto: 'uno.ts, dos.ts',
      fechaMs: Date.parse(fechaEdicion),
    })
    expect(resumen.resumenActividad).toEqual({
      comandos: 1,
      ediciones: 1,
      mensajes: 0,
      ficheros: ['dos.ts', 'uno.ts'],
    })
  })

  it('acepta changes como objeto ruta → cambio, que es el formato real de Codex', async () => {
    const directorio = await crearDirectorioTemporal()
    const ruta = path.join(directorio, 'rollout-objeto.jsonl')
    const fecha = '2026-10-20T08:01:00.000Z'
    await writeFile(ruta, linea({
      timestamp: fecha,
      type: 'event_msg',
      payload: {
        type: 'patch_apply_end',
        changes: {
          '/repo/src/uno.ts': { type: 'update', unified_diff: '@@ -1 +1 @@' },
          '/repo/test/dos.test.ts': { type: 'add', content: 'x' },
        },
        success: true,
      },
    }))

    const resumen = await crearLectorRollouts().resumen(ruta)

    expect(resumen.resumenActividad.ediciones).toBe(1)
    expect(resumen.resumenActividad.ficheros).toEqual(['dos.test.ts', 'uno.ts'])
  })

  it('cuenta una sola edición cuando un exec con patch va seguido de su patch_apply_end', async () => {
    const directorio = await crearDirectorioTemporal()
    const ruta = path.join(directorio, 'rollout-patch-js.jsonl')
    await writeFile(ruta, [
      {
        timestamp: '2026-10-20T08:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'c1',
          input: 'const patch = "*** Begin Patch\\n*** Update File: /repo/src/a.ts\\n@@\\n-x\\n+y\\n*** End Patch";\nawait tools.apply_patch(patch);',
        },
      },
      {
        timestamp: '2026-10-20T08:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'patch_apply_end', changes: { '/repo/src/a.ts': { type: 'update' } }, success: true },
      },
    ].map(linea).join(''))

    const resumen = await crearLectorRollouts().resumen(ruta)

    expect(resumen.resumenActividad.ediciones).toBe(1)
    expect(resumen.resumenActividad.comandos).toBe(0)
    expect(resumen.resumenActividad.ficheros).toEqual(['a.ts'])
    expect(resumen.ultimaAccion?.texto).toBe('a.ts')
  })

  it('convierte un function_call en la última acción de comando', async () => {
    const directorio = await crearDirectorioTemporal()
    const ruta = path.join(directorio, 'rollout-comando.jsonl')
    const fecha = '2026-10-19T08:00:00.000Z'
    await writeFile(ruta, linea({
      timestamp: fecha,
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell_command',
        arguments: JSON.stringify({ cmd: 'npm test\necho despues' }),
      },
    }))

    const resumen = await crearLectorRollouts().resumen(ruta)

    expect(resumen.ultimaAccion).toEqual({
      tipo: 'comando',
      texto: 'npm test',
      fechaMs: Date.parse(fecha),
    })
    expect(resumen.resumenActividad).toEqual({
      comandos: 1,
      ediciones: 0,
      mensajes: 0,
      ficheros: [],
    })
  })

  it('ignora un exec con patch (lo cuenta su patch_apply_end) y marca el resto como código de herramienta', async () => {
    const directorio = await crearDirectorioTemporal()
    const ruta = path.join(directorio, 'rollout-exec-sin-cmd.jsonl')
    await writeFile(ruta, [
      {
        timestamp: '2026-10-19T08:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          input: '*** Begin Patch\n*** Add File: /repo/src/nuevo.ts\n*** Delete File: /repo/src/viejo.ts\n*** End Patch',
        },
      },
      {
        timestamp: '2026-10-19T08:01:00.000Z',
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'exec', input: 'await herramienta()' },
      },
    ].map(linea).join(''))

    const resumen = await crearLectorRollouts().resumen(ruta)

    expect(resumen.ultimaAccion).toEqual({
      tipo: 'comando',
      texto: 'Código de herramienta',
      fechaMs: Date.parse('2026-10-19T08:01:00.000Z'),
    })
    expect(resumen.resumenActividad).toEqual({
      comandos: 1,
      ediciones: 0,
      mensajes: 0,
      ficheros: [],
    })
  })

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
      ultimaAccion: null,
      resumenActividad: { comandos: 0, ediciones: 0, mensajes: 0, ficheros: [] },
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
