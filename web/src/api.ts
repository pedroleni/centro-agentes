import { Commit, Instantanea } from '@centro/compartido'
import { z } from 'zod'

const TIEMPO_LIMITE_MS = 8_000

function opcionesPeticion(): RequestInit {
  return { signal: AbortSignal.timeout(TIEMPO_LIMITE_MS) }
}

async function obtenerJson(respuesta: Response): Promise<unknown> {
  if (!respuesta.ok) {
    throw new Error(`La API respondió con ${respuesta.status}`)
  }
  return respuesta.json()
}

export async function obtenerInstantanea(): Promise<Instantanea> {
  const respuesta = await fetch('/api/instantanea', opcionesPeticion())
  return Instantanea.parse(await obtenerJson(respuesta))
}

export async function obtenerCommits(id: string): Promise<Commit[]> {
  const respuesta = await fetch(
    `/api/proyectos/${encodeURIComponent(id)}/commits`,
    opcionesPeticion(),
  )
  const cuerpo = await obtenerJson(respuesta)
  return Commit.array().parse(
    typeof cuerpo === 'object' && cuerpo !== null && 'commits' in cuerpo
      ? cuerpo.commits
      : cuerpo,
  )
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

export async function obtenerLinea(id: string, antes: number | null): Promise<ResultadoLinea> {
  const parametros = antes === null ? '' : `?antes=${antes}`
  const respuesta = await fetch(
    `/api/agentes/${encodeURIComponent(id)}/linea${parametros}`,
    opcionesPeticion(),
  )
  return ResultadoLinea.parse(await obtenerJson(respuesta))
}
