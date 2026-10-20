import { describe, expect, it, vi } from 'vitest'
import type { PtyMinimo } from '../../src/terminales/gestor.js'
import { crearGestorTerminalesConpty, type AbrirPtyConpty } from '../../src/terminales/gestorConpty.js'

const orden = {
  cwd: 'C:\\Users\\pedro\\web',
  argv: ['powershell.exe', '-NoLogo', '-Command', 'claude'],
  titulo: 'Claude · web',
  tipo: 'claude' as const,
  agenteId: null,
  proyectoId: 'aaaaaaaaaaaa',
}

function ptyFalso() {
  let alDatos: ((datos: string) => void) | undefined
  let alSalir: ((evento: { exitCode: number }) => void) | undefined
  const pty: PtyMinimo = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (callback) => { alDatos = callback },
    onExit: (callback) => { alSalir = callback },
  }
  return {
    pty,
    emitirDatos: (datos: string) => alDatos?.(datos),
    emitirSalida: (exitCode = 0) => alSalir?.({ exitCode }),
  }
}

function falsos() {
  const procesos: ReturnType<typeof ptyFalso>[] = []
  const abrirPty = vi.fn<AbrirPtyConpty>(() => {
    const proceso = ptyFalso()
    procesos.push(proceso)
    return proceso.pty
  })
  return { abrirPty, procesos }
}

