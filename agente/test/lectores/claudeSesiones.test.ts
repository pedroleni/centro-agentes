import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { leerSesionesVivas } from '../../src/lectores/claudeSesiones.js'

const temporales: string[] = []

async function crearDirectorioTemporal(): Promise<string> {
  const directorio = await mkdtemp(path.join(tmpdir(), 'centro-claude-sesiones-'))
  temporales.push(directorio)
  return directorio
}

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((directorio) => rm(directorio, { recursive: true })))
})

describe('leerSesionesVivas', () => {
  it('lee solo los JSON validos, traduce sus campos y comprueba si el pid sigue vivo', async () => {
    const directorio = await crearDirectorioTemporal()
    await writeFile(
      path.join(directorio, '101.json'),
      JSON.stringify({
        pid: 101,
        sessionId: 'sesion-cli',
        cwd: '/proyecto uno',
        name: 'Claude CLI',
        status: 'busy',
        entrypoint: 'cli',
        startedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
      }),
    )
    await writeFile(
      path.join(directorio, '202.json'),
      JSON.stringify({
        pid: 202,
        sessionId: 'sesion-vscode',
        cwd: '/proyecto dos',
        name: 'Claude VS Code',
        status: 'idle',
        entrypoint: 'claude-vscode',
        startedAt: 1_700_000_002_000,
        updatedAt: 1_700_000_003_000,
      }),
    )
    await writeFile(path.join(directorio, '303.json'), '{invalido')
    await writeFile(path.join(directorio, 'credencial.key'), 'no debe leerse')

    const pidVivo = vi.fn((pid: number) => pid === 101)
    const leer = vi.fn(async (ruta: string) => readFile(ruta, 'utf8'))

    await expect(leerSesionesVivas(directorio, pidVivo, leer)).resolves.toEqual([
      {
        pid: 101,
        sessionId: 'sesion-cli',
        cwd: '/proyecto uno',
        nombre: 'Claude CLI',
        status: 'busy',
        entrada: 'cli',
        inicioMs: 1_700_000_000_000,
        actualizadaMs: 1_700_000_001_000,
        vivo: true,
      },
      {
        pid: 202,
        sessionId: 'sesion-vscode',
        cwd: '/proyecto dos',
        nombre: 'Claude VS Code',
        status: 'idle',
        entrada: 'claude-vscode',
        inicioMs: 1_700_000_002_000,
        actualizadaMs: 1_700_000_003_000,
        vivo: false,
      },
    ])
    expect(pidVivo).toHaveBeenCalledTimes(2)
    expect(leer).toHaveBeenCalledTimes(3)
    expect(leer.mock.calls.every(([ruta]) => !ruta.endsWith('.key'))).toBe(true)
  })
})
