import { describe, expect, it } from 'vitest'
import type { Agente, EstadoAgente } from '@centro/compartido'
import {
  duracionCorta,
  etiquetaEstado,
  fechaRelativa,
  porcentajeContexto,
} from '../../src/logica/formato.js'

function crearAgente(contexto: Agente['contexto']): Agente {
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
