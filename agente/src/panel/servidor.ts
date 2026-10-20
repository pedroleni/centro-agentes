import { createServer, type IncomingMessage, type Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { CIERRE_TERMINAL, MensajeNavegadorTerminal } from '@centro/compartido'
import type { GestorTerminales } from '../terminales/gestor.js'
import type { Peticion, Respuesta } from './manejador.js'

const LIMITE_CUERPO = 64 * 1024

type OpcionesPanel = {
  puerto: number
  manejador: (peticion: Peticion) => Promise<Respuesta>
  terminal?: {
    maquinaId(): Promise<string>
    adjuntar: GestorTerminales['adjuntar']
  }
}

function cabecera(peticion: IncomingMessage, nombre: string): string | undefined {
  const valor = peticion.headers[nombre]
  return Array.isArray(valor) ? valor[0] : valor
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

const CABECERAS_ERROR = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

export function arrancarPanel(opciones: OpcionesPanel): Promise<Server> {
  const permitidos = new Set([`127.0.0.1:${opciones.puerto}`, `localhost:${opciones.puerto}`])
  const origenes = new Set([...permitidos].map((host) => `http://${host}`))
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 })

  const servidor = createServer((peticion, respuesta) => {
    void (async () => {
      let cuerpo: string | null = null
      if (peticion.method === 'POST' || peticion.method === 'DELETE') {
        try {
          cuerpo = await leerCuerpo(peticion)
        } catch {
          respuesta.writeHead(413, CABECERAS_ERROR).end()
          return
        }
      }
      const resultado = await opciones.manejador({
        metodo: peticion.method ?? '',
        url: peticion.url ?? '/',
        host: cabecera(peticion, 'host'),
        origin: cabecera(peticion, 'origin'),
        cuerpo,
      })
      if (!respuesta.headersSent) {
        respuesta.writeHead(resultado.estado, resultado.cabeceras)
        respuesta.end(resultado.cuerpo)
      }
    })().catch(() => {
      if (!respuesta.headersSent) respuesta.writeHead(500, CABECERAS_ERROR)
      respuesta.end('Error interno')
    })
  })

  // WebSocket de un terminal. Host y Origin exactos de este panel: una web
  // cualquiera abierta en el navegador no puede engancharse a un terminal.
  servidor.on('upgrade', (peticion, socket, cabeza) => {
    socket.on('error', () => undefined)
    const rechazar = (estado: string) => {
      socket.write(`HTTP/1.1 ${estado}\r\nConnection: close\r\n\r\n`)
      socket.destroy()
    }
    void (async () => {
      const url = new URL(peticion.url ?? '/', 'http://panel')
      const coincidencia = /^\/api\/maquinas\/([^/]+)\/terminales\/([0-9a-f]{12})\/ws$/.exec(url.pathname)
      if (opciones.terminal === undefined || coincidencia === null) return rechazar('404 Not Found')
      const host = cabecera(peticion, 'host')
      const origin = cabecera(peticion, 'origin')
      if (host === undefined || !permitidos.has(host) || origin === undefined || !origenes.has(origin)) {
        return rechazar('403 Forbidden')
      }
      if (decodeURIComponent(coincidencia[1] ?? '') !== await opciones.terminal.maquinaId()) return rechazar('404 Not Found')
      const terminalId = coincidencia[2] ?? ''
      const cols = Number(url.searchParams.get('cols') ?? 80)
      const rows = Number(url.searchParams.get('rows') ?? 24)
      const terminal = opciones.terminal
      wss.handleUpgrade(peticion, socket, cabeza, (ws) => {
        ws.on('error', () => undefined)
        let enganche: ReturnType<GestorTerminales['adjuntar']>
        try {
          enganche = terminal.adjuntar(
            terminalId,
            { cols, rows },
            (datos) => { if (ws.readyState === ws.OPEN) ws.send(Buffer.from(datos, 'utf8')) },
            () => ws.close(CIERRE_TERMINAL.terminada, 'La sesión ha terminado'),
          )
        } catch {
          ws.close(CIERRE_TERMINAL.noEncontrado, 'Terminal no encontrado')
          return
        }
        ws.on('message', (datos, binario) => {
          if (binario) return
          let mensaje: MensajeNavegadorTerminal
          try {
            mensaje = MensajeNavegadorTerminal.parse(JSON.parse(datos.toString()))
          } catch {
            return
          }
          if (mensaje.tipo === 'entrada') enganche.escribir(mensaje.datos)
          else enganche.redimensionar(mensaje.cols, mensaje.rows)
        })
        ws.on('close', () => enganche.soltar())
      })
    })().catch(() => rechazar('500 Internal Server Error'))
  })

  servidor.on('error', () => undefined)
  return new Promise((resolve, reject) => {
    const rechazar = (error: Error): void => reject(error)
    servidor.once('error', rechazar)
    servidor.listen(opciones.puerto, '127.0.0.1', () => {
      servidor.removeListener('error', rechazar)
      resolve(servidor)
    })
  })
}
