// @vitest-environment jsdom
import type { Agente, Instantanea, Proyecto } from '@centro/compartido'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VistaGeneral } from '../../src/vistas/VistaGeneral.js'

const AHORA = new Date(2026, 9, 20, 12).getTime()

afterEach(cleanup)

function crearProyecto(cambios: Partial<Proyecto> = {}): Proyecto {
  return {
    id: 'centro-agentes',
    nombre: 'centro-agentes',
    ruta: '/proyectos/centro-agentes',
    grupo: 'Proyectos IA',
    git: {
      rama: 'main',
      ultimoCommit: {
        hash: '0123456',
        mensaje: 'Añade la vista general',
        fechaMs: AHORA - 60_000,
      },
      cambios: 2,
      adelante: 0,
      atras: 0,
      ramas: ['main'],
      actividad14d: [0, 1, 0, 2, 3, 1, 0, 0, 4, 2, 0, 1, 3, 2],
    },
    pendientes: [],
    ultimaActividadMs: AHORA - 30_000,
    ...cambios,
  }
}

function crearAgente(cambios: Partial<Agente> = {}): Agente {
  return {
    id: 'claude:sesion-1',
    tipo: 'claude',
    modo: 'interactivo',
    titulo: 'Implementar la vista general',
    cwd: '/proyectos/centro-agentes',
    proyectoIds: ['centro-agentes'],
    estado: 'trabajando',
    modelo: 'Opus 5.5',
    esfuerzo: null,
    contexto: { usados: 11, ventana: 100 },
    tokensTotales: 11,
    ultimoPrompt: 'Implementa exactamente la vista general',
    rama: 'main',
    pr: null,
    inicioMs: AHORA - 60 * 60_000,
    ultimaActividadMs: AHORA - 10_000,
    padreId: null,
    entrada: null,
    puedeContinuar: true,
    tareas: [],
    commitsMs: [],
    ...cambios,
  }
}

function crearInstantanea(
  proyectos: Proyecto[] = [crearProyecto()],
  agentes: Agente[] = [crearAgente()],
): Instantanea {
  return {
    version: 1,
    maquina: { id: 'mac', nombre: 'Mac de pruebas', so: 'macos', avisos: [] },
    generadaMs: AHORA - 5_000,
    proyectos,
    agentes,
  }
}

function pintar(datos = crearInstantanea(), error = false) {
  return render(
    <VistaGeneral datos={datos} error={error} actualizadaMs={datos.generadaMs} ahora={AHORA} />,
  )
}

describe('VistaGeneral', () => {
  it('pinta el título del panel', () => {
    pintar()
    expect(screen.getByText('Centro de agentes')).toBeTruthy()
  })

  it('muestra el estado y el contexto del agente que trabaja', () => {
    pintar()
    expect(screen.getByText('Trabajando')).toBeTruthy()
    expect(screen.getByText('11%')).toBeTruthy()
  })

  it('oculta una tarjeta sin agentes esperando al activar Esperándome', () => {
    pintar()
    fireEvent.click(screen.getByRole('button', { name: 'Esperándome' }))
    expect(screen.queryByRole('link', { name: 'centro-agentes' })).toBeNull()
  })

  it('filtra las tarjetas al escribir en el buscador', () => {
    const otro = crearProyecto({ id: 'otro', nombre: 'otro-proyecto' })
    pintar(crearInstantanea([crearProyecto(), otro]))

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'otro' } })

    expect(screen.queryByRole('link', { name: 'centro-agentes' })).toBeNull()
    expect(screen.getByRole('link', { name: 'otro-proyecto' })).toBeTruthy()
  })

  it('muestra un mensaje cuando no hay proyectos ni agentes', () => {
    pintar(crearInstantanea([], []))
    expect(screen.getByText('No hay proyectos en las carpetas escaneadas')).toBeTruthy()
  })

  it('avisa del error y conserva visibles los datos', () => {
    pintar(crearInstantanea(), true)
    expect(screen.getByText('Sin conexión con el agente · reintentando')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'centro-agentes' })).toBeTruthy()
  })

  it('enlaza la tarjeta con la ficha del proyecto', () => {
    pintar()
    expect(screen.getByRole('link', { name: 'centro-agentes' }).getAttribute('href'))
      .toBe('#/proyecto/centro-agentes')
  })

  it('no muestra acciones de editor ni terminal todavía no disponibles', () => {
    pintar()
    expect(screen.queryByText('⌘')).toBeNull()
    expect(screen.queryByText('>_')).toBeNull()
  })

  it('usa singular y plural al contar los proyectos de un grupo', () => {
    const { rerender } = pintar()
    expect(screen.getByText('· 1 proyecto')).toBeTruthy()

    const datos = crearInstantanea([
      crearProyecto(),
      crearProyecto({ id: 'otro', nombre: 'otro-proyecto' }),
    ])
    rerender(
      <VistaGeneral datos={datos} error={false} actualizadaMs={datos.generadaMs} ahora={AHORA} />,
    )
    expect(screen.getByText('· 2 proyectos')).toBeTruthy()
  })
})
