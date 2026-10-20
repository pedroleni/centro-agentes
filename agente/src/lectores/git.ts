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

// La configuración de un repo puede ejecutar programas (fsmonitor, gpg al
// mostrar firmas, filtros clean/process de .gitattributes). Un repo descargado
// en una de las carpetas escaneadas no debe poder ejecutar nada aquí, así que
// todas las llamadas los anulan con -c, que manda sobre la config del repo.
const CONFIG_SEGURA = [
  '-c', 'core.fsmonitor=false',
  '-c', 'log.showSignature=false',
  '-c', 'core.hooksPath=/dev/null',
]

async function git(
  ruta: string,
  argumentos: string[],
  extra: string[] = [],
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [...CONFIG_SEGURA, ...extra, '-C', ruta, ...argumentos], {
      timeout: 5_000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      encoding: 'utf8',
    })
    return stdout
  } catch {
    return null
  }
}

// Leer la config no ejecuta nada. Con ella se anula cada filtro definido, para
// que `git status` no pase el contenido de los ficheros por programas del repo.
async function filtrosAnulados(ruta: string): Promise<string[]> {
  const salida = await git(ruta, ['config', '-z', '--name-only', '--get-regexp', '^filter\\.'])
  const nombres = new Set<string>()
  for (const clave of (salida ?? '').split('\0')) {
    const encontrado = /^filter\.(.+)\.[^.]+$/.exec(clave)
    if (encontrado?.[1]) nombres.add(encontrado[1])
  }
  return [...nombres].flatMap((nombre) => [
    '-c', `filter.${nombre}.clean=`,
    '-c', `filter.${nombre}.smudge=`,
    '-c', `filter.${nombre}.process=`,
    '-c', `filter.${nombre}.required=false`,
  ])
}

export async function estadoGit(ruta: string, ahoraMs: number): Promise<EstadoGit> {
  const desdeMs = ahoraMs - 14 * DIA_MS
  const sinFiltros = await filtrosAnulados(ruta)
  const [ramaTexto, commitTexto, estadoTexto, divergenciaTexto, ramasTexto, actividadTexto] =
    await Promise.all([
      git(ruta, ['symbolic-ref', '--short', 'HEAD']),
      git(ruta, ['log', '--no-show-signature', '-1', '--format=%h%x00%s%x00%ct']),
      git(ruta, ['status', '--ignore-submodules=all', '--porcelain=v1', '-z'], sinFiltros),
      git(ruta, ['rev-list', '--left-right', '--count', '@{u}...HEAD']),
      git(ruta, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
      git(ruta, [
        'log',
        '--no-show-signature',
        `--since=${new Date(desdeMs).toISOString()}`,
        '--format=%ct',
      ]),
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
