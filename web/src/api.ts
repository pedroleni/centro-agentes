import { Commit, RespuestaMaquinas, TerminalInfo } from '@centro/compartido'
import { z } from 'zod'
import { clavePanel } from './logica/clavePanel.js'

const TIEMPO_LIMITE_MS = 8_000
// La primera instantánea tras arrancar el agente lee los transcripts enteros y
// puede tardar varios segundos con transcripts de cientos de MB.
const TIEMPO_LIMITE_INSTANTANEA_MS = 30_000
// Más que los 10 s que el hub espera a la máquina, para que llegue su 504.
const TIEMPO_LIMITE_MAQUINA_MS = 15_000

// En el panel local, crear y cerrar terminales exige su clave.
function cabecerasTerminal(): Record<string, string> {
  const clave = clavePanel()
  return clave === null ? {} : { 'X-Clave-Panel': clave }
}

function opcionesPeticion(limiteMs = TIEMPO_LIMITE_MS): RequestInit {
  return { signal: AbortSignal.timeout(limiteMs) }
}

export class ErrorApi extends Error {
  constructor(readonly estado: number, mensaje?: string) {
    super(mensaje ?? `La API respondió con ${estado}`)
  }
}

async function obtenerJson(respuesta: Response): Promise<unknown> {
  if (!respuesta.ok) {
    throw new ErrorApi(respuesta.status)
  }
  return respuesta.json()
}

const EventoLinea = z.object({
  fechaMs: z.number(),
  tipo: z.enum([
    'usuario',
    'asistente',
    'comando',
    'edicion',
    'lectura',
    'busqueda',
    'subagente',
    'pregunta',
    'otro',
  ]),
  texto: z.string(),
  detalle: z.string().nullable(),
})

const ResultadoLinea = z.object({
  eventos: z.array(EventoLinea),
  antes: z.number().nullable(),
})

export type EventoLinea = z.infer<typeof EventoLinea>
export type ResultadoLinea = z.infer<typeof ResultadoLinea>

// --- API común al panel local y al hub (/api/maquinas…) ---

export async function obtenerMaquinas(): Promise<RespuestaMaquinas> {
  const respuesta = await fetch('/api/maquinas', opcionesPeticion(TIEMPO_LIMITE_INSTANTANEA_MS))
  return RespuestaMaquinas.parse(await obtenerJson(respuesta))
}

export async function obtenerCommitsDe(maquinaId: string, proyectoId: string): Promise<Commit[]> {
  const respuesta = await fetch(
    `/api/maquinas/${encodeURIComponent(maquinaId)}/proyectos/${encodeURIComponent(proyectoId)}/commits`,
    opcionesPeticion(TIEMPO_LIMITE_MAQUINA_MS),
  )
  return z.object({ commits: z.array(Commit) }).parse(await obtenerJson(respuesta)).commits
}

export async function obtenerLineaDe(maquinaId: string, agenteId: string, antes: number | null): Promise<ResultadoLinea> {
  const parametros = antes === null ? '' : `?antes=${antes}`
  const respuesta = await fetch(
    `/api/maquinas/${encodeURIComponent(maquinaId)}/agentes/${encodeURIComponent(agenteId)}/linea${parametros}`,
    opcionesPeticion(TIEMPO_LIMITE_MAQUINA_MS),
  )
  return ResultadoLinea.parse(await obtenerJson(respuesta))
}

export async function entrar(contrasena: string): Promise<void> {
  const respuesta = await fetch('/api/sesion', {
    ...opcionesPeticion(),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contrasena }),
  })
  if (!respuesta.ok) throw new ErrorApi(respuesta.status)
}

export async function crearCodigoAlta(): Promise<{ codigo: string; caducaMs: number }> {
  const respuesta = await fetch('/api/maquinas/codigos', { ...opcionesPeticion(), method: 'POST' })
  return z.object({ codigo: z.string(), caducaMs: z.number() }).parse(await obtenerJson(respuesta))
}

export async function revocarMaquina(maquinaId: string): Promise<void> {
  const respuesta = await fetch(`/api/maquinas/${encodeURIComponent(maquinaId)}`, { ...opcionesPeticion(), method: 'DELETE' })
  if (!respuesta.ok) throw new ErrorApi(respuesta.status)
}

export type PedidoTerminal =
  | { accion: 'continuar'; agenteId: string }
  | { accion: 'nueva'; tipo: 'claude' | 'codex'; proyectoId: string }

// Títulos de los terminales creados desde esta pestaña: la instantánea que los
// lista puede tardar unos segundos en llegar (el hub la recibe cada 5 s).
const titulos = new Map<string, string>()

export function tituloReciente(terminalId: string): string | null {
  return titulos.get(terminalId) ?? null
}

// Crea un terminal en una máquina y devuelve sus datos. Los errores llevan el
// mensaje del servidor (p. ej. "Esta sesión sigue abierta en otro sitio").
export async function crearTerminal(maquinaId: string, pedido: PedidoTerminal): Promise<TerminalInfo> {
  const respuesta = await fetch(`/api/maquinas/${encodeURIComponent(maquinaId)}/terminales`, {
    ...opcionesPeticion(TIEMPO_LIMITE_MAQUINA_MS),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecerasTerminal() },
    body: JSON.stringify(pedido),
  })
  if (!respuesta.ok) {
    const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string }
    throw new ErrorApi(respuesta.status, cuerpo.error)
  }
  const terminal = TerminalInfo.parse(await respuesta.json())
  titulos.set(terminal.id, terminal.titulo)
  return terminal
}

export async function cerrarTerminal(maquinaId: string, terminalId: string): Promise<void> {
  const respuesta = await fetch(`/api/maquinas/${encodeURIComponent(maquinaId)}/terminales/${terminalId}`, {
    ...opcionesPeticion(),
    method: 'DELETE',
    headers: cabecerasTerminal(),
  })
  if (!respuesta.ok) throw new ErrorApi(respuesta.status)
}
