import { describe, expect, it } from 'vitest'
import { Instantanea } from '../src/esquemas.js'

const ejemploValido = {
  version: 1 as const,
  maquina: {
    id: 'maquina-1',
    nombre: 'Portátil',
    so: 'macos' as const,
    avisos: [],
  },
  generadaMs: 1_700_000_000_000,
  proyectos: [
    {
      id: 'proyecto-1',
      nombre: 'Centro',
      ruta: '/tmp/Centro',
      grupo: 'Proyectos',
      git: {
        rama: 'main',
        ultimoCommit: { hash: 'abc123', mensaje: 'Inicial', fechaMs: 1_700_000_000_000 },
        cambios: 0,
        adelante: 0,
        atras: 0,
        ramas: ['main'],
        actividad14d: Array.from({ length: 14 }, () => 0),
      },
      pendientes: [
        {
          origen: 'plan' as const,
          titulo: 'Tarea 1',
          fechaMs: null,
          hechas: 0,
          total: 1,
          quizaDesactualizado: false,
        },
      ],
      ultimaActividadMs: 1_700_000_000_000,
    },
  ],
  agentes: [
    {
      id: 'agente-1',
      tipo: 'claude' as const,
      modo: 'interactivo' as const,
      titulo: 'Implementación',
      cwd: '/tmp/Centro',
      proyectoIds: ['proyecto-1'],
      estado: 'trabajando' as const,
      modelo: 'claude-opus-5',
      esfuerzo: null,
      contexto: { usados: 100, ventana: 1_000_000 },
      tokensTotales: 100,
      ultimoPrompt: 'Continúa',
      rama: 'main',
      pr: null,
      inicioMs: 1_700_000_000_000,
      ultimaActividadMs: 1_700_000_000_000,
      padreId: null,
      entrada: null,
      puedeContinuar: true,
      tareas: [{ texto: 'Probar', estado: 'pendiente' as const }],
    },
  ],
}

describe('esquemas de la instantánea', () => {
  it('acepta una instantánea válida', () => {
    expect(() => Instantanea.parse(ejemploValido)).not.toThrow()
  })

  it('rechaza un estado de agente desconocido', () => {
    const invalido = structuredClone(ejemploValido)
    invalido.agentes[0].estado = 'raro'
    expect(() => Instantanea.parse(invalido)).toThrow()
  })

  it('rechaza una actividad que no tiene exactamente 14 días', () => {
    const invalido = structuredClone(ejemploValido)
    invalido.proyectos[0].git.actividad14d = Array.from({ length: 13 }, () => 0)
    expect(() => Instantanea.parse(invalido)).toThrow()
  })
})
