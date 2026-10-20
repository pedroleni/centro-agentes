import { appendFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { crearLectorIncremental } from '../../src/util/incremental.js'

type Estado = { n: number; ultimoX: number | null }

const temporales: string[] = []

async function crearTemporal(contenido: string): Promise<string> {
  const directorio = await mkdtemp(path.join(tmpdir(), 'centro-incremental-'))
  temporales.push(directorio)
  const ruta = path.join(directorio, 'eventos.jsonl')
  await writeFile(ruta, contenido)
  return ruta
}

function crearLector() {
  return crearLectorIncremental<Estado>(
    () => ({ n: 0, ultimoX: null }),
    (estado, objeto) => {
      if (typeof objeto !== 'object' || objeto === null || !('x' in objeto)) return
      const x = (objeto as { x?: unknown }).x
      if (typeof x !== 'number') return
      estado.n += 1
      estado.ultimoX = x
    },
  )
}

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((directorio) => rm(directorio, { recursive: true })))
})

describe('crearLectorIncremental', () => {
  it('procesa la primera lectura y despues solo los bytes añadidos', async () => {
    const ruta = await crearTemporal('{"x":1}\n{"x":2}\n{"x":3}\n')
    const lector = crearLector()

    await expect(lector.leer(ruta)).resolves.toEqual({ n: 3, ultimoX: 3 })

    const anadido = '{"x":4}\n{"x":5}\n'
    await appendFile(ruta, anadido)
    await expect(lector.leer(ruta)).resolves.toEqual({ n: 5, ultimoX: 5 })
    expect(lector.bytesUltimaLectura(ruta)).toBe(Buffer.byteLength(anadido))
  })

  it('ignora una linea con JSON invalido sin lanzar', async () => {
    const ruta = await crearTemporal('{"x":1}\nno json\n{"x":2}\n')
    const lector = crearLector()

    await expect(lector.leer(ruta)).resolves.toEqual({ n: 2, ultimoX: 2 })
  })

  it('empieza de cero cuando el fichero se ha truncado', async () => {
    const ruta = await crearTemporal('{"x":1}\n{"x":2}\n{"x":3}\n')
    const lector = crearLector()
    await lector.leer(ruta)

    await writeFile(ruta, '{"x":9}\n')

    await expect(lector.leer(ruta)).resolves.toEqual({ n: 1, ultimoX: 9 })
    expect(lector.bytesUltimaLectura(ruta)).toBe((await stat(ruta)).size)
  })

  it('espera a que una linea a medio escribir se complete', async () => {
    const ruta = await crearTemporal('{"x":1}\n{"x":2')
    const lector = crearLector()

    await expect(lector.leer(ruta)).resolves.toEqual({ n: 1, ultimoX: 1 })

    await appendFile(ruta, '}\n')

    await expect(lector.leer(ruta)).resolves.toEqual({ n: 2, ultimoX: 2 })
  })
})
