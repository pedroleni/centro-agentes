import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { SO } from '@centro/compartido'
import type { RutasBase } from './rutas/base.js'

export type Diagnostico = {
  so: SO
  node: string
  claude: { existe: boolean; proyectos: number; sesionesVivas: number }
  codex: { existe: boolean; baseDeDatos: string | null; rollouts: boolean }
  git: string | null
  terminales: { tipo: 'tmux' | 'conpty'; disponible: boolean }
  raices: { ruta: string; existe: boolean }[]
}

type DependenciasDiagnostico = {
  so: SO
  rutas: RutasBase
  raices: string[]
  ejecutar(cmd: string, args: string[]): Promise<string>
  cargarPty(): boolean
  version: string
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta)
    return true
  } catch {
    return false
  }
}

async function contarEntradas(ruta: string): Promise<number> {
  try {
    return (await readdir(ruta)).length
  } catch {
    return 0
  }
}

async function listarEntradas(ruta: string): Promise<string[]> {
  try {
    return await readdir(ruta)
  } catch {
    return []
  }
}

async function intentarEjecutar(
  ejecutar: DependenciasDiagnostico['ejecutar'],
  cmd: string,
  args: string[],
): Promise<string | null> {
  try {
    return await ejecutar(cmd, args)
  } catch {
    return null
  }
}

function baseDeDatosMasReciente(entradas: string[]): string | null {
  let elegida: { nombre: string; numero: number } | null = null
  for (const nombre of entradas) {
    const coincidencia = /^state_(\d+)\.sqlite$/.exec(nombre)
    if (coincidencia === null) continue
    const numero = Number(coincidencia[1])
    if (elegida === null || numero > elegida.numero) elegida = { nombre, numero }
  }
  return elegida?.nombre ?? null
}

export async function diagnosticar(dep: DependenciasDiagnostico): Promise<Diagnostico> {
  const moduloPath = dep.so === 'windows' ? path.win32 : path
  const rutaProyectosClaude = moduloPath.join(dep.rutas.claude, 'projects')
  const rutaSesionesClaude = moduloPath.join(dep.rutas.claude, 'sessions')
  const rutaRolloutsCodex = moduloPath.join(dep.rutas.codex, 'sessions')

  const [
    claudeExiste,
    proyectos,
    sesionesVivas,
    codexExiste,
    entradasCodex,
    rollouts,
    git,
    raices,
  ] = await Promise.all([
    existe(dep.rutas.claude),
    contarEntradas(rutaProyectosClaude),
    contarEntradas(rutaSesionesClaude),
    existe(dep.rutas.codex),
    listarEntradas(dep.rutas.codex),
    existe(rutaRolloutsCodex),
    intentarEjecutar(dep.ejecutar, 'git', ['--version']),
    Promise.all(dep.raices.map(async (ruta) => ({ ruta, existe: await existe(ruta) }))),
  ])

  const terminales: Diagnostico['terminales'] = dep.so === 'windows'
    ? { tipo: 'conpty', disponible: dep.cargarPty() }
    : {
        tipo: 'tmux',
        disponible: await intentarEjecutar(dep.ejecutar, 'tmux', ['-V']) !== null,
      }

  return {
    so: dep.so,
    node: dep.version,
    claude: { existe: claudeExiste, proyectos, sesionesVivas },
    codex: {
      existe: codexExiste,
      baseDeDatos: baseDeDatosMasReciente(entradasCodex),
      rollouts,
    },
    git: git === null ? null : git.trim(),
    terminales,
    raices,
  }
}
