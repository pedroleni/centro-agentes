import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Clave del panel local: se crea en cada arranque y solo se ve en la terminal que
// lo arrancó, dentro del enlace de entrada. Sin ella (en una cookie HttpOnly), el
// panel no deja crear, cerrar ni abrir terminales: Host y Origin solo frenan a
// los navegadores, no a otros procesos o contenedores que lleguen a 127.0.0.1.

export const COOKIE_PANEL = 'ca_panel'

export function crearClavePanel(): string {
  return randomBytes(24).toString('base64url')
}

export function leerCookie(cabecera: string | undefined, nombre: string): string | null {
  if (cabecera === undefined) return null
  for (const parte of cabecera.split(';')) {
    const igual = parte.indexOf('=')
    if (igual === -1) continue
    if (parte.slice(0, igual).trim() === nombre) return parte.slice(igual + 1).trim()
  }
  return null
}

// Compara resúmenes de igual longitud para no revelar por el tiempo cuánto acierta.
export function mismaClave(dada: string | null | undefined, clave: string | undefined): boolean {
  if (dada === null || dada === undefined || clave === undefined) return false
  const a = createHash('sha256').update(dada).digest()
  const b = createHash('sha256').update(clave).digest()
  return timingSafeEqual(a, b)
}

export function cookiePanel(clave: string): string {
  return `${COOKIE_PANEL}=${clave}; HttpOnly; SameSite=Strict; Path=/`
}
