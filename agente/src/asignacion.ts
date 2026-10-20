import path from 'node:path'
import type { ProyectoBase } from './lectores/proyectos.js'

function contiene(ruta: string, base: string): boolean {
  const relativa = path.relative(base, ruta)
  return relativa === '' || (!relativa.startsWith('..') && !path.isAbsolute(relativa))
}

export function asignarProyectos(
  cwd: string,
  ficherosEditados: string[],
  proyectos: ProyectoBase[],
): string[] {
  const proyectoCwd = proyectos
    .filter((proyecto) => contiene(cwd, proyecto.ruta))
    .sort((a, b) => b.ruta.length - a.ruta.length)[0]
  if (proyectoCwd !== undefined) return [proyectoCwd.id]

  const asignados: string[] = []
  for (const fichero of ficherosEditados) {
    const proyecto = proyectos
      .filter((candidato) => contiene(fichero, candidato.ruta))
      .sort((a, b) => b.ruta.length - a.ruta.length)[0]
    if (proyecto !== undefined && !asignados.includes(proyecto.id)) {
      asignados.push(proyecto.id)
    }
  }
  return asignados
}
