import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  crearRegistroFuentes,
  leerLinea,
  type Fuente,
} from '../src/linea.js'

const temporales: string[] = []

async function crearJsonl(nombre: string, lineas: unknown[]): Promise<string> {
  const directorio = await mkdtemp(path.join(tmpdir(), 'centro-linea-'))
  temporales.push(directorio)
  const ruta = path.join(directorio, nombre)
  await writeFile(ruta, `${lineas.map((linea) => JSON.stringify(linea)).join('\n')}\n`)
  return ruta
}

function fuente(tipo: Fuente['tipo'], ruta: string): Fuente {
  return { tipo, ruta }
}

afterEach(async () => {
  await Promise.all(
    temporales.splice(0).map((directorio) => rm(directorio, { recursive: true, force: true })),
  )
})

describe('leerLinea', () => {
  it('convierte el transcript real de Claude y empareja el resultado de Bash', async () => {
    const ruta = await crearJsonl('claude.jsonl', [
      {
        type: 'user',
        timestamp: '2026-10-20T08:00:00.000Z',
        message: { content: 'Ejecuta las pruebas' },
      },
      {
        type: 'assistant',
        timestamp: '2026-10-20T08:01:00.000Z',
        message: {
          content: [
            { type: 'text', text: 'Voy a comprobarlo.' },
            { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'npm test' } },
          ],
        },
      },
      {
        type: 'user',
        timestamp: '2026-10-20T08:02:00.000Z',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: [{ type: 'text', text: '12 tests passed' }],
            },
          ],
        },
      },
    ])

    await expect(leerLinea(fuente('claude', ruta), null)).resolves.toEqual({
      eventos: [
        {
          fechaMs: Date.parse('2026-10-20T08:00:00.000Z'),
          tipo: 'usuario',
          texto: 'Ejecuta las pruebas',
          detalle: null,
        },
        {
          fechaMs: Date.parse('2026-10-20T08:01:00.000Z'),
          tipo: 'asistente',
          texto: 'Voy a comprobarlo.',
          detalle: null,
        },
        {
          fechaMs: Date.parse('2026-10-20T08:01:00.000Z'),
          tipo: 'comando',
          texto: 'npm test',
          detalle: '12 tests passed',
        },
      ],
      antes: null,
    })
  })

  it('entiende custom_tool_call, su salida y los event_msg reales de un rollout', async () => {
    const ruta = await crearJsonl('rollout.jsonl', [
      {
        timestamp: '2026-10-20T09:00:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Haz el cambio' },
      },
      {
        timestamp: '2026-10-20T09:01:00.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          call_id: 'call-1',
          name: 'exec',
          input: { cmd: 'npm test' },
        },
      },
      {
        timestamp: '2026-10-20T09:01:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-1',
          output: 'Todo correcto',
        },
      },
      {
        timestamp: '2026-10-20T09:02:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'patch_apply_end',
          success: true,
          changes: {
            '/repo/src/uno.ts': { type: 'update' },
            '/repo/test/dos.test.ts': { type: 'add' },
          },
        },
      },
      {
        timestamp: '2026-10-20T09:03:00.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'Cambio terminado' },
      },
    ])

    const resultado = await leerLinea(fuente('codex-rollout', ruta), null)

    expect(resultado.eventos).toEqual([
      expect.objectContaining({ tipo: 'usuario', texto: 'Haz el cambio' }),
      expect.objectContaining({ tipo: 'comando', texto: 'npm test', detalle: 'Todo correcto' }),
      expect.objectContaining({ tipo: 'edicion', texto: 'uno.ts, dos.test.ts' }),
      expect.objectContaining({ tipo: 'asistente', texto: 'Cambio terminado' }),
    ])
  })

  it('convierte command_execution, file_change y agent_message de .codex-logs', async () => {
    const ruta = await crearJsonl('tarea.jsonl', [
      {
        type: 'item.completed',
        item: { type: 'command_execution', command: 'npm run build', aggregated_output: 'OK' },
      },
      {
        type: 'item.completed',
        item: { type: 'file_change', changes: [{ path: '/repo/src/linea.ts' }] },
      },
      {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Listo' },
      },
    ])

    const resultado = await leerLinea(fuente('codex-log', ruta), null)

    expect(resultado.eventos).toEqual([
      expect.objectContaining({ tipo: 'comando', texto: 'npm run build', detalle: 'OK' }),
      expect.objectContaining({ tipo: 'edicion', texto: 'linea.ts' }),
      expect.objectContaining({ tipo: 'asistente', texto: 'Listo' }),
    ])
    expect(resultado.eventos.every((evento) => evento.fechaMs > 0)).toBe(true)
  })

  it('pagina hacia atras sin leer mas de 200 lineas cada vez', async () => {
    const lineas = Array.from({ length: 5_000 }, (_, indice) => ({
      type: 'item.completed',
      timestamp: indice,
      item: { type: 'agent_message', text: `mensaje-${indice}` },
    }))
    const ruta = await crearJsonl('grande.jsonl', lineas)

    const primera = await leerLinea(fuente('codex-log', ruta), null)
    const segunda = await leerLinea(fuente('codex-log', ruta), primera.antes)

    expect(primera.eventos).toHaveLength(200)
    expect(primera.eventos[0]?.texto).toBe('mensaje-4800')
    expect(primera.antes).not.toBeNull()
    expect(segunda.eventos).toHaveLength(200)
    expect(segunda.eventos[0]?.texto).toBe('mensaje-4600')
    expect(segunda.eventos.at(-1)?.texto).toBe('mensaje-4799')
  })

  it('enmascara secretos en comandos y detalles', async () => {
    const ruta = await crearJsonl('secreto.jsonl', [
      {
        type: 'item.completed',
        timestamp: 1,
        item: {
          type: 'command_execution',
          command: 'curl -H sk-1234567890abcdef https://example.test',
          aggregated_output: 'token: sk-abcdef1234567890',
        },
      },
    ])

    const resultado = await leerLinea(fuente('codex-log', ruta), null)

    expect(resultado.eventos[0]).toMatchObject({
      texto: 'curl -H «oculto» https://example.test',
      detalle: 'token: «oculto»',
    })
  })

  it.each([
    ['<task-notification>Terminó la tarea', false],
    ['<system-reminder>Recuerda el contexto', false],
    ['<command-name>prueba</command-name>', false],
    ['<local-command-stdout>salida</local-command-stdout>', false],
    ['Texto marcado como metadato', true],
  ])('convierte el aviso de sistema %s en un evento neutro', async (texto, isMeta) => {
    const ruta = await crearJsonl('aviso.jsonl', [{
      type: 'user',
      isMeta,
      timestamp: '2026-10-20T08:00:00.000Z',
      message: { content: texto },
    }])

    const resultado = await leerLinea(fuente('claude', ruta), null)

    expect(resultado.eventos).toEqual([{
      fechaMs: Date.parse('2026-10-20T08:00:00.000Z'),
      tipo: 'otro',
      texto: 'Aviso del sistema',
      detalle: null,
    }])
  })

  it('ignora un exec con patch y convierte el resto de exec sin cmd en código de herramienta', async () => {
    const ruta = await crearJsonl('exec-sin-cmd.jsonl', [
      {
        timestamp: '2026-10-20T09:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          input: '*** Begin Patch\n*** Update File: src/uno.ts\n*** Delete File: src/dos.ts\n*** End Patch',
        },
      },
      {
        timestamp: '2026-10-20T09:01:00.000Z',
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'exec', input: 'const resultado = herramienta()' },
      },
    ])

    const resultado = await leerLinea(fuente('codex-rollout', ruta), null)

    expect(resultado.eventos).toEqual([
      expect.objectContaining({ tipo: 'comando', texto: 'Código de herramienta' }),
    ])
  })
})

