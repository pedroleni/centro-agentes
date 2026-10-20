import { describe, expect, it } from 'vitest'
import { enlazarCommits } from '../src/historial.js'
import type { Agente, Commit } from '../src/esquemas.js'

function agente(
  id: string,
  proyectoIds: string[],
  commitsMs: number[],
): Agente {
  return {
    id,
    tipo: 'claude',
    modo: 'interactivo',
    titulo: id,
    cwd: '/proyecto',
    proyectoIds,
    estado: 'cerrada',
    modelo: null,
    esfuerzo: null,
    contexto: null,
    tokensTotales: null,
    ultimoPrompt: null,
    rama: null,
    pr: null,
    inicioMs: null,
    ultimaActividadMs: 0,
    padreId: null,
    entrada: null,
    puedeContinuar: true,
    tareas: [],
    commitsMs,
  }
}

function commit(hash: string, fechaMs: number): Commit {
  return { hash, mensaje: hash, fechaMs, autor: 'Pruebas Centro' }
}

describe('enlazarCommits', () => {
  it('enlaza un commit cercano con el agente del proyecto', () => {
    const actual = commit('cercano', 1_000_000)
    const sesion = agente('claude:uno', ['proyecto-1'], [actual.fechaMs - 30_000])

    expect(enlazarCommits([actual], [sesion], 'proyecto-1').get(sesion.id)).toEqual([actual])
  })

  it('no enlaza un commit separado diez minutos de la marca', () => {
    const actual = commit('lejano', 1_000_000)
    const sesion = agente('claude:uno', ['proyecto-1'], [actual.fechaMs - 10 * 60_000])

    expect(enlazarCommits([actual], [sesion], 'proyecto-1').get(sesion.id)).toBeUndefined()
  })

  it('no enlaza agentes de otro proyecto', () => {
    const actual = commit('otro-proyecto', 1_000_000)
    const sesion = agente('claude:uno', ['proyecto-2'], [actual.fechaMs])

    expect(enlazarCommits([actual], [sesion], 'proyecto-1').get(sesion.id)).toBeUndefined()
  })

  it('elige el agente cuya marca es la más cercana', () => {
    const actual = commit('disputado', 1_000_000)
    const lejano = agente('claude:lejano', ['proyecto-1'], [actual.fechaMs - 90_000])
    const cercano = agente('claude:cercano', ['proyecto-1'], [actual.fechaMs - 5_000])
    const enlaces = enlazarCommits([actual], [lejano, cercano], 'proyecto-1')

    expect(enlaces.get(cercano.id)).toEqual([actual])
    expect(enlaces.get(lejano.id)).toBeUndefined()
  })
})
