import { describe, expect, it } from 'vitest'
import { resolverEstatico, tipoContenido } from '../../src/panel/estaticos.js'

describe('resolverEstatico', () => {
  it.each([
    '/../etc/passwd',
    '/%2e%2e/x',
    '/assets/../index.html',
    '/assets/%2e%2e/index.html',
    '/a%00b',
    '/assets\\..\\secreto',
    '/assets%5c..%5csecreto',
    '/%E0%A4%A',
    '/api/instantanea',
  ])('rechaza la ruta insegura %s', (ruta) => {
    expect(resolverEstatico('/w', ruta)).toBeNull()
  })

  it('resuelve la raiz como index.html', () => {
    expect(resolverEstatico('/w', '/')).toBe('/w/index.html')
  })

  it('decodifica la ruta y elimina la query', () => {
    expect(resolverEstatico('/w', '/assets/x.js?v=1')).toBe('/w/assets/x.js')
    expect(resolverEstatico('/w', '/assets/icono%20uno.svg')).toBe(
      '/w/assets/icono uno.svg',
    )
  })
})

describe('tipoContenido', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
    ['app.css', 'text/css; charset=utf-8'],
    ['marca.svg', 'image/svg+xml'],
    ['foto.png', 'image/png'],
    ['datos.json', 'application/json; charset=utf-8'],
    ['favicon.ico', 'image/x-icon'],
    ['fuente.woff2', 'font/woff2'],
    ['archivo.bin', 'application/octet-stream'],
  ])('asigna %s a %s', (ruta, esperado) => {
    expect(tipoContenido(ruta)).toBe(esperado)
  })
})
