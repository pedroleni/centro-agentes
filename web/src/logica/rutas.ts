import type { MaquinaVista } from '@centro/compartido'

// Rutas del front. Las nuevas llevan la máquina (#/m/<mid>/…); las antiguas
// (#/proyecto/<pid>, #/agente/<aid>) siguen valiendo y se resuelven buscando qué
// máquina tiene ese proyecto o ese agente.

export type Ruta =
  | { vista: 'general' }
  | { vista: 'terminal'; maquinaId: string; terminalId: string }
  | { vista: 'proyecto'; maquinaId: string | null; proyectoId: string }
  | { vista: 'agente'; maquinaId: string | null; agenteId: string }

export function rutaProyecto(maquinaId: string | null, proyectoId: string): string {
  return maquinaId === null ? `#/proyecto/${proyectoId}` : `#/m/${encodeURIComponent(maquinaId)}/proyecto/${proyectoId}`
}

export function rutaAgente(maquinaId: string | null, agenteId: string): string {
  const agente = encodeURIComponent(agenteId)
  return maquinaId === null ? `#/agente/${agente}` : `#/m/${encodeURIComponent(maquinaId)}/agente/${agente}`
}

export function rutaTerminal(maquinaId: string, terminalId: string): string {
  return `#/m/${encodeURIComponent(maquinaId)}/terminal/${terminalId}`
}

export function leerRuta(hash: string): Ruta {
  const terminal = /^#\/m\/([^/]+)\/terminal\/([0-9a-f]{12})$/.exec(hash)
  if (terminal !== null) {
    try {
      return { vista: 'terminal', maquinaId: decodeURIComponent(terminal[1] ?? ''), terminalId: terminal[2] ?? '' }
    } catch {
      return { vista: 'general' }
    }
  }
  const coincidencia = /^#(?:\/m\/([^/]+))?\/(proyecto|agente)\/([^/]+)$/.exec(hash)
  if (coincidencia === null) return { vista: 'general' }
  try {
    const maquinaId = coincidencia[1] === undefined ? null : decodeURIComponent(coincidencia[1])
    const id = decodeURIComponent(coincidencia[3] ?? '')
    return coincidencia[2] === 'proyecto'
      ? { vista: 'proyecto', maquinaId, proyectoId: id }
      : { vista: 'agente', maquinaId, agenteId: id }
  } catch {
    return { vista: 'general' }
  }
}

export function maquinaDeRuta(ruta: Ruta, maquinas: MaquinaVista[]): MaquinaVista | null {
  if (ruta.vista === 'general') return null
  if (ruta.vista === 'terminal') return maquinas.find((maquina) => maquina.id === ruta.maquinaId) ?? null
  if (ruta.maquinaId !== null) return maquinas.find((maquina) => maquina.id === ruta.maquinaId) ?? null
  return maquinas.find((maquina) => (
    ruta.vista === 'proyecto'
      ? maquina.instantanea?.proyectos.some((proyecto) => proyecto.id === ruta.proyectoId)
      : maquina.instantanea?.agentes.some((agente) => agente.id === ruta.agenteId)
  )) ?? null
}
