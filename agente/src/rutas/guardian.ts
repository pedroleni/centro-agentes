import { realpath } from 'node:fs/promises'
import path from 'node:path'

export class RutaProhibida extends Error {
  constructor(public readonly motivo: 'fuera' | 'prohibida' | 'no-existe') {
    super(`Ruta rechazada: ${motivo}`)
    this.name = 'RutaProhibida'
  }
}

export function crearGuardian(opts: { permitidas: string[] }): {
  comprobar(ruta: string): Promise<string>
} {
  const permitidasReales = Promise.all(opts.permitidas.map((permitida) => resolverRuta(permitida)))

  return {
    async comprobar(ruta: string): Promise<string> {
      const rutaReal = await resolverRuta(ruta)
      const dentro = (await permitidasReales).some((permitida) => estaDentro(rutaReal, permitida))

      if (!dentro) {
        throw new RutaProhibida('fuera')
      }
      if (esProhibida(rutaReal)) {
        throw new RutaProhibida('prohibida')
      }

      return rutaReal
    },
  }
}

async function resolverRuta(ruta: string): Promise<string> {
  try {
    return await realpath(ruta)
  } catch {
    throw new RutaProhibida('no-existe')
  }
}

function estaDentro(ruta: string, permitida: string): boolean {
  const relativa = path.relative(permitida, ruta)
  return relativa === '' || (!relativa.startsWith('..') && !path.isAbsolute(relativa))
}

function esProhibida(ruta: string): boolean {
  const nombre = path.basename(ruta).toLowerCase()
  if (
    nombre === 'auth.json' ||
    nombre.endsWith('.key') ||
    nombre.startsWith('.env') ||
    nombre.startsWith('client_secret')
  ) {
    return true
  }

  const partes = path.normalize(ruta).toLowerCase().split(path.sep)
  return partes.some((parte, indice) => parte === '.claude' && partes[indice + 1] === 'session-env')
}
