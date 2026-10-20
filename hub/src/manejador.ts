import { z } from 'zod'
import { SO } from '@centro/compartido'
import {
  decodificarRuta,
  json,
  manejarEstatico,
  respuesta,
  type Respuesta,
} from '@centro/agente/panel/respuestas'
import type { Almacen } from './almacen.js'
import {
  comprobarContrasena,
  cookieSesion,
  evaluarPeticion,
  hostsPermitidos,
  leerCookie,
  NOMBRE_COOKIE,
  type Sesiones,
} from './auth.js'
import { SinConexion, SinRespuesta, type Conexiones, type PeticionSinId } from './conexiones.js'
import type { ConfigHub } from './config.js'

export type PeticionHub = {
  metodo: string
  url: string
  host: string | undefined
  origin: string | undefined
  cookie: string | undefined
  tailscaleLogin: string | undefined
  ip: string
  cuerpo: string | null
}

type Dependencias = {
  cfg: ConfigHub
  almacen: Almacen
  sesiones: Sesiones
  limitador: { permitir(clave: string): boolean }
  conexiones: Conexiones
  dirWeb: string
  leerEstatico(ruta: string): Promise<Buffer | null>
}

const ID_HEX = /^[0-9a-f]{12}$/
const Entrada = z.object({ contrasena: z.string().min(1).max(512) })
const Alta = z.object({ codigo: z.string().min(1).max(32), nombre: z.string().min(1).max(80), so: SO })

function leerJson<T>(esquema: z.ZodType<T>, cuerpo: string | null): T | null {
  if (cuerpo === null) return null
  try {
    return esquema.parse(JSON.parse(cuerpo))
  } catch {
    return null
  }
}

function rechazo(veredicto: 'host' | 'tailscale' | 'sin-sesion' | 'origen'): Respuesta {
  if (veredicto === 'host') return respuesta(403, 'Host no permitido')
  if (veredicto === 'tailscale') return json(403, { error: 'Solo se puede entrar desde la red Tailscale de Pedro' })
  if (veredicto === 'sin-sesion') return json(401, { error: 'Inicia sesión' })
  return json(403, { error: 'Origen no permitido' })
}

async function pedirAgente(dep: Dependencias, maquinaId: string, peticion: PeticionSinId): Promise<Respuesta> {
  try {
    return json(200, await dep.conexiones.pedir(maquinaId, peticion))
  } catch (error) {
    if (error instanceof SinConexion) return json(502, { error: error.message })
    if (error instanceof SinRespuesta) return json(504, { error: error.message })
    return json(404, { error: 'No encontrado' })
  }
}

