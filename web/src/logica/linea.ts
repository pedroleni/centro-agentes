import type { ResultadoLinea } from '../api.js'

// Fusiona una página nueva de la línea de tiempo con la que ya se ve. Con la misma
// clave (fecha y texto) gana el evento nuevo: un comando llega primero sin salida y
// después con ella, y lo que interesa ver es la última versión.
export function fusionarLinea(
  anterior: ResultadoLinea,
  nueva: ResultadoLinea,
  conservarAntes: boolean,
): ResultadoLinea {
  const porClave = new Map<string, ResultadoLinea['eventos'][number]>()
  for (const evento of [...anterior.eventos, ...nueva.eventos]) {
    porClave.set(`${evento.fechaMs}\u0000${evento.texto}`, evento)
  }
  return {
    eventos: [...porClave.values()].sort((a, b) => a.fechaMs - b.fechaMs),
    antes: conservarAntes ? anterior.antes : nueva.antes,
  }
}
