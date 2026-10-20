import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { crearAlmacen } from '../src/almacen.js'

const temporales: string[] = []
afterEach(async () => {
  await Promise.all(temporales.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function nuevo(ahora: () => number = Date.now) {
  const dir = await mkdtemp(path.join(tmpdir(), 'centro-almacen-'))
  temporales.push(dir)
  const ruta = path.join(dir, 'hub.sqlite')
  return { ruta, almacen: crearAlmacen(ruta, ahora) }
}

describe('almacén del hub', () => {
  it('genera códigos de 8 caracteres sin ambiguos que caducan a los 10 minutos', async () => {
    let t = 1_000
    const { almacen } = await nuevo(() => t)
    const { codigo, caducaMs } = almacen.crearCodigoAlta()
    expect(codigo).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
    expect(caducaMs).toBe(1_000 + 10 * 60_000)
    t = caducaMs + 1
    expect(almacen.canjearCodigo(codigo, 'MacBook', 'macos')).toBeNull()
  })

  it('un código solo se canjea una vez y el token identifica a la máquina', async () => {
    const { almacen } = await nuevo()
    const { codigo } = almacen.crearCodigoAlta()
    const alta = almacen.canjearCodigo(codigo, 'MacBook', 'macos')
    expect(alta).not.toBeNull()
    expect(alta!.maquinaId).toMatch(/^[0-9a-f]{12}$/)
    expect(almacen.canjearCodigo(codigo, 'Otra', 'windows')).toBeNull()
    expect(almacen.maquinaDeToken(alta!.token)).toEqual({ id: alta!.maquinaId, nombre: 'MacBook', so: 'macos' })
    expect(almacen.maquinaDeToken(`${alta!.token}x`)).toBeNull()
  })

  it('una máquina revocada deja de valer y queda marcada', async () => {
    const { almacen } = await nuevo()
    const alta = almacen.canjearCodigo(almacen.crearCodigoAlta().codigo, 'Mini', 'macos')!
    expect(almacen.revocar(alta.maquinaId)).toBe(true)
    expect(almacen.maquinaDeToken(alta.token)).toBeNull()
    expect(almacen.listarMaquinas()[0]?.revocadaMs).not.toBeNull()
  })

  it('no guarda en claro ni el código ni el token, y el fichero es 0600', async () => {
    const { almacen, ruta } = await nuevo()
    const { codigo } = almacen.crearCodigoAlta()
    const alta = almacen.canjearCodigo(codigo, 'Win', 'windows')!
    almacen.cerrar()
    const crudo = await readFile(ruta)
    expect(crudo.includes(Buffer.from(codigo))).toBe(false)
    expect(crudo.includes(Buffer.from(alta.token))).toBe(false)
    expect((await stat(ruta)).mode & 0o777).toBe(0o600)
  })

  it('guarda y devuelve los eventos de auditoría, los más recientes primero', async () => {
    let t = 10
    const { almacen } = await nuevo(() => t)
    almacen.auditar('entrada', { ok: true })
    t = 20
    almacen.auditar('alta', { maquinaId: 'abc' })
    expect(almacen.ultimosEventos(10)).toEqual([
      { fechaMs: 20, evento: 'alta', detalle: { maquinaId: 'abc' } },
      { fechaMs: 10, evento: 'entrada', detalle: { ok: true } },
    ])
  })
  it('conserva como mucho las 10 000 filas de auditoría más recientes', async () => {
    let t = 0
    const { almacen } = await nuevo(() => t)
    for (let i = 0; i < 10_050; i += 1) { t = i; almacen.auditar('evento', { i }) }
    const eventos = almacen.ultimosEventos(20_000)
    expect(eventos.length).toBeLessThanOrEqual(10_000)
    expect(eventos[0]?.detalle).toEqual({ i: 10_049 })
  })
})
