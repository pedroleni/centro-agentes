import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Clave del panel local: se crea en cada arranque y solo se ve en la terminal que
// lo arrancó, dentro del enlace `#clave=…`. El front la guarda en localStorage
// (aislado por puerto, a diferencia de las cookies, que verían también otros
// servidores de 127.0.0.1) y la manda en la cabecera X-Clave-Panel o, en el
// WebSocket, como subprotocolo `clave.<clave>`. Sin ella, el panel no deja crear,
// cerrar ni abrir terminales: Host y Origin solo frenan a los navegadores, no a
// otros procesos o contenedores que lleguen a 127.0.0.1.

export const PREFIJO_PROTOCOLO = 'clave.'

export function crearClavePanel(): string {
  return randomBytes(24).toString('base64url')
}

// La clave que trae un apretón de manos en su lista de subprotocolos.
export function claveDeProtocolos(cabecera: string | undefined): string | null {
  const protocolo = (cabecera ?? '').split(',').map((p) => p.trim()).find((p) => p.startsWith(PREFIJO_PROTOCOLO))
  return protocolo === undefined ? null : protocolo.slice(PREFIJO_PROTOCOLO.length)
}

// Compara resúmenes de igual longitud para no revelar por el tiempo cuánto acierta.
export function mismaClave(dada: string | null | undefined, clave: string | undefined): boolean {
  if (dada === null || dada === undefined || clave === undefined) return false
  const a = createHash('sha256').update(dada).digest()
  const b = createHash('sha256').update(clave).digest()
  return timingSafeEqual(a, b)
}
