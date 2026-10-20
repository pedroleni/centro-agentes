// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnVivo } from '../../src/vistas/EnVivo.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('EnVivo', () => {
  it('actualiza cada segundo el tiempo desde la última instantánea', () => {
    vi.useFakeTimers()
    render(<EnVivo actualizadaMs={10_000} error={false} ahora={10_000} />)

    expect(screen.getByText(/actualizado hace 0 s/)).toBeTruthy()

    act(() => vi.advanceTimersByTime(3_000))

    expect(screen.getByText(/actualizado hace 3 s/)).toBeTruthy()
  })
  it('al llegar una instantánea nueva vuelve a 0 s sin pasar por un valor inflado', () => {
    vi.useFakeTimers()
    const { rerender } = render(<EnVivo actualizadaMs={1_000} error={false} ahora={1_000} />)
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(screen.getByText(/hace 3 s/)).toBeTruthy()
    rerender(<EnVivo actualizadaMs={4_000} error={false} ahora={4_000} />)
    expect(screen.getByText(/hace 0 s/)).toBeTruthy()
    vi.useRealTimers()
  })
})
