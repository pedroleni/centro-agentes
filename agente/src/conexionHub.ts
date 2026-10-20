import { MensajeHub, type Commit, type Instantanea, type MensajeAgente } from '@centro/compartido'
import type { ResultadoLinea } from './linea.js'
import type { Enganche, GestorTerminales } from './terminales/gestor.js'
import type { PedidoTerminal, ResultadoTerminal } from './terminales/servicio.js'

// Conexión saliente del agente con el hub. El agente saluda, manda su instantánea
// cada 5 s y contesta las peticiones del protocolo: lecturas (commits y línea) y
// terminales, que se crean siempre con las órdenes cerradas del propio agente a
// partir de ids de su instantánea. Si la conexión cae, reintenta con backoff; si
// el hub dice que el token está revocado (4401) o que hay otra copia conectada
// (4409), para y lo explica.

export type SocketMinimo = {
  readyState: number
  send(datos: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((evento: { data: string }) => void) | null
  onclose: ((evento: { code: number }) => void) | null
  onerror: (() => void) | null
}

export type TerminalesHub = {
  crear(pedido: PedidoTerminal): Promise<ResultadoTerminal>
  cerrar(terminalId: string): Promise<void>
  adjuntar: GestorTerminales['adjuntar']
}

const ESPERAS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
const MAXIMO_CANALES = 16
// 48 KiB por mensaje: en base64 son 64 K caracteres, bajo el límite del protocolo.
const TROZO_SALIDA = 48 * 1024
const ESTABLE_MS = 60_000
const INTERVALO_INSTANTANEA_MS = 5_000

export function urlWebSocket(hub: string): string {
  const url = new URL('/api/agente', hub)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

type Opciones = {
  url: string
  token: string
  maquinaId: string
  nombre: string
  obtenerInstantanea(): Promise<Instantanea>
  obtenerCommits(proyectoId: string): Promise<Commit[] | null>
  obtenerLinea(agenteId: string, antes: number | null): Promise<ResultadoLinea | null>
  terminales?: TerminalesHub
  crearSocket(url: string, token: string): SocketMinimo
  aleatorio?: () => number
  log?: (mensaje: string) => void
}

export function crearConexionHub(o: Opciones) {
  const aleatorio = o.aleatorio ?? Math.random
  const log = o.log ?? ((m: string) => process.stderr.write(`${m}\n`))
  let socket: SocketMinimo | null = null
  let intento = 0
  let parado = false
  let latido: ReturnType<typeof setInterval> | null = null
  let reintento: ReturnType<typeof setTimeout> | null = null
  let estable: ReturnType<typeof setTimeout> | null = null
  // Terminales que el hub tiene enganchados, por canal.
  const canales = new Map<string, Enganche>()

  const conIdDelHub = (instantanea: Instantanea): Instantanea => ({
    ...instantanea,
    maquina: { ...instantanea.maquina, id: o.maquinaId, nombre: o.nombre },
  })

  // Solo por el socket vigente y abierto (readyState 1): mandar por uno que aún
  // conecta o ya se ha sustituido lanza una excepción y tumbaría el agente.
  function enviar(mensaje: MensajeAgente): void {
    if (socket === null || socket.readyState !== 1) return
    try {
      socket.send(JSON.stringify(mensaje))
    } catch {
      // El socket se ha cerrado entre la comprobación y el envío: se reintenta al reconectar.
    }
  }

  async function enviarInstantanea(): Promise<void> {
    try {
      enviar({ tipo: 'instantanea', instantanea: conIdDelHub(await o.obtenerInstantanea()) })
    } catch {
      // Una construcción fallida no tumba la conexión: se reintenta en el siguiente ciclo.
    }
  }

  function enviarSalida(canal: string, texto: string): void {
    const bytes = Buffer.from(texto, 'utf8')
    for (let inicio = 0; inicio < bytes.length; inicio += TROZO_SALIDA) {
      enviar({ tipo: 'terminal-salida', canal, datos: bytes.subarray(inicio, inicio + TROZO_SALIDA).toString('base64') })
    }
  }

  function adjuntar(canal: string, terminalId: string, tamano: { cols: number; rows: number }): void {
    if (o.terminales === undefined) return enviar({ tipo: 'terminal-fin', canal, motivo: 'no-encontrado' })
    if (canales.has(canal) || canales.size >= MAXIMO_CANALES) return enviar({ tipo: 'terminal-fin', canal, motivo: 'demasiados' })
    let enganche: Enganche
    try {
      enganche = o.terminales.adjuntar(
        terminalId,
        tamano,
        (texto) => { if (canales.get(canal) === enganche) enviarSalida(canal, texto) },
        () => {
          // Si el canal ya se soltó, el hub no espera nada más de él.
          if (canales.get(canal) !== enganche) return
          canales.delete(canal)
          enviar({ tipo: 'terminal-fin', canal, motivo: 'terminada' })
        },
      )
    } catch {
      enviar({ tipo: 'terminal-fin', canal, motivo: 'no-encontrado' })
      return
    }
    canales.set(canal, enganche)
  }

  function soltarCanales(): void {
    const enganches = [...canales.values()]
    canales.clear()
    for (const enganche of enganches) enganche.soltar()
  }

  // Los mensajes de canal se atienden en el acto, en el orden en que llegan.
  function atenderCanal(mensaje: Exclude<MensajeHub, { tipo: 'peticion' | 'adios' }>): void {
    if (mensaje.tipo === 'terminal-adjuntar') return adjuntar(mensaje.canal, mensaje.terminalId, { cols: mensaje.cols, rows: mensaje.rows })
    const enganche = canales.get(mensaje.canal)
    if (enganche === undefined) return
    if (mensaje.tipo === 'terminal-entrada') enganche.escribir(Buffer.from(mensaje.datos, 'base64').toString('utf8'))
    else if (mensaje.tipo === 'terminal-tamano') enganche.redimensionar(mensaje.cols, mensaje.rows)
    else {
      canales.delete(mensaje.canal)
      enganche.soltar()
    }
  }

  async function contestar(crudo: string): Promise<void> {
    let mensaje: MensajeHub
    try {
      mensaje = MensajeHub.parse(JSON.parse(crudo))
    } catch {
      return
    }
    if (mensaje.tipo === 'adios') return
    if (mensaje.tipo !== 'peticion') return atenderCanal(mensaje)
    try {
      let datos: unknown
      if (mensaje.op === 'commits') {
        datos = await o.obtenerCommits(mensaje.proyectoId).then((commits) => (commits === null ? null : { commits }))
      } else if (mensaje.op === 'linea') {
        datos = await o.obtenerLinea(mensaje.agenteId, mensaje.antes)
      } else if (o.terminales === undefined) {
        enviar({ tipo: 'respuesta', id: mensaje.id, ok: false, error: 'Los terminales no están disponibles en esta máquina' })
        return
      } else if (mensaje.op === 'terminal-crear') {
        datos = await o.terminales.crear(mensaje.accion === 'continuar'
          ? { accion: 'continuar', agenteId: mensaje.agenteId }
          : { accion: 'nueva', tipo: mensaje.tipo_agente, proyectoId: mensaje.proyectoId })
      } else {
        const cerrado = await o.terminales.cerrar(mensaje.terminalId).then(() => true, () => false)
        enviar(cerrado
          ? { tipo: 'respuesta', id: mensaje.id, ok: true, datos: { cerrado: true } }
          : { tipo: 'respuesta', id: mensaje.id, ok: false, error: 'Terminal no encontrado' })
        return
      }
      enviar(datos === null
        ? { tipo: 'respuesta', id: mensaje.id, ok: false, error: 'No encontrado' }
        : { tipo: 'respuesta', id: mensaje.id, ok: true, datos })
    } catch {
      enviar({ tipo: 'respuesta', id: mensaje.id, ok: false, error: 'Error al leer en la máquina' })
    }
  }

  function limpiar(): void {
    if (latido !== null) clearInterval(latido)
    if (estable !== null) clearTimeout(estable)
    latido = null
    estable = null
  }

  function conectar(): void {
    if (parado) return
    const actual = o.crearSocket(o.url, o.token)
    socket = actual
    actual.onopen = () => {
      if (socket !== actual) return
      void (async () => {
        const instantanea = conIdDelHub(await o.obtenerInstantanea())
        enviar({ tipo: 'hola', maquina: instantanea.maquina, version: 1 })
        enviar({ tipo: 'instantanea', instantanea })
      })().catch(() => undefined)
      latido = setInterval(() => { void enviarInstantanea() }, INTERVALO_INSTANTANEA_MS)
      estable = setTimeout(() => { intento = 0 }, ESTABLE_MS)
    }
    actual.onmessage = (evento) => { void contestar(String(evento.data)) }
    actual.onerror = () => undefined
    actual.onclose = (evento) => {
      if (socket !== actual) return
      socket = null
      limpiar()
      soltarCanales()
      if (evento.code === 4401) {
        log('Token revocado: vuelve a dar de alta esta máquina')
        parado = true
        return
      }
      if (evento.code === 4409) {
        log('Otra copia de este agente se ha conectado')
        parado = true
        return
      }
      programarReintento()
    }
  }

  function programarReintento(): void {
    if (parado) return
    const base = ESPERAS_MS[Math.min(intento, ESPERAS_MS.length - 1)] ?? 30_000
    const variacion = 1 + (aleatorio() - 0.5) * 0.4
    intento += 1
    reintento = setTimeout(conectar, Math.round(base * variacion))
  }

  return {
    arrancar(): void {
      parado = false
      conectar()
    },
    parar(): void {
      parado = true
      limpiar()
      if (reintento !== null) clearTimeout(reintento)
      soltarCanales()
      socket?.close()
      socket = null
    },
  }
}