describe('gestor de terminales ConPTY', () => {
  it('crea el proceso con su orden y carpeta y lo lista', async () => {
    const f = falsos()
    const gestor = crearGestorTerminalesConpty({ abrirPty: f.abrirPty, ahora: () => 5 })
    const info = await gestor.crear({ ...orden, agenteId: 'claude:sesion-1' })

    expect(f.abrirPty).toHaveBeenCalledWith(orden.argv, {
      cwd: orden.cwd,
      cols: 120,
      rows: 32,
      env: expect.objectContaining({ TERM: 'xterm-256color' }),
    })
    expect(info).toMatchObject({
      titulo: orden.titulo,
      tipo: 'claude',
      agenteId: 'claude:sesion-1',
      proyectoId: 'aaaaaaaaaaaa',
      creadoMs: 5,
    })
    expect(info.id).toMatch(/^[0-9a-f]{12}$/)
    expect(await gestor.listar()).toEqual([info])
  })

  it('no pasa de 6 terminales y una sesión tiene un solo terminal', async () => {
    const f = falsos()
    const gestor = crearGestorTerminalesConpty({ abrirPty: f.abrirPty })
    const sesion = { ...orden, agenteId: 'claude:sesion-repetida' }
    const [primero, segundo] = await Promise.all([gestor.crear(sesion), gestor.crear(sesion)])

    expect(segundo.id).toBe(primero.id)
    expect(f.abrirPty).toHaveBeenCalledTimes(1)
    await Promise.all(Array.from({ length: 5 }, (_, indice) => gestor.crear({
      ...orden,
      titulo: `Claude · ${indice}`,
      proyectoId: `proyecto-${indice}`,
    })))
    await expect(gestor.crear(orden)).rejects.toThrow('Ya hay 6 terminales abiertos en esta máquina')
    expect(f.abrirPty).toHaveBeenCalledTimes(6)
  })

  it('al volver a entrar reenvía la salida reciente', async () => {
    const f = falsos()
    const gestor = crearGestorTerminalesConpty({ abrirPty: f.abrirPty })
    const info = await gestor.crear(orden)
    f.procesos[0]!.emitirDatos('hola')
    const recibidos: string[] = []

    gestor.adjuntar(info.id, { cols: 80, rows: 24 }, (datos) => recibidos.push(datos), () => {})
    expect(recibidos).toEqual(['hola'])

    f.procesos[0]!.emitirDatos('x'.repeat(200 * 1_024))
    f.procesos[0]!.emitirDatos('final')
    const recientes: string[] = []
    gestor.adjuntar(info.id, { cols: 80, rows: 24 }, (datos) => recientes.push(datos), () => {})
    expect(recientes).toHaveLength(1)
    expect(Buffer.byteLength(recientes[0]!, 'utf8')).toBeLessThanOrEqual(128 * 1_024)
    expect(recientes[0]).toMatch(/final$/)
  })

  it('varios navegadores a la vez; soltar uno no mata el proceso', async () => {
    const f = falsos()
    const gestor = crearGestorTerminalesConpty({ abrirPty: f.abrirPty })
    const info = await gestor.crear(orden)
    const recibidosA: string[] = []
    const recibidosB: string[] = []
    const a = gestor.adjuntar(info.id, { cols: 80, rows: 24 }, (datos) => recibidosA.push(datos), () => {})
    const b = gestor.adjuntar(info.id, { cols: 80, rows: 24 }, (datos) => recibidosB.push(datos), () => {})

    f.procesos[0]!.emitirDatos('uno')
    a.soltar()
    f.procesos[0]!.emitirDatos('dos')
    b.redimensionar(1_000, 1)

    expect(recibidosA).toEqual(['uno'])
    expect(recibidosB).toEqual(['uno', 'dos'])
    expect(f.procesos[0]!.pty.kill).not.toHaveBeenCalled()
    expect(f.procesos[0]!.pty.resize).toHaveBeenCalledWith(400, 5)
  })

  it('al terminar avisa a todos y desaparece de la lista', async () => {
    const f = falsos()
    const gestor = crearGestorTerminalesConpty({ abrirPty: f.abrirPty })
    const info = await gestor.crear(orden)
    const alSalirA = vi.fn()
    const alSalirB = vi.fn()
    gestor.adjuntar(info.id, { cols: 80, rows: 24 }, () => {}, alSalirA)
    gestor.adjuntar(info.id, { cols: 80, rows: 24 }, () => {}, alSalirB)

    f.procesos[0]!.emitirSalida()

    expect(alSalirA).toHaveBeenCalledTimes(1)
    expect(alSalirB).toHaveBeenCalledTimes(1)
    expect(await gestor.listar()).toEqual([])
  })

  it('cerrar mata el proceso; ids desconocidos fallan', async () => {
    const f = falsos()
    const gestor = crearGestorTerminalesConpty({ abrirPty: f.abrirPty })
    const info = await gestor.crear(orden)

    await gestor.cerrar(info.id)

    expect(f.procesos[0]!.pty.kill).toHaveBeenCalledTimes(1)
    expect(await gestor.listar()).toEqual([])
    await expect(gestor.cerrar('ffffffffffff')).rejects.toThrow()
    expect(() => gestor.adjuntar('x; ls', { cols: 80, rows: 24 }, () => {}, () => {})).toThrow()
  })

  it('limpia el título y no se cae si el pty ya ha terminado', async () => {
    const f = falsos()
    const gestor = crearGestorTerminalesConpty({ abrirPty: f.abrirPty })
    const info = await gestor.crear({ ...orden, titulo: `Claude\u001b[2J · ${'x'.repeat(300)}` })
    expect(info.titulo).not.toMatch(/[\u0000-\u001f]/)
    expect(info.titulo.length).toBeLessThanOrEqual(200)
    const enganche = gestor.adjuntar(info.id, { cols: 80, rows: 24 }, () => {}, () => {})
    const roto = () => { throw new Error('ioctl(2) failed, EBADF') }
    vi.mocked(f.procesos[0]!.pty.resize).mockImplementation(roto)
    vi.mocked(f.procesos[0]!.pty.write).mockImplementation(roto)
    expect(() => enganche.redimensionar(100, 30)).not.toThrow()
    expect(() => enganche.escribir('ls\r')).not.toThrow()
  })

  it('al terminar el proceso cierra también su pseudoconsola', async () => {
    const f = falsos()
    const gestor = crearGestorTerminalesConpty({ abrirPty: f.abrirPty })
    await gestor.crear(orden)
    f.procesos[0]!.emitirSalida(0)
    expect(f.procesos[0]!.pty.kill).toHaveBeenCalled()
  })

  it('al volver tras mucha salida conserva los modos del terminal y empieza en una línea entera', async () => {
    const f = falsos()
    const gestor = crearGestorTerminalesConpty({ abrirPty: f.abrirPty })
    const info = await gestor.crear(orden)
    // Claude activa el pegado entre corchetes al arrancar; sin él, pegar varias
    // líneas tras volver a entrar enviaría el mensaje a la primera.
    f.procesos[0]!.emitirDatos('\u001b[?2004h\u001b[?25l')
    for (let i = 0; i < 30_000; i += 1) f.procesos[0]!.emitirDatos(`linea ${i}\r\n`)
    let recibido = ''
    gestor.adjuntar(info.id, { cols: 80, rows: 24 }, (datos) => { recibido += datos }, () => {})
    expect(recibido.startsWith('\u001b[?2004h\u001b[?25l')).toBe(true)
    expect(recibido.slice('\u001b[?2004h\u001b[?25l'.length)).toMatch(/^linea \d+\r\n/)
    expect(recibido.endsWith('linea 29999\r\n')).toBe(true)
  })

  it('sin recortar no añade nada a la salida guardada', async () => {
    const f = falsos()
    const gestor = crearGestorTerminalesConpty({ abrirPty: f.abrirPty })
    const info = await gestor.crear(orden)
    f.procesos[0]!.emitirDatos('hola\u001b[?1049h pantalla')
    let recibido = ''
    gestor.adjuntar(info.id, { cols: 80, rows: 24 }, (datos) => { recibido += datos }, () => {})
    expect(recibido).toBe('hola\u001b[?1049h pantalla')
  })
})
