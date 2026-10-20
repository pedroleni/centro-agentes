// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { claveDelEnlace, clavePanel, guardarClavePanel } from '../../src/logica/clavePanel.js'

afterEach(() => { localStorage.clear() })

describe('clave del panel local', () => {
  it('saca la clave del enlace de arranque (#clave=…) y nada más', () => {
    expect(claveDelEnlace('#clave=AbC_123-xyz_0123456789abcd')).toBe('AbC_123-xyz_0123456789abcd')
    expect(claveDelEnlace('#/')).toBeNull()
    expect(claveDelEnlace('#clave=corta')).toBeNull()
    expect(claveDelEnlace('#clave=con espacios y <html> 0123456789')).toBeNull()
  })

  it('la guarda en localStorage, que es de este origen (puerto incluido)', () => {
    expect(clavePanel()).toBeNull()
    guardarClavePanel('AbC_123-xyz_0123456789abcd')
    expect(clavePanel()).toBe('AbC_123-xyz_0123456789abcd')
  })
})
