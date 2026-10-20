import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MensajeHub } from '@centro/compartido'
import { crearConexiones, SinConexion, SinRespuesta } from '../src/conexiones.js'

afterEach(() => { vi.useRealTimers() })

const maquina = { id: 'm1', nombre: 'MacBook', so: 'macos' as const, avisos: [] as never[] }
const instantanea = { version: 1, maquina, generadaMs: 1, proyectos: [], agentes: [] }

function conexionFalsa() {
  const enviados: MensajeHub[] = []
  const cierres: { codigo: number; motivo: string }[] = []
  return {
    enviados,
    cierres,
    conexion: {
      enviar: (m: MensajeHub) => { enviados.push(m) },
      cerrar: (codigo: number, motivo: string) => { cierres.push({ codigo, motivo }) },
    },
  }
}

const registradas = [{ id: 'm1', nombre: 'MacBook', so: 'macos' as const }]

describe('conexiones de agentes', () => {
  it('una máquina con hola e instantánea aparece conectada con sus datos', () => {
    const t = 1_000
    const conexiones = crearConexiones(() => t)
    const { conexion } = conexionFalsa()
    conexiones.conectar('m1', conexion)
    conexiones.recibir('m1', JSON.stringify({ tipo: 'hola', maquina, version: 1 }))
    conexiones.recibir('m1', JSON.stringify({ tipo: 'instantanea', instantanea }))
    const [vista] = conexiones.vista(registradas)
    expect(vista).toMatchObject({ id: 'm1', conectada: true, ultimoLatidoMs: 1_000 })
    expect(vista?.instantanea?.generadaMs).toBe(1)
  })

  it('tras 21 s sin latido pasa a desconectada pero conserva la última instantánea', () => {
    let t = 1_000
    const conexiones = crearConexiones(() => t)
    conexiones.conectar('m1', conexionFalsa().conexion)
    conexiones.recibir('m1', JSON.stringify({ tipo: 'instantanea', instantanea }))
    t += 21_000
    const [vista] = conexiones.vista(registradas)
    expect(vista).toMatchObject({ conectada: false, ultimoLatidoMs: 1_000 })
    expect(vista?.instantanea).not.toBeNull()
  })

  it('una segunda conexión de la misma máquina cierra la anterior con 4409', () => {
    const conexiones = crearConexiones()
    const primera = conexionFalsa()
    conexiones.conectar('m1', primera.conexion)
    conexiones.conectar('m1', conexionFalsa().conexion)
    expect(primera.cierres).toEqual([{ codigo: 4409, motivo: expect.any(String) }])
  })

  it('un mensaje inválido cierra la conexión con 4400', () => {
    const conexiones = crearConexiones()
    const falsa = conexionFalsa()
    conexiones.conectar('m1', falsa.conexion)
    conexiones.recibir('m1', '{"tipo":"ejecuta","comando":"rm -rf /"}')
    expect(falsa.cierres[0]?.codigo).toBe(4400)
  })

  it('pedir resuelve con la respuesta del mismo id', async () => {
    const conexiones = crearConexiones()
    const falsa = conexionFalsa()
    conexiones.conectar('m1', falsa.conexion)
    const promesa = conexiones.pedir('m1', { op: 'commits', proyectoId: 'p1' })
    const enviada = falsa.enviados[0]
    expect(enviada).toMatchObject({ tipo: 'peticion', op: 'commits', proyectoId: 'p1' })
    const id = (enviada as { id: string }).id
    conexiones.recibir('m1', JSON.stringify({ tipo: 'respuesta', id, ok: true, datos: { commits: [] } }))
    await expect(promesa).resolves.toEqual({ commits: [] })
  })

  it('una respuesta con ok:false rechaza con su error', async () => {
    const conexiones = crearConexiones()
    const falsa = conexionFalsa()
    conexiones.conectar('m1', falsa.conexion)
    const promesa = conexiones.pedir('m1', { op: 'linea', agenteId: 'a', antes: null })
    const id = (falsa.enviados[0] as { id: string }).id
    conexiones.recibir('m1', JSON.stringify({ tipo: 'respuesta', id, ok: false, error: 'no encontrado' }))
    await expect(promesa).rejects.toThrow('no encontrado')
  })

  it('pedir sin respuesta rechaza con SinRespuesta a los 10 s', async () => {
    vi.useFakeTimers()
    const conexiones = crearConexiones()
    conexiones.conectar('m1', conexionFalsa().conexion)
    const promesa = conexiones.pedir('m1', { op: 'commits', proyectoId: 'p1' })
    const comprobacion = expect(promesa).rejects.toBeInstanceOf(SinRespuesta)
    await vi.advanceTimersByTimeAsync(10_000)
    await comprobacion
  })

  it('pedir a una máquina desconectada rechaza con SinConexion', async () => {
    const conexiones = crearConexiones()
    await expect(conexiones.pedir('m1', { op: 'commits', proyectoId: 'p1' })).rejects.toBeInstanceOf(SinConexion)
    const falsa = conexionFalsa()
    conexiones.conectar('m1', falsa.conexion)
    conexiones.desconectar('m1', falsa.conexion)
    await expect(conexiones.pedir('m1', { op: 'commits', proyectoId: 'p1' })).rejects.toBeInstanceOf(SinConexion)
  })

  it('desconectar una conexión antigua no afecta a la nueva, y cerrarMaquina cierra la actual', () => {
    const conexiones = crearConexiones()
    const vieja = conexionFalsa()
    const nueva = conexionFalsa()
    conexiones.conectar('m1', vieja.conexion)
    conexiones.conectar('m1', nueva.conexion)
    conexiones.recibir('m1', JSON.stringify({ tipo: 'hola', maquina, version: 1 }))
    conexiones.desconectar('m1', vieja.conexion)
    expect(conexiones.vista(registradas)[0]?.conectada).toBe(true)
    conexiones.cerrarMaquina('m1', 4401, 'revocada')
    expect(nueva.cierres).toEqual([{ codigo: 4401, motivo: 'revocada' }])
  })
})