describe('crearRegistroFuentes', () => {
  it('sustituye el mapa entero solo cuando termina bien la construcción', async () => {
    const registro = crearRegistroFuentes()
    const antigua = fuente('claude', '/tmp/antigua.jsonl')
    const nueva = fuente('codex-rollout', '/tmp/nueva.jsonl')

    await registro.construir(async (registrar) => {
      registrar('antigua', antigua)
      return 'primera'
    })

    let terminar: (() => void) | undefined
    const pendiente = registro.construir(async (registrar) => {
      registrar('nueva', nueva)
      await new Promise<void>((resolve) => {
        terminar = resolve
      })
      return 'segunda'
    })

    expect(registro.obtener('antigua')).toEqual(antigua)
    expect(registro.obtener('nueva')).toBeNull()
    terminar?.()
    await pendiente
    expect(registro.obtener('antigua')).toBeNull()
    expect(registro.obtener('nueva')).toEqual(nueva)

    await expect(
      registro.construir(async (registrar) => {
        registrar('fallida', fuente('claude', '/tmp/fallida.jsonl'))
        throw new Error('fallo sintetico')
      }),
    ).rejects.toThrow('fallo sintetico')
    expect(registro.obtener('nueva')).toEqual(nueva)
    expect(registro.obtener('fallida')).toBeNull()
  })
  it('muestra completos los mensajes largos de Codex, en rollouts y en logs', async () => {
    const largo = 'palabra '.repeat(60).trim()
    const rollout = await crearJsonl('rollout-largo.jsonl', [
      { timestamp: '2026-10-20T09:00:00.000Z', type: 'event_msg', payload: { type: 'agent_message', message: largo } },
    ])
    const log = await crearJsonl('log-largo.jsonl', [
      { type: 'item.completed', item: { type: 'agent_message', text: largo } },
    ])
    expect((await leerLinea(fuente('codex-rollout', rollout), null)).eventos[0]?.texto).toBe(largo)
    expect((await leerLinea(fuente('codex-log', log), null)).eventos[0]?.texto).toBe(largo)
  })

  it('da a los eventos de un log sin timestamps horas distintas, ordenadas y estables', async () => {
    const log = await crearJsonl('log-sin-horas.jsonl', [
      { type: 'item.completed', item: { type: 'command_execution', command: 'npm test', aggregated_output: '' } },
      { type: 'item.completed', item: { type: 'command_execution', command: 'npm test', aggregated_output: '' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'hecho' } },
    ])
    const primera = (await leerLinea(fuente('codex-log', log), null)).eventos
    expect(primera).toHaveLength(3)
    const horas = primera.map((evento) => evento.fechaMs)
    expect(new Set(horas).size).toBe(3)
    expect([...horas].sort((a, b) => a - b)).toEqual(horas)

    const despues = new Date(Date.now() + 60_000)
    await utimes(log, despues, despues)
    const segunda = (await leerLinea(fuente('codex-log', log), null)).eventos
    expect(segunda.map((evento) => evento.fechaMs)).toEqual(horas)
  })
})
