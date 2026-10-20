import { describe, expect, it } from 'vitest'
import { estadoTrasCierre } from '../../src/logica/terminal.js'

describe('estado del terminal tras cerrarse el WebSocket', () => {
  it('los cierres con motivo conocido paran; los demás reconectan', () => {
    expect(estadoTrasCierre(4000)).toBe('terminado')
    expect(estadoTrasCierre(4004)).toBe('no-encontrado')
    expect(estadoTrasCierre(4502)).toBe('desconectada')
    expect(estadoTrasCierre(4401)).toBe('sin-sesion')
    expect(estadoTrasCierre(1006)).toBe('reconectando')
    expect(estadoTrasCierre(1013)).toBe('reconectando')
  })
})
