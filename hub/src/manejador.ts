import { z } from 'zod'
import { SO, TerminalInfo } from '@centro/compartido'
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
  crearLimitador,
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
const PedidoTerminal = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('continuar'), agenteId: z.string().min(1).max(200) }),
  z.object({ accion: z.literal('nueva'), tipo: z.enum(['claude', 'codex']), proyectoId: z.string().regex(ID_HEX) }),
])
// Lo que contesta el agente al crear un terminal: se valida antes de dárselo al
// navegador, y solo con estados de error conocidos.
const ResultadoTerminal = z.union([
  z.object({ ok: z.literal(true), terminal: TerminalInfo }),
  z.object({
    ok: z.literal(false),
    estado: z.union([z.literal(400), z.literal(404), z.literal(409), z.literal(429), z.literal(500)]),
    error: z.string().max(200),
  }),
])

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

async function pedirAgente(
  dep: Dependencias,
  maquinaId: string,
  peticion: PeticionSinId,
  responder: (datos: unknown) => Respuesta = (datos) => json(200, datos),
): Promise<Respuesta> {
  let datos: unknown
  try {
    datos = await dep.conexiones.pedir(maquinaId, peticion)
  } catch (error) {
    if (error instanceof SinConexion) return json(502, { error: error.message })
    if (error instanceof SinRespuesta) return json(504, { error: error.message })
    return json(404, { error: 'No encontrado' })
  }
  return responder(datos)
}

function respuestaTerminal(datos: unknown): Respuesta {
  const resultado = ResultadoTerminal.safeParse(datos)
  if (!resultado.success) return json(502, { error: 'Respuesta no válida de la máquina' })
  return resultado.data.ok ? json(201, resultado.data.terminal) : json(resultado.data.estado, { error: resultado.data.error })
}

// Rutas del hub. Todas pasan antes por las barreras de `evaluarPeticion` salvo dos:
// el alta de una máquina (la usa el agente, con un código de un solo uso) y los
// estáticos del front (necesarios para pintar la pantalla de entrada), que solo
// exigen Host y Tailscale.
export function crearManejadorHub(dep: Dependencias) {
  // Tope global de intentos de contraseña, además del de cada IP: un proceso local
  // del Mac mini podría falsificar la IP de origen en cada intento.
  const intentosGlobales = crearLimitador(20, 60_000)
  return async (p: PeticionHub): Promise<Respuesta> => {
    const ruta = decodificarRuta(p.url)
    if (ruta === null) return respuesta(404, 'No encontrado')
    const esApi = ruta === '/api' || ruta.startsWith('/api/')

    if (p.metodo === 'POST' && ruta === '/api/alta') {
      if (p.host === undefined || !hostsPermitidos(dep.cfg).has(p.host)) return rechazo('host')
      if (dep.cfg.exigirTailscale && p.tailscaleLogin !== dep.cfg.propietarioTailscale) return rechazo('tailscale')
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
        if (!dep.limitador.permitir(`entrada:${p.ip}`) || !intentosGlobales.permitir('entrada')) {
          return json(429, { error: 'Demasiados intentos, espera un minuto' })
        }
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

    const terminales = /^\/api\/maquinas\/([^/]+)\/terminales$/.exec(ruta)
    if (terminales) {
      if (p.metodo !== 'POST') return respuesta(405, 'Metodo no permitido')
      const maquinaId = terminales[1] ?? ''
      if (!ID_HEX.test(maquinaId)) return json(404, { error: 'No encontrado' })
      const pedido = leerJson(PedidoTerminal, p.cuerpo)
      if (pedido === null) return json(400, { error: 'Petición no válida' })
      const peticion: PeticionSinId = pedido.accion === 'continuar'
        ? { op: 'terminal-crear', accion: 'continuar', agenteId: pedido.agenteId }
        : { op: 'terminal-crear', accion: 'nueva', tipo_agente: pedido.tipo, proyectoId: pedido.proyectoId }
      let terminalId: string | undefined
      const r = await pedirAgente(dep, maquinaId, peticion, (datos) => {
        const resultado = respuestaTerminal(datos)
        if (resultado.estado === 201) terminalId = (datos as { terminal: { id: string } }).terminal.id
        return resultado
      })
      // Quién abrió qué terminal y con qué resultado (§7).
      dep.almacen.auditar('terminal-crear', { maquinaId, ip: p.ip, ...pedido, estado: r.estado, terminalId })
      return r
    }

    const terminal = /^\/api\/maquinas\/([^/]+)\/terminales\/([^/]+)$/.exec(ruta)
    if (terminal) {
      if (p.metodo !== 'DELETE') return respuesta(405, 'Metodo no permitido')
      const [, maquinaId = '', terminalId = ''] = terminal
      if (!ID_HEX.test(maquinaId) || !ID_HEX.test(terminalId)) return json(404, { error: 'No encontrado' })
      const r = await pedirAgente(dep, maquinaId, { op: 'terminal-cerrar', terminalId }, () => respuesta(204, ''))
      dep.almacen.auditar('terminal-cerrar', { maquinaId, terminalId, ip: p.ip, estado: r.estado })
      return r
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
