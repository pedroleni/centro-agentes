import { describe, expect, it } from 'vitest'
import { trocearTexto } from '../src/texto.js'

describe('trocearTexto', () => {
  it('parte en trozos de como mucho N unidades sin separar los pares sustitutos', () => {
    const texto = 'a' + '😀'.repeat(10) + 'ñ'
    const trozos = trocearTexto(texto, 4)
    expect(trozos.join('')).toBe(texto)
    for (const trozo of trozos) {
      expect(trozo.length).toBeLessThanOrEqual(4)
      expect(trozo.length).toBeGreaterThan(0)
      expect(Buffer.from(Buffer.from(trozo, 'utf8').toString('utf8')).equals(Buffer.from(trozo, 'utf8'))).toBe(true)
      expect(trozo).not.toMatch(/[\uD800-\uDBFF]$/)
    }
    expect(trocearTexto('')).toEqual([])
    expect(trocearTexto('hola')).toEqual(['hola'])
  })
})
