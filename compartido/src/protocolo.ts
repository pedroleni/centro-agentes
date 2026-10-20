import { z } from 'zod'
import { Instantanea, Maquina, SO } from './esquemas.js'

// Mensajes entre el agente de cada máquina y el hub. El hub solo puede pedir estas
// dos operaciones de lectura: el agente nunca ejecuta nada por encargo del hub.

export const LIMITE_MENSAJE_BYTES = 8 * 1024 * 1024

export const MensajeAgente = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('hola'), maquina: Maquina, version: z.literal(1) }),
  z.object({ tipo: z.literal('instantanea'), instantanea: Instantanea }),
  z.object({
    tipo: z.literal('respuesta'),
    id: z.string().min(1),
    ok: z.boolean(),
    datos: z.unknown().optional(),
    error: z.string().optional(),
  }),
])
export type MensajeAgente = z.infer<typeof MensajeAgente>

const PeticionCommits = z.object({
  tipo: z.literal('peticion'),
  id: z.string().min(1),
  op: z.literal('commits'),
  proyectoId: z.string().min(1),
})

const PeticionLinea = z.object({
  tipo: z.literal('peticion'),
  id: z.string().min(1),
  op: z.literal('linea'),
  agenteId: z.string().min(1),
  antes: z.number().int().nonnegative().nullable(),
})

export const Peticion = z.discriminatedUnion('op', [PeticionCommits, PeticionLinea])
export type Peticion = z.infer<typeof Peticion>

export const MensajeHub = z.union([
  Peticion,
  z.object({ tipo: z.literal('adios'), motivo: z.string() }),
])
export type MensajeHub = z.infer<typeof MensajeHub>

export const MaquinaVista = z.object({
  id: z.string(),
  nombre: z.string(),
  so: SO,
  conectada: z.boolean(),
  ultimoLatidoMs: z.number().nullable(),
  instantanea: Instantanea.nullable(),
})
export type MaquinaVista = z.infer<typeof MaquinaVista>

export const RespuestaMaquinas = z.object({
  modo: z.enum(['local', 'hub']),
  maquinas: z.array(MaquinaVista),
})
export type RespuestaMaquinas = z.infer<typeof RespuestaMaquinas>
