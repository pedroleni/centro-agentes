import { describe, expect, it } from 'vitest'
import type { Agente, Commit } from '@centro/compartido'
import { historialPorDia } from '../../src/logica/historial.js'

function crearAgente(cambios: Partial<Agente> = {}): Agente {
  return {
    id: 'claude:uno', tipo: 'claude', modo: 'interactivo', titulo: 'Sesión', cwd: '/proyecto',
    proyectoIds: ['proyecto-1'], estado: 'cerrada', modelo: null, esfuerzo: null,
    contexto: null, tokensTotales: null, ultimoPrompt: null, rama: 'main', pr: null,
    inicioMs: null, ultimaActividadMs: 0, padreId: null, entrada: null,
    puedeContinuar: true, tareas: [], commitsPorProyecto: {}, ...cambios,
  }
}

function crearCommit(hash: string, fechaMs: number): Commit {
  return { hash, mensaje: hash, fechaMs, autor: 'Pruebas Centro' }
}

describe('historialPorDia', () => {
  it('incluye un commit enlazado dentro de la sesión y no como evento suelto', () => {
    const ahora = new Date(2026, 8, 12, 15).getTime()
    const enlazado = crearCommit('enlazado', ahora - 60_000)
    const suelto = crearCommit('suelto', ahora - 120_000)
    const agente = crearAgente({
      ultimaActividadMs: ahora - 30_000,
      commitsPorProyecto: { 'proyecto-1': [enlazado.fechaMs - 5_000] },
    })

    const dias = historialPorDia([enlazado, suelto], [agente], 'proyecto-1', ahora)
    const eventos = dias[0]?.eventos ?? []
    const sesion = eventos.find((evento) => evento.tipo === 'sesion')

    expect(sesion).toMatchObject({ tipo: 'sesion', agente, commits: [enlazado] })
    expect(eventos.filter((evento) => evento.tipo === 'commit')).toEqual([
      { tipo: 'commit', fechaMs: suelto.fechaMs, commit: suelto },
    ])
  })

  it('agrupa dos días en orden descendente con etiquetas Hoy y Ayer', () => {
    const ahora = new Date(2026, 8, 12, 15).getTime()
    const hoy = crearCommit('hoy', new Date(2026, 8, 12, 10).getTime())
    const ayer = crearCommit('ayer', new Date(2026, 8, 11, 18).getTime())

    const dias = historialPorDia([ayer, hoy], [], 'proyecto-1', ahora)

    expect(dias.map((dia) => dia.etiqueta)).toEqual(['Hoy', 'Ayer'])
    expect(dias).toHaveLength(2)
  })

  it('etiqueta otros días con día de la semana y fecha local', () => {
    const ahora = new Date(2026, 8, 15, 15).getTime()
    const jueves = crearCommit('jueves', new Date(2026, 8, 10, 10).getTime())

    expect(historialPorDia([jueves], [], 'proyecto-1', ahora)[0]?.etiqueta).toBe('jueves 10 sep')
  })

  it('repite una sesión en cada día de sus commits y también en el día de su última actividad', () => {
    const ahora = new Date(2026, 8, 12, 15).getTime()
    const commitDiaDTemprano = crearCommit('d-temprano', new Date(2026, 8, 10, 9).getTime())
    const commitDiaDUltimo = crearCommit('d-ultimo', new Date(2026, 8, 10, 18).getTime())
    const commitDiaDMenos3 = crearCommit('d-menos-3', new Date(2026, 8, 7, 11).getTime())
    const agente = crearAgente({
      ultimaActividadMs: ahora - 30_000,
      commitsPorProyecto: {
        'proyecto-1': [
          commitDiaDTemprano.fechaMs,
          commitDiaDUltimo.fechaMs,
          commitDiaDMenos3.fechaMs,
        ],
      },
    })

    const dias = historialPorDia(
      [commitDiaDTemprano, commitDiaDUltimo, commitDiaDMenos3],
      [agente],
      'proyecto-1',
      ahora,
    )
    const sesiones = dias.flatMap((dia) => dia.eventos)
      .filter((evento) => evento.tipo === 'sesion')

    expect(dias.map((dia) => dia.clave)).toEqual(['2026-09-12', '2026-09-10', '2026-09-07'])
    expect(sesiones).toHaveLength(3)
    expect(sesiones).toEqual([
      { tipo: 'sesion', fechaMs: agente.ultimaActividadMs, agente, commits: [] },
      {
        tipo: 'sesion',
        fechaMs: commitDiaDUltimo.fechaMs,
        agente,
        commits: [commitDiaDTemprano, commitDiaDUltimo],
      },
      {
        tipo: 'sesion',
        fechaMs: commitDiaDMenos3.fechaMs,
        agente,
        commits: [commitDiaDMenos3],
      },
    ])
  })
})
