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

  it.each([
    ['export DB_PASSWORD=x', 'export DB_PASSWORD=«oculto»'],
    ['$env:API_KEY="x"', '$env:API_KEY="«oculto»"'],
    ['{"api_key": "x"}', '{"api_key": "«oculto»"}'],
    ['{"password": "x"}', '{"password": "«oculto»"}'],
    ['{"Authorization": "Bearer x"}', '{"Authorization": "«oculto»"}'],
    ['password: x', 'password: «oculto»'],
    ['token: x', 'token: «oculto»'],
  ])('enmascara el formato estructurado %s', (texto, esperado) => {
    expect(enmascararSecretos(texto)).toBe(esperado)
  })

  it('enmascara un bloque de clave privada completo', () => {
    const clave = [
      'antes',
      '-----BEGIN RSA PRIVATE KEY-----',
      'abc123',
      'def456',
      '-----END RSA PRIVATE KEY-----',
      'despues',
    ].join('\n')

    expect(enmascararSecretos(clave)).toBe('antes\n«oculto»\ndespues')
  })

  it.each(['NOMBRE=pedro', '{"nombre": "pedro"}'])('conserva el dato inocuo %s', (texto) => {
    expect(enmascararSecretos(texto)).toBe(texto)
  })

  it('trunca y procesa en menos de 200 ms una entrada de un millón de caracteres', () => {
    const texto = 'key'.repeat(Math.ceil(1_000_000 / 3)).slice(0, 1_000_000)
    const inicio = performance.now()

    const resultado = enmascararSecretos(texto)
    const duracionMs = performance.now() - inicio

    expect(resultado).toHaveLength(20_001)
    expect(resultado.endsWith('…')).toBe(true)
    expect(duracionMs).toBeLessThan(200)
  })
})

describe('claves privadas cortadas', () => {
  it('enmascara un bloque PEM sin END hasta el final del texto', () => {
    const texto = 'salida:\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nQUFBQUJBQUFBQkFBQUFC\n'
    expect(enmascararSecretos(texto)).toBe('salida:\n«oculto»')
  })

  it('sigue dejando el texto normal que va después de un bloque completo', () => {
    const texto = 'a\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\nfin'
    expect(enmascararSecretos(texto)).toBe('a\n«oculto»\nfin')
  })
})
