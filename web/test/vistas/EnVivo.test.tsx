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
})
