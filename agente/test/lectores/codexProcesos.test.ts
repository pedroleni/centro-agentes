import { describe, expect, it, vi } from 'vitest'
import {
  hilosAbiertos,
  procesosCodex,
  type ProcesoCodex,
} from '../../src/lectores/codexProcesos.js'
import type { HiloCodex } from '../../src/lectores/codexHilos.js'

describe('procesosCodex', () => {
  it('detecta procesos macOS, descarta falsos positivos y consulta sus cwd', async () => {
    const salidaPs = [
      ' 101 Sun Oct 19 08:15:30 2026 /opt/homebrew/bin/codex',
      ' 202 Sun Oct 19 08:16:30 2026 node /opt/codex/bin/codex.js exec tarea',
      ' 303 Sun Oct 19 08:17:30 2026 grep codex',
    ].join('\n')
    const ejecutar = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'ps') return salidaPs
      if (cmd === 'lsof' && args.at(-2) === '101') return 'p101\nfcwd\nn/Proyectos IA/Uno\n'
      if (cmd === 'lsof' && args.at(-2) === '202') return 'p202\nfcwd\nn/Proyectos IA/Dos\n'
      return ''
    })

    await expect(procesosCodex('macos', ejecutar)).resolves.toEqual([
      {
        pid: 101,
        cwd: '/Proyectos IA/Uno',
        inicioMs: Date.parse('Sun Oct 19 08:15:30 2026'),
        interactivo: true,
      },
      {
        pid: 202,
        cwd: '/Proyectos IA/Dos',
        inicioMs: Date.parse('Sun Oct 19 08:16:30 2026'),
        interactivo: false,
      },
    ])
    expect(ejecutar).toHaveBeenCalledWith('ps', ['-axo', 'pid=,lstart=,command='])
  })

  it('lee los procesos de PowerShell con cwd desconocido', async () => {
    const ejecutar = vi.fn(async () =>
      JSON.stringify([
        {
          ProcessId: 404,
          CreationDate: '2026-10-19T08:20:00.000Z',
          CommandLine: 'codex resume hilo',
        },
        {
          ProcessId: 505,
          CreationDate: '2026-10-19T08:21:00.000Z',
          CommandLine: 'codex exec tarea',
        },
      ]),
    )

    await expect(procesosCodex('windows', ejecutar)).resolves.toEqual([
      {
        pid: 404,
        cwd: null,
        inicioMs: Date.parse('2026-10-19T08:20:00.000Z'),
        interactivo: true,
      },
      {
        pid: 505,
        cwd: null,
        inicioMs: Date.parse('2026-10-19T08:21:00.000Z'),
        interactivo: false,
      },
    ])
    expect(ejecutar).toHaveBeenCalledWith('powershell', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'codex' } | Select ProcessId,CreationDate,CommandLine | ConvertTo-Json",
    ])
  })
})

function hilo(
  id: string,
  cwd: string,
  actualizadoMs: number,
  source = 'cli',
): HiloCodex {
  return {
    id,
    titulo: id,
    cwd,
    modelo: null,
    esfuerzo: null,
    tokens: 0,
    rama: null,
    source,
    creadoMs: 0,
    actualizadoMs,
    rollout: `${id}.jsonl`,
    padreId: null,
  }
}

describe('hilosAbiertos', () => {
  it('marca solo el hilo interactivo mas reciente del cwd y nunca uno exec', () => {
    const hilos = [
      hilo('antiguo', '/repo', 2_000),
      hilo('reciente', '/repo', 4_000),
      hilo('tarea-exec', '/repo', 5_000, 'exec'),
      hilo('otro', '/otro', 4_500),
    ]
    const procesos: ProcesoCodex[] = [
      { pid: 1, cwd: '/repo', inicioMs: 1_000, interactivo: true },
      { pid: 2, cwd: '/otro', inicioMs: 1_000, interactivo: false },
    ]

    expect(hilosAbiertos(hilos, procesos)).toEqual(new Set(['reciente']))
  })

  it('sin cwd marca todos los hilos interactivos recientes', () => {
    const hilos = [
      hilo('uno', '/repo-1', 4_000),
      hilo('dos', '/repo-2', 5_000),
      hilo('viejo', '/repo-3', 500),
      hilo('exec', '/repo-4', 6_000, 'exec'),
    ]
    const procesos: ProcesoCodex[] = [
      { pid: 1, cwd: null, inicioMs: 1_000, interactivo: true },
    ]

    expect(hilosAbiertos(hilos, procesos)).toEqual(new Set(['uno', 'dos']))
  })
  it('un proceso con cwd en la raíz (app-server de VS Code) cuenta como cwd desconocido', () => {
    const hilos = [hilo('uno', '/repo-a', 5_000), hilo('dos', '/repo-b', 6_000), hilo('viejo', '/repo-a', 500)]
    const procesos: ProcesoCodex[] = [{ pid: 1, cwd: '/', inicioMs: 1_000, interactivo: true }]

    expect(hilosAbiertos(hilos, procesos)).toEqual(new Set(['uno', 'dos']))
  })
})
