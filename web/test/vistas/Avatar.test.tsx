// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Avatar } from '../../src/vistas/Avatar.js'

afterEach(cleanup)

describe('Avatar', () => {
  it('pinta la imagen del rol y muestra el icono de respaldo si falla', () => {
    render(<Avatar rol="claude-explorador" estado="trabajando" tamano={88} />)

    const imagen = screen.getByRole('img', { name: 'Explorador' })
    expect(imagen.getAttribute('src')).toBe('/agentes/claude-explorador.png')

    fireEvent.error(imagen)

    expect(screen.queryByRole('img', { name: 'Explorador' })).toBeNull()
    expect(screen.getByText('✱')).toBeTruthy()
  })
})
