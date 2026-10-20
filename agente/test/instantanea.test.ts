import { createHash } from 'node:crypto'
import { appendFile, mkdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { construirInstantanea } from '../src/instantanea.js'
import { homeFalso, type HomeFalso } from './ayudas/homeFalso.js'

const hogares: HomeFalso[] = []

async function preparar(): Promise<HomeFalso> {
  const hogar = await homeFalso()
  hogares.push(hogar)
  return hogar
}

async function construir(
  hogar: HomeFalso,
  ejecutar: (cmd: string, args: string[]) => Promise<string> = async () => '',
  registrarFuente?: (
    agenteId: string,
    fuente: { tipo: 'claude' | 'codex-rollout' | 'codex-log'; ruta: string },
  ) => void,
) {
  return construirInstantanea({
    cfg: hogar.cfg,
    rutas: hogar.rutas,
    so: 'macos',
    ahoraMs: hogar.ahoraMs,
    pidVivo: (pid: number) => pid === 4321,
    ejecutar,
    registrarFuente,
  })
}

afterEach(async () => {
  await Promise.all(hogares.splice(0).map((hogar) => hogar.limpiar()))
})

describe('construirInstantanea', () => {
  it('compone proyectos y agentes Claude/Codex sin duplicar hilo y tarea', async () => {
    const hogar = await preparar()
    const instantanea = await construir(hogar)

    expect(instantanea.maquina).toEqual({
      id: createHash('sha1').update(hogar.cfg.nombreMaquina).digest('hex').slice(0, 12),
      nombre: hogar.cfg.nombreMaquina,
      so: 'macos',
      avisos: [],
    })

    const viva = instantanea.agentes.find((agente) => agente.id === 'claude:viva-a')
    expect(viva).toMatchObject({
      estado: 'trabajando',
      rol: 'claude',
      proyectoIds: [hogar.idA],
      puedeContinuar: false,
      contexto: { usados: 60, ventana: 1_000_000 },
    })

    const cerrada = instantanea.agentes.find((agente) => agente.id === 'claude:cerrada-b')
    expect(cerrada).toMatchObject({
      estado: 'cerrada',
      puedeContinuar: true,
      proyectoIds: [hogar.idB],
      ultimoPrompt: 'Usa «oculto»',
    })

    const codex = instantanea.agentes.filter((agente) => agente.id === 'codex:hilo-exec')
    expect(codex).toHaveLength(1)
    expect(codex[0]).toMatchObject({
      modo: 'tarea',
      rol: 'codex-obrero',
      modelo: 'gpt-5.6-sol',
      proyectoIds: [hogar.idA],
      estado: 'en-curso',
      puedeContinuar: false,
    })
    expect(instantanea.agentes.some((agente) => agente.id.startsWith('codex-tarea:'))).toBe(false)

    const proyectoA = instantanea.proyectos.find((proyecto) => proyecto.id === hogar.idA)
    expect(proyectoA?.pendientes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origen: 'sesion', titulo: 'Pendiente vivo' }),
      ]),
    )
    expect(proyectoA?.pendientes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ titulo: 'Ya hecha' })]),
    )
  })

  it('usa la actividad del log unido cuando tiene mas comandos que el rollout', async () => {
    const hogar = await preparar()
    const log = path.join(hogar.proyectoA, '.codex-logs', 'tarea.jsonl')
    await appendFile(
      log,
      [
        {
          type: 'item.completed',
          item: { type: 'command_execution', command: 'npm test' },
        },
        {
          type: 'item.completed',
          item: { type: 'file_change', changes: [{ path: '/repo/src/cambio.ts' }] },
        },
        {
          type: 'item.completed',
          item: { type: 'agent_message', text: 'Trabajo completado' },
        },
      ].map((evento) => JSON.stringify(evento)).join('\n') + '\n',
    )

    const instantanea = await construir(hogar)
    const agente = instantanea.agentes.find((item) => item.id === 'codex:hilo-exec')

    expect(agente?.resumenActividad).toEqual({
      comandos: 1,
      ediciones: 1,
      mensajes: 1,
      ficheros: ['cambio.ts'],
    })
  })

  it('usa la descripción del meta.json como título y el agentType como rol del subagente', async () => {
    const hogar = await preparar()
    const directorio = path.join(
      hogar.rutas.claude,
      'projects',
      '-home-Desktop-Proyectos-IA',
      'viva-a',
      'subagents',
    )
    const transcript = path.join(directorio, 'agent-explora.jsonl')
    await mkdir(directorio, { recursive: true })
    await writeFile(
      transcript,
      `${JSON.stringify({
        type: 'assistant',
        cwd: hogar.proyectoA,
        timestamp: new Date(hogar.ahoraMs - 500).toISOString(),
        message: { content: [{ type: 'text', text: 'Analizando.' }] },
      })}\n`,
    )
    await writeFile(
      path.join(directorio, 'agent-explora.meta.json'),
      JSON.stringify({ agentType: 'Explore', description: 'Encontrar el origen del fallo' }),
    )

    const instantanea = await construir(hogar)

    expect(instantanea.agentes.find((agente) => agente.id === 'claude:viva-a:explora'))
      .toMatchObject({
        titulo: 'Encontrar el origen del fallo',
        rol: 'claude-explorador',
      })
  })

  it('registra las rutas validadas de transcripts, rollouts y logs', async () => {
    const hogar = await preparar()
    const fuentes: Array<{
      agenteId: string
      fuente: { tipo: 'claude' | 'codex-rollout' | 'codex-log'; ruta: string }
    }> = []

    await construir(hogar, async () => '', (agenteId, fuente) => {
      fuentes.push({ agenteId, fuente })
    })

    expect(fuentes).toEqual(expect.arrayContaining([
      {
        agenteId: 'claude:viva-a',
        fuente: {
          tipo: 'claude',
          ruta: path.join(
            hogar.rutas.claude,
            'projects',
            '-home-Desktop-Proyectos-IA',
            'viva-a.jsonl',
          ),
        },
      },
      {
        agenteId: 'codex:hilo-exec',
        fuente: {
          tipo: 'codex-rollout',
          ruta: path.join(hogar.rutas.codex, 'sessions', 'hilo-exec.jsonl'),
        },
      },
    ]))
  })

  it('titula una tarea Codex con la primera línea no vacía del prompt y la recorta', async () => {
    const hogar = await preparar()
    const primeraLinea = 'x'.repeat(95)
    await writeFile(
      path.join(hogar.proyectoA, '.codex-logs', 'sin-hilo.jsonl'),
      `${JSON.stringify({
        type: 'task_meta',
        effort: 'medium',
        model: 'gpt-5.6-sol',
        prompt: `\n   \n${primeraLinea}\nEsta línea no forma parte del título`,
      })}\n`,
    )

    const instantanea = await construir(hogar)
    const tarea = instantanea.agentes.find((agente) => agente.modo === 'tarea' && agente.titulo.startsWith('xxxxxxxxxx'))

    expect(tarea?.titulo).toBe(`${'x'.repeat(90)}…`)
  })

  it('avisa y omite Codex si falta su carpeta', async () => {
    const hogar = await preparar()
    await rm(hogar.rutas.codex, { recursive: true })

    const instantanea = await construir(hogar)

    expect(instantanea.maquina.avisos).toEqual(['sin-codex'])
    expect(instantanea.agentes.filter((agente) => agente.tipo === 'codex')).toEqual([])
  })

  it('omite sin romper el agente cuyo rollout resuelve a auth.json', async () => {
    const hogar = await preparar()
    await hogar.crearRolloutMalicioso('hilo-malicioso')

    const instantanea = await construir(hogar)

    expect(instantanea.agentes.some((agente) => agente.id === 'codex:hilo-malicioso')).toBe(false)
    expect(instantanea.agentes.some((agente) => agente.id === 'codex:hilo-exec')).toBe(true)
  })
  it('no incluye tareas de .codex-logs con más de 7 días', async () => {
    const hogar = await preparar()
    const log = path.join(hogar.proyectoA, '.codex-logs', '20260101-000000-task.jsonl')
    await writeFile(
      log,
      `${JSON.stringify({ type: 'task_meta', effort: 'low', model: 'x', prompt: 'vieja' })}\n${JSON.stringify({ type: 'turn.completed' })}\n`,
    )
    const haceDiezDias = new Date(hogar.ahoraMs - 10 * 24 * 60 * 60 * 1_000)
    await utimes(log, haceDiezDias, haceDiezDias)

    const instantanea = await construir(hogar)

    expect(instantanea.agentes.some((agente) => agente.titulo === 'vieja')).toBe(false)
  })

  it('no expone el contenido de un HANDOFF enlazado a un .env', async () => {
    const hogar = await preparar()
    const entorno = path.join(hogar.proyectoA, '.env')
    await writeFile(entorno, '# Pendiente:\n\n- TOKEN=abc123secret\n')
    await symlink(entorno, path.join(hogar.proyectoA, 'HANDOFF.md'))

    const instantanea = await construir(hogar)

    expect(JSON.stringify(instantanea)).not.toContain('abc123secret')
  })

  it('impide continuar hilos interactivos recientes si falla el listado de procesos', async () => {
    const hogar = await preparar()
    const rollout = path.join(hogar.rutas.codex, 'sessions', 'hilo-interactivo.jsonl')
    await writeFile(
      rollout,
      `${JSON.stringify({
        timestamp: new Date(hogar.ahoraMs - 60_000).toISOString(),
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Sigue con ello' },
      })}\n`,
    )
    const base = new DatabaseSync(hogar.rutaBaseCodex)
    try {
      base.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        'hilo-interactivo',
        'Hilo interactivo reciente',
        hogar.proyectoA,
        'gpt-5.6-sol',
        'high',
        100,
        'main',
        'cli',
        0,
        hogar.ahoraMs - 120_000,
        hogar.ahoraMs - 60_000,
        rollout,
      )
    } finally {
      base.close()
    }

    const instantanea = await construir(hogar, async () => {
      throw new Error('ps no disponible')
    })

    expect(instantanea.agentes.find((agente) => agente.id === 'codex:hilo-interactivo'))
      .toMatchObject({ puedeContinuar: false })
  })

  it('enmascara el texto de las tareas incluido dentro de los agentes', async () => {
    const hogar = await preparar()
    const transcript = path.join(
      hogar.rutas.claude,
      'projects',
      '-home-Desktop-Proyectos-IA',
      'viva-a.jsonl',
    )
    await appendFile(
      transcript,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'TodoWrite',
              input: { todos: [{ content: 'API_KEY=abc123secret', status: 'pending' }] },
            },
          ],
        },
        timestamp: new Date(hogar.ahoraMs).toISOString(),
      })}\n`,
    )

    const instantanea = await construir(hogar)
    const agente = instantanea.agentes.find((item) => item.id === 'claude:viva-a')

    expect(agente?.tareas).toEqual([{ texto: 'API_KEY=«oculto»', estado: 'pendiente' }])
    expect(JSON.stringify(agente)).not.toContain('abc123secret')
  })

  it('asigna cada marca de commit al repo indicado aunque la sesión pertenezca a otro', async () => {
    const hogar = await preparar()
    const transcript = path.join(
      hogar.rutas.claude,
      'projects',
      '-home-Desktop-Proyectos-IA',
      'viva-a.jsonl',
    )
    await appendFile(
      transcript,
      `${JSON.stringify({
        type: 'assistant',
        cwd: hogar.proyectoA,
        message: {
          content: [{
            type: 'tool_use',
            name: 'Bash',
            input: { command: `git -C "${hogar.proyectoB}" commit -m x` },
          }],
        },
        timestamp: new Date(hogar.ahoraMs).toISOString(),
      })}\n`,
    )

    const instantanea = await construir(hogar)
    const agente = instantanea.agentes.find((item) => item.id === 'claude:viva-a')

    expect(agente?.proyectoIds).toEqual([hogar.idA])
    expect(agente?.commitsPorProyecto).toEqual({ [hogar.idB]: [hogar.ahoraMs] })
  })
  it('da a una tarea de Codex sin hilo un id sin rutas y registra su log como fuente', async () => {
    const hogar = await preparar()
    const log = path.join(hogar.proyectoA, '.codex-logs', '20261020-120000-task.jsonl')
    await writeFile(
      log,
      `${JSON.stringify({ type: 'task_meta', effort: 'low', model: 'gpt-5.6-luna', prompt: 'tarea suelta' })}\n`,
    )
    const fuentes = new Map<string, { tipo: string; ruta: string }>()

    const instantanea = await construir(hogar, undefined, (id, fuente) => fuentes.set(id, fuente))

    const tarea = instantanea.agentes.find((agente) => agente.titulo === 'tarea suelta')
    expect(tarea).toBeDefined()
    expect(tarea!.id).toMatch(/^codex-tarea:[0-9a-f]{16}$/)
    expect(fuentes.get(tarea!.id)).toMatchObject({ tipo: 'codex-log' })
  })
  it('incluye los terminales abiertos que le pasa el gestor', async () => {
    const hogar = await preparar()
    const terminal = { id: '0123456789ab', titulo: 'Claude · a', tipo: 'claude' as const, agenteId: null, proyectoId: null, creadoMs: 1 }
    const instantanea = await construirInstantanea({
      cfg: hogar.cfg, rutas: hogar.rutas, so: 'macos', ahoraMs: hogar.ahoraMs, pidVivo: () => false, ejecutar: async () => '',
      listarTerminales: async () => [terminal],
    })
    expect(instantanea.terminales).toEqual([terminal])
  })
})
