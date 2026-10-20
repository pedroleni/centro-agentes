import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { crearGestorTerminales, entornoTerminal, type PtyMinimo } from '../../src/terminales/gestor.js'

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
    // Destino exacto (=): sin él, tmux acepta prefijos y patrones de otras sesiones.
    expect(f.llamadas).toContainEqual(['set-option', '-t', `=ca-${info.id}:`, 'window-size', 'latest'])
    expect(f.llamadas).toContainEqual(['set-option', '-t', `=ca-${info.id}:`, '@ca_titulo', 'Claude · prueba'])
  })

  it('usa su propio servidor de tmux y no expande formatos en la carpeta', async () => {
    const f = falsos()
    const gestor = crearGestorTerminales({ tmux: f.tmux, abrirPty: f.abrirPty, socket: 'centro-agentes' })
    const info = await gestor.crear({ ...orden, cwd: '/Users/p/Web#Shop #{session_name}' })
    expect(f.llamadas.every((args) => args[0] === '-L' && args[1] === 'centro-agentes')).toBe(true)
    expect(f.llamadas[1]?.slice(2, 8)).toEqual(['new-session', '-d', '-s', `ca-${info.id}`, '-c', '/Users/p/Web##Shop ##{session_name}'])
    gestor.adjuntar(info.id, { cols: 80, rows: 24 }, () => {}, () => {})
    expect(f.abrirPty).toHaveBeenCalledWith(['tmux', '-L', 'centro-agentes', 'attach-session', '-t', `=ca-${info.id}`], expect.anything())
    await gestor.cerrar(info.id)
    expect(f.llamadas.at(-1)).toEqual(['-L', 'centro-agentes', 'kill-session', '-t', `=ca-${info.id}`])
  })

  it('si falla al guardar sus datos, cierra la sesión recién creada', async () => {
    const f = falsos()
    const tmux = vi.fn(async (args: string[]) => {
      f.llamadas.push(args)
      if (args[0] === 'set-option') throw new Error('tmux falló')
      return ''
    })
    const gestor = crearGestorTerminales({ tmux, abrirPty: f.abrirPty })
    await expect(gestor.crear(orden)).rejects.toThrow('tmux falló')
    expect(f.llamadas.at(-1)?.slice(0, 2)).toEqual(['kill-session', '-t'])
  })

  it('crea de uno en uno: la misma sesión a la vez da un solo terminal y nunca pasa del máximo', async () => {
    const sesiones = new Map<string, Record<string, string>>()
    const tmux = vi.fn(async (args: string[]) => {
      await new Promise((r) => setTimeout(r, 1))
      if (args[0] === 'list-sessions') {
        return [...sesiones].map(([n, o]) => [n, '1', o['@ca_titulo'] ?? '', o['@ca_tipo'] ?? '', o['@ca_agente'] ?? '', o['@ca_proyecto'] ?? ''].join('\t')).join('\n')
      }
      if (args[0] === 'new-session') sesiones.set(args[3]!, {})
      if (args[0] === 'set-option') sesiones.get(args[2]!.replace(/^=/, '').replace(/:$/, ''))![args[3]!] = args[4]!
      return ''
    })
    const gestor = crearGestorTerminales({ tmux, abrirPty: falsos().abrirPty })
    const continuar = { ...orden, agenteId: 'claude:323ca3f4-7985-4de1-869d-e6b0dc0cace0' }
    const [a, b] = await Promise.all([gestor.crear(continuar), gestor.crear(continuar)])
    expect(a.id).toBe(b.id)
    expect(sesiones.size).toBe(1)
    const resultados = await Promise.allSettled(Array.from({ length: 7 }, () => gestor.crear(orden)))
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(5)
    expect(sesiones.size).toBe(6)
  })

  it('dos procesos (panel y conectar) que continúan la misma sesión a la vez acaban en un solo terminal', async () => {
    // tmux compartido entre dos gestores con colas distintas: new-session falla si el nombre ya existe.
    const sesiones = new Map<string, Record<string, string>>()
    const tmux = vi.fn(async (args: string[]) => {
      await new Promise((r) => setTimeout(r, 1))
      if (args[0] === 'list-sessions') {
        return [...sesiones].map(([n, o]) => [n, '1', o['@ca_titulo'] ?? '', o['@ca_tipo'] ?? '', o['@ca_agente'] ?? '', o['@ca_proyecto'] ?? ''].join('\t')).join('\n')
      }
      if (args[0] === 'new-session') {
        if (sesiones.has(args[3]!)) throw new Error(`duplicate session: ${args[3]}`)
        sesiones.set(args[3]!, {})
      }
      if (args[0] === 'set-option') sesiones.get(args[2]!.replace(/^=/, '').replace(/:$/, ''))![args[3]!] = args[4]!
      return ''
    })
    const panel = crearGestorTerminales({ tmux, abrirPty: falsos().abrirPty })
    const conectar = crearGestorTerminales({ tmux, abrirPty: falsos().abrirPty })
    const continuar = { ...orden, agenteId: 'claude:323ca3f4-7985-4de1-869d-e6b0dc0cace0' }
    const [a, b] = await Promise.all([panel.crear(continuar), conectar.crear(continuar)])
    expect(a.id).toBe(b.id)
    expect(sesiones.size).toBe(1)
  })

  it('los terminales no heredan las variables de npm ni NODE_OPTIONS del agente', () => {
    expect(entornoTerminal({ PATH: '/bin', HOME: '/Users/p', NODE_OPTIONS: '--experimental-sqlite', npm_config_cache: '/x', npm_lifecycle_event: 'panel' }))
      .toEqual({ PATH: '/bin', HOME: '/Users/p', TERM: 'xterm-256color' })
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
    expect(f.abrirPty).toHaveBeenCalledWith(['tmux', 'attach-session', '-t', '=ca-0123456789ab'], expect.objectContaining({ cols: 400, rows: 5 }))
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

  it('no se cae si el pty ya ha terminado al escribir, redimensionar o soltar', () => {
    const f = falsos()
    const roto = () => { throw new Error('ioctl(2) failed, EBADF') }
    f.pty.resize.mockImplementation(roto)
    f.pty.write.mockImplementation(roto)
    f.pty.kill.mockImplementation(roto)
    const gestor = crearGestorTerminales({ tmux: f.tmux, abrirPty: f.abrirPty })
    const enganche = gestor.adjuntar('0123456789ab', { cols: 80, rows: 24 }, () => {}, () => {})
    expect(() => enganche.redimensionar(100, 30)).not.toThrow()
    expect(() => enganche.escribir('ls\r')).not.toThrow()
    expect(() => enganche.soltar()).not.toThrow()
  })

  it('rechaza ids que no son de 12 hex al enganchar o cerrar', async () => {
    const gestor = crearGestorTerminales({ tmux: falsos().tmux, abrirPty: falsos().abrirPty })
    expect(() => gestor.adjuntar('x; ls', { cols: 80, rows: 24 }, () => {}, () => {})).toThrow()
    await expect(gestor.cerrar('../x')).rejects.toThrow()
  })
})

