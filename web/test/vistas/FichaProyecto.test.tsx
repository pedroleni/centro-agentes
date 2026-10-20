// @vitest-environment jsdom
import type { Agente, Commit, Proyecto } from '@centro/compartido'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FichaProyecto } from '../../src/vistas/FichaProyecto.js'

const AHORA = new Date(2026, 9, 20, 12).getTime()
const FECHA_COMMIT_ENLAZADO = new Date(2026, 9, 20, 10, 30).getTime()

afterEach(cleanup)

const proyecto: Proyecto = {
  id: '012345abcdef',
  nombre: 'centro-agentes',
  ruta: '/proyectos/centro-agentes',
  grupo: 'Proyectos IA',
  git: {
    rama: 'main',
    ultimoCommit: null,
    cambios: 3,
    adelante: 0,
    atras: 0,
    ramas: ['main', 'ficha-proyecto'],
    actividad14d: Array.from({ length: 14 }, () => 0),
  },
  pendientes: [
    {
      origen: 'handoff',
      titulo: 'Revisar la entrega anterior',
      fechaMs: new Date(2026, 9, 18).getTime(),
      hechas: null,
      total: null,
      quizaDesactualizado: true,
    },
    {
      origen: 'plan',
      titulo: 'Completar el panel local',
      fechaMs: new Date(2026, 9, 19).getTime(),
      hechas: 42,
      total: 43,
      quizaDesactualizado: false,
    },
  ],
  ultimaActividadMs: AHORA,
}

const agente: Agente = {
  id: 'claude:sesion-1',
  tipo: 'claude',
  modo: 'interactivo',
  titulo: 'Implementar la ficha de proyecto',
  cwd: proyecto.ruta,
  proyectoIds: [proyecto.id],
  estado: 'cerrada',
  modelo: 'Opus 5.5',
  esfuerzo: null,
  contexto: null,
  tokensTotales: null,
  ultimoPrompt: null,
  rama: 'main',
  pr: null,
  inicioMs: AHORA - 3_600_000,
  ultimaActividadMs: FECHA_COMMIT_ENLAZADO + 30_000,
  padreId: null,
  entrada: null,
  puedeContinuar: true,
  tareas: [],
  commitsMs: [FECHA_COMMIT_ENLAZADO - 5_000],
}

const commits: Commit[] = [
  {
    hash: 'enlazado123',
    mensaje: 'Commit producido por la sesión',
    fechaMs: FECHA_COMMIT_ENLAZADO,
    autor: 'Pruebas Centro',
  },
  {
    hash: 'suelto456',
    mensaje: 'Commit hecho fuera de la sesión',
    fechaMs: FECHA_COMMIT_ENLAZADO - 3_600_000,
    autor: 'Pruebas Centro',
  },
]

function pintar() {
  return render(
    <FichaProyecto proyecto={proyecto} agentes={[agente]} commits={commits} ahora={AHORA} />,
  )
}

describe('FichaProyecto', () => {
  it('anida el commit enlazado bajo la sesión y deja el otro como evento suelto', () => {
    pintar()

    const sesion = screen.getByText('enlazado123').closest('.cd-ev')
    expect(sesion).not.toBeNull()
    expect(within(sesion as HTMLElement).getByText('enlazado123')).toBeTruthy()
    expect(within(sesion as HTMLElement).queryByText('suelto456')).toBeNull()

    const commitSuelto = screen.getByText('suelto456').closest('.cd-ev')
    expect(commitSuelto).not.toBeNull()
    expect(within(commitSuelto as HTMLElement).getByText('suelto456')).toBeTruthy()
  })

  it('muestra el progreso del plan', () => {
    pintar()
    expect(screen.getByText(/42\/43/)).toBeTruthy()
  })

  it('avisa cuando el handoff puede estar desactualizado', () => {
    pintar()
    expect(screen.getByText('Puede estar desactualizado')).toBeTruthy()
  })

  it('ofrece Continuar desactivado cuando la sesión puede retomarse', () => {
    pintar()
    expect((screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('muestra el historial en tandas de cuarenta eventos', () => {
    const muchosCommits = Array.from({ length: 50 }, (_, indice): Commit => ({
      hash: `commit-${indice}`,
      mensaje: `Commit ${indice}`,
      fechaMs: AHORA - indice * 60_000,
      autor: 'Pruebas Centro',
    }))
    const { container } = render(
      <FichaProyecto proyecto={proyecto} agentes={[]} commits={muchosCommits} ahora={AHORA} />,
    )

    expect(container.querySelectorAll('.cd-ev')).toHaveLength(40)
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar más' }))
    expect(container.querySelectorAll('.cd-ev')).toHaveLength(50)
    expect(screen.queryByRole('button', { name: 'Mostrar más' })).toBeNull()
  })

  it('muestra un estado de no encontrado con enlace de vuelta', () => {
    render(<FichaProyecto proyecto={null} agentes={[]} commits={[]} ahora={AHORA} />)
    expect(screen.getByText('Proyecto no encontrado')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Volver' }).getAttribute('href')).toBe('#/')
  })
})
