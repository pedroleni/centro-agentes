import { describe, expect, it } from 'vitest'
import type { Agente, EstadoAgente } from '@centro/compartido'
import {
  duracionCorta,
  etiquetaEstado,
  fechaRelativa,
  nombreModelo,
  porcentajeContexto,
  tiempoAgente,
} from '../../src/logica/formato.js'

function crearAgente(contexto: Agente['contexto'], cambios: Partial<Agente> = {}): Agente {
  return {
    id: 'claude:uno',
    tipo: 'claude',
    modo: 'interactivo',
    titulo: 'Sesión',
    cwd: '/proyecto',
    proyectoIds: ['proyecto-1'],
    estado: 'trabajando',
    modelo: 'claude',
    esfuerzo: null,
    contexto,
    tokensTotales: null,
    ultimoPrompt: null,
    rama: 'main',
    pr: null,
    inicioMs: null,
    ultimaActividadMs: 0,
    padreId: null,
    entrada: null,
    puedeContinuar: false,
    tareas: [],
    commitsMs: [],
    ...cambios,
  }
}

describe('etiquetaEstado', () => {
  it.each<[EstadoAgente, string]>([
    ['trabajando', 'Trabajando'],
    ['esperandote', 'Esperándote'],
    ['cerrada', 'Cerrada'],
    ['en-curso', 'En curso'],
    ['terminado', 'Terminado'],
    ['interrumpido', 'Interrumpido'],
  ])('convierte %s en su texto de interfaz', (estado, etiqueta) => {
    expect(etiquetaEstado(estado)).toBe(etiqueta)
  })
})

describe('porcentajeContexto', () => {
  it('redondea el porcentaje usado', () => {
    expect(porcentajeContexto(crearAgente({ usados: 114_000, ventana: 1_000_000 }))).toBe(11)
  })

  it('devuelve null cuando no hay ventana de contexto', () => {
    expect(porcentajeContexto(crearAgente({ usados: 114_000, ventana: null }))).toBeNull()
    expect(porcentajeContexto(crearAgente(null))).toBeNull()
  })
})

describe('duracionCorta', () => {
  it.each([
    [45_000, '45 s'],
    [12 * 60_000, '12 min'],
    [4_200_000, '1 h 10 min'],
    [3 * 24 * 60 * 60_000, '3 d'],
  ])('formatea %i ms como %s', (ms, esperada) => {
    expect(duracionCorta(ms)).toBe(esperada)
  })
})

describe('nombreModelo', () => {
  it.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-4-6', 'Sonnet 4.6'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-opus-5-5[1m]', 'Opus 5.5'],
    ['gpt-5.6-sol', 'gpt-5.6-sol'],
    [null, ''],
  ])('convierte %s en %s', (modelo, esperado) => {
    expect(nombreModelo(modelo)).toBe(esperado)
  })
})

describe('tiempoAgente', () => {
  const ahora = new Date(2026, 8, 12, 15, 30).getTime()

  it('muestra la duración de un agente activo iniciado hace menos de 48 horas', () => {
    const agente = crearAgente(null, { inicioMs: ahora - 3_600_000 })
    expect(tiempoAgente(agente, ahora)).toBe('1 h')
  })

  it('muestra desde qué fecha está activo cuando no conoce el inicio', () => {
    const agente = crearAgente(null, {
      inicioMs: null,
      ultimaActividadMs: new Date(2026, 7, 15, 10).getTime(),
    })
    expect(tiempoAgente(agente, ahora)).toBe('desde 15 ago')
  })

  it('muestra la última actividad relativa de un agente cerrado', () => {
    const agente = crearAgente(null, {
      estado: 'cerrada',
      inicioMs: ahora - 3_600_000,
      ultimaActividadMs: ahora - 12 * 60_000,
    })
    expect(tiempoAgente(agente, ahora)).toBe('hace 12 min')
  })
})

describe('fechaRelativa', () => {
  const ahora = new Date(2026, 8, 12, 15, 30).getTime()

  it.each([
    [ahora - 30_000, 'ahora'],
    [ahora - 12 * 60_000, 'hace 12 min'],
    [ahora - 3 * 60 * 60_000, 'hace 3 h'],
    [new Date(2026, 8, 11, 20).getTime(), 'ayer'],
    [new Date(2026, 8, 5, 10).getTime(), '5 sep'],
  ])('formatea una fecha relativa como %s', (fechaMs, esperada) => {
    expect(fechaRelativa(fechaMs, ahora)).toBe(esperada)
  })
})
