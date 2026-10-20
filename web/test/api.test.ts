import { afterEach, describe, expect, it, vi } from 'vitest'
import { crearTerminal, tituloReciente } from '../src/api.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('crear terminales', () => {
  it('recuerda el título del terminal recién creado hasta que llegue en la instantánea', async () => {
    const terminal = { id: 'bbbbbbbbbbbb', titulo: 'Claude · web', tipo: 'claude', agenteId: null, proyectoId: 'aaaaaaaaaaaa', creadoMs: 1 }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 201, json: async () => terminal }) as Response))
    expect(tituloReciente('bbbbbbbbbbbb')).toBeNull()
    await crearTerminal('aaaaaaaaaaaa', { accion: 'nueva', tipo: 'claude', proyectoId: 'aaaaaaaaaaaa' })
    expect(tituloReciente('bbbbbbbbbbbb')).toBe('Claude · web')
  })
})
