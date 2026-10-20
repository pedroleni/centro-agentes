import { afterEach, describe, expect, it, vi } from 'vitest'
import { MensajeHub } from '@centro/compartido'
import { crearConexiones, DemasiadosCanales, SinConexion, SinRespuesta } from '../src/conexiones.js'

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
  it('impone el id y el nombre registrados aunque el agente diga otros', () => {
    const conexiones = crearConexiones()
    conexiones.conectar('m1', conexionFalsa().conexion)
    const falsa = { ...instantanea, maquina: { id: 'otra', nombre: 'Suplantada', so: 'windows', avisos: [] } }
    conexiones.recibir('m1', JSON.stringify({ tipo: 'instantanea', instantanea: falsa }))
    expect(conexiones.vista(registradas)[0]?.instantanea?.maquina).toMatchObject({ id: 'm1', nombre: 'MacBook', so: 'macos' })
  })
})

function navegadorFalso() {
  const datos: Buffer[] = []
  const fines: { codigo: number; motivo: string }[] = []
  return {
    datos,
    fines,
    navegador: {
      datos: (bytes: Buffer) => { datos.push(bytes) },
      fin: (codigo: number, motivo: string) => { fines.push({ codigo, motivo }) },
    },
  }
}

type Adjuntar = Extract<MensajeHub, { tipo: 'terminal-adjuntar' }>
const TERMINAL = 'aaaaaaaaaaaa'
const salida = (canal: string, texto: string) =>
  JSON.stringify({ tipo: 'terminal-salida', canal, datos: Buffer.from(texto).toString('base64') })

