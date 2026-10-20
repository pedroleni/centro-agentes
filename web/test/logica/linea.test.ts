import { describe, expect, it } from 'vitest'
import { fusionarLinea } from '../../src/logica/linea.js'

const comando = { fechaMs: 10, tipo: 'comando' as const, texto: 'npm test', detalle: null }

describe('fusionarLinea', () => {
  it('sustituye un evento por su versión nueva con la misma clave (la salida llega después)', () => {
    const anterior = { eventos: [comando], antes: 5 }
    const nueva = { eventos: [{ ...comando, detalle: '293 passed' }], antes: null }
    const resultado = fusionarLinea(anterior, nueva, true)
    expect(resultado.eventos).toEqual([{ ...comando, detalle: '293 passed' }])
    expect(resultado.antes).toBe(5)
  })

  it('ordena por fecha y toma el antes de la página nueva al cargar anteriores', () => {
    const anterior = { eventos: [{ ...comando, fechaMs: 20, texto: 'b' }], antes: 5 }
    const nueva = { eventos: [{ ...comando, fechaMs: 1, texto: 'a' }], antes: null }
    const resultado = fusionarLinea(anterior, nueva, false)
    expect(resultado.eventos.map((evento) => evento.texto)).toEqual(['a', 'b'])
    expect(resultado.antes).toBeNull()
  })
})
