import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { leerLineasDesde, ultimasLineas } from '../../src/util/lineas.js'

const temporales: string[] = []

async function crearTemporal(contenido: string): Promise<string> {
  const directorio = await mkdtemp(path.join(tmpdir(), 'centro-lineas-'))
  temporales.push(directorio)
  const ruta = path.join(directorio, 'eventos.jsonl')
  await writeFile(ruta, contenido)
  return ruta
}

async function recogerLineas(
  ruta: string,
  desdeByte = 0,
): Promise<{ linea: string; finByte: number }[]> {
  const resultado: { linea: string; finByte: number }[] = []
  for await (const linea of leerLineasDesde(ruta, desdeByte)) {
    resultado.push(linea)
  }
  return resultado
}

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((directorio) => rm(directorio, { recursive: true })))
})

describe('ultimasLineas', () => {
  it('pagina hacia atras usando antesDeByte', async () => {
    const ruta = await crearTemporal(
      Array.from({ length: 1_000 }, (_, indice) => `l${indice}`).join('\n') + '\n',
    )

    const pagina = await ultimasLineas(ruta, 3)
    expect(pagina.lineas).toEqual(['l997', 'l998', 'l999'])

    const anterior = await ultimasLineas(ruta, 3, pagina.desdeByte)
    expect(anterior.lineas).toEqual(['l994', 'l995', 'l996'])
  })

  it('elimina el retorno de carro de ficheros CRLF', async () => {
    const ruta = await crearTemporal('uno\r\ndos\r\n')

    await expect(ultimasLineas(ruta, 2)).resolves.toMatchObject({ lineas: ['uno', 'dos'] })
  })

  it('ignora la ultima linea si no termina en salto', async () => {
    const ruta = await crearTemporal('{"a":0}\n{"a":1')

    await expect(ultimasLineas(ruta, 2)).resolves.toMatchObject({ lineas: ['{"a":0}'] })
  })
})

describe('leerLineasDesde', () => {
  it('devuelve lineas completas con su offset final', async () => {
    const ruta = await crearTemporal('uno\r\ndos\n')

    expect(await recogerLineas(ruta)).toEqual([
      { linea: 'uno', finByte: 5 },
      { linea: 'dos', finByte: 9 },
    ])
  })

  it('no devuelve una linea a medio escribir', async () => {
    const ruta = await crearTemporal('{"a":0}\n{"a":1')

    expect(await recogerLineas(ruta)).toEqual([{ linea: '{"a":0}', finByte: 8 }])
  })

  it('conserva caracteres UTF-8 multibyte partidos en el borde de un bloque de 64 KiB', async () => {
    const linea = `${'x'.repeat(65_535)}á`
    const ruta = await crearTemporal(`${linea}\nfin\n`)

    expect(await recogerLineas(ruta)).toEqual([
      { linea, finByte: 65_538 },
      { linea: 'fin', finByte: 65_542 },
    ])
  })
})
