import { Commit, RespuestaMaquinas } from '@centro/compartido'
import { z } from 'zod'

const TIEMPO_LIMITE_MS = 8_000
// La primera instantánea tras arrancar el agente lee los transcripts enteros y
// puede tardar varios segundos con transcripts de cientos de MB.
const TIEMPO_LIMITE_INSTANTANEA_MS = 30_000
// Más que los 10 s que el hub espera a la máquina, para que llegue su 504.
const TIEMPO_LIMITE_MAQUINA_MS = 15_000

function opcionesPeticion(limiteMs = TIEMPO_LIMITE_MS): RequestInit {
  return { signal: AbortSignal.timeout(limiteMs) }
}

export class ErrorApi extends Error {
  constructor(readonly estado: number) {
    super(`La API respondió con ${estado}`)
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
