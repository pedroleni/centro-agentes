import { describe, expect, it } from 'vitest'
import { rutasBase } from '../../src/rutas/base.js'

describe('rutasBase', () => {
  it('calcula la ruta de Claude en macOS', () => {
    expect(rutasBase('macos', '/Users/p', {}).claude).toBe('/Users/p/.claude')
  })

  it('respeta CODEX_HOME', () => {
    expect(rutasBase('macos', '/Users/p', { CODEX_HOME: '/x' }).codex).toBe('/x')
  })

  it('usa rutas y temporales de Windows', () => {
    const rutas = rutasBase('windows', 'C:\\Users\\p', { TEMP: 'C:\\T' })

    expect(rutas.claude).toBe('C:\\Users\\p\\.claude')
    expect(rutas.temporales).toEqual(['C:\\T'])
  })
})
