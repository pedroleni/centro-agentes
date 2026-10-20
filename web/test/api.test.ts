// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cerrarTerminal, crearTerminal, tituloReciente } from '../src/api.js'
import { guardarClavePanel } from '../src/logica/clavePanel.js'

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

describe('crear terminales', () => {
  it('recuerda el título del terminal recién creado hasta que llegue en la instantánea', async () => {
    const terminal = { id: 'bbbbbbbbbbbb', titulo: 'Claude · web', tipo: 'claude', agenteId: null, proyectoId: 'aaaaaaaaaaaa', creadoMs: 1 }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 201, json: async () => terminal }) as Response))
    expect(tituloReciente('bbbbbbbbbbbb')).toBeNull()
    await crearTerminal('aaaaaaaaaaaa', { accion: 'nueva', tipo: 'claude', proyectoId: 'aaaaaaaaaaaa' })
    expect(tituloReciente('bbbbbbbbbbbb')).toBe('Claude · web')
  })

  it('en el panel local manda su clave en una cabecera al crear y al cerrar', async () => {
    guardarClavePanel('AbC_123-xyz_0123456789abcd')
    const terminal = { id: 'cccccccccccc', titulo: 'Codex · web', tipo: 'codex', agenteId: null, proyectoId: 'aaaaaaaaaaaa', creadoMs: 1 }
    const fetch = vi.fn(async () => ({ ok: true, status: 201, json: async () => terminal }) as Response)
    vi.stubGlobal('fetch', fetch)
    await crearTerminal('aaaaaaaaaaaa', { accion: 'nueva', tipo: 'codex', proyectoId: 'aaaaaaaaaaaa' })
    await cerrarTerminal('aaaaaaaaaaaa', 'cccccccccccc')
    for (const [, opciones] of fetch.mock.calls as unknown as [string, RequestInit][]) {
      expect(new Headers(opciones.headers).get('X-Clave-Panel')).toBe('AbC_123-xyz_0123456789abcd')
    }
  })
})
