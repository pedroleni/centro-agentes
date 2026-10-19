import path from 'node:path'
import type { SO } from '@centro/compartido'
import type { HiloCodex } from './codexHilos.js'

export type ProcesoCodex = {
  pid: number
  cwd: string | null
  inicioMs: number
  interactivo: boolean
}

type Ejecutar = (cmd: string, args: string[]) => Promise<string>

const COMANDO_POWERSHELL =
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'codex' } | Select ProcessId,CreationDate,CommandLine | ConvertTo-Json"

function argumentosComando(comando: string): string[] {
  return comando.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((parte) =>
    parte.replace(/^(['"])(.*)\1$/, '$2'),
  ) ?? []
}

function esComandoCodex(argumentos: string[]): boolean {
  const ejecutable = argumentos[0]
  if (ejecutable === undefined) return false
  if (path.posix.basename(ejecutable) === 'codex') return true
  const primerArgumento = argumentos[1]
  return primerArgumento !== undefined && /(?:^|[/\\])codex\.js$/.test(primerArgumento)
}

function esInteractivo(argumentos: string[]): boolean {
  return !argumentos.slice(1).includes('exec')
}

async function cwdProceso(pid: number, ejecutar: Ejecutar): Promise<string | null> {
  try {
    const salida = await ejecutar('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'])
    const linea = salida.split(/\r?\n/).find((valor) => valor.startsWith('n'))
    return linea === undefined || linea.length === 1 ? null : linea.slice(1)
  } catch {
    return null
  }
}

async function procesosMacos(ejecutar: Ejecutar): Promise<ProcesoCodex[]> {
  const salida = await ejecutar('ps', ['-axo', 'pid=,lstart=,command='])
  const procesos: ProcesoCodex[] = []
  const patron = /^\s*(\d+)\s+((?:\S+\s+){4}\d{4})\s+(.+)$/

  for (const linea of salida.split(/\r?\n/)) {
    const coincidencia = patron.exec(linea)
    if (coincidencia === null) continue
    const pid = Number(coincidencia[1])
    const inicioMs = Date.parse(coincidencia[2] ?? '')
    const argumentos = argumentosComando(coincidencia[3] ?? '')
    if (!Number.isInteger(pid) || !Number.isFinite(inicioMs) || !esComandoCodex(argumentos)) continue

    procesos.push({
      pid,
      cwd: await cwdProceso(pid, ejecutar),
      inicioMs,
      interactivo: esInteractivo(argumentos),
    })
  }
  return procesos
}

function fechaWindows(valor: unknown): number | null {
  if (typeof valor !== 'string') return null
  const fechaJson = /^\/?Date\((\d+)(?:[+-]\d+)?\)\/?$/.exec(valor)
  if (fechaJson !== null) {
    const fechaMs = Number(fechaJson[1])
    return Number.isFinite(fechaMs) ? fechaMs : null
  }
  const directa = Date.parse(valor)
  if (!Number.isNaN(directa)) return directa

  const wmi = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.\d+([+-])(\d{3})$/.exec(valor)
  if (wmi === null) return null
  const [, ano, mes, dia, hora, minuto, segundo, signo, desplazamiento] = wmi
  const utc = Date.UTC(
    Number(ano),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo),
  )
  const minutos = Number(desplazamiento)
  return utc - (signo === '+' ? minutos : -minutos) * 60_000
}

async function procesosWindows(ejecutar: Ejecutar): Promise<ProcesoCodex[]> {
  const salida = await ejecutar('powershell', ['-NoProfile', '-Command', COMANDO_POWERSHELL])
  let valor: unknown
  try {
    valor = JSON.parse(salida) as unknown
  } catch {
    return []
  }

  const filas = Array.isArray(valor) ? valor : [valor]
  const procesos: ProcesoCodex[] = []
  for (const fila of filas) {
    if (!fila || typeof fila !== 'object') continue
    const registro = fila as Record<string, unknown>
    const pid = registro.ProcessId
    const inicioMs = fechaWindows(registro.CreationDate)
    const comando = registro.CommandLine
    if (typeof pid !== 'number' || inicioMs === null || typeof comando !== 'string') continue
    procesos.push({
      pid,
      cwd: null,
      inicioMs,
      interactivo: esInteractivo(argumentosComando(comando)),
    })
  }
  return procesos
}

export async function procesosCodex(so: SO, ejecutar: Ejecutar): Promise<ProcesoCodex[]> {
  if (so === 'windows') return procesosWindows(ejecutar)
  if (so === 'macos') return procesosMacos(ejecutar)
  return []
}

export function hilosAbiertos(hilos: HiloCodex[], procesos: ProcesoCodex[]): Set<string> {
  const abiertos = new Set<string>()

  for (const proceso of procesos) {
    if (!proceso.interactivo) continue
    const recientes = hilos.filter(
      (hilo) => hilo.source !== 'exec' && hilo.actualizadoMs >= proceso.inicioMs,
    )
    // El app-server de Codex en VS Code atiende varios hilos y corre con cwd en
    // la raíz del disco: sin un cwd útil, se marcan todos los hilos recientes
    // para no ofrecer "continuar" una sesión que puede seguir abierta.
    if (proceso.cwd === null || cwdDesconocido(proceso.cwd)) {
      for (const hilo of recientes) abiertos.add(hilo.id)
      continue
    }

    let masReciente: HiloCodex | null = null
    for (const hilo of recientes) {
      if (hilo.cwd !== proceso.cwd) continue
      if (masReciente === null || hilo.actualizadoMs > masReciente.actualizadoMs) {
        masReciente = hilo
      }
    }
    if (masReciente !== null) abiertos.add(masReciente.id)
  }

  return abiertos
}

function cwdDesconocido(cwd: string): boolean {
  return path.parse(cwd).root === cwd || path.win32.parse(cwd).root === cwd
}
