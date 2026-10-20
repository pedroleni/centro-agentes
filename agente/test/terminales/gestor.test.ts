import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { crearGestorTerminales, type PtyMinimo } from '../../src/terminales/gestor.js'

const orden = { cwd: '/tmp', argv: ['/bin/zsh', '-lc', 'exec claude'], titulo: 'Claude · prueba', tipo: 'claude' as const, agenteId: null, proyectoId: 'aaaaaaaaaaaa' }

function falsos(listado = '') {
  const llamadas: string[][] = []
  const tmux = vi.fn(async (args: string[]) => { llamadas.push(args); return args[0] === 'list-sessions' ? listado : '' })
  const datos: ((d: string) => void)[] = []
  const salidas: ((e: { exitCode: number }) => void)[] = []
  const pty = { write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: (cb: (d: string) => void) => { datos.push(cb) }, onExit: (cb: (e: { exitCode: number }) => void) => { salidas.push(cb) } }
  const abrirPty = vi.fn<(argv: string[], o: { cols: number; rows: number }) => PtyMinimo>(() => pty)
  return { llamadas, tmux, pty, abrirPty, datos, salidas }
}

describe('gestor de terminales', () => {
  it('crea una sesión de tmux con la orden exacta y guarda sus datos como opciones', async () => {
    const f = falsos()
    const gestor = crearGestorTerminales({ tmux: f.tmux, abrirPty: f.abrirPty, ahora: () => 5 })
    const info = await gestor.crear(orden)
    expect(info).toMatchObject({ titulo: 'Claude · prueba', tipo: 'claude', proyectoId: 'aaaaaaaaaaaa', agenteId: null, creadoMs: 5 })
    expect(info.id).toMatch(/^[0-9a-f]{12}$/)
    expect(f.llamadas[1]).toEqual(['new-session', '-d', '-s', `ca-${info.id}`, '-c', '/tmp', '-x', '120', '-y', '32', '--', '/bin/zsh', '-lc', 'exec claude'])
    expect(f.llamadas).toContainEqual(['set-option', '-t', `ca-${info.id}`, 'window-size', 'latest'])
    expect(f.llamadas).toContainEqual(['set-option', '-t', `ca-${info.id}`, '@ca_titulo', 'Claude · prueba'])
  })

  it('no abre más de 6 terminales por máquina', async () => {
    const listado = Array.from({ length: 6 }, (_, i) => `ca-00000000000${i}\t1\tT\tclaude\t\t`).join('\n')
    const gestor = crearGestorTerminales({ tmux: falsos(listado).tmux, abrirPty: falsos().abrirPty })
    await expect(gestor.crear(orden)).rejects.toThrow('Ya hay 6 terminales abiertos en esta máquina')
  })

  it('lista solo las sesiones ca- con sus datos', async () => {
    const listado = 'otra\t1\t\t\t\t\nca-0123456789ab\t1700000000\tClaude · x\tcodex\tcodex:abc\taaaaaaaaaaaa\n'
    const gestor = crearGestorTerminales({ tmux: falsos(listado).tmux, abrirPty: falsos().abrirPty })
    expect(await gestor.listar()).toEqual([{ id: '0123456789ab', titulo: 'Claude · x', tipo: 'codex', agenteId: 'codex:abc', proyectoId: 'aaaaaaaaaaaa', creadoMs: 1_700_000_000_000 }])
  })

  it('se engancha con un pty, reenvía datos y acota el tamaño', async () => {
    const f = falsos()
    const gestor = crearGestorTerminales({ tmux: f.tmux, abrirPty: f.abrirPty })
    const recibidos: string[] = []
    const alSalir = vi.fn()
    const enganche = gestor.adjuntar('0123456789ab', { cols: 1_000, rows: 1 }, (d) => recibidos.push(d), alSalir)
    expect(f.abrirPty).toHaveBeenCalledWith(['tmux', 'attach-session', '-t', 'ca-0123456789ab'], expect.objectContaining({ cols: 400, rows: 5 }))
    f.datos[0]!('hola')
    expect(recibidos).toEqual(['hola'])
    enganche.escribir('ls\r')
    expect(f.pty.write).toHaveBeenCalledWith('ls\r')
    enganche.redimensionar(80, 24)
    expect(f.pty.resize).toHaveBeenCalledWith(80, 24)
    f.salidas[0]!({ exitCode: 0 })
    expect(alSalir).toHaveBeenCalled()
    enganche.soltar()
    expect(f.pty.kill).toHaveBeenCalled()
  })

  it('rechaza ids que no son de 12 hex al enganchar o cerrar', async () => {
    const gestor = crearGestorTerminales({ tmux: falsos().tmux, abrirPty: falsos().abrirPty })
    expect(() => gestor.adjuntar('x; ls', { cols: 80, rows: 24 }, () => {}, () => {})).toThrow()
    await expect(gestor.cerrar('../x')).rejects.toThrow()
  })
})

const sinTmux = process.env.CODEX_SANDBOX !== undefined || (() => { try { execFileSync('tmux', ['-V']); return false } catch { return true } })()

describe.skipIf(sinTmux)('gestor de terminales con tmux real', () => {
  const creados: string[] = []
  afterEach(() => { for (const id of creados.splice(0)) { try { execFileSync('tmux', ['kill-session', '-t', `ca-${id}`]) } catch { /* ya cerrada */ } } })

  it('crea, se engancha, recibe la salida y cierra', async () => {
    const { crearGestorTerminalesReal } = await import('../../src/terminales/gestor.js')
    const gestor = crearGestorTerminalesReal()
    const info = await gestor.crear({ ...orden, argv: ['/bin/sh', '-c', 'echo hola-terminal; sleep 5'] })
    creados.push(info.id)
    let salida = ''
    const enganche = gestor.adjuntar(info.id, { cols: 80, rows: 24 }, (d) => { salida += d }, () => {})
    await new Promise((r) => setTimeout(r, 1_000))
    expect(salida).toContain('hola-terminal')
    expect((await gestor.listar()).map((t) => t.id)).toContain(info.id)
    enganche.soltar()
    await gestor.cerrar(info.id)
    expect((await gestor.listar()).map((t) => t.id)).not.toContain(info.id)
  })
})
