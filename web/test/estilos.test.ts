import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/estilos.css', import.meta.url)), 'utf8')

function bloqueReducido(texto: string): string {
  const inicio = texto.indexOf('@media (prefers-reduced-motion: reduce)')
  expect(inicio).toBeGreaterThan(-1)
  let profundidad = 0
  for (let i = texto.indexOf('{', inicio); i < texto.length; i += 1) {
    if (texto[i] === '{') profundidad += 1
    if (texto[i] === '}' && --profundidad === 0) return texto.slice(inicio, i + 1)
  }
  return ''
}

it('anula en prefers-reduced-motion cada selector animado, con el mismo selector', () => {
  const reducido = bloqueReducido(css)
  const fuera = css.replace(reducido, '')
  const animados = [...fuera.matchAll(/([^{}]+)\{[^}]*animation\s*:\s*(?!none)[^;}]+/g)]
    .flatMap((m) => (m[1] ?? '').split(','))
    .map((selector) => selector.trim())
    .filter((selector) => selector !== '' && !selector.startsWith('@') && !/^\d+%|^from|^to/.test(selector))
  expect(animados.length).toBeGreaterThan(0)
  for (const selector of animados) expect(reducido, selector).toContain(selector)
})
