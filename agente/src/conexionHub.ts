import { MensajeHub, type Commit, type Instantanea, type MensajeAgente } from '@centro/compartido'
import type { ResultadoLinea } from './linea.js'

// Conexión saliente del agente con el hub. El agente saluda, manda su instantánea
// cada 5 s y solo contesta las dos peticiones de lectura del protocolo. Si la
// conexión cae, reintenta con backoff; si el hub dice que el token está revocado
// (4401) o que hay otra copia conectada (4409), para y lo explica.

export type SocketMinimo = {
  readyState: number
  send(datos: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((evento: { data: string }) => void) | null
  onclose: ((evento: { code: number }) => void) | null
  onerror: (() => void) | null
}

const ESPERAS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
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

  async function contestar(crudo: string): Promise<void> {
    let mensaje: MensajeHub
    try {
      mensaje = MensajeHub.parse(JSON.parse(crudo))
    } catch {
      return
    }
    if (mensaje.tipo !== 'peticion') return
    try {
      const datos = mensaje.op === 'commits'
        ? await o.obtenerCommits(mensaje.proyectoId).then((commits) => (commits === null ? null : { commits }))
        : await o.obtenerLinea(mensaje.agenteId, mensaje.antes)
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
      socket?.close()
      socket = null
    },
  }
}
