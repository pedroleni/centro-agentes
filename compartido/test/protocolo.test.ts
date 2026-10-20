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
  describe('terminales', () => {
    it('acepta crear (continuar o nueva) y cerrar como peticiones', () => {
      expect(MensajeHub.parse({ tipo: 'peticion', id: '1', op: 'terminal-crear', accion: 'continuar', agenteId: 'claude:x' })).toBeTruthy()
      expect(MensajeHub.parse({ tipo: 'peticion', id: '2', op: 'terminal-crear', accion: 'nueva', tipo_agente: 'codex', proyectoId: 'aaaaaaaaaaaa' })).toBeTruthy()
      expect(MensajeHub.parse({ tipo: 'peticion', id: '3', op: 'terminal-cerrar', terminalId: '0123456789ab' })).toBeTruthy()
      expect(() => MensajeHub.parse({ tipo: 'peticion', id: '4', op: 'terminal-crear', accion: 'nueva', tipo_agente: 'bash', proyectoId: 'a' })).toThrow()
      expect(() => MensajeHub.parse({ tipo: 'peticion', id: '5', op: 'terminal-cerrar', terminalId: '../x' })).toThrow()
    })

    it('acepta los mensajes de canal del hub y acota tamaños y datos', () => {
      expect(MensajeHub.parse({ tipo: 'terminal-adjuntar', canal: 'c1', terminalId: '0123456789ab', cols: 80, rows: 24 })).toBeTruthy()
      expect(MensajeHub.parse({ tipo: 'terminal-entrada', canal: 'c1', datos: Buffer.from('ls\r').toString('base64') })).toBeTruthy()
      expect(MensajeHub.parse({ tipo: 'terminal-tamano', canal: 'c1', cols: 400, rows: 120 })).toBeTruthy()
      expect(MensajeHub.parse({ tipo: 'terminal-soltar', canal: 'c1' })).toBeTruthy()
      expect(() => MensajeHub.parse({ tipo: 'terminal-tamano', canal: 'c1', cols: 401, rows: 24 })).toThrow()
      expect(() => MensajeHub.parse({ tipo: 'terminal-adjuntar', canal: 'c1', terminalId: '0123456789ab', cols: 80, rows: 4 })).toThrow()
      expect(() => MensajeHub.parse({ tipo: 'terminal-entrada', canal: 'c1', datos: 'A'.repeat(90_000) })).toThrow()
    })

    it('acepta la salida y el fin de un terminal del agente', () => {
      expect(MensajeAgente.parse({ tipo: 'terminal-salida', canal: 'c1', datos: 'aG9sYQ==' })).toBeTruthy()
      expect(MensajeAgente.parse({ tipo: 'terminal-fin', canal: 'c1', motivo: 'La sesión ha terminado' })).toBeTruthy()
    })
  })
})
