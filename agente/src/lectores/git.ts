import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { EstadoGit } from '@centro/compartido'

const execFileAsync = promisify(execFile)
const DIA_MS = 24 * 60 * 60 * 1_000

function estadoVacio(): EstadoGit {
  return {
    rama: null,
    ultimoCommit: null,
    cambios: 0,
    adelante: null,
    atras: null,
    ramas: [],
    actividad14d: Array<number>(14).fill(0),
  }
}

async function git(ruta: string, argumentos: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', ruta, ...argumentos], {
      timeout: 5_000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      encoding: 'utf8',
    })
    return stdout
  } catch {
    return null
  }
}

export async function estadoGit(ruta: string, ahoraMs: number): Promise<EstadoGit> {
  const desdeMs = ahoraMs - 14 * DIA_MS
  const [ramaTexto, commitTexto, estadoTexto, divergenciaTexto, ramasTexto, actividadTexto] =
    await Promise.all([
      git(ruta, ['symbolic-ref', '--short', 'HEAD']),
      git(ruta, ['log', '-1', '--format=%h%x00%s%x00%ct']),
      git(ruta, ['status', '--porcelain=v1', '-z']),
      git(ruta, ['rev-list', '--left-right', '--count', '@{u}...HEAD']),
      git(ruta, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
      git(ruta, ['log', `--since=${new Date(desdeMs).toISOString()}`, '--format=%ct']),
    ])

  if (
    ramaTexto === null &&
    commitTexto === null &&
    estadoTexto === null &&
    divergenciaTexto === null &&
    ramasTexto === null &&
    actividadTexto === null
  ) {
    return estadoVacio()
  }

  const estado = estadoVacio()
  estado.rama = ramaTexto?.trim() || null

  if (commitTexto !== null && commitTexto.length > 0) {
    const [hash, mensaje, fechaSegundos] = commitTexto.split('\0')
    const fecha = Number(fechaSegundos?.trim())
    if (hash !== undefined && mensaje !== undefined && Number.isFinite(fecha)) {
      estado.ultimoCommit = { hash, mensaje, fechaMs: fecha * 1_000 }
    }
  }

  if (estadoTexto !== null) {
    estado.cambios = estadoTexto
      .split('\0')
      .filter((entrada) => /^[ MADRCU?!]{2} /.test(entrada)).length
  }

  if (divergenciaTexto !== null) {
    const [atras, adelante] = divergenciaTexto.trim().split(/\s+/).map(Number)
    if (Number.isInteger(atras) && Number.isInteger(adelante)) {
      estado.atras = atras ?? null
      estado.adelante = adelante ?? null
    }
  }

  if (ramasTexto !== null) {
    estado.ramas = ramasTexto
      .split(/\r?\n/)
      .map((rama) => rama.trim())
      .filter(Boolean)
  }

  if (actividadTexto !== null) {
    for (const linea of actividadTexto.split(/\r?\n/)) {
      const fechaMs = Number(linea) * 1_000
      if (!Number.isFinite(fechaMs)) continue
      const diasAtras = Math.floor((ahoraMs - fechaMs) / DIA_MS)
      const indice = 13 - diasAtras
      if (indice >= 0 && indice < 14) {
        estado.actividad14d[indice] = (estado.actividad14d[indice] ?? 0) + 1
      }
    }
  }

  return estado
}
