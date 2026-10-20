// @vitest-environment jsdom
import type { Agente, Proyecto } from '@centro/compartido'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EnDirecto } from '../../src/vistas/EnDirecto.js'

const AHORA = new Date(2026, 9, 20, 12).getTime()

afterEach(cleanup)

const proyecto: Proyecto = {
  id: 'centro-agentes',
  nombre: 'centro-agentes',
  ruta: '/proyectos/centro-agentes',
  grupo: 'Proyectos IA',
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
  ultimaActividadMs: AHORA,
}

function crearAgente(cambios: Partial<Agente> = {}): Agente {
  return {
    id: 'claude:activo',
    tipo: 'claude',
    modo: 'interactivo',
    titulo: 'Implementar avatares',
    cwd: proyecto.ruta,
    proyectoIds: [proyecto.id],
    estado: 'trabajando',
    rol: 'claude-explorador',
    ultimaAccion: { tipo: 'comando', texto: 'npm test', fechaMs: AHORA - 2_000 },
    resumenActividad: { comandos: 1, ediciones: 0, mensajes: 0, ficheros: [] },
    modelo: 'Opus 5.5',
    esfuerzo: null,
    contexto: { usados: 42, ventana: 100 },
    tokensTotales: 42,
    ultimoPrompt: null,
    rama: 'main',
    pr: null,
    inicioMs: AHORA - 60_000,
    ultimaActividadMs: AHORA - 2_000,
    padreId: null,
    entrada: null,
    puedeContinuar: false,
    tareas: [],
    commitsPorProyecto: {},
    ...cambios,
  }
}

describe('EnDirecto', () => {
  it('muestra el agente trabajando y excluye una sesión cerrada hace dos horas', () => {
    render(
      <EnDirecto
        agentes={[
          crearAgente(),
          crearAgente({
            id: 'claude:cerrado',
            titulo: 'Sesión antigua',
            estado: 'cerrada',
            ultimaActividadMs: AHORA - 2 * 60 * 60_000,
          }),
        ]}
        proyectos={[proyecto]}
        ahora={AHORA}
      />,
    )

    expect(screen.getByText('npm test')).toBeTruthy()
    expect(screen.queryByText('Sesión antigua')).toBeNull()
  })

  it('muestra el estado vacío cuando no hay agentes activos', () => {
    render(<EnDirecto agentes={[]} proyectos={[proyecto]} ahora={AHORA} />)

    expect(screen.getByText('Ningún agente trabajando ahora mismo')).toBeTruthy()
  })
})
