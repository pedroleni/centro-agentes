import { describe, expect, it } from 'vitest'
import { normalizarRutaWindows, rutasBase } from '../../src/rutas/base.js'

describe('normalizarRutaWindows', () => {
  it('normaliza las rutas largas de Windows', () => {
    expect(normalizarRutaWindows('\\\\?\\C:\\x')).toBe('C:\\x')
    expect(normalizarRutaWindows('\\\\?\\UNC\\srv\\share\\x')).toBe('\\\\srv\\share\\x')
    expect(normalizarRutaWindows('c:\\x')).toBe('C:\\x')
    expect(normalizarRutaWindows('/Users/p/x')).toBe('/Users/p/x')
  })
})

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