const sinTmux = process.env.CODEX_SANDBOX !== undefined || (() => { try { execFileSync('tmux', ['-V']); return false } catch { return true } })()

describe.skipIf(sinTmux)('gestor de terminales con tmux real', () => {
  // Un servidor de tmux solo para estas pruebas: no toca las sesiones de nadie.
  const socket = `centro-agentes-prueba-${process.pid}`
  const temporales: string[] = []
  afterAll(async () => {
    try { execFileSync('tmux', ['-L', socket, 'kill-server']) } catch { /* ya parado */ }
    await rm(path.join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${process.getuid?.() ?? 0}`, socket), { force: true })
    await Promise.all(temporales.map((d) => rm(d, { recursive: true, force: true })))
  })

  it('crea, se engancha, recibe la salida y cierra', async () => {
    const { crearGestorTerminalesReal } = await import('../../src/terminales/gestor.js')
    const gestor = crearGestorTerminalesReal(socket)
    const info = await gestor.crear({ ...orden, argv: ['/bin/sh', '-c', 'echo hola-terminal; sleep 5'] })
    let salida = ''
    const enganche = gestor.adjuntar(info.id, { cols: 80, rows: 24 }, (d) => { salida += d }, () => {})
    await new Promise((r) => setTimeout(r, 1_000))
    expect(salida).toContain('hola-terminal')
    expect((await gestor.listar()).find((t) => t.id === info.id)?.titulo).toBe('Claude · prueba')
    enganche.soltar()
    await gestor.cerrar(info.id)
    expect((await gestor.listar()).map((t) => t.id)).not.toContain(info.id)
  })

  it('arranca en la carpeta exacta aunque su nombre lleve # o formatos de tmux', async () => {
    const { crearGestorTerminalesReal } = await import('../../src/terminales/gestor.js')
    const carpeta = await mkdtemp(path.join(tmpdir(), 'web#{session_name}#S-'))
    const fuera = await mkdtemp(path.join(tmpdir(), 'centro-pwd-'))
    temporales.push(carpeta, fuera)
    const gestor = crearGestorTerminalesReal(socket)
    const info = await gestor.crear({ ...orden, cwd: carpeta, argv: ['/bin/sh', '-c', `pwd -P > ${fuera}/pwd.txt; sleep 5`] })
    await new Promise((r) => setTimeout(r, 800))
    expect((await readFile(path.join(fuera, 'pwd.txt'), 'utf8')).trim()).toBe(await realpath(carpeta))
    await gestor.cerrar(info.id)
  })
})