// Rutas del hub. Todas pasan antes por las barreras de `evaluarPeticion` salvo dos:
// el alta de una máquina (la usa el agente, con un código de un solo uso) y los
// estáticos del front (necesarios para pintar la pantalla de entrada), que solo
// exigen Host y Tailscale.
export function crearManejadorHub(dep: Dependencias) {
  return async (p: PeticionHub): Promise<Respuesta> => {
    const ruta = decodificarRuta(p.url)
    if (ruta === null) return respuesta(404, 'No encontrado')
    const esApi = ruta === '/api' || ruta.startsWith('/api/')

    if (p.metodo === 'POST' && ruta === '/api/alta') {
      if (p.host === undefined || !hostsPermitidos(dep.cfg).has(p.host)) return rechazo('host')
      if (!dep.limitador.permitir(`alta:${p.ip}`)) return json(429, { error: 'Demasiados intentos' })
      const datos = leerJson(Alta, p.cuerpo)
      const alta = datos === null ? null : dep.almacen.canjearCodigo(datos.codigo, datos.nombre, datos.so)
      if (datos === null || alta === null) {
        dep.almacen.auditar('alta-fallida', { ip: p.ip })
        return json(400, { error: 'Código no válido o caducado' })
      }
      dep.almacen.auditar('alta', { maquinaId: alta.maquinaId, nombre: datos.nombre, so: datos.so })
      return json(200, alta)
    }

    if (!esApi) {
      if (p.metodo !== 'GET' && p.metodo !== 'HEAD') return respuesta(405, 'Metodo no permitido', { Allow: 'GET, HEAD' })
      const veredicto = evaluarPeticion({ ...p, ruta: '/api/sesion', metodo: 'POST', origin: undefined }, dep.cfg, dep.sesiones)
      if (veredicto === 'host' || veredicto === 'tailscale') return rechazo(veredicto)
      const r = await manejarEstatico(dep, p.url, ruta)
      return p.metodo === 'HEAD' ? { ...r, cuerpo: '' } : r
    }

    const veredicto = evaluarPeticion({ ...p, ruta }, dep.cfg, dep.sesiones)
    if (veredicto !== 'ok') return rechazo(veredicto)

    if (ruta === '/api/sesion') {
      if (p.metodo === 'POST') {
        if (!dep.limitador.permitir(`entrada:${p.ip}`)) return json(429, { error: 'Demasiados intentos, espera un minuto' })
        const datos = leerJson(Entrada, p.cuerpo)
        if (datos === null || !comprobarContrasena(datos.contrasena, dep.cfg.contrasena)) {
          dep.almacen.auditar('entrada-fallida', { ip: p.ip })
          return json(401, { error: 'Contraseña incorrecta' })
        }
        dep.almacen.auditar('entrada', { ip: p.ip })
        return respuesta(204, '', { 'Set-Cookie': cookieSesion(dep.sesiones.crear(), 12 * 3_600), 'Cache-Control': 'no-store' })
      }
      if (p.metodo === 'DELETE') {
        const token = leerCookie(p.cookie, NOMBRE_COOKIE)
        if (token !== null) dep.sesiones.cerrar(token)
        return respuesta(204, '', { 'Set-Cookie': cookieSesion('', 0), 'Cache-Control': 'no-store' })
      }
      if (p.metodo === 'GET') return json(200, { propietario: dep.cfg.propietarioTailscale })
      return respuesta(405, 'Metodo no permitido')
    }

    if (ruta === '/api/maquinas') {
      if (p.metodo !== 'GET') return respuesta(405, 'Metodo no permitido')
      const activas = dep.almacen.listarMaquinas().filter((m) => m.revocadaMs === null)
      return json(200, { modo: 'hub', maquinas: dep.conexiones.vista(activas) })
    }

    if (ruta === '/api/maquinas/codigos') {
      if (p.metodo !== 'POST') return respuesta(405, 'Metodo no permitido')
      const codigo = dep.almacen.crearCodigoAlta()
      dep.almacen.auditar('codigo-alta', { caducaMs: codigo.caducaMs })
      return json(200, codigo)
    }

    if (ruta === '/api/auditoria') {
      if (p.metodo !== 'GET') return respuesta(405, 'Metodo no permitido')
      return json(200, dep.almacen.ultimosEventos(100))
    }

    const maquina = /^\/api\/maquinas\/([^/]+)$/.exec(ruta)
    if (maquina) {
      if (p.metodo !== 'DELETE') return respuesta(405, 'Metodo no permitido')
      const id = maquina[1] ?? ''
      if (!ID_HEX.test(id) || !dep.almacen.revocar(id)) return json(404, { error: 'Máquina no encontrada' })
      dep.conexiones.cerrarMaquina(id, 4401, 'Máquina revocada')
      dep.almacen.auditar('revocar', { maquinaId: id })
      return respuesta(204, '')
    }

    const commits = /^\/api\/maquinas\/([^/]+)\/proyectos\/([^/]+)\/commits$/.exec(ruta)
    if (commits) {
      if (p.metodo !== 'GET') return respuesta(405, 'Metodo no permitido')
      const [, maquinaId = '', proyectoId = ''] = commits
      if (!ID_HEX.test(maquinaId) || !ID_HEX.test(proyectoId)) return json(404, { error: 'No encontrado' })
      return pedirAgente(dep, maquinaId, { op: 'commits', proyectoId })
    }

    const linea = /^\/api\/maquinas\/([^/]+)\/agentes\/([^/]+)\/linea$/.exec(ruta)
    if (linea) {
      if (p.metodo !== 'GET') return respuesta(405, 'Metodo no permitido')
      const [, maquinaId = '', agenteId = ''] = linea
      if (!ID_HEX.test(maquinaId) || agenteId.length > 200) return json(404, { error: 'No encontrado' })
      const textoAntes = new URL(p.url, 'http://hub').searchParams.get('antes')
      const antes = textoAntes === null ? null : Number(textoAntes)
      if (antes !== null && (!Number.isInteger(antes) || antes < 0)) return json(400, { error: 'antes no válido' })
      return pedirAgente(dep, maquinaId, { op: 'linea', agenteId, antes })
    }

    return json(404, { error: 'No encontrado' })
  }
}
