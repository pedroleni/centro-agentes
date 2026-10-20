import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import { CIERRE_TERMINAL, LIMITE_MENSAJE_BYTES, MensajeNavegadorTerminal } from '@centro/compartido'
import type { Almacen } from './almacen.js'
import { crearLimitador, hostsPermitidos, leerCookie, NOMBRE_COOKIE, origenesPermitidos, type Sesiones } from './auth.js'
import { DemasiadosCanales, type Canal, type Conexiones, type ConexionAgente } from './conexiones.js'
import type { ConfigHub } from './config.js'
import type { PeticionHub } from './manejador.js'
import type { Respuesta } from '@centro/agente/panel/respuestas'

const LIMITE_CUERPO = 64 * 1024
const RUTA_TERMINAL = /^\/api\/maquinas\/([0-9a-f]{12})\/terminales\/([0-9a-f]{12})\/ws$/
// 64 K caracteres de entrada, aunque todos vengan escapados en el JSON.
const LIMITE_MENSAJE_NAVEGADOR = 512 * 1024
// Si el navegador no da abasto con la salida, se corta: al reconectar, tmux
// repinta la pantalla entera.
const MAXIMO_PENDIENTE_NAVEGADOR = 8 * 1024 * 1024
const VIGILANCIA_SESION_MS = 30_000

type Opciones = {
  cfg: ConfigHub
  almacen: Almacen
  conexiones: Conexiones
  sesiones: Sesiones
  manejar(p: PeticionHub): Promise<Respuesta>
}

function cabecera(peticion: IncomingMessage, nombre: string): string | undefined {
  const valor = peticion.headers[nombre]
  return Array.isArray(valor) ? valor[0] : valor
}

function ipDe(peticion: IncomingMessage): string {
  return cabecera(peticion, 'x-forwarded-for')?.split(',')[0]?.trim() || peticion.socket.remoteAddress || 'desconocida'
}

function medida(valor: string | null, porDefecto: number, minimo: number, maximo: number): number {
  const numero = Number(valor ?? porDefecto)
  return Number.isFinite(numero) ? Math.min(maximo, Math.max(minimo, Math.round(numero))) : porDefecto
}

function leerCuerpo(peticion: IncomingMessage): Promise<string | null> {
  return new Promise((resolver, rechazar) => {
    const trozos: Buffer[] = []
    let total = 0
    peticion.on('data', (trozo: Buffer) => {
      total += trozo.length
      if (total > LIMITE_CUERPO) {
        rechazar(new Error('cuerpo demasiado grande'))
        peticion.destroy()
        return
      }
      trozos.push(trozo)
    })
    peticion.on('end', () => resolver(trozos.length === 0 ? null : Buffer.concat(trozos).toString('utf8')))
    peticion.on('error', rechazar)
  })
}

