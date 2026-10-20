import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { diagnosticar } from '../src/diagnostico.js'
import { rutasBase } from '../src/rutas/base.js'

const temporales: string[] = []

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((ruta) => rm(ruta, { recursive: true, force: true })))
})

async function crearHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'centro-diagnostico-'))
  temporales.push(home)
  await Promise.all([
    mkdir(path.join(home, '.claude', 'projects', 'a'), { recursive: true }),
    mkdir(path.join(home, '.claude', 'projects', 'b'), { recursive: true }),
    mkdir(path.join(home, '.claude', 'sessions'), { recursive: true }),
    mkdir(path.join(home, '.codex', 'sessions'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(path.join(home, '.claude', 'sessions', '1.json'), '{}'),
    writeFile(path.join(home, '.codex', 'state_5.sqlite'), ''),
    writeFile(path.join(home, '.codex', 'auth.json'), 'SECRETO-NO'),
  ])
  return home
}

describe('diagnosticar', () => {
  it('cuenta lo que hay sin leer secretos', async () => {
    const home = await crearHome()
    const resultado = await diagnosticar({
      so: 'macos',
      rutas: rutasBase('macos', home, {}),
      raices: [path.join(home, 'Desktop')],
      ejecutar: async () => Promise.reject(new Error('no está instalado')),
      probarTerminal: async () => ({ disponible: true, detalle: null }),
      version: 'v22.12.0',
    })

    expect(resultado.claude).toEqual({ existe: true, proyectos: 2, sesionesVivas: 1 })
    expect(resultado.codex).toEqual({ existe: true, baseDeDatos: 'state_5.sqlite', rollouts: true })
    expect(resultado.git).toBeNull()
    expect(resultado.terminales).toEqual({ tipo: 'tmux', disponible: false, detalle: null })
    expect(resultado.raices).toEqual([{ ruta: path.join(home, 'Desktop'), existe: false }])
    expect(JSON.stringify(resultado)).not.toContain('SECRETO-NO')
  })

  it('usa ConPTY en Windows y conserva el resultado de cargar node-pty', async () => {
    const ejecutar = vi.fn(async () => 'git version 2.51.0\n')
    const resultado = await diagnosticar({
      so: 'windows',
      rutas: rutasBase('windows', 'C:\\Users\\pedro', {}),
      raices: [],
      ejecutar,
      probarTerminal: async () => { throw new Error('ConPTY no disponible') },
      version: 'v22.12.0',
    })

    expect(resultado.terminales).toEqual({ tipo: 'conpty', disponible: false, detalle: null })
    expect(ejecutar).toHaveBeenCalledWith('git', ['--version'])
    expect(resultado.git).toBe('git version 2.51.0')
    expect(ejecutar).not.toHaveBeenCalledWith('tmux', ['-V'])
  })

  it('comprueba tmux en macOS y elige la base de Codex con N mayor', async () => {
    const home = await crearHome()
    await writeFile(path.join(home, '.codex', 'state_12.sqlite'), '')
    const ejecutar = vi.fn(async (cmd: string) => cmd === 'tmux' ? 'tmux 3.5' : 'git version 2.51.0')

    const resultado = await diagnosticar({
      so: 'macos',
      rutas: rutasBase('macos', home, {}),
      raices: [],
      ejecutar,
      probarTerminal: async () => { throw new Error('ConPTY no disponible') },
      version: 'v22.12.0',
    })

    expect(resultado.codex.baseDeDatos).toBe('state_12.sqlite')
    expect(resultado.terminales).toEqual({ tipo: 'tmux', disponible: true, detalle: null })
    expect(ejecutar).toHaveBeenCalledWith('tmux', ['-V'])
  })

  it('en Windows prueba ConPTY de verdad y cuenta dónde están claude y codex', async () => {
    const resultado = await diagnosticar({
      so: 'windows',
      rutas: rutasBase('windows', 'C:\\Users\\pedro', {}),
      raices: [],
      ejecutar: async () => 'git version 2.51.0',
      probarTerminal: async () => ({ disponible: true, detalle: 'C:\\nvm\\claude.cmd\nRemoteSigned' }),
      version: 'v22.12.0',
    })
    expect(resultado.terminales).toEqual({ tipo: 'conpty', disponible: true, detalle: 'C:\\nvm\\claude.cmd\nRemoteSigned' })
  })
})
