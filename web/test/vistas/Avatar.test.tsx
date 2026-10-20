// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Avatar } from '../../src/vistas/Avatar.js'

afterEach(cleanup)

describe('Avatar', () => {
  it('pinta la imagen del rol y muestra el icono de respaldo si falla', () => {
    const { container } = render(<Avatar rol="claude-explorador" estado="trabajando" tamano={88} />)

    const imagen = screen.getByRole('img', { name: 'Explorador' })
    expect(imagen.getAttribute('src')).toBe('/agentes/claude-explorador.png')

    fireEvent.error(imagen)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('✱')).toBeTruthy()
  })
  it('el icono de respaldo se anuncia como imagen', () => {
    const { container } = render(<Avatar rol="codex" estado="trabajando" tamano={28} />)
    fireEvent.error(container.querySelector('img')!)
    expect(screen.getByRole('img', { name: 'Codex' })).toBeTruthy()
  })
})