// Servidor del hub: HTTP para el navegador, WebSocket en /api/agente para los
// agentes, que se identifican con su token (nunca con cookie), y WebSocket de
// cada terminal para el navegador, con las mismas barreras que la API. Solo
// 127.0.0.1: `tailscale serve` es quien lo publica en la red privada.
export function arrancarHub(opciones: Opciones): Promise<Server> {
  const { cfg, almacen, conexiones, sesiones } = opciones
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITE_MENSAJE_BYTES })
  const wssNavegador = new WebSocketServer({ noServer: true, maxPayload: LIMITE_MENSAJE_NAVEGADOR })
  // Intentos de conexión rechazados por IP: sin límite, un cliente podría llenar
  // la auditoría (y el disco) a miles de filas por segundo.
  const rechazosWs = crearLimitador(30, 60_000)

  const servidor = createServer((peticion, respuesta) => {
    void (async () => {
      let cuerpo: string | null = null
      if (peticion.method === 'POST' || peticion.method === 'DELETE') {
        try {
          cuerpo = await leerCuerpo(peticion)
        } catch {
          respuesta.writeHead(413).end()
          return
        }
      }
      const resultado = await opciones.manejar({
        metodo: peticion.method ?? '',
        url: peticion.url ?? '/',
        host: cabecera(peticion, 'host'),
        origin: cabecera(peticion, 'origin'),
        cookie: cabecera(peticion, 'cookie'),
        tailscaleLogin: cabecera(peticion, 'tailscale-user-login'),
        ip: ipDe(peticion),
        cuerpo,
      })
      if (!respuesta.headersSent) {
        respuesta.writeHead(resultado.estado, resultado.cabeceras)
        respuesta.end(resultado.cuerpo)
      }
    })().catch(() => {
      if (!respuesta.headersSent) respuesta.writeHead(500)
      respuesta.end()
    })
  })

  servidor.on('upgrade', (peticion, socket, cabeza) => {
    // Un socket que falla antes o durante el apretón de manos no puede tumbar el hub.
    socket.on('error', () => undefined)
    const rechazar = (estado: string) => {
      socket.write(`HTTP/1.1 ${estado}\r\nConnection: close\r\n\r\n`)
      socket.destroy()
    }
    const url = new URL(peticion.url ?? '/', 'http://hub')
    const terminal = RUTA_TERMINAL.exec(url.pathname)
    if (terminal) return conectarNavegador(peticion, socket, cabeza, url, terminal[1] ?? '', terminal[2] ?? '', rechazar)
    if (url.pathname !== '/api/agente') return rechazar('404 Not Found')
    const host = cabecera(peticion, 'host')
    if (host === undefined || !hostsPermitidos(cfg).has(host)) return rechazar('403 Forbidden')
    // Con Tailscale exigido, también los agentes tienen que venir de tu identidad.
    if (cfg.exigirTailscale && cabecera(peticion, 'tailscale-user-login') !== cfg.propietarioTailscale) {
      return rechazar('403 Forbidden')
    }
    const autorizacion = cabecera(peticion, 'authorization') ?? ''
    const token = autorizacion.startsWith('Bearer ') ? autorizacion.slice(7) : ''
    const maquina = token === '' ? null : almacen.maquinaDeToken(token)
    if (maquina === null) {
      if (!rechazosWs.permitir(ipDe(peticion))) return rechazar('429 Too Many Requests')
      almacen.auditar('conexion-rechazada', { ip: ipDe(peticion) })
      // Se completa el apretón de manos solo para cerrar con 4401: así el agente
      // sabe que su token no vale (revocado) y deja de reintentar.
      return wss.handleUpgrade(peticion, socket, cabeza, (ws) => {
        ws.on('error', () => undefined)
        ws.close(4401, 'Token no válido')
      })
    }
    wss.handleUpgrade(peticion, socket, cabeza, (ws) => {
      const conexion: ConexionAgente = {
        enviar: (mensaje) => ws.send(JSON.stringify(mensaje)),
        cerrar: (codigo, motivo) => ws.close(codigo, motivo),
      }
      conexiones.conectar(maquina.id, conexion)
      almacen.auditar('conexion', { maquinaId: maquina.id })
      ws.on('message', (datos, binario) => {
        if (binario) return conexion.cerrar(4400, 'Solo se aceptan mensajes de texto')
        conexiones.recibir(maquina.id, datos.toString())
      })
      ws.on('close', () => conexiones.desconectar(maquina.id, conexion))
      ws.on('error', () => conexiones.desconectar(maquina.id, conexion))
    })
  })

  function conectarNavegador(
    peticion: IncomingMessage,
    socket: Duplex,
    cabeza: Buffer,
    url: URL,
    maquinaId: string,
    terminalId: string,
    rechazar: (estado: string) => void,
  ): void {
    const host = cabecera(peticion, 'host')
    if (host === undefined || !hostsPermitidos(cfg).has(host)) return rechazar('403 Forbidden')
    if (cfg.exigirTailscale && cabecera(peticion, 'tailscale-user-login') !== cfg.propietarioTailscale) {
      return rechazar('403 Forbidden')
    }
    const sesion = leerCookie(cabecera(peticion, 'cookie'), NOMBRE_COOKIE)
    if (sesion === null || !sesiones.valida(sesion)) return rechazar('401 Unauthorized')
    // El navegador manda siempre Origin en un WebSocket: sin él o ajeno, fuera.
    const origin = cabecera(peticion, 'origin')
    if (origin === undefined || !origenesPermitidos(cfg).has(origin)) return rechazar('403 Forbidden')
    const tamano = {
      cols: medida(url.searchParams.get('cols'), 80, 20, 400),
      rows: medida(url.searchParams.get('rows'), 24, 5, 120),
    }
    wssNavegador.handleUpgrade(peticion, socket, cabeza, (ws) => {
      ws.on('error', () => undefined)
      almacen.auditar('terminal-entrar', { maquinaId, terminalId, ip: ipDe(peticion) })
      let canal: Canal
      try {
        canal = conexiones.abrirCanal(maquinaId, terminalId, tamano, {
          datos: (bytes) => {
            if (ws.readyState !== ws.OPEN) return
            if (ws.bufferedAmount > MAXIMO_PENDIENTE_NAVEGADOR) return ws.close(1013, 'Demasiada salida pendiente')
            ws.send(bytes, { binary: true })
          },
          fin: (codigo, motivo) => ws.close(codigo, motivo),
        })
      } catch (error) {
        if (error instanceof DemasiadosCanales) ws.close(1013, error.message)
        else ws.close(CIERRE_TERMINAL.maquinaDesconectada, 'La máquina no está conectada')
        return
      }
      // Cerrar sesión (o que caduque) también corta los terminales abiertos.
      const vigilancia = setInterval(() => {
        if (!sesiones.valida(sesion)) ws.close(CIERRE_TERMINAL.sesionCaducada, 'La sesión ha caducado')
      }, VIGILANCIA_SESION_MS)
      ws.on('message', (datos, binario) => {
        if (!sesiones.valida(sesion)) return ws.close(CIERRE_TERMINAL.sesionCaducada, 'La sesión ha caducado')
        if (binario) return
        let mensaje: MensajeNavegadorTerminal
        try {
          mensaje = MensajeNavegadorTerminal.parse(JSON.parse(datos.toString()))
        } catch {
          return
        }
        if (mensaje.tipo === 'entrada') canal.escribir(mensaje.datos)
        else canal.redimensionar(mensaje.cols, mensaje.rows)
      })
      ws.on('close', () => {
        clearInterval(vigilancia)
        canal.soltar()
      })
    })
  }

  servidor.on('error', () => undefined)
  return new Promise((resolver, rechazar) => {
    servidor.once('error', rechazar)
    servidor.listen(cfg.puerto, '127.0.0.1', () => {
      servidor.removeListener('error', rechazar)
      resolver(servidor)
    })
  })
}
