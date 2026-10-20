import { createServer, type IncomingMessage, type Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { LIMITE_MENSAJE_BYTES } from '@centro/compartido'
import type { Almacen } from './almacen.js'
import { crearLimitador, hostsPermitidos } from './auth.js'
import type { Conexiones, ConexionAgente } from './conexiones.js'
import type { ConfigHub } from './config.js'
import type { PeticionHub } from './manejador.js'
import type { Respuesta } from '@centro/agente/panel/respuestas'

const LIMITE_CUERPO = 64 * 1024

type Opciones = {
  cfg: ConfigHub
  almacen: Almacen
  conexiones: Conexiones
  manejar(p: PeticionHub): Promise<Respuesta>
}

function cabecera(peticion: IncomingMessage, nombre: string): string | undefined {
  const valor = peticion.headers[nombre]
  return Array.isArray(valor) ? valor[0] : valor
}

function ipDe(peticion: IncomingMessage): string {
  return cabecera(peticion, 'x-forwarded-for')?.split(',')[0]?.trim() || peticion.socket.remoteAddress || 'desconocida'
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

// Servidor del hub: HTTP para el navegador y WebSocket en /api/agente para los
// agentes, que se identifican con su token (nunca con cookie). Solo 127.0.0.1:
// `tailscale serve` es quien lo publica en la red privada.
export function arrancarHub(opciones: Opciones): Promise<Server> {
  const { cfg, almacen, conexiones } = opciones
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITE_MENSAJE_BYTES })
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
    const ruta = (peticion.url ?? '').split('?', 1)[0]
    if (ruta !== '/api/agente') return rechazar('404 Not Found')
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

  servidor.on('error', () => undefined)
  return new Promise((resolver, rechazar) => {
    servidor.once('error', rechazar)
    servidor.listen(cfg.puerto, '127.0.0.1', () => {
      servidor.removeListener('error', rechazar)
      resolver(servidor)
    })
  })
}
