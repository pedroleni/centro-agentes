import { createServer, type Server } from 'node:http'
import type { Peticion, Respuesta } from './manejador.js'

type OpcionesPanel = {
  puerto: number
  manejador: (peticion: Peticion) => Promise<Respuesta>
}

export function arrancarPanel(opciones: OpcionesPanel): Promise<Server> {
  const servidor = createServer((peticion, respuesta) => {
    void opciones.manejador({
      metodo: peticion.method ?? '',
      url: peticion.url ?? '/',
      host: peticion.headers.host,
    }).then((resultado) => {
      respuesta.writeHead(resultado.estado, resultado.cabeceras)
      respuesta.end(resultado.cuerpo)
    }).catch(() => {
      respuesta.writeHead(500, {
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      })
      respuesta.end('Error interno')
    })
  })

  return new Promise((resolve, reject) => {
    const rechazar = (error: Error): void => reject(error)
    servidor.once('error', rechazar)
    servidor.listen(opciones.puerto, '127.0.0.1', () => {
      servidor.removeListener('error', rechazar)
      resolve(servidor)
    })
  })
}
