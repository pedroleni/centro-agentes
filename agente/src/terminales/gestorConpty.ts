import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import type { TerminalInfo } from '@centro/compartido'
import { acotar, entornoTerminal, limpio, sinFallo, type Enganche, type GestorTerminales, type PtyMinimo } from './gestor.js'
import type { OrdenTerminal } from './ordenes.js'

// Terminales del panel en Windows: sin tmux, cada uno es un proceso en ConPTY
// que vive mientras viva el agente (§5.2), en un registro en memoria (§6.4).
// Como no hay tmux que repinte la pantalla al volver a entrar, se guarda la
// salida reciente y se reenvía a cada navegador que se engancha.

export type AbrirPtyConpty = (
  argv: string[],
  opciones: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv },
) => PtyMinimo

type EngancheConpty = {
  alDatos: (datos: string) => void
  alSalir: () => void
}

type TerminalConpty = {
  info: TerminalInfo
  pty: PtyMinimo
  salida: string[]
  bytesSalida: number
  enganches: Set<EngancheConpty>
}

const ID = /^[0-9a-f]{12}$/

function comprobarId(id: string): void {
  if (!ID.test(id)) throw new Error('Terminal no válido')
}

function sufijoUtf8(texto: string, maximo: number): string {
  if (maximo <= 0) return ''
  let bytes = 0
  const caracteres = Array.from(texto)
  let indice = caracteres.length
  while (indice > 0) {
    const caracter = caracteres[indice - 1]!
    const bytesCaracter = Buffer.byteLength(caracter, 'utf8')
    if (bytes + bytesCaracter > maximo) break
    bytes += bytesCaracter
    indice -= 1
  }
  return caracteres.slice(indice).join('')
}

function guardarSalida(terminal: TerminalConpty, datos: string, memoria: number): void {
  if (memoria <= 0) {
    terminal.salida = []
    terminal.bytesSalida = 0
    return
  }
  terminal.salida.push(datos)
  terminal.bytesSalida += Buffer.byteLength(datos, 'utf8')
  while (terminal.bytesSalida > memoria && terminal.salida.length > 0) {
    const primero = terminal.salida[0]!
    const bytesPrimero = Buffer.byteLength(primero, 'utf8')
    const exceso = terminal.bytesSalida - memoria
    if (bytesPrimero <= exceso) {
      terminal.salida.shift()
      terminal.bytesSalida -= bytesPrimero
      continue
    }
    const recortado = sufijoUtf8(primero, bytesPrimero - exceso)
    terminal.salida[0] = recortado
    terminal.bytesSalida = terminal.bytesSalida - bytesPrimero + Buffer.byteLength(recortado, 'utf8')
  }
}

export function crearGestorTerminalesConpty(dep: {
  abrirPty: AbrirPtyConpty
  ahora?: () => number
  maximo?: number
  memoria?: number
}): GestorTerminales {
  const ahora = dep.ahora ?? Date.now
  const maximo = dep.maximo ?? 6
  const memoria = dep.memoria ?? 128 * 1_024
  const terminales = new Map<string, TerminalConpty>()

  return {
    async listar(): Promise<TerminalInfo[]> {
      return [...terminales.values()].map((terminal) => terminal.info)
    },

    async crear(orden: OrdenTerminal): Promise<TerminalInfo> {
      if (orden.agenteId !== null) {
        const existente = [...terminales.values()].find((terminal) => terminal.info.agenteId === orden.agenteId)
        if (existente !== undefined) return existente.info
      }
      if (terminales.size >= maximo) throw new Error(`Ya hay ${maximo} terminales abiertos en esta máquina`)

      let id = randomBytes(6).toString('hex')
      while (terminales.has(id)) id = randomBytes(6).toString('hex')
      const pty = dep.abrirPty(orden.argv, {
        cwd: orden.cwd,
        cols: 120,
        rows: 32,
        env: entornoTerminal(process.env),
      })
      const info: TerminalInfo = {
        id,
        titulo: limpio(orden.titulo),
        tipo: orden.tipo,
        agenteId: orden.agenteId,
        proyectoId: orden.proyectoId,
        creadoMs: ahora(),
      }
      const terminal: TerminalConpty = {
        info,
        pty,
        salida: [],
        bytesSalida: 0,
        enganches: new Set(),
      }
      terminales.set(id, terminal)
      pty.onData((datos) => {
        guardarSalida(terminal, datos, memoria)
        for (const enganche of [...terminal.enganches]) enganche.alDatos(datos)
      })
      pty.onExit(() => {
        terminales.delete(id)
        for (const enganche of [...terminal.enganches]) enganche.alSalir()
        terminal.enganches.clear()
      })
      return info
    },

    adjuntar(
      id: string,
      tamano: { cols: number; rows: number },
      alDatos: (datos: string) => void,
      alSalir: () => void,
    ): Enganche {
      comprobarId(id)
      const terminal = terminales.get(id)
      if (terminal === undefined) throw new Error('Terminal no encontrado')
      const salida = terminal.salida.join('')
      if (salida !== '') alDatos(salida)
      const enganche = { alDatos, alSalir }
      terminal.enganches.add(enganche)
      sinFallo(() => terminal.pty.resize(acotar(tamano.cols, 20, 400), acotar(tamano.rows, 5, 120)))
      return {
        escribir: (datos) => sinFallo(() => terminal.pty.write(datos)),
        redimensionar: (cols, rows) => sinFallo(() => terminal.pty.resize(acotar(cols, 20, 400), acotar(rows, 5, 120))),
        soltar: () => { terminal.enganches.delete(enganche) },
      }
    },

    async cerrar(id: string): Promise<void> {
      comprobarId(id)
      const terminal = terminales.get(id)
      if (terminal === undefined) throw new Error('Terminal no encontrado')
      terminales.delete(id)
      sinFallo(() => terminal.pty.kill())
    },
  }
}

export function crearGestorTerminalesConptyReal(): GestorTerminales {
  return crearGestorTerminalesConpty({
    abrirPty: (argv, opciones) => {
      const pty = createRequire(import.meta.url)('node-pty') as typeof import('node-pty')
      const proceso = pty.spawn(argv[0]!, argv.slice(1), {
        name: 'xterm-256color',
        cols: opciones.cols,
        rows: opciones.rows,
        cwd: opciones.cwd,
        env: opciones.env as Record<string, string>,
        useConpty: true,
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
