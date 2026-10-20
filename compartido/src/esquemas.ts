import { z } from 'zod'

export const SO = z.enum(['macos', 'windows', 'linux'])
export type SO = z.infer<typeof SO>

const UltimoCommit = z.object({
  hash: z.string(),
  mensaje: z.string(),
  fechaMs: z.number(),
})

export const EstadoGit = z.object({
  rama: z.string().nullable(),
  ultimoCommit: UltimoCommit.nullable(),
  cambios: z.number().int(),
  adelante: z.number().int().nullable(),
  atras: z.number().int().nullable(),
  ramas: z.array(z.string()),
  actividad14d: z.array(z.number().int()).length(14),
})
export type EstadoGit = z.infer<typeof EstadoGit>

export const Pendiente = z.object({
  origen: z.enum(['plan', 'handoff', 'sesion']),
  titulo: z.string(),
  fechaMs: z.number().nullable(),
  hechas: z.number().int().nullable(),
  total: z.number().int().nullable(),
  quizaDesactualizado: z.boolean(),
})
export type Pendiente = z.infer<typeof Pendiente>

export const Proyecto = z.object({
  id: z.string(),
  nombre: z.string(),
  ruta: z.string(),
  grupo: z.string(),
  git: EstadoGit,
  pendientes: z.array(Pendiente),
  ultimaActividadMs: z.number(),
})
export type Proyecto = z.infer<typeof Proyecto>

export const EstadoAgente = z.enum([
  'trabajando',
  'esperandote',
  'cerrada',
  'en-curso',
  'terminado',
  'interrumpido',
])
export type EstadoAgente = z.infer<typeof EstadoAgente>

export const TareaSesion = z.object({
  texto: z.string(),
  estado: z.enum(['pendiente', 'en-curso', 'hecha']),
})
export type TareaSesion = z.infer<typeof TareaSesion>

export const Commit = z.object({
  hash: z.string(),
  mensaje: z.string(),
  fechaMs: z.number(),
  autor: z.string(),
})
export type Commit = z.infer<typeof Commit>

export const Agente = z.object({
  id: z.string(),
  tipo: z.enum(['claude', 'codex']),
  modo: z.enum(['interactivo', 'tarea']),
  titulo: z.string(),
  cwd: z.string(),
  proyectoIds: z.array(z.string()),
  estado: EstadoAgente,
  modelo: z.string().nullable(),
  esfuerzo: z.string().nullable(),
  contexto: z.object({ usados: z.number(), ventana: z.number().nullable() }).nullable(),
  tokensTotales: z.number().nullable(),
  ultimoPrompt: z.string().nullable(),
  rama: z.string().nullable(),
  pr: z.object({ numero: z.number(), url: z.string() }).nullable(),
  inicioMs: z.number().nullable(),
  ultimaActividadMs: z.number(),
  padreId: z.string().nullable(),
  entrada: z.string().nullable(),
  puedeContinuar: z.boolean(),
  tareas: z.array(TareaSesion),
  commitsMs: z.array(z.number()),
})
export type Agente = z.infer<typeof Agente>

export const Maquina = z.object({
  id: z.string(),
  nombre: z.string(),
  so: SO,
  avisos: z.array(z.enum(['sin-claude', 'sin-codex'])),
})
export type Maquina = z.infer<typeof Maquina>

export const Instantanea = z.object({
  version: z.literal(1),
  maquina: Maquina,
  generadaMs: z.number(),
  proyectos: z.array(Proyecto),
  agentes: z.array(Agente),
})
export type Instantanea = z.infer<typeof Instantanea>
