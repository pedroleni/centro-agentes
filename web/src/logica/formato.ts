import type { Agente, EstadoAgente } from '@centro/compartido'

const MINUTO_MS = 60_000
const HORA_MS = 60 * MINUTO_MS
const DIA_MS = 24 * HORA_MS

const ETIQUETAS_ESTADO: Record<EstadoAgente, string> = {
  trabajando: 'Trabajando',
  esperandote: 'Esperándote',
  cerrada: 'Cerrada',
  'en-curso': 'En curso',
  terminado: 'Terminado',
  interrumpido: 'Interrumpido',
}

export function etiquetaEstado(estado: EstadoAgente): string {
  return ETIQUETAS_ESTADO[estado]
}

export function porcentajeContexto(agente: Agente): number | null {
  if (agente.contexto?.ventana == null) {
    return null
  }
  return Math.round(100 * agente.contexto.usados / agente.contexto.ventana)
}

export function nombreModelo(modelo: string | null): string {
  if (modelo === null) {
    return ''
  }

  const coincidencia = /^claude-(opus|sonnet|haiku|fable)-(\d+)-(\d+)(?:-\d{8})?(?:\[[^\]]+\])?$/.exec(modelo)
  if (coincidencia === null) {
    return modelo
  }

  const familia = coincidencia[1]
  const mayor = coincidencia[2]
  const menor = coincidencia[3]
  if (familia === undefined || mayor === undefined || menor === undefined) {
    return modelo
  }
  return `${familia[0]?.toUpperCase()}${familia.slice(1)} ${mayor}.${menor}`
}

export function duracionCorta(ms: number): string {
  const duracion = Math.max(0, ms)
  if (duracion < MINUTO_MS) {
    return `${Math.floor(duracion / 1_000)} s`
  }
  if (duracion < HORA_MS) {
    return `${Math.floor(duracion / MINUTO_MS)} min`
  }
  if (duracion < DIA_MS) {
    const horas = Math.floor(duracion / HORA_MS)
    const minutos = Math.floor((duracion % HORA_MS) / MINUTO_MS)
    return minutos === 0 ? `${horas} h` : `${horas} h ${minutos} min`
  }
  return `${Math.floor(duracion / DIA_MS)} d`
}

function inicioDelDia(ms: number): number {
  const fecha = new Date(ms)
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime()
}

export function fechaCorta(ms: number): string {
  const fecha = new Date(ms)
  const dia = new Intl.DateTimeFormat('es-ES', { day: 'numeric' }).format(fecha)
  const mes = new Intl.DateTimeFormat('es-ES', { month: 'short' })
    .format(fecha)
    .replaceAll('.', '')
    .slice(0, 3)
  return `${dia} ${mes}`
}

export function fechaRelativa(ms: number, ahora: number): string {
  const transcurrido = Math.max(0, ahora - ms)
  if (transcurrido < MINUTO_MS) {
    return 'ahora'
  }
  if (transcurrido < HORA_MS) {
    return `hace ${Math.floor(transcurrido / MINUTO_MS)} min`
  }

  const diaActual = inicioDelDia(ahora)
  const diaFecha = inicioDelDia(ms)
  if (diaFecha === diaActual) {
    return `hace ${Math.floor(transcurrido / HORA_MS)} h`
  }

  const fechaAyer = new Date(diaActual)
  fechaAyer.setDate(fechaAyer.getDate() - 1)
  if (diaFecha === fechaAyer.getTime()) {
    return 'ayer'
  }

  return fechaCorta(ms)
}

export function tiempoAgente(agente: Agente, ahora: number): string {
  const activo = agente.estado === 'trabajando'
    || agente.estado === 'esperandote'
    || agente.estado === 'en-curso'

  if (!activo) {
    return fechaRelativa(agente.ultimaActividadMs, ahora)
  }

  if (agente.inicioMs !== null && ahora - agente.inicioMs < 48 * HORA_MS) {
    return duracionCorta(ahora - agente.inicioMs)
  }

  return `desde ${fechaCorta(agente.inicioMs ?? agente.ultimaActividadMs)}`
}
