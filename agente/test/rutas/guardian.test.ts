import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { crearGuardian, RutaProhibida } from '../../src/rutas/guardian.js'

describe('crearGuardian', () => {
  let raiz: string
  let permitida: string
  let fuera: string

  beforeEach(async () => {
    raiz = await mkdtemp(path.join(tmpdir(), 'centro-guardian-'))
    permitida = path.join(raiz, 'permitida')
    fuera = path.join(raiz, 'fuera')
    await mkdir(path.join(permitida, 'a'), { recursive: true })
    await mkdir(fuera)
    await writeFile(path.join(permitida, 'normal.txt'), 'normal')
    await writeFile(path.join(fuera, 'x'), 'fuera')
  })

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true })
  })

  it('devuelve el realpath de un fichero dentro de una ruta permitida', async () => {
    const ruta = path.join(permitida, 'normal.txt')
    const guardian = crearGuardian({ permitidas: [permitida] })

    await expect(guardian.comprobar(ruta)).resolves.toBe(await realpath(ruta))
  })

  it('rechaza un fichero fuera de las rutas permitidas', async () => {
    const guardian = crearGuardian({ permitidas: [permitida] })

    await esperarRutaProhibida(guardian.comprobar(path.join(fuera, 'x')), 'fuera')
  })

  it('rechaza un enlace simbólico que sale de una ruta permitida', async () => {
    const enlace = path.join(permitida, 'enlace')
    await symlink(path.join(fuera, 'x'), enlace)
    const guardian = crearGuardian({ permitidas: [permitida] })

    await esperarRutaProhibida(guardian.comprobar(enlace), 'fuera')
  })

  it('rechaza una ruta con .. que sale de una ruta permitida', async () => {
    const ruta = `${permitida}${path.sep}a${path.sep}..${path.sep}..${path.sep}fuera${path.sep}x`
    const guardian = crearGuardian({ permitidas: [permitida] })

    await esperarRutaProhibida(guardian.comprobar(ruta), 'fuera')
  })

  it.each([
    'auth.json',
    'a.key',
    '.env.local',
    'client_secret_1.json',
    path.join('.claude', 'session-env', 's'),
  ])('rechaza la ruta prohibida %s', async (relativa) => {
    const ruta = path.join(permitida, relativa)
    await mkdir(path.dirname(ruta), { recursive: true })
    await writeFile(ruta, 'secreto')
    const guardian = crearGuardian({ permitidas: [permitida] })

    await esperarRutaProhibida(guardian.comprobar(ruta), 'prohibida')
  })

  it('rechaza una ruta inexistente', async () => {
    const guardian = crearGuardian({ permitidas: [permitida] })

    await esperarRutaProhibida(guardian.comprobar(path.join(permitida, 'no-existe')), 'no-existe')
  })
})

async function esperarRutaProhibida(
  promesa: Promise<string>,
  motivo: RutaProhibida['motivo'],
): Promise<void> {
  try {
    await promesa
    throw new Error('Se esperaba RutaProhibida')
  } catch (error) {
    expect(error).toBeInstanceOf(RutaProhibida)
    expect(error).toMatchObject({ motivo })
  }
}
