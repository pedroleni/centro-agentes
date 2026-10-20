import { afterEach, describe, expect, it, vi } from 'vitest'
import { crearConexionHub, urlWebSocket } from '../src/conexionHub.js'

afterEach(() => { vi.useRealTimers() })

class SocketFalso {
  enviados: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  cerrado = false
  send(datos: string) { this.enviados.push(JSON.parse(datos)) }
  close() { this.cerrado = true }
  abrir() { this.onopen?.() }
  llega(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }) }
  cae(code = 1006) { this.onclose?.({ code }) }
}

const maquina = { id: 'local', nombre: 'MacBook', so: 'macos' as const, avisos: [] as never[] }
const instantanea = { version: 1 as const, maquina, generadaMs: 1, proyectos: [], agentes: [] }

function preparar() {
  const sockets: SocketFalso[] = []
  const log = vi.fn()
  const conexion = crearConexionHub({
    url: 'wss://mini.ts.net/api/agente',
    token: 'T',
    maquinaId: 'abcdefabcdef',
    nombre: 'MacBook',
    obtenerInstantanea: async () => instantanea,
    obtenerCommits: async (id) => (id === 'p1' ? [{ hash: 'a', mensaje: 'm', fechaMs: 1, autor: 'x' }] : null),
    obtenerLinea: async () => ({ eventos: [], antes: null }),
    crearSocket: () => { const s = new SocketFalso(); sockets.push(s); return s },
    aleatorio: () => 0.5,
    log,
  })
  return { conexion, sockets, log }
}

describe('conexión con el hub', () => {
  it('convierte la URL del hub en la del WebSocket', () => {
    expect(urlWebSocket('https://mini.ts.net/')).toBe('wss://mini.ts.net/api/agente')
    expect(urlWebSocket('http://127.0.0.1:4701')).toBe('ws://127.0.0.1:4701/api/agente')
  })

  it('saluda, envía la instantánea con el id del hub y la repite cada 5 s', async () => {
    vi.useFakeTimers()
    const { conexion, sockets } = preparar()
    conexion.arrancar()
    sockets[0]!.abrir()
    await vi.advanceTimersByTimeAsync(0)
    expect(sockets[0]!.enviados[0]).toMatchObject({ tipo: 'hola', maquina: { id: 'abcdefabcdef', nombre: 'MacBook' } })
    expect(sockets[0]!.enviados[1]).toMatchObject({ tipo: 'instantanea', instantanea: { maquina: { id: 'abcdefabcdef' } } })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(sockets[0]!.enviados.filter((m) => (m as { tipo: string }).tipo === 'instantanea')).toHaveLength(2)
    conexion.parar()
  })

  it('contesta commits y línea, y un proyecto desconocido con ok:false', async () => {
    vi.useFakeTimers()
    const { conexion, sockets } = preparar()
    conexion.arrancar()
    const s = sockets[0]!
    s.abrir()
    s.llega({ tipo: 'peticion', id: '1', op: 'commits', proyectoId: 'p1' })
    s.llega({ tipo: 'peticion', id: '2', op: 'commits', proyectoId: 'otro' })
    s.llega({ tipo: 'peticion', id: '3', op: 'linea', agenteId: 'a', antes: null })
    await vi.advanceTimersByTimeAsync(0)
    const respuestas = s.enviados.filter((m) => (m as { tipo: string }).tipo === 'respuesta')
    expect(respuestas).toEqual(expect.arrayContaining([
      { tipo: 'respuesta', id: '1', ok: true, datos: { commits: [{ hash: 'a', mensaje: 'm', fechaMs: 1, autor: 'x' }] } },
      { tipo: 'respuesta', id: '2', ok: false, error: 'No encontrado' },
      { tipo: 'respuesta', id: '3', ok: true, datos: { eventos: [], antes: null } },
    ]))
    conexion.parar()
  })

  it('ignora peticiones que no son del protocolo (nunca ejecuta nada)', async () => {
    vi.useFakeTimers()
    const { conexion, sockets } = preparar()
    conexion.arrancar()
    sockets[0]!.abrir()
    sockets[0]!.llega({ tipo: 'peticion', id: '9', op: 'ejecutar', comando: 'rm -rf /' })
    await vi.advanceTimersByTimeAsync(0)
    expect(sockets[0]!.enviados.some((m) => (m as { id?: string }).id === '9')).toBe(false)
    conexion.parar()
  })

  it('reintenta con backoff 1, 2, 4 s y vuelve a 1 s tras 60 s conectado', async () => {
    vi.useFakeTimers()
    const { conexion, sockets } = preparar()
    conexion.arrancar()
    sockets[0]!.cae()
    await vi.advanceTimersByTimeAsync(999)
    expect(sockets).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets).toHaveLength(2)
    sockets[1]!.cae()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sockets).toHaveLength(3)
    sockets[2]!.cae()
    await vi.advanceTimersByTimeAsync(4_000)
    expect(sockets).toHaveLength(4)
    sockets[3]!.abrir()
    await vi.advanceTimersByTimeAsync(60_000)
    sockets[3]!.cae()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(5)
    conexion.parar()
  })

  it('con 4401 o 4409 deja de reintentar y lo explica', async () => {
    vi.useFakeTimers()
    const { conexion, sockets, log } = preparar()
    conexion.arrancar()
    sockets[0]!.abrir()
    sockets[0]!.cae(4401)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets).toHaveLength(1)
    expect(log).toHaveBeenCalledWith('Token revocado: vuelve a dar de alta esta máquina')
    conexion.parar()
  })
})
