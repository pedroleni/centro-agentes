import { z } from 'zod'
import { Instantanea, Maquina, SO } from './esquemas.js'

// Mensajes entre el agente de cada máquina y el hub. El hub solo puede pedir estas
// dos operaciones de lectura: el agente nunca ejecuta nada por encargo del hub.

export const LIMITE_MENSAJE_BYTES = 8 * 1024 * 1024
// 64 KiB de datos de terminal por mensaje, en base64.
const LIMITE_DATOS_TERMINAL_B64 = Math.ceil((64 * 1024) / 3) * 4
const ID_TERMINAL = z.string().regex(/^[0-9a-f]{12}$/)
const CANAL = z.string().min(1).max(64)
const COLUMNAS = z.number().int().min(20).max(400)
const FILAS = z.number().int().min(5).max(120)
const BASE64 = z.string().max(LIMITE_DATOS_TERMINAL_B64).regex(/^[A-Za-z0-9+/]*={0,2}$/)

export const MensajeAgente = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('hola'), maquina: Maquina, version: z.literal(1) }),
  z.object({ tipo: z.literal('instantanea'), instantanea: Instantanea }),
  z.object({ tipo: z.literal('terminal-salida'), canal: z.string().min(1).max(64), datos: z.string().max(LIMITE_DATOS_TERMINAL_B64) }),
  z.object({ tipo: z.literal('terminal-fin'), canal: z.string().min(1).max(64), motivo: z.string().max(200) }),
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

const PeticionTerminalContinuar = z.object({
  tipo: z.literal('peticion'),
  id: z.string().min(1),
  op: z.literal('terminal-crear'),
  accion: z.literal('continuar'),
  agenteId: z.string().min(1).max(200),
})

const PeticionTerminalNueva = z.object({
  tipo: z.literal('peticion'),
  id: z.string().min(1),
  op: z.literal('terminal-crear'),
  accion: z.literal('nueva'),
  // `tipo` ya distingue los mensajes del protocolo; por eso este campo se llama así.
  tipo_agente: z.enum(['claude', 'codex']),
  proyectoId: z.string().min(1).max(64),
})

const PeticionTerminalCerrar = z.object({
  tipo: z.literal('peticion'),
  id: z.string().min(1),
  op: z.literal('terminal-cerrar'),
  terminalId: ID_TERMINAL,
})

export const Peticion = z.union([PeticionCommits, PeticionLinea, PeticionTerminalContinuar, PeticionTerminalNueva, PeticionTerminalCerrar])
export type Peticion = z.infer<typeof Peticion>

export const MensajeHub = z.union([
  Peticion,
  z.object({ tipo: z.literal('adios'), motivo: z.string() }),
  z.object({ tipo: z.literal('terminal-adjuntar'), canal: CANAL, terminalId: ID_TERMINAL, cols: COLUMNAS, rows: FILAS }),
  z.object({ tipo: z.literal('terminal-entrada'), canal: CANAL, datos: BASE64 }),
  z.object({ tipo: z.literal('terminal-tamano'), canal: CANAL, cols: COLUMNAS, rows: FILAS }),
  z.object({ tipo: z.literal('terminal-soltar'), canal: CANAL }),
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
