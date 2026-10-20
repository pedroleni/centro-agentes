import { describe, expect, it } from 'vitest'
import { conCtrl, secuenciaTecla } from '../../src/logica/teclas.js'

describe('barra de teclas del terminal', () => {
  it('traduce cada tecla a su secuencia', () => {
    expect(secuenciaTecla('Esc')).toBe('\x1b')
    expect(secuenciaTecla('Tab')).toBe('\t')
    expect(secuenciaTecla('Arriba')).toBe('\x1b[A')
    expect(secuenciaTecla('Abajo')).toBe('\x1b[B')
    expect(secuenciaTecla('Derecha')).toBe('\x1b[C')
    expect(secuenciaTecla('Izquierda')).toBe('\x1b[D')
  })

  it('Ctrl más una letra da su código de control y lo demás no cambia', () => {
    expect(conCtrl('c')).toBe('\x03')
    expect(conCtrl('C')).toBe('\x03')
    expect(conCtrl('a')).toBe('\x01')
    expect(conCtrl('[')).toBe('\x1b')
    expect(conCtrl('1')).toBe('1')
    expect(conCtrl('ab')).toBe('ab')
  })
})
