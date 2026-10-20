// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Entrar } from '../../src/vistas/Entrar.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function respuesta(estado: number): Response {
  return { ok: estado >= 200 && estado < 300, status: estado, json: async () => ({}) } as Response
}

async function intentar(estado: number) {
  vi.stubGlobal('fetch', vi.fn(async () => respuesta(estado)))
  const alEntrar = vi.fn()
  render(<Entrar alEntrar={alEntrar} />)
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'x' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })); await Promise.resolve(); await Promise.resolve() })
  return alEntrar
}

describe('Entrar', () => {
  it('llama a alEntrar cuando la contraseña es correcta', async () => {
    expect(await intentar(204)).toHaveBeenCalled()
  })
  it('explica cada rechazo', async () => {
    await intentar(401)
    expect(screen.getByText('Contraseña incorrecta')).toBeTruthy()
    cleanup()
    await intentar(429)
    expect(screen.getByText('Demasiados intentos, espera un minuto')).toBeTruthy()
    cleanup()
    await intentar(403)
    expect(screen.getByText('Solo se puede entrar desde la red Tailscale de Pedro')).toBeTruthy()
  })
})
