import type { Fuente, ResultadoLinea } from '../linea.js'

type Dependencias = {
  obtenerInstantanea(): Promise<{ agentes: { id: string }[] }>
  obtenerFuente(agenteId: string): Fuente | null
  leer(fuente: Fuente, antes: number | null): Promise<ResultadoLinea>
}

// Resuelve la línea de tiempo de un agente:
// - espera a la instantánea, para no competir con la primera construcción del registro;
// - un agente vivo sin fichero propio (p. ej. una sesión sin transcript todavía)
//   tiene una línea vacía, no "no disponible";
// - null solo cuando el agente no está en la instantánea.
export function crearObtenerLinea(dep: Dependencias) {
  return async (agenteId: string, antes: number | null): Promise<ResultadoLinea | null> => {
    const instantanea = await dep.obtenerInstantanea()
    const fuente = dep.obtenerFuente(agenteId)
    if (fuente !== null) return dep.leer(fuente, antes)
    return instantanea.agentes.some((agente) => agente.id === agenteId)
      ? { eventos: [], antes: null }
      : null
  }
}
