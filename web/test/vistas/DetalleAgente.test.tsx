// @vitest-environment jsdom
import type { Agente, Proyecto } from '@centro/compartido'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResultadoLinea } from '../../src/api.js'
import { DetalleAgente } from '../../src/vistas/DetalleAgente.js'

const AHORA = new Date(2026, 9, 20, 12).getTime()

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

const agente: Agente = {
  id: 'claude:explorador-1',
  tipo: 'claude',
  modo: 'interactivo',
  titulo: 'Investigar el detalle de agente',
  cwd: proyecto.ruta,
  proyectoIds: [proyecto.id],
  estado: 'trabajando',
  rol: 'claude-explorador',
  ultimaAccion: { tipo: 'comando', texto: 'npm test', fechaMs: AHORA - 1_000 },
  resumenActividad: {
    comandos: 3,
    ediciones: 2,
    mensajes: 5,
    ficheros: ['DetalleAgente.tsx', 'estilos.css'],
  },
  modelo: 'claude-opus-4-1',
  esfuerzo: 'alto',
  contexto: { usados: 64, ventana: 100 },
  tokensTotales: 64,
  ultimoPrompt: 'Construye el detalle',
  rama: 'main',
  pr: null,
  inicioMs: AHORA - 60_000,
  ultimaActividadMs: AHORA - 1_000,
  padreId: null,
  entrada: null,
  puedeContinuar: false,
  tareas: [],
  commitsPorProyecto: {},
}

const linea: ResultadoLinea = {
  antes: 120,
  eventos: [
    { fechaMs: AHORA - 3_000, tipo: 'usuario', texto: 'Hazlo', detalle: null },
    { fechaMs: AHORA - 2_000, tipo: 'asistente', texto: 'Voy con ello', detalle: null },
    {
      fechaMs: AHORA - 1_000,
      tipo: 'comando',
      texto: 'npm test',
      detalle: '12 tests passed',
    },
  ],
}

afterEach(cleanup)

describe('DetalleAgente', () => {
  it('muestra el rol, los contadores y los ficheros del agente', () => {
    render(
      <DetalleAgente
        agente={agente}
        proyectos={[proyecto]}
        linea={linea}
        cargarAnteriores={() => undefined}
        ahora={AHORA}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Explorador' })).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('DetalleAgente.tsx')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'centro-agentes' }).getAttribute('href'))
      .toBe('#/proyecto/centro-agentes')
  })

  it('coloca un mensaje del usuario bajo la etiqueta Tú', () => {
    render(
      <DetalleAgente agente={agente} proyectos={[proyecto]} linea={linea}
        cargarAnteriores={() => undefined} ahora={AHORA} />,
    )

    const mensaje = screen.getByText('Hazlo').closest('.da-evento')
    expect(mensaje).not.toBeNull()
    expect(mensaje?.textContent).toContain('Tú')
  })

  it('oculta la salida de un comando hasta pulsar Ver salida', () => {
    render(
      <DetalleAgente agente={agente} proyectos={[proyecto]} linea={linea}
        cargarAnteriores={() => undefined} ahora={AHORA} />,
    )

    expect(screen.queryByText('12 tests passed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver salida' }))
    expect(screen.getByText('12 tests passed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ocultar salida' })).toBeTruthy()
  })

  it('solicita los eventos anteriores', () => {
    const cargarAnteriores = vi.fn()
    render(
      <DetalleAgente agente={agente} proyectos={[proyecto]} linea={linea}
        cargarAnteriores={cargarAnteriores} ahora={AHORA} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cargar anteriores' }))
    expect(cargarAnteriores).toHaveBeenCalledOnce()
  })

  it('informa si el agente ya no está disponible', () => {
    render(
      <DetalleAgente agente={null} proyectos={[proyecto]} linea={null}
        cargarAnteriores={() => undefined} ahora={AHORA} />,
    )

    expect(screen.getByText('Este agente ya no está disponible')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Volver' }).getAttribute('href')).toBe('#/')
  })
  it('pinta el Markdown de las respuestas del agente', () => {
    const { container } = render(
      <DetalleAgente agente={agente} proyectos={[proyecto]}
        linea={{ antes: null, eventos: [{ fechaMs: 5, tipo: 'asistente', texto: 'Listo: **303 tests** con `npm test`', detalle: null }] }}
        cargarAnteriores={() => {}} ahora={AHORA} />,
    )
    expect(container.querySelector('.da-asistente .md strong')?.textContent).toBe('303 tests')
    expect(container.querySelector('.da-asistente .md code')?.textContent).toBe('npm test')
  })
})
