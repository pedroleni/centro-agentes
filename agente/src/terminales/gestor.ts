import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import type { TerminalInfo } from '@centro/compartido'
import type { OrdenTerminal } from './ordenes.js'

// Terminales del panel: cada uno es una sesión de tmux `ca-<12 hex>` creada con una
// orden cerrada (ver ordenes.ts). Sus datos viven como opciones de la propia sesión
// de tmux, así sobreviven a un reinicio del agente. Para verlo, el agente se
// engancha con un pty (`tmux attach-session`) y reenvía los bytes.

export type PtyMinimo = {
  write(datos: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(alDatos: (datos: string) => void): void
  onExit(alSalir: (evento: { exitCode: number }) => void): void
}

export type EjecutorTmux = (args: string[]) => Promise<string>
export type AbrirPty = (argv: string[], opciones: { cols: number; rows: number; env: NodeJS.ProcessEnv }) => PtyMinimo

export type Enganche = {
  escribir(datos: string): void
  redimensionar(cols: number, rows: number): void
  soltar(): void
}

const ID = /^[0-9a-f]{12}$/
const FORMATO = '#{session_name}\t#{session_created}\t#{@ca_titulo}\t#{@ca_tipo}\t#{@ca_agente}\t#{@ca_proyecto}'

function acotar(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, Math.round(Number.isFinite(valor) ? valor : minimo)))
}

function sesion(id: string): string {
  if (!ID.test(id)) throw new Error('Terminal no válido')
  return `ca-${id}`
}

function limpio(texto: string): string {
  return texto.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 200)
}

export function crearGestorTerminales(dep: {
  tmux: EjecutorTmux
  abrirPty: AbrirPty
  ahora?: () => number
  maximo?: number
}) {
  const ahora = dep.ahora ?? Date.now
  const maximo = dep.maximo ?? 6

  async function listar(): Promise<TerminalInfo[]> {
    // Sin servidor de tmux (ningún terminal abierto), list-sessions falla: lista vacía.
    const salida = await dep.tmux(['list-sessions', '-F', FORMATO]).catch(() => '')
    const terminales: TerminalInfo[] = []
    for (const linea of salida.split('\n')) {
      const [nombre = '', creado = '0', titulo = '', tipo = '', agente = '', proyecto = ''] = linea.split('\t')
      const id = nombre.startsWith('ca-') ? nombre.slice(3) : ''
      if (!ID.test(id)) continue
      terminales.push({
        id,
        titulo: titulo || 'Terminal',
        tipo: tipo === 'codex' ? 'codex' : 'claude',
        agenteId: agente || null,
        proyectoId: proyecto || null,
        creadoMs: Number(creado) * 1_000,
      })
    }
    return terminales
  }

  return {
    listar,

    async crear(orden: OrdenTerminal): Promise<TerminalInfo> {
      if ((await listar()).length >= maximo) throw new Error(`Ya hay ${maximo} terminales abiertos en esta máquina`)
      const id = randomBytes(6).toString('hex')
      const nombre = sesion(id)
      await dep.tmux(['new-session', '-d', '-s', nombre, '-c', orden.cwd, '-x', '120', '-y', '32', '--', ...orden.argv])
      const opciones: [string, string][] = [
        ['window-size', 'latest'],
        ['status', 'off'],
        ['@ca_titulo', limpio(orden.titulo)],
        ['@ca_tipo', orden.tipo],
        ['@ca_agente', orden.agenteId ?? ''],
        ['@ca_proyecto', orden.proyectoId ?? ''],
      ]
      for (const [clave, valor] of opciones) await dep.tmux(['set-option', '-t', nombre, clave, valor])
      return {
        id,
        titulo: limpio(orden.titulo),
        tipo: orden.tipo,
        agenteId: orden.agenteId,
        proyectoId: orden.proyectoId,
        creadoMs: ahora(),
      }
    },

    adjuntar(
      id: string,
      tamano: { cols: number; rows: number },
      alDatos: (datos: string) => void,
      alSalir: () => void,
    ): Enganche {
      const nombre = sesion(id)
      const pty = dep.abrirPty(['tmux', 'attach-session', '-t', nombre], {
        cols: acotar(tamano.cols, 20, 400),
        rows: acotar(tamano.rows, 5, 120),
        env: { ...process.env, TERM: 'xterm-256color' },
      })
      pty.onData(alDatos)
      pty.onExit(() => alSalir())
      return {
        escribir: (datos) => pty.write(datos),
        redimensionar: (cols, rows) => pty.resize(acotar(cols, 20, 400), acotar(rows, 5, 120)),
        soltar: () => pty.kill(),
      }
    },

    async cerrar(id: string): Promise<void> {
      await dep.tmux(['kill-session', '-t', sesion(id)])
    },
  }
}

export type GestorTerminales = ReturnType<typeof crearGestorTerminales>

const execFileAsync = promisify(execFile)

export function crearGestorTerminalesReal(): GestorTerminales {
  return crearGestorTerminales({
    tmux: async (args) => (await execFileAsync('tmux', args, { timeout: 5_000, encoding: 'utf8' })).stdout,
    abrirPty: (argv, opciones) => {
      // node-pty es nativo: se carga solo cuando hace falta un terminal.
      const pty = createRequire(import.meta.url)('node-pty') as typeof import('node-pty')
      const proceso = pty.spawn(argv[0] ?? 'tmux', argv.slice(1), {
        name: 'xterm-256color',
        cols: opciones.cols,
        rows: opciones.rows,
        cwd: homedir(),
        env: opciones.env as Record<string, string>,
      })
      return {
        write: (datos) => proceso.write(datos),
        resize: (cols, rows) => proceso.resize(cols, rows),
        kill: () => proceso.kill(),
        onData: (alDatos) => { proceso.onData(alDatos) },
        onExit: (alSalir) => { proceso.onExit(alSalir) },
      }
    },
  })
}
