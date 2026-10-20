import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export type SesionViva = {
  pid: number
  sessionId: string
  cwd: string
  nombre: string
  status: 'idle' | 'busy'
  entrada: string
  inicioMs: number
  actualizadaMs: number
  vivo: boolean
}

type LeerTexto = (ruta: string) => Promise<string>

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null
}

function aFechaMs(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor
  if (typeof valor !== 'string') return null
  const fechaMs = Date.parse(valor)
  return Number.isNaN(fechaMs) ? null : fechaMs
}

function convertirSesion(
  valor: unknown,
  pidVivo: (pid: number) => boolean,
): SesionViva | null {
  if (!esRegistro(valor)) return null

  const { pid, sessionId, cwd, name, status, entrypoint, startedAt, updatedAt } = valor
  if (
    typeof pid !== 'number' ||
    !Number.isFinite(pid) ||
    typeof sessionId !== 'string'
  ) {
    return null
  }

  return {
    pid,
    sessionId,
    cwd: typeof cwd === 'string' ? cwd : '',
    nombre: typeof name === 'string' ? name : sessionId,
    status: status === 'busy' ? 'busy' : 'idle',
    entrada: typeof entrypoint === 'string' ? entrypoint : 'desconocida',
    inicioMs: aFechaMs(startedAt) ?? 0,
    actualizadaMs: aFechaMs(updatedAt) ?? 0,
    vivo: pidVivo(pid),
  }
}

export async function leerSesionesVivas(
  dir: string,
  pidVivo: (pid: number) => boolean,
  leer: LeerTexto = async (ruta) => readFile(ruta, 'utf8'),
): Promise<SesionViva[]> {
  let nombres: string[]
  try {
    nombres = await readdir(dir)
  } catch {
    return []
  }

  const sesiones: SesionViva[] = []
  for (const nombre of nombres.sort()) {
    if (path.extname(nombre) !== '.json') continue

    let valor: unknown
    try {
      valor = JSON.parse(await leer(path.join(dir, nombre))) as unknown
    } catch {
      continue
    }

    const sesion = convertirSesion(valor, pidVivo)
    if (sesion !== null) sesiones.push(sesion)
  }
  return sesiones
}
