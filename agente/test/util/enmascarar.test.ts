import { describe, expect, it } from 'vitest'
import { enmascararSecretos } from '../../src/util/enmascarar.js'

describe('enmascararSecretos', () => {
  it.each([
    ['clave sk-ant-abc123def456ghi789', 'clave «oculto»'],
    [`ghp_${'a'.repeat(36)}`, '«oculto»'],
    ['github_pat_11ABC_xyz', '«oculto»'],
    ['eyJhbGciOi.eyJzdWIi.firma', '«oculto»'],
    ['AKIAIOSFODNN7EXAMPLE', '«oculto»'],
    ['Authorization: Bearer abc.def', 'Authorization: «oculto»'],
    ['DB_PASSWORD=hunter2', 'DB_PASSWORD=«oculto»'],
    ['API_KEY = x1', 'API_KEY = «oculto»'],
  ])('enmascara %s', (texto, esperado) => {
    expect(enmascararSecretos(texto)).toBe(esperado)
  })

  it.each(['NOMBRE=pedro', 'sk-'])('no modifica %s', (texto) => {
    expect(enmascararSecretos(texto)).toBe(texto)
  })
})
