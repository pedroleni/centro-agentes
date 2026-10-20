import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { cerrarTerminal } from '../api.js'
import { conCtrl, secuenciaTecla, type Tecla } from '../logica/teclas.js'
import { estadoTrasCierre, type EstadoTerminal } from '../logica/terminal.js'

const MENSAJES: Record<Exclude<EstadoTerminal, 'conectado'>, string> = {
  conectando: 'Conectando…',
  reconectando: 'Reconectando…',
  terminado: 'La sesión ha terminado',
  'no-encontrado': 'Este terminal ya no existe',
  desconectada: 'La máquina se ha desconectado',
  'sin-sesion': 'Tu sesión ha caducado: vuelve a entrar',
}

const TECLAS: { tecla: Tecla; etiqueta: string }[] = [
  { tecla: 'Esc', etiqueta: 'Esc' },
  { tecla: 'Tab', etiqueta: 'Tab' },
  { tecla: 'Izquierda', etiqueta: '←' },
  { tecla: 'Arriba', etiqueta: '↑' },
  { tecla: 'Abajo', etiqueta: '↓' },
  { tecla: 'Derecha', etiqueta: '→' },
]

const ESPERAS_MS = [1_000, 2_000, 4_000, 8_000]

// Terminal real de una máquina en el navegador: xterm.js conectado por WebSocket
// al panel local o al hub (mismo protocolo). Si se corta la red reconecta; si la
// sesión termina o la máquina se desconecta, lo dice y deja de intentarlo.
export function VistaTerminal({ maquinaId, maquinaNombre, terminalId, titulo }: {
  maquinaId: string
  maquinaNombre: string
  terminalId: string
  titulo: string
}) {
  const contenedor = useRef<HTMLDivElement>(null)
  const socket = useRef<WebSocket | null>(null)
  const ctrlActivo = useRef(false)
  const [estado, establecerEstado] = useState<EstadoTerminal>('conectando')
  const [ctrl, establecerCtrl] = useState(false)

  function enviar(mensaje: object): void {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(mensaje))
  }

  function escribir(datos: string): void {
    const texto = ctrlActivo.current ? conCtrl(datos) : datos
    if (ctrlActivo.current) {
      ctrlActivo.current = false
      establecerCtrl(false)
    }
    enviar({ tipo: 'entrada', datos: texto })
  }

  useEffect(() => {
    if (contenedor.current === null) return
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: 13,
      theme: { background: '#0d1017', foreground: '#cdd3e0', cursor: '#cdd3e0' },
    })
    const ajuste = new FitAddon()
    terminal.loadAddon(ajuste)
    terminal.open(contenedor.current)
    ajuste.fit()
    terminal.focus()
    terminal.onData((datos) => escribir(datos))

    let vivo = true
    let intento = 0
    let reintento: ReturnType<typeof setTimeout> | undefined

    function conectar(): void {
      const protocolo = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const url = `${protocolo}://${window.location.host}/api/maquinas/${encodeURIComponent(maquinaId)}/terminales/${terminalId}/ws?cols=${terminal.cols}&rows=${terminal.rows}`
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      socket.current = ws
      ws.onopen = () => {
        intento = 0
        establecerEstado('conectado')
      }
      ws.onmessage = (evento) => {
        terminal.write(typeof evento.data === 'string' ? evento.data : new Uint8Array(evento.data as ArrayBuffer))
      }
      ws.onclose = (evento) => {
        if (!vivo || socket.current !== ws) return
        const siguiente = estadoTrasCierre(evento.code)
        establecerEstado(siguiente)
        if (siguiente !== 'reconectando') return
        reintento = setTimeout(conectar, ESPERAS_MS[Math.min(intento, ESPERAS_MS.length - 1)])
        intento += 1
      }
    }
    conectar()

    const observador = new ResizeObserver(() => {
      ajuste.fit()
      enviar({ tipo: 'tamano', cols: terminal.cols, rows: terminal.rows })
    })
    observador.observe(contenedor.current)

    return () => {
      vivo = false
      if (reintento !== undefined) clearTimeout(reintento)
      observador.disconnect()
      socket.current?.close()
      socket.current = null
      terminal.dispose()
    }
    // El terminal se crea una vez por terminal abierto.
  }, [maquinaId, terminalId])

  async function cerrar(): Promise<void> {
    if (!window.confirm(`¿Cerrar este terminal? Se terminará "${titulo}" en ${maquinaNombre}.`)) return
    await cerrarTerminal(maquinaId, terminalId).catch(() => undefined)
    window.location.hash = '#/'
  }

  return (
    <main className="vt-pagina">
      <header className="vt-cabecera">
        <a className="vt-volver" href="#/">‹ Panel</a>
        <div className="vt-titulo">
          <strong>{titulo}</strong>
          <span className="vt-maquina">{maquinaNombre}</span>
        </div>
        <span className={`vt-estado ${estado}`}>{estado === 'conectado' ? '● Conectado' : MENSAJES[estado]}</span>
        <button type="button" className="cd-btn" onClick={() => void cerrar()}>Cerrar terminal</button>
      </header>
      <p className="vt-aviso">Sesión real en {maquinaNombre} · lo que escribas se ejecuta allí</p>
      <div className="vt-terminal" ref={contenedor} />
      {(estado === 'terminado' || estado === 'no-encontrado' || estado === 'desconectada' || estado === 'sin-sesion') && (
        <p className="vt-fin" role="status">{MENSAJES[estado]} · <a href="#/">Volver al panel</a></p>
      )}
      <nav className="vt-teclas" aria-label="Teclas especiales">
        {TECLAS.slice(0, 2).map(({ tecla, etiqueta }) => (
          <button key={tecla} type="button" onClick={() => escribir(secuenciaTecla(tecla))}>{etiqueta}</button>
        ))}
        <button
          type="button"
          aria-pressed={ctrl}
          className={ctrl ? 'on' : ''}
          onClick={() => { ctrlActivo.current = !ctrlActivo.current; establecerCtrl(ctrlActivo.current) }}
        >
          Ctrl
        </button>
        {TECLAS.slice(2).map(({ tecla, etiqueta }) => (
          <button key={tecla} type="button" aria-label={tecla} onClick={() => escribir(secuenciaTecla(tecla))}>{etiqueta}</button>
        ))}
      </nav>
    </main>
  )
}
