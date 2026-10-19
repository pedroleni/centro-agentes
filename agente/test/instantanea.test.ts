import { createHash } from 'node:crypto'
import { rm, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { construirInstantanea } from '../src/instantanea.js'
import { homeFalso, type HomeFalso } from './ayudas/homeFalso.js'

const hogares: HomeFalso[] = []

async function preparar(): Promise<HomeFalso> {
  const hogar = await homeFalso()
  hogares.push(hogar)
  return hogar
}

async function construir(hogar: HomeFalso) {
  return construirInstantanea({
    cfg: hogar.cfg,
    rutas: hogar.rutas,
    so: 'macos',
    ahoraMs: hogar.ahoraMs,
    pidVivo: (pid: number) => pid === 4321,
    ejecutar: async () => '',
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

    expect(instantanea.agentes.some((agente) => agente.id.includes('20260101-000000-task'))).toBe(false)
  })
})
