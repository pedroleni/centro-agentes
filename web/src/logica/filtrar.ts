import type { Grupo, TarjetaDatos } from './agrupar.js'

export type FiltroProyectos = 'todos' | 'activos' | 'esperandome' | 'pendientes'

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES')
}

function coincideFiltro(tarjeta: TarjetaDatos, filtro: FiltroProyectos): boolean {
  switch (filtro) {
    case 'activos':
      return tarjeta.activo
    case 'esperandome':
      return tarjeta.agentes.some((agente) => agente.estado === 'esperandote')
    case 'pendientes':
      return tarjeta.pendientes > 0
    case 'todos':
      return true
  }
}

function coincideTexto(tarjeta: TarjetaDatos, texto: string): boolean {
  if (texto === '') {
    return true
  }
  return [
    tarjeta.proyecto.nombre,
    tarjeta.proyecto.git.rama ?? '',
    ...tarjeta.agentes.map((agente) => agente.titulo),
  ].some((valor) => normalizar(valor).includes(texto))
}

export function filtrarGrupos(
  grupos: Grupo[],
  filtro: FiltroProyectos,
  texto: string,
): Grupo[] {
  const textoNormalizado = normalizar(texto.trim())
  return grupos
    .map((grupo) => ({
      nombre: grupo.nombre,
      tarjetas: grupo.tarjetas.filter(
        (tarjeta) => coincideFiltro(tarjeta, filtro) && coincideTexto(tarjeta, textoNormalizado),
      ),
      inactivas: grupo.inactivas.filter(
        (tarjeta) => coincideFiltro(tarjeta, filtro) && coincideTexto(tarjeta, textoNormalizado),
      ),
    }))
    .filter((grupo) => grupo.tarjetas.length > 0 || grupo.inactivas.length > 0)
}
