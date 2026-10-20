import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { ConfigHub } from './config.js'

// Autenticación del navegador en el hub. Para entrar hacen falta las dos cosas que
// pide la especificación: estar en la red Tailscale de Pedro (cabecera que pone
// `tailscale serve`) y saber la contraseña.

const PARAMETROS_SCRYPT = { N: 16_384, r: 8, p: 1 }
const LONGITUD_HASH = 64
const VIDA_SESION_MS = 12 * 3_600_000
export const NOMBRE_COOKIE = 'ca_sesion'

export function hashContrasena(contrasena: string): { sal: string; hash: string } {
  const sal = randomBytes(16)
  const hash = scryptSync(contrasena, sal, LONGITUD_HASH, PARAMETROS_SCRYPT)
  return { sal: sal.toString('base64'), hash: hash.toString('base64') }
}

export function comprobarContrasena(contrasena: string, guardada: { sal: string; hash: string }): boolean {
  const esperado = Buffer.from(guardada.hash, 'base64')
  const calculado = scryptSync(contrasena, Buffer.from(guardada.sal, 'base64'), esperado.length, PARAMETROS_SCRYPT)
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado)
}

export function crearSesiones(ahora: () => number = Date.now) {
  const caducidades = new Map<string, number>()
  return {
    crear(): string {
      const token = randomBytes(32).toString('base64url')
      caducidades.set(token, ahora() + VIDA_SESION_MS)
      return token
    },
    valida(token: string): boolean {
      const caduca = caducidades.get(token)
      if (caduca === undefined) return false
      if (ahora() > caduca) {
        caducidades.delete(token)
        return false
      }
      return true
    },
    cerrar(token: string): void {
      caducidades.delete(token)
    },
  }
}

export type Sesiones = ReturnType<typeof crearSesiones>

export function crearLimitador(maximo = 5, ventanaMs = 60_000, ahora: () => number = Date.now) {
  const intentos = new Map<string, number[]>()
  return {
    permitir(clave: string): boolean {
      const desde = ahora() - ventanaMs
      const recientes = (intentos.get(clave) ?? []).filter((t) => t > desde)
      if (recientes.length >= maximo) {
        intentos.set(clave, recientes)
        return false
      }
      recientes.push(ahora())
      intentos.set(clave, recientes)
      return true
    },
  }
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

export function cookieSesion(token: string, maxAgeS: number): string {
  return `${NOMBRE_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeS}`
}

export type PeticionNavegador = {
  metodo: string
  ruta: string
  host: string | undefined
  origin: string | undefined
  cookie: string | undefined
  tailscaleLogin: string | undefined
}

export type Veredicto = 'ok' | 'host' | 'tailscale' | 'sin-sesion' | 'origen'

export function hostsPermitidos(cfg: ConfigHub): Set<string> {
  const hosts = new Set([`127.0.0.1:${cfg.puerto}`, `localhost:${cfg.puerto}`])
  if (cfg.hostPublico !== null) hosts.add(cfg.hostPublico)
  return hosts
}

export function origenesPermitidos(cfg: ConfigHub): Set<string> {
  const origenes = new Set([`http://127.0.0.1:${cfg.puerto}`, `http://localhost:${cfg.puerto}`])
  if (cfg.hostPublico !== null) origenes.add(`https://${cfg.hostPublico}`)
  return origenes
}

export function evaluarPeticion(p: PeticionNavegador, cfg: ConfigHub, sesiones: Sesiones): Veredicto {
  if (p.host === undefined || !hostsPermitidos(cfg).has(p.host)) return 'host'
  if (cfg.exigirTailscale && (p.tailscaleLogin === undefined || p.tailscaleLogin !== cfg.propietarioTailscale)) {
    return 'tailscale'
  }
  const esEntrada = p.metodo === 'POST' && p.ruta === '/api/sesion'
  if (!esEntrada) {
    const token = leerCookie(p.cookie, NOMBRE_COOKIE)
    if (token === null || !sesiones.valida(token)) return 'sin-sesion'
  }
  if ((p.metodo === 'POST' || p.metodo === 'DELETE') && (p.origin === undefined || !origenesPermitidos(cfg).has(p.origin))) {
    return 'origen'
  }
  return 'ok'
}
