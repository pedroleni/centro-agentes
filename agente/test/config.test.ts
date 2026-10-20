import { describe, expect, it } from 'vitest'
import { cargarConfig } from '../src/config.js'

describe('cargarConfig', () => {
  it('incluye las carpetas de OneDrive en Windows', () => {
    const home = 'C:\\Users\\pedro'
    const oneDrive = 'C:\\Users\\pedro\\OneDrive'

    expect(cargarConfig(null, home, 'windows', { OneDrive: oneDrive }).raices).toEqual([
      'C:\\Users\\pedro\\Desktop',
      'C:\\Users\\pedro\\Downloads',
      'C:\\Users\\pedro\\Documents',
      'C:\\Users\\pedro\\OneDrive\\Desktop',
      'C:\\Users\\pedro\\OneDrive\\Documents',
      'C:\\Users\\pedro\\OneDrive\\Escritorio',
      'C:\\Users\\pedro\\OneDrive\\Documentos',
    ])
    expect(cargarConfig(null, '/Users/pedro', 'macos', { OneDrive: oneDrive }).raices).toEqual([
      '/Users/pedro/Desktop',
      '/Users/pedro/Downloads',
      '/Users/pedro/Documents',
    ])
  })

  it('también encuentra el OneDrive de empresa', () => {
    expect(cargarConfig(null, 'C:\\Users\\pedro', 'windows', { OneDriveCommercial: 'C:\\Users\\pedro\\OneDrive - Empresa' }).raices)
      .toContain('C:\\Users\\pedro\\OneDrive - Empresa\\Escritorio')
  })
})
