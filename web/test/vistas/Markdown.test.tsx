// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown } from '../../src/vistas/Markdown.js'

afterEach(cleanup)

function html(texto: string): HTMLElement {
  return render(<Markdown texto={texto} />).container
}

describe('Markdown', () => {
  it('convierte negrita, cursiva y código en línea', () => {
    const c = html('Esto es **importante**, *sutil* y `npm test`.')
    expect(c.querySelector('strong')?.textContent).toBe('importante')
    expect(c.querySelector('em')?.textContent).toBe('sutil')
    expect(c.querySelector('code')?.textContent).toBe('npm test')
  })

  it('convierte listas con viñetas y numeradas, y bloques de código', () => {
    const c = html('- uno\n- dos\n\n1. primero\n2. segundo\n\n```bash\nnpm run panel\n```')
    expect([...c.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['uno', 'dos'])
    expect([...c.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual(['primero', 'segundo'])
    expect(c.querySelector('pre code')?.textContent).toBe('npm run panel')
  })

  it('solo enlaza URLs http(s) y abre en otra pestaña sin opener', () => {
    const c = html('[panel](http://127.0.0.1:4600) y [malo](javascript:alert(1))')
    const enlaces = c.querySelectorAll('a')
    expect(enlaces).toHaveLength(1)
    expect(enlaces[0]?.getAttribute('href')).toBe('http://127.0.0.1:4600')
    expect(enlaces[0]?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(c.textContent).toContain('malo')
  })

  it('nunca interpreta HTML del texto', () => {
    const c = html('<script>alert(1)</script> <img src=x onerror=alert(1)> **hola**')
    expect(c.querySelector('script')).toBeNull()
    expect(c.querySelector('img')).toBeNull()
    expect(c.textContent).toContain('<script>alert(1)</script>')
  })

  it('respeta los saltos de línea simples dentro de un párrafo', () => {
    const c = html('línea uno\nlínea dos')
    expect(c.querySelectorAll('br')).toHaveLength(1)
  })
})
