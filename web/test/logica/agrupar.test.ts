import { describe, expect, it } from 'vitest'
import type { Agente, Instantanea, Proyecto } from '@centro/compartido'
import { agruparProyectos } from '../../src/logica/agrupar.js'

const DIA_MS = 24 * 60 * 60_000

function crearProyecto(cambios: Partial<Proyecto> = {}): Proyecto {
  return {
    id: 'proyecto-1',
    nombre: 'Proyecto',
    ruta: '/proyectos/proyecto',
    grupo: 'Proyectos',
    git: {
      rama: 'main',
      ultimoCommit: null,
      cambios: 0,
      adelante: 0,
      atras: 0,
      ramas: ['main'],
      actividad14d: Array.from({ length: 14 }, () => 0),
    },
    pendientes: [],
    ultimaActividadMs: 0,
    ...cambios,
  }
}

function crearAgente(cambios: Partial<Agente> = {}): Agente {
  return {
    id: 'claude:uno',
    tipo: 'claude',
    modo: 'interactivo',
    titulo: 'Sesión',
    cwd: '/proyectos/proyecto',
    proyectoIds: ['proyecto-1'],
    estado: 'cerrada',
    rol: 'claude',
    ultimaAccion: null,
    resumenActividad: { comandos: 0, ediciones: 0, mensajes: 0, ficheros: [] },
    modelo: null,
    esfuerzo: null,
    contexto: null,
    tokensTotales: null,
    ultimoPrompt: null,
    rama: 'main',
    pr: null,
    inicioMs: null,
    ultimaActividadMs: 0,
    padreId: null,
    entrada: null,
    puedeContinuar: true,
    tareas: [],
    commitsPorProyecto: {},
    ...cambios,
  }
}

function crearInstantanea(proyectos: Proyecto[], agentes: Agente[]): Instantanea {
  return {
    version: 1,
    maquina: { id: 'mac', nombre: 'Mac', so: 'macos', avisos: [] },
    generadaMs: 0,
    proyectos,
    agentes,
  }
}

describe('agruparProyectos', () => {
  it('pone primero la tarjeta activa y ordena sus agentes por estado', () => {
    const ahora = new Date(2026, 8, 12, 12).getTime()
    const activo = crearProyecto({ id: 'activo', nombre: 'Activo', ultimaActividadMs: ahora - 2_000 })
    const otro = crearProyecto({ id: 'otro', nombre: 'Otro', ultimaActividadMs: ahora - 1_000 })
    const cerrado = crearAgente({
      id: 'cerrado',
      proyectoIds: ['activo'],
      estado: 'cerrada',
      ultimaActividadMs: ahora,
    })
    const trabajando = crearAgente({
      id: 'trabajando',
      proyectoIds: ['activo'],
      estado: 'trabajando',
      ultimoPrompt: 'Haz la tarea',
      ultimaActividadMs: ahora - 5_000,
    })

    const resultado = agruparProyectos(
      crearInstantanea([otro, activo], [cerrado, trabajando]),
      ahora,
    )

    expect(resultado.grupos[0]?.tarjetas.map((tarjeta) => tarjeta.proyecto.id)).toEqual([
      'activo',
      'otro',
    ])
    expect(resultado.grupos[0]?.tarjetas[0]?.activo).toBe(true)
    expect(resultado.grupos[0]?.tarjetas[0]?.agentes.map((agente) => agente.id)).toEqual([
      'trabajando',
      'cerrado',
    ])
    expect(resultado.grupos[0]?.tarjetas[0]?.ultimoPrompt).toBe('Haz la tarea')
  })

  it('separa como inactivo un proyecto vacío de hace más de treinta días', () => {
    const ahora = new Date(2026, 8, 12, 12).getTime()
    const antiguo = crearProyecto({ ultimaActividadMs: ahora - 40 * DIA_MS })
    const resultado = agruparProyectos(crearInstantanea([antiguo], []), ahora)

    expect(resultado.grupos[0]?.tarjetas).toEqual([])
    expect(resultado.grupos[0]?.inactivas[0]?.proyecto.id).toBe(antiguo.id)
  })

  it('excluye subagentes de las tarjetas', () => {
    const proyecto = crearProyecto()
    const padre = crearAgente({ id: 'padre' })
    const subagente = crearAgente({ id: 'hijo', padreId: 'padre', estado: 'trabajando' })
    const resultado = agruparProyectos(crearInstantanea([proyecto], [subagente, padre]), 0)

    expect(resultado.grupos[0]?.tarjetas[0]?.agentes.map((agente) => agente.id)).toEqual(['padre'])
  })

  it('devuelve aparte los agentes raíz sin proyecto', () => {
    const sinProyecto = crearAgente({ id: 'suelto', proyectoIds: [] })
    const subagente = crearAgente({ id: 'hijo-suelto', proyectoIds: [], padreId: 'suelto' })
    const resultado = agruparProyectos(crearInstantanea([], [sinProyecto, subagente]), 0)

    expect(resultado.sinProyecto).toEqual([sinProyecto])
  })

  it('cuenta planes incompletos y el handoff', () => {
    const proyecto = crearProyecto({
      pendientes: [
        { origen: 'plan', titulo: 'Plan pendiente', fechaMs: null, hechas: 1, total: 2, quizaDesactualizado: false },
        { origen: 'plan', titulo: 'Plan hecho', fechaMs: null, hechas: 2, total: 2, quizaDesactualizado: false },
        { origen: 'handoff', titulo: 'HANDOFF', fechaMs: null, hechas: null, total: null, quizaDesactualizado: false },
      ],
    })
    const resultado = agruparProyectos(crearInstantanea([proyecto], []), 0)

    expect(resultado.grupos[0]?.tarjetas[0]?.pendientes).toBe(2)
  })
})
