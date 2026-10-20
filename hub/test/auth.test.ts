import { describe, expect, it } from 'vitest'
import {
  comprobarContrasena,
  cookieSesion,
  crearLimitador,
  crearSesiones,
  evaluarPeticion,
  hashContrasena,
  leerCookie,
} from '../src/auth.js'
import type { ConfigHub } from '../src/config.js'

const cfg: ConfigHub = {
  puerto: 4700,
  hostPublico: 'mini.tail1234.ts.net',
  propietarioTailscale: 'pedro@example.com',
  exigirTailscale: true,
  contrasena: hashContrasena('secreta'),
}

describe('contraseña', () => {
  it('acepta la correcta y rechaza la incorrecta, con sal distinta cada vez', () => {
    expect(comprobarContrasena('secreta', cfg.contrasena)).toBe(true)
    expect(comprobarContrasena('Secreta', cfg.contrasena)).toBe(false)
    expect(hashContrasena('secreta').sal).not.toBe(cfg.contrasena.sal)
  })
})

describe('sesiones', () => {
  it('duran 12 horas y se pueden cerrar', () => {
    let t = 0
    const sesiones = crearSesiones(() => t)
    const token = sesiones.crear()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    t = 12 * 3_600_000
    expect(sesiones.valida(token)).toBe(true)
    t += 1
    expect(sesiones.valida(token)).toBe(false)
    const otro = sesiones.crear()
    sesiones.cerrar(otro)
    expect(sesiones.valida(otro)).toBe(false)
  })
})

describe('limitador', () => {
  it('permite 5 intentos por minuto por clave', () => {
    let t = 0
    const limitador = crearLimitador(5, 60_000, () => t)
    for (let i = 0; i < 5; i += 1) expect(limitador.permitir('ip')).toBe(true)
    expect(limitador.permitir('ip')).toBe(false)
    expect(limitador.permitir('otra')).toBe(true)
    t = 60_001
    expect(limitador.permitir('ip')).toBe(true)
  })
})

describe('cookies', () => {
  it('lee la cookie de sesión y la escribe con las banderas seguras', () => {
    expect(leerCookie('a=1; ca_sesion=xyz; b=2', 'ca_sesion')).toBe('xyz')
    expect(leerCookie(undefined, 'ca_sesion')).toBeNull()
    const cabecera = cookieSesion('xyz', 43_200)
    for (const parte of ['ca_sesion=xyz', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=43200']) {
      expect(cabecera).toContain(parte)
    }
  })
})

describe('evaluarPeticion', () => {
  const sesiones = crearSesiones()
  const token = sesiones.crear()
  const base = {
    metodo: 'GET',
    ruta: '/api/maquinas',
    host: 'mini.tail1234.ts.net',
    origin: undefined as string | undefined,
    cookie: `ca_sesion=${token}`,
    tailscaleLogin: 'pedro@example.com',
  }

  it('deja pasar una petición correcta', () => {
    expect(evaluarPeticion(base, cfg, sesiones)).toBe('ok')
    expect(evaluarPeticion({ ...base, host: '127.0.0.1:4700' }, cfg, sesiones)).toBe('ok')
  })

  it('rechaza Host ajeno, Tailscale ajeno, falta de sesión y Origin ajeno, en ese orden', () => {
    expect(evaluarPeticion({ ...base, host: 'evil.com' }, cfg, sesiones)).toBe('host')
    expect(evaluarPeticion({ ...base, tailscaleLogin: 'otro@example.com' }, cfg, sesiones)).toBe('tailscale')
    expect(evaluarPeticion({ ...base, tailscaleLogin: undefined as unknown as string }, cfg, sesiones)).toBe('tailscale')
    expect(evaluarPeticion({ ...base, cookie: '' }, cfg, sesiones)).toBe('sin-sesion')
    expect(evaluarPeticion({ ...base, metodo: 'POST', origin: 'https://evil.com' }, cfg, sesiones)).toBe('origen')
    expect(evaluarPeticion({ ...base, metodo: 'DELETE', origin: undefined }, cfg, sesiones)).toBe('origen')
  })

  it('el POST de entrada no exige sesión pero sí Origin, y sin Tailscale exigido basta la sesión', () => {
    expect(evaluarPeticion({ ...base, metodo: 'POST', ruta: '/api/sesion', cookie: '', origin: 'https://mini.tail1234.ts.net' }, cfg, sesiones)).toBe('ok')
    expect(evaluarPeticion({ ...base, tailscaleLogin: undefined as unknown as string }, { ...cfg, exigirTailscale: false }, sesiones)).toBe('ok')
  })
})
