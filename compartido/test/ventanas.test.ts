import { describe, expect, it } from 'vitest'
import { ventanaContexto } from '../src/ventanas.js'

describe('ventanas de contexto', () => {
  it('resuelve los modelos Claude y los sufijos', () => {
    expect(ventanaContexto('claude-opus-5-5')).toBe(1_000_000)
    expect(ventanaContexto('claude-opus-5-5[1m]')).toBe(1_000_000)
    expect(ventanaContexto('claude-haiku-4-5')).toBe(200_000)
  })

  it('devuelve null para un modelo desconocido', () => {
    expect(ventanaContexto('gpt-5.6-sol')).toBeNull()
  })

  it('prioriza la configuración adicional', () => {
    expect(ventanaContexto('gpt-5.6-sol', { 'gpt-5.6-sol': 258400 })).toBe(258400)
  })
})
