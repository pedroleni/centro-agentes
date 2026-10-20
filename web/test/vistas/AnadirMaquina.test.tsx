// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnadirMaquina } from '../../src/vistas/AnadirMaquina.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const AHORA = 1_000_000
const maquinas = [{ id: 'aaaaaaaaaaaa', nombre: 'MacBook', so: 'macos' as const, conectada: true, ultimoLatidoMs: AHORA, instantanea: null }]

function respuesta(cuerpo: unknown, estado = 200): Response {
  return { ok: estado >= 200 && estado < 300, status: estado, json: async () => cuerpo } as Response
}

describe('AnadirMaquina', () => {
  it('genera un código y muestra los comandos para dar de alta la máquina', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => respuesta({ codigo: 'G9KND9MX', caducaMs: AHORA + 600_000 }))
    vi.stubGlobal('fetch', fetch)
    render(<AnadirMaquina maquinas={maquinas} ahora={AHORA} alCerrar={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generar código' })); await Promise.resolve(); await Promise.resolve() })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/maquinas/codigos')
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(screen.getByText('G9KND9MX')).toBeTruthy()
    expect(screen.getByText(/caduca en 10 min/)).toBeTruthy()
    expect(document.body.textContent).toContain(`npm run agente:alta -- --hub ${window.location.origin} --codigo G9KND9MX`)
    expect(document.body.textContent).toContain('npm run agente:conectar')
  })

  it('revoca una máquina solo tras confirmar', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => respuesta({}, 204))
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('confirm', vi.fn(() => false))
    render(<AnadirMaquina maquinas={maquinas} ahora={AHORA} alCerrar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revocar MacBook' }))
    expect(fetch).not.toHaveBeenCalled()
    vi.stubGlobal('confirm', vi.fn(() => true))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Revocar MacBook' })); await Promise.resolve() })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/maquinas/aaaaaaaaaaaa')
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('DELETE')
  })
  it('no exagera los minutos si la hora de referencia va unos segundos por detrás', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({ codigo: 'ABCDEFGH', caducaMs: AHORA + 3_000 + 600_000 })))
    render(<AnadirMaquina maquinas={maquinas} ahora={AHORA} alCerrar={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generar código' })); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText(/caduca en 10 min/)).toBeTruthy()
  })
})
