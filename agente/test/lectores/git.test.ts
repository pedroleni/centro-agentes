import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test } from 'vitest'
import { estadoGit } from '../../src/lectores/git.js'
import { crearRepo, ejecutarGit } from '../ayudas/repo.js'

const execFileAsync = promisify(execFile)
const temporales: string[] = []
const DIA_MS = 24 * 60 * 60 * 1_000
const AHORA = Date.UTC(2026, 9, 19, 12)

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((ruta) => rm(ruta, { recursive: true, force: true })))
})

async function temporal(): Promise<string> {
  const ruta = await mkdtemp(path.join(os.tmpdir(), 'centro-git-'))
  temporales.push(ruta)
  return ruta
}

describe('estadoGit', () => {
  test('lee rama, cambios, último commit y actividad de los últimos catorce días', async () => {
    const repo = path.join(await temporal(), 'Grupo X', 'Año ñ')
    await crearRepo(repo, [
      { mensaje: 'Hace dos días', fechaMs: AHORA - 2 * DIA_MS },
      { mensaje: 'Commit de hoy', fechaMs: AHORA },
    ])
    const versionado = path.join(repo, 'commit-0.txt')
    await writeFile(versionado, `${await readFile(versionado, 'utf8')}modificado\n`)
    await writeFile(path.join(repo, 'sin seguimiento.txt'), 'nuevo\n')

    const estado = await estadoGit(repo, AHORA)

    expect(estado.rama).toBe('main')
    expect(estado.cambios).toBe(2)
    expect(estado.ultimoCommit?.mensaje).toBe('Commit de hoy')
    expect(estado.actividad14d[13]).toBe(1)
    expect(estado.actividad14d[11]).toBe(1)
    expect(estado.adelante).toBeNull()
    expect(estado.atras).toBeNull()
  })

  test('enumera las ramas locales', async () => {
    const repo = path.join(await temporal(), 'repo')
    await crearRepo(repo, [{ mensaje: 'Inicial', fechaMs: AHORA }])
    await ejecutarGit(repo, ['branch', 'otra'])

    expect((await estadoGit(repo, AHORA)).ramas).toEqual(['main', 'otra'])
  })

  test('calcula un commit local por delante del upstream de un clon bare', async () => {
    const base = await temporal()
    const origenTrabajo = path.join(base, 'origen-trabajo')
    const bare = path.join(base, 'origen.git')
    const clon = path.join(base, 'clon')
    await crearRepo(origenTrabajo, [{ mensaje: 'Inicial remoto', fechaMs: AHORA - DIA_MS }])
    await execFileAsync('git', ['init', '--bare', '-b', 'main', bare], {
      timeout: 5_000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })
    await ejecutarGit(origenTrabajo, ['remote', 'add', 'origin', bare])
    await ejecutarGit(origenTrabajo, ['push', '-u', 'origin', 'main'])
    await execFileAsync('git', ['clone', bare, clon], {
      timeout: 5_000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })
    await ejecutarGit(clon, ['config', 'user.name', 'Pruebas Centro'])
    await ejecutarGit(clon, ['config', 'user.email', 'pruebas@centro.invalid'])
    await writeFile(path.join(clon, 'local.txt'), 'local\n')
    await ejecutarGit(clon, ['add', 'local.txt'])
    const fecha = new Date(AHORA).toISOString()
    await execFileAsync('git', ['commit', '-m', 'Solo local'], {
      cwd: clon,
      timeout: 5_000,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_AUTHOR_DATE: fecha,
        GIT_COMMITTER_DATE: fecha,
      },
    })

    expect(await estadoGit(clon, AHORA)).toMatchObject({ adelante: 1, atras: 0 })
  })

  test('tolera un repositorio recién creado sin commits', async () => {
    const repo = path.join(await temporal(), 'vacio')
    await crearRepo(repo, [])

    const estado = await estadoGit(repo, AHORA)

    expect(estado.ultimoCommit).toBeNull()
    expect(estado.actividad14d).toEqual(Array<number>(14).fill(0))
  })

  test('devuelve valores vacíos para una ruta inexistente sin lanzar', async () => {
    const inexistente = path.join(await temporal(), 'borrada')

    await expect(estadoGit(inexistente, AHORA)).resolves.toEqual({
      rama: null,
      ultimoCommit: null,
      cambios: 0,
      adelante: null,
      atras: null,
      ramas: [],
      actividad14d: Array<number>(14).fill(0),
    })
  })
})
