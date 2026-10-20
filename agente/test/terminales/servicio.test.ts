import { describe, expect, it, vi } from 'vitest'
import { crearTerminalPedido } from '../../src/terminales/servicio.js'

const agente = { id: 'claude:323ca3f4-7985-4de1-869d-e6b0dc0cace0', tipo: 'claude', titulo: 'Sesión', cwd: '/Users/p/x', proyectoIds: ['aaaaaaaaaaaa'], puedeContinuar: true }
const instantanea = { proyectos: [{ id: 'aaaaaaaaaaaa', nombre: 'x', ruta: '/Users/p/x' }], agentes: [agente, { ...agente, id: 'claude:11111111-2222-3333-4444-555555555555', puedeContinuar: false }] } as never
const info = { id: '0123456789ab', titulo: 'Claude · Sesión', tipo: 'claude', agenteId: agente.id, proyectoId: 'aaaaaaaaaaaa', creadoMs: 1 }

function gestor(crear = vi.fn(async () => info)) {
  return { crear } as never
}

describe('crearTerminalPedido', () => {
  it('continúa una sesión cerrada que existe en la instantánea de esta máquina', async () => {
    const crear = vi.fn(async () => info)
    const r = await crearTerminalPedido({ accion: 'continuar', agenteId: agente.id }, instantanea, gestor(crear))
    expect(r).toEqual({ ok: true, terminal: info })
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ argv: ['/bin/zsh', '-lc', `exec claude --resume ${agente.id.slice(7)}`] }))
  })

  it('409 si la sesión sigue abierta, 404 si no existe, 400 si no se puede continuar', async () => {
    expect(await crearTerminalPedido({ accion: 'continuar', agenteId: 'claude:11111111-2222-3333-4444-555555555555' }, instantanea, gestor()))
      .toEqual({ ok: false, estado: 409, error: 'Esta sesión sigue abierta en otro sitio' })
    expect(await crearTerminalPedido({ accion: 'continuar', agenteId: 'claude:no-existe' }, instantanea, gestor()))
      .toMatchObject({ ok: false, estado: 404 })
    expect(await crearTerminalPedido({ accion: 'nueva', tipo: 'claude', proyectoId: 'bbbbbbbbbbbb' }, instantanea, gestor()))
      .toMatchObject({ ok: false, estado: 404 })
  })

  it('abre una sesión nueva en un proyecto de esta máquina', async () => {
    const crear = vi.fn(async () => info)
    expect(await crearTerminalPedido({ accion: 'nueva', tipo: 'codex', proyectoId: 'aaaaaaaaaaaa' }, instantanea, gestor(crear))).toMatchObject({ ok: true })
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/Users/p/x', argv: ['/bin/zsh', '-lc', 'exec codex'] }))
  })

  it('traduce el máximo de terminales a un 429', async () => {
    const crear = vi.fn(async () => { throw new Error('Ya hay 6 terminales abiertos en esta máquina') })
    expect(await crearTerminalPedido({ accion: 'nueva', tipo: 'claude', proyectoId: 'aaaaaaaaaaaa' }, instantanea, gestor(crear)))
      .toEqual({ ok: false, estado: 429, error: 'Ya hay 6 terminales abiertos en esta máquina' })
  })
})