describe('canales de terminal', () => {
  it('abre un canal, lleva la salida del agente al navegador y lo cierra con 4000 al terminar', () => {
    const conexiones = crearConexiones()
    const agente = conexionFalsa()
    conexiones.conectar('m1', agente.conexion)
    const nav = navegadorFalso()
    conexiones.abrirCanal('m1', TERMINAL, { cols: 100, rows: 30 }, nav.navegador)
    const adjuntar = agente.enviados[0] as Adjuntar
    expect(adjuntar).toMatchObject({ tipo: 'terminal-adjuntar', terminalId: TERMINAL, cols: 100, rows: 30 })
    conexiones.recibir('m1', salida(adjuntar.canal, 'hola ñ'))
    expect(Buffer.concat(nav.datos).toString()).toBe('hola ñ')
    conexiones.recibir('m1', JSON.stringify({ tipo: 'terminal-fin', canal: adjuntar.canal, motivo: 'terminada' }))
    expect(nav.fines).toEqual([{ codigo: 4000, motivo: expect.any(String) }])
    conexiones.recibir('m1', salida(adjuntar.canal, 'tarde'))
    expect(nav.datos).toHaveLength(1)
    expect(agente.cierres).toEqual([])
  })

  it('un terminal que no existe en la máquina cierra el canal con 4004', () => {
    const conexiones = crearConexiones()
    const agente = conexionFalsa()
    conexiones.conectar('m1', agente.conexion)
    const nav = navegadorFalso()
    conexiones.abrirCanal('m1', TERMINAL, { cols: 80, rows: 24 }, nav.navegador)
    const { canal } = agente.enviados[0] as Adjuntar
    conexiones.recibir('m1', JSON.stringify({ tipo: 'terminal-fin', canal, motivo: 'no-encontrado' }))
    expect(nav.fines).toEqual([{ codigo: 4004, motivo: expect.any(String) }])
  })

  it('si el agente suelta el canal por saturación o por tope, el navegador reintenta (1013)', () => {
    const conexiones = crearConexiones()
    const agente = conexionFalsa()
    conexiones.conectar('m1', agente.conexion)
    for (const motivo of ['saturado', 'demasiados']) {
      const nav = navegadorFalso()
      conexiones.abrirCanal('m1', TERMINAL, { cols: 80, rows: 24 }, nav.navegador)
      const { canal } = agente.enviados.at(-1) as Adjuntar
      conexiones.recibir('m1', JSON.stringify({ tipo: 'terminal-fin', canal, motivo }))
      expect(nav.fines).toEqual([{ codigo: 1013, motivo: expect.any(String) }])
    }
  })

  it('otra máquina no puede escribir en el canal ajeno y un canal desconocido se ignora', () => {
    const conexiones = crearConexiones()
    const m1 = conexionFalsa()
    const m2 = conexionFalsa()
    conexiones.conectar('m1', m1.conexion)
    conexiones.conectar('m2', m2.conexion)
    const nav = navegadorFalso()
    conexiones.abrirCanal('m1', TERMINAL, { cols: 80, rows: 24 }, nav.navegador)
    const { canal } = m1.enviados[0] as Adjuntar
    conexiones.recibir('m2', salida(canal, 'inyectado'))
    conexiones.recibir('m2', JSON.stringify({ tipo: 'terminal-fin', canal, motivo: 'terminada' }))
    conexiones.recibir('m1', salida('desconocido', 'x'))
    expect(nav.datos).toEqual([])
    expect(nav.fines).toEqual([])
    expect([...m1.cierres, ...m2.cierres]).toEqual([])
  })

  it('el navegador escribe en trozos válidos, cambia el tamaño y suelta el canal', () => {
    const conexiones = crearConexiones()
    const agente = conexionFalsa()
    conexiones.conectar('m1', agente.conexion)
    const nav = navegadorFalso()
    const canal = conexiones.abrirCanal('m1', TERMINAL, { cols: 80, rows: 24 }, nav.navegador)
    const { canal: id } = agente.enviados[0] as Adjuntar
    // 64 K caracteres de 2 y 4 bytes: más de 64 KiB en UTF-8, hay que trocearlo
    // sin partir ningún carácter.
    const texto = 'ñ'.repeat(30_000) + '😀'.repeat(17_000) + '\r'
    canal.escribir(texto)
    const entradas = agente.enviados.slice(1) as Extract<MensajeHub, { tipo: 'terminal-entrada' }>[]
    expect(entradas.length).toBeGreaterThan(1)
    for (const entrada of entradas) {
      expect(MensajeHub.safeParse(entrada).success).toBe(true)
      expect(entrada).toMatchObject({ tipo: 'terminal-entrada', canal: id })
      const trozo = Buffer.from(entrada.datos, 'base64')
      expect(Buffer.from(trozo.toString('utf8'), 'utf8').equals(trozo)).toBe(true)
    }
    expect(entradas.map((e) => Buffer.from(e.datos, 'base64').toString('utf8')).join('')).toBe(texto)
    canal.redimensionar(120, 40)
    expect(agente.enviados.at(-1)).toEqual({ tipo: 'terminal-tamano', canal: id, cols: 120, rows: 40 })
    canal.soltar()
    expect(agente.enviados.at(-1)).toEqual({ tipo: 'terminal-soltar', canal: id })
    conexiones.recibir('m1', salida(id, 'después de soltar'))
    canal.escribir('x')
    expect(nav.datos).toEqual([])
    expect(agente.enviados.at(-1)).toEqual({ tipo: 'terminal-soltar', canal: id })
  })

  it('si el agente se va, lo sustituye otra copia o se revoca, sus canales se cierran con 4502', () => {
    const conexiones = crearConexiones()
    const vieja = conexionFalsa()
    conexiones.conectar('m1', vieja.conexion)
    const a = navegadorFalso()
    conexiones.abrirCanal('m1', TERMINAL, { cols: 80, rows: 24 }, a.navegador)
    const nueva = conexionFalsa()
    conexiones.conectar('m1', nueva.conexion)
    expect(a.fines).toEqual([{ codigo: 4502, motivo: expect.any(String) }])

    const b = navegadorFalso()
    conexiones.abrirCanal('m1', TERMINAL, { cols: 80, rows: 24 }, b.navegador)
    conexiones.desconectar('m1', nueva.conexion)
    expect(b.fines).toEqual([{ codigo: 4502, motivo: expect.any(String) }])

    const otra = conexionFalsa()
    conexiones.conectar('m1', otra.conexion)
    const c = navegadorFalso()
    conexiones.abrirCanal('m1', TERMINAL, { cols: 80, rows: 24 }, c.navegador)
    conexiones.cerrarMaquina('m1', 4401, 'revocada')
    expect(c.fines).toEqual([{ codigo: 4502, motivo: expect.any(String) }])
  })

  it('sin la máquina conectada no abre canal, y limita los canales abiertos por máquina', () => {
    const conexiones = crearConexiones()
    expect(() => conexiones.abrirCanal('m1', TERMINAL, { cols: 80, rows: 24 }, navegadorFalso().navegador)).toThrow(SinConexion)
    conexiones.conectar('m1', conexionFalsa().conexion)
    for (let i = 0; i < 16; i += 1) conexiones.abrirCanal('m1', TERMINAL, { cols: 80, rows: 24 }, navegadorFalso().navegador)
    expect(() => conexiones.abrirCanal('m1', TERMINAL, { cols: 80, rows: 24 }, navegadorFalso().navegador)).toThrow(DemasiadosCanales)
  })
})
