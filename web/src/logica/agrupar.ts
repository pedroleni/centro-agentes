import type { Agente, EstadoAgente, Instantanea, Proyecto } from '@centro/compartido'

const DIA_MS = 24 * 60 * 60_000
const ORDEN_ESTADO: Record<EstadoAgente, number> = {
  trabajando: 0,
  esperandote: 1,
  'en-curso': 2,
  interrumpido: 3,
  cerrada: 4,
  terminado: 5,
}

export type TarjetaDatos = {
  proyecto: Proyecto
  agentes: Agente[]
  ultimoPrompt: string | null
  pendientes: number
  activo: boolean
}

export type Grupo = {
  nombre: string
  tarjetas: TarjetaDatos[]
  inactivas: TarjetaDatos[]
}

function compararAgentes(a: Agente, b: Agente): number {
  return ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]
    || b.ultimaActividadMs - a.ultimaActividadMs
}

function contarPendientes(proyecto: Proyecto): number {
  const planes = proyecto.pendientes.filter((pendiente) =>
    pendiente.origen === 'plan'
      && pendiente.hechas !== null
      && pendiente.total !== null
      && pendiente.hechas < pendiente.total,
  ).length
  const tieneHandoff = proyecto.pendientes.some((pendiente) => pendiente.origen === 'handoff')
  return planes + Number(tieneHandoff)
}

function crearTarjeta(proyecto: Proyecto, agentes: Agente[]): TarjetaDatos {
  const agentesDelProyecto = agentes
    .filter((agente) => agente.padreId === null && agente.proyectoIds.includes(proyecto.id))
    .sort(compararAgentes)
  const agenteConPrompt = agentesDelProyecto
    .filter((agente) => agente.ultimoPrompt !== null)
    .sort((a, b) => b.ultimaActividadMs - a.ultimaActividadMs)[0]

  return {
    proyecto,
    agentes: agentesDelProyecto,
    ultimoPrompt: agenteConPrompt?.ultimoPrompt ?? null,
    pendientes: contarPendientes(proyecto),
    activo: agentesDelProyecto.some((agente) =>
      agente.estado === 'trabajando'
        || agente.estado === 'esperandote'
        || agente.estado === 'en-curso',
    ),
  }
}

function compararTarjetas(a: TarjetaDatos, b: TarjetaDatos): number {
  return Number(b.activo) - Number(a.activo)
    || b.proyecto.ultimaActividadMs - a.proyecto.ultimaActividadMs
}

function actividadGrupo(grupo: Grupo): number {
  return Math.max(
    ...grupo.tarjetas.map((tarjeta) => tarjeta.proyecto.ultimaActividadMs),
    ...grupo.inactivas.map((tarjeta) => tarjeta.proyecto.ultimaActividadMs),
  )
}

export function agruparProyectos(
  instantanea: Instantanea,
  ahora: number,
): { grupos: Grupo[]; sinProyecto: Agente[] } {
  const gruposPorNombre = new Map<string, Grupo>()
  const limiteInactivo = ahora - 30 * DIA_MS

  for (const proyecto of instantanea.proyectos) {
    const tarjeta = crearTarjeta(proyecto, instantanea.agentes)
    const grupo = gruposPorNombre.get(proyecto.grupo) ?? {
      nombre: proyecto.grupo,
      tarjetas: [],
      inactivas: [],
    }
    const esInactiva = !tarjeta.activo
      && tarjeta.agentes.length === 0
      && proyecto.ultimaActividadMs < limiteInactivo

    if (esInactiva) {
      grupo.inactivas.push(tarjeta)
    } else {
      grupo.tarjetas.push(tarjeta)
    }
    gruposPorNombre.set(proyecto.grupo, grupo)
  }

  const grupos = [...gruposPorNombre.values()]
  for (const grupo of grupos) {
    grupo.tarjetas.sort(compararTarjetas)
    grupo.inactivas.sort(compararTarjetas)
  }
  grupos.sort((a, b) => actividadGrupo(b) - actividadGrupo(a))

  return {
    grupos,
    sinProyecto: instantanea.agentes.filter(
      (agente) => agente.padreId === null && agente.proyectoIds.length === 0,
    ),
  }
}
