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
  // Si se ha descartado salida antigua, y el último estado de cada modo privado
  // (\x1b[?Nh / \x1b[?Nl) visto: pegado entre corchetes, pantalla alternativa,
  // cursor… Al reenviar lo recortado, esos modos se habrían perdido.
  recortada: boolean
  modos: Map<string, 'h' | 'l'>
  enganches: Set<EngancheConpty>
}

const MODO_PRIVADO = /\u001b\[\?([\d;]+)([hl])/g
// Solo los modos que importan al volver a entrar; una salida binaria podría
// inventarse miles y el prefijo crecería sin límite.
const MODOS_CONOCIDOS = new Set(['1', '7', '25', '47', '1000', '1002', '1003', '1004', '1005', '1006', '1015', '1047', '1048', '1049', '2004', '2026'])

function apuntarModos(terminal: TerminalConpty, datos: string): void {
  for (const [, numeros = '', valor] of datos.matchAll(MODO_PRIVADO)) {
    for (const numero of numeros.split(';')) {
      if (!MODOS_CONOCIDOS.has(numero)) continue
      // Se borra antes para que el orden refleje el último cambio.
      terminal.modos.delete(numero)
      terminal.modos.set(numero, valor as 'h' | 'l')
    }
  }
}

// Lo que se reenvía al volver a entrar: tal cual si no se ha recortado; si se ha
// recortado, primero los modos vigentes y después la salida desde una línea entera.
function salidaParaReenviar(terminal: TerminalConpty): string {
  const salida = terminal.salida.join('')
  if (!terminal.recortada) return salida
  const salto = salida.indexOf('\n')
  const desdeLinea = salto === -1 ? salida : salida.slice(salto + 1)
  const modos = [...terminal.modos].map(([numero, valor]) => `\u001b[?${numero}${valor}`).join('')
  return modos + desdeLinea
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
  if (terminal.bytesSalida > memoria) terminal.recortada = true
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
        recortada: false,
        modos: new Map(),
        enganches: new Set(),
      }
      terminales.set(id, terminal)
      pty.onData((datos) => {
        apuntarModos(terminal, datos)
        guardarSalida(terminal, datos, memoria)
        for (const enganche of [...terminal.enganches]) enganche.alDatos(datos)
      })
      // Al terminar solo NO se llama a kill: en Windows node-pty acabaría matando
      // por PID a los 5 s, y ese PID ya puede ser de otro proceso (incluso de un
      // git del propio agente).
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
      const salida = salidaParaReenviar(terminal)
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
      // node-pty relanza cualquier error de su socket si nadie más lo escucha, y
      // eso tumbaría el agente. El final del proceso ya llega por onExit.
      ;(proceso as unknown as { on(evento: 'error', oyente: () => void): void }).on('error', () => undefined)
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

// Texto legible de la salida de un terminal: sin títulos de ventana (OSC), con
// cada salto de posición del cursor como salto de línea y sin líneas vacías.
export function limpiarSalidaTerminal(salida: string): string {
  return salida
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[\d*(?:;\d*)?H/g, '\n')
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '')
    .join('\n')
}

// Prueba real de ConPTY para el diagnóstico: abre PowerShell igual que un
// terminal del panel y pregunta dónde están claude y codex y qué política de
// ejecución tiene. Si en 10 s no termina, no está disponible.
export function probarConptyReal(): Promise<{ disponible: boolean; detalle: string | null }> {
  return new Promise((resolver) => {
    let salida = ''
    let terminado = false
    let proceso: import('node-pty').IPty
    const acabar = (disponible: boolean): void => {
      if (terminado) return
      terminado = true
      clearTimeout(limite)
      const detalle = limpiarSalidaTerminal(salida)
      resolver({ disponible, detalle: detalle === '' ? null : detalle })
    }
    // Solo se mata si sigue vivo al agotar el tiempo (ver onExit del gestor).
    const limite = setTimeout(() => {
      sinFallo(() => proceso.kill())
      acabar(false)
    }, 10_000)
    try {
      const pty = createRequire(import.meta.url)('node-pty') as typeof import('node-pty')
      proceso = pty.spawn('powershell.exe', ['-NoLogo', '-Command', '(Get-Command claude,codex -ErrorAction SilentlyContinue).Source; Get-ExecutionPolicy'], {
        name: 'xterm-256color',
        cols: 200,
        rows: 20,
        cwd: process.cwd(),
        env: entornoTerminal(process.env) as Record<string, string>,
        useConpty: true,
      })
      ;(proceso as unknown as { on(evento: 'error', oyente: () => void): void }).on('error', () => undefined)
      proceso.onData((datos) => { salida += datos })
      proceso.onExit(({ exitCode }) => acabar(exitCode === 0))
    } catch {
      acabar(false)
    }
  })
}
