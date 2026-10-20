import { describe, expect, it, vi } from 'vitest'
import { crearObtenerLinea } from '../../src/panel/obtenerLinea.js'
import type { Fuente, ResultadoLinea } from '../../src/linea.js'

const instantanea = { agentes: [{ id: 'claude:con-fuente' }, { id: 'claude:sin-fuente' }] }
const fuente: Fuente = { tipo: 'claude', ruta: '/x.jsonl' }
const resultado: ResultadoLinea = { eventos: [], antes: 7 }

function preparar(construida = Promise.resolve(instantanea)) {
  const leer = vi.fn(async () => resultado)
  const obtenerFuente = vi.fn((id: string) => (id === 'claude:con-fuente' ? fuente : null))
  const obtener = crearObtenerLinea({ obtenerInstantanea: () => construida, obtenerFuente, leer })
  return { obtener, leer, obtenerFuente }
}

describe('crearObtenerLinea', () => {
  it('lee la fuente registrada del agente', async () => {
    const { obtener, leer } = preparar()
    await expect(obtener('claude:con-fuente', null)).resolves.toBe(resultado)
    expect(leer).toHaveBeenCalledWith(fuente, null)
  })

  it('devuelve una línea vacía para un agente vivo sin fuente', async () => {
    const { obtener, leer } = preparar()
    await expect(obtener('claude:sin-fuente', null)).resolves.toEqual({ eventos: [], antes: null })
    expect(leer).not.toHaveBeenCalled()
  })

  it('devuelve null para un agente que no está en la instantánea', async () => {
    const { obtener } = preparar()
    await expect(obtener('claude:inexistente', null)).resolves.toBeNull()
  })

  it('espera a la instantánea antes de mirar el registro', async () => {
    let soltar: (valor: typeof instantanea) => void = () => {}
    const pendiente = new Promise<typeof instantanea>((resolver) => { soltar = resolver })
    const { obtener, obtenerFuente } = preparar(pendiente)
    const promesa = obtener('claude:con-fuente', null)
    await Promise.resolve()
    expect(obtenerFuente).not.toHaveBeenCalled()
    soltar(instantanea)
    await expect(promesa).resolves.toBe(resultado)
  })
})
