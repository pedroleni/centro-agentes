import { open } from 'node:fs/promises'

const TAMANO_BLOQUE = 64 * 1_024

function decodificarLinea(bytes: Buffer): string {
  const fin = bytes.at(-1) === 0x0d ? bytes.length - 1 : bytes.length
  return bytes.toString('utf8', 0, fin)
}

export async function* leerLineasDesde(
  ruta: string,
  desdeByte: number,
): AsyncGenerator<{ linea: string; finByte: number }> {
  const fichero = await open(ruta, 'r')
  const bloque = Buffer.allocUnsafe(TAMANO_BLOQUE)
  const fragmentos: Buffer[] = []
  let posicion = Math.max(0, desdeByte)

  try {
    while (true) {
      const { bytesRead } = await fichero.read(bloque, 0, bloque.length, posicion)
      if (bytesRead === 0) return

      let inicio = 0
      for (let indice = 0; indice < bytesRead; indice += 1) {
        if (bloque[indice] !== 0x0a) continue

        const ultimoFragmento = bloque.subarray(inicio, indice)
        const bytesLinea =
          fragmentos.length === 0
            ? ultimoFragmento
            : Buffer.concat([...fragmentos, ultimoFragmento])
        fragmentos.length = 0

        yield {
          linea: decodificarLinea(bytesLinea),
          finByte: posicion + indice + 1,
        }
        inicio = indice + 1
      }

      if (inicio < bytesRead) {
        fragmentos.push(Buffer.from(bloque.subarray(inicio, bytesRead)))
      }
      posicion += bytesRead
    }
  } finally {
    await fichero.close()
  }
}

export async function ultimasLineas(
  ruta: string,
  n: number,
  antesDeByte?: number,
  maximoBytes = Number.POSITIVE_INFINITY,
): Promise<{ lineas: string[]; desdeByte: number }> {
  const fichero = await open(ruta, 'r')

  try {
    const { size } = await fichero.stat()
    const limite = Math.min(size, Math.max(0, antesDeByte ?? size))
    if (n <= 0 || limite === 0) return { lineas: [], desdeByte: limite }

    const bloques: Buffer[] = []
    let inicioLeido = limite
    let saltos = 0

    // Se para al tener n líneas o, si las líneas son enormes, al pasar de
    // `maximoBytes`, pero siempre con al menos una línea completa para avanzar.
    while (
      inicioLeido > 0 &&
      saltos < n + 1 &&
      !(limite - inicioLeido >= maximoBytes && saltos >= 2)
    ) {
      const longitud = Math.min(TAMANO_BLOQUE, inicioLeido)
      const posicion = inicioLeido - longitud
      const bloque = Buffer.allocUnsafe(longitud)
      const { bytesRead } = await fichero.read(bloque, 0, longitud, posicion)
      if (bytesRead === 0) break

      const leido = bloque.subarray(0, bytesRead)
      bloques.unshift(Buffer.from(leido))
      for (const byte of leido) {
        if (byte === 0x0a) saltos += 1
      }
      inicioLeido = posicion
    }

    const contenido = Buffer.concat(bloques)
    const completas: { linea: string; desdeByte: number }[] = []
    let inicioLinea = 0

    for (let indice = 0; indice < contenido.length; indice += 1) {
      if (contenido[indice] !== 0x0a) continue

      if (inicioLeido === 0 || inicioLinea > 0) {
        completas.push({
          linea: decodificarLinea(contenido.subarray(inicioLinea, indice)),
          desdeByte: inicioLeido + inicioLinea,
        })
      }
      inicioLinea = indice + 1
    }

    const seleccionadas = completas.slice(-n)
    return {
      lineas: seleccionadas.map(({ linea }) => linea),
      desdeByte: seleccionadas[0]?.desdeByte ?? limite,
    }
  } finally {
    await fichero.close()
  }
}
