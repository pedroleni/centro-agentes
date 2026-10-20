import { afterEach, describe, expect, it, vi } from 'vitest'
import { MensajeAgente } from '@centro/compartido'
import { crearConexionHub, urlWebSocket, type TerminalesHub } from '../src/conexionHub.js'

afterEach(() => { vi.useRealTimers() })

class SocketFalso {
  enviados: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  cerrado = false
  readyState = 1
  bufferedAmount = 0
  send(datos: string) { this.enviados.push(JSON.parse(datos)) }
  close() { this.cerrado = true }
  abrir() { this.onopen?.() }
  llega(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }) }
  cae(code = 1006) { this.onclose?.({ code }) }
}

const maquina = { id: 'local', nombre: 'MacBook', so: 'macos' as const, avisos: [] as never[] }
const instantanea = { version: 1 as const, maquina, generadaMs: 1, proyectos: [], agentes: [] }

function preparar(terminales?: TerminalesHub) {
  const sockets: SocketFalso[] = []
  const log = vi.fn()
  const conexion = crearConexionHub({
    terminales,
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
  it('no envía por un socket que todavía no está abierto ni por uno sustituido', async () => {
    vi.useFakeTimers()
    const { conexion, sockets } = preparar()
    conexion.arrancar()
    const s = sockets[0]!
    s.readyState = 0
    s.send = () => { throw new Error('INVALID_STATE') }
    s.llega({ tipo: 'peticion', id: '1', op: 'commits', proyectoId: 'p1' })
    await vi.advanceTimersByTimeAsync(0)
    conexion.parar()
  })

  it('crea y cierra terminales por encargo del hub con sus propias órdenes', async () => {
    vi.useFakeTimers()
    const terminal = { id: 'bbbbbbbbbbbb', titulo: 'Claude · web', tipo: 'claude' as const, agenteId: 'claude:abc', proyectoId: null, creadoMs: 1 }
    const terminales = {
      crear: vi.fn(async () => ({ ok: true as const, terminal })),
      cerrar: vi.fn(async (id: string) => { if (id !== 'bbbbbbbbbbbb') throw new Error('no existe') }),
      adjuntar: vi.fn(),
    }
    const { conexion, sockets } = preparar(terminales)
    conexion.arrancar()
    const s = sockets[0]!
    s.abrir()
    s.llega({ tipo: 'peticion', id: '1', op: 'terminal-crear', accion: 'continuar', agenteId: 'claude:abc' })
    s.llega({ tipo: 'peticion', id: '2', op: 'terminal-crear', accion: 'nueva', tipo_agente: 'codex', proyectoId: 'aaaaaaaaaaaa' })
    s.llega({ tipo: 'peticion', id: '3', op: 'terminal-cerrar', terminalId: 'bbbbbbbbbbbb' })
    s.llega({ tipo: 'peticion', id: '4', op: 'terminal-cerrar', terminalId: 'cccccccccccc' })
    await vi.advanceTimersByTimeAsync(0)
    expect(terminales.crear.mock.calls).toEqual([
      [{ accion: 'continuar', agenteId: 'claude:abc' }],
      [{ accion: 'nueva', tipo: 'codex', proyectoId: 'aaaaaaaaaaaa' }],
    ])
    expect(terminales.cerrar.mock.calls).toEqual([['bbbbbbbbbbbb'], ['cccccccccccc']])
    const respuestas = s.enviados.filter((m) => (m as { tipo: string }).tipo === 'respuesta')
    expect(respuestas).toEqual(expect.arrayContaining([
      { tipo: 'respuesta', id: '1', ok: true, datos: { ok: true, terminal } },
      { tipo: 'respuesta', id: '3', ok: true, datos: { cerrado: true } },
      { tipo: 'respuesta', id: '4', ok: false, error: 'Terminal no encontrado' },
    ]))
    conexion.parar()
  })

  it('sin terminales en esta máquina lo dice y no engancha nada', async () => {
    vi.useFakeTimers()
    const { conexion, sockets } = preparar()
    conexion.arrancar()
    const s = sockets[0]!
    s.abrir()
    s.llega({ tipo: 'peticion', id: '1', op: 'terminal-crear', accion: 'continuar', agenteId: 'claude:abc' })
    s.llega({ tipo: 'terminal-adjuntar', canal: 'c1', terminalId: 'aaaaaaaaaaaa', cols: 80, rows: 24 })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.enviados).toEqual(expect.arrayContaining([
      { tipo: 'respuesta', id: '1', ok: false, error: 'Los terminales no están disponibles en esta máquina' },
      { tipo: 'terminal-fin', canal: 'c1', motivo: 'no-encontrado' },
    ]))
    conexion.parar()
  })

  it('engancha un canal: salida troceada en base64, entrada, tamaño y soltar', async () => {
    vi.useFakeTimers()
    const enganche = { escribir: vi.fn(), redimensionar: vi.fn(), soltar: vi.fn() }
    let alDatos: (datos: string) => void = () => {}
    let alSalir: () => void = () => {}
    const adjuntar = vi.fn((_id: string, _tamano: { cols: number; rows: number }, datos: (d: string) => void, salir: () => void) => {
      alDatos = datos
      alSalir = salir
      return enganche
    })
    const { conexion, sockets } = preparar({ crear: vi.fn(), cerrar: vi.fn(), adjuntar })
    conexion.arrancar()
    const s = sockets[0]!
    s.abrir()
    await vi.advanceTimersByTimeAsync(0)
    const antes = s.enviados.length
    s.llega({ tipo: 'terminal-adjuntar', canal: 'c1', terminalId: 'aaaaaaaaaaaa', cols: 100, rows: 30 })
    expect(adjuntar).toHaveBeenCalledWith('aaaaaaaaaaaa', { cols: 100, rows: 30 }, expect.any(Function), expect.any(Function))

    const grande = 'ñ'.repeat(70_000)
    alDatos('hola ñ')
    alDatos(grande)
    const salidas = s.enviados.slice(antes) as { tipo: string; canal: string; datos: string }[]
    for (const salida of salidas) {
      expect(MensajeAgente.safeParse(salida).success).toBe(true)
      expect(salida).toMatchObject({ tipo: 'terminal-salida', canal: 'c1' })
    }
    expect(Buffer.from(salidas[0]!.datos, 'base64').toString()).toBe('hola ñ')
    expect(salidas.length).toBeGreaterThan(2)
    expect(Buffer.concat(salidas.slice(1).map((m) => Buffer.from(m.datos, 'base64'))).toString()).toBe(grande)

    s.llega({ tipo: 'terminal-entrada', canal: 'c1', datos: Buffer.from('ls ñ\r').toString('base64') })
    s.llega({ tipo: 'terminal-tamano', canal: 'c1', cols: 90, rows: 20 })
    s.llega({ tipo: 'terminal-entrada', canal: 'otro', datos: Buffer.from('x').toString('base64') })
    expect(enganche.escribir.mock.calls).toEqual([['ls ñ\r']])
    expect(enganche.redimensionar).toHaveBeenCalledWith(90, 20)

    s.llega({ tipo: 'terminal-soltar', canal: 'c1' })
    expect(enganche.soltar).toHaveBeenCalledTimes(1)
    const tras = s.enviados.length
    alSalir()
    alDatos('tarde')
    expect(s.enviados.length).toBe(tras)
    conexion.parar()
  })

  it('avisa al hub si el terminal termina, no existe o hay demasiados canales', async () => {
    vi.useFakeTimers()
    const salidas: (() => void)[] = []
    const adjuntar = vi.fn((id: string, _t: unknown, _d: unknown, salir: () => void) => {
      if (id === 'ffffffffffff') throw new Error('Terminal no válido')
      salidas.push(salir)
      return { escribir: vi.fn(), redimensionar: vi.fn(), soltar: vi.fn() }
    })
    const { conexion, sockets } = preparar({ crear: vi.fn(), cerrar: vi.fn(), adjuntar })
    conexion.arrancar()
    const s = sockets[0]!
    s.abrir()
    s.llega({ tipo: 'terminal-adjuntar', canal: 'c1', terminalId: 'aaaaaaaaaaaa', cols: 80, rows: 24 })
    salidas[0]!()
    s.llega({ tipo: 'terminal-adjuntar', canal: 'c2', terminalId: 'ffffffffffff', cols: 80, rows: 24 })
    for (let i = 0; i < 17; i += 1) s.llega({ tipo: 'terminal-adjuntar', canal: `n${i}`, terminalId: 'aaaaaaaaaaaa', cols: 80, rows: 24 })
    const fines = s.enviados.filter((m) => (m as { tipo: string }).tipo === 'terminal-fin')
    expect(fines).toEqual([
      { tipo: 'terminal-fin', canal: 'c1', motivo: 'terminada' },
      { tipo: 'terminal-fin', canal: 'c2', motivo: 'no-encontrado' },
      { tipo: 'terminal-fin', canal: 'n16', motivo: 'demasiados' },
    ])
    conexion.parar()
  })

  it('al caer la conexión o al parar suelta todos los canales', async () => {
    vi.useFakeTimers()
    const enganches: { soltar: ReturnType<typeof vi.fn> }[] = []
    const adjuntar = vi.fn(() => {
      const enganche = { escribir: vi.fn(), redimensionar: vi.fn(), soltar: vi.fn() }
      enganches.push(enganche)
      return enganche
    })
    const { conexion, sockets } = preparar({ crear: vi.fn(), cerrar: vi.fn(), adjuntar })
    conexion.arrancar()
    sockets[0]!.abrir()
    sockets[0]!.llega({ tipo: 'terminal-adjuntar', canal: 'c1', terminalId: 'aaaaaaaaaaaa', cols: 80, rows: 24 })
    sockets[0]!.llega({ tipo: 'terminal-adjuntar', canal: 'c2', terminalId: 'aaaaaaaaaaaa', cols: 80, rows: 24 })
    sockets[0]!.cae()
    expect(enganches.map((e) => e.soltar.mock.calls.length)).toEqual([1, 1])
    await vi.advanceTimersByTimeAsync(1_000)
    sockets[1]!.abrir()
    sockets[1]!.llega({ tipo: 'terminal-adjuntar', canal: 'c3', terminalId: 'aaaaaaaaaaaa', cols: 80, rows: 24 })
    conexion.parar()
    expect(enganches[2]!.soltar).toHaveBeenCalledTimes(1)
  })

  it('si el enlace con el hub se satura, suelta el canal y lo dice en vez de acumular', async () => {
    vi.useFakeTimers()
    const enganche = { escribir: vi.fn(), redimensionar: vi.fn(), soltar: vi.fn() }
    let alDatos: (datos: string) => void = () => {}
    const adjuntar = vi.fn((_id: string, _t: unknown, datos: (d: string) => void) => { alDatos = datos; return enganche })
    const { conexion, sockets } = preparar({ crear: vi.fn(), cerrar: vi.fn(), adjuntar })
    conexion.arrancar()
    const s = sockets[0]!
    s.abrir()
    s.llega({ tipo: 'terminal-adjuntar', canal: 'c1', terminalId: 'aaaaaaaaaaaa', cols: 80, rows: 24 })
    s.bufferedAmount = 9 * 1024 * 1024
    const antes = s.enviados.length
    alDatos('mucha salida')
    expect(enganche.soltar).toHaveBeenCalledTimes(1)
    expect(s.enviados.slice(antes)).toEqual([{ tipo: 'terminal-fin', canal: 'c1', motivo: 'saturado' }])
    alDatos('más')
    expect(s.enviados.length).toBe(antes + 1)
    conexion.parar()
  })
})
