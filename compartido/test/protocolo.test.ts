import { describe, expect, it } from 'vitest'
import {
  LIMITE_MENSAJE_BYTES,
  MensajeAgente,
  MensajeHub,
  RespuestaMaquinas,
} from '../src/protocolo.js'

const maquina = { id: 'abc', nombre: 'MacBook', so: 'macos', avisos: [] }
const instantanea = { version: 1, maquina, generadaMs: 1, proyectos: [], agentes: [] }

describe('protocolo', () => {
  it('acepta las tres variantes de mensaje del agente', () => {
    expect(MensajeAgente.parse({ tipo: 'hola', maquina, version: 1 }).tipo).toBe('hola')
    expect(MensajeAgente.parse({ tipo: 'instantanea', instantanea }).tipo).toBe('instantanea')
    expect(MensajeAgente.parse({ tipo: 'respuesta', id: 'p1', ok: true, datos: { commits: [] } }).tipo).toBe('respuesta')
  })

  it('acepta las peticiones y el adiós del hub', () => {
    expect(MensajeHub.parse({ tipo: 'peticion', id: '1', op: 'commits', proyectoId: 'aaa' }).tipo).toBe('peticion')
    expect(MensajeHub.parse({ tipo: 'peticion', id: '2', op: 'linea', agenteId: 'claude:x', antes: null }).tipo).toBe('peticion')
    expect(MensajeHub.parse({ tipo: 'adios', motivo: 'revocada' }).tipo).toBe('adios')
  })

  it('rechaza tipos y operaciones desconocidos', () => {
    expect(() => MensajeAgente.parse({ tipo: 'ejecuta', comando: 'rm -rf /' })).toThrow()
    expect(() => MensajeHub.parse({ tipo: 'peticion', id: '1', op: 'ejecutar', comando: 'ls' })).toThrow()
  })

  it('exige que antes sea un entero no negativo o null', () => {
    expect(() => MensajeHub.parse({ tipo: 'peticion', id: '1', op: 'linea', agenteId: 'a', antes: -1 })).toThrow()
    expect(() => MensajeHub.parse({ tipo: 'peticion', id: '1', op: 'linea', agenteId: 'a', antes: 1.5 })).toThrow()
  })

  it('valida la respuesta de máquinas y fija el límite de mensaje en 8 MB', () => {
    const r = RespuestaMaquinas.parse({
      modo: 'hub',
      maquinas: [{ id: 'abc', nombre: 'MacBook', so: 'macos', conectada: false, ultimoLatidoMs: null, instantanea: null }],
    })
    expect(r.maquinas).toHaveLength(1)
    expect(LIMITE_MENSAJE_BYTES).toBe(8 * 1024 * 1024)
  })
})
