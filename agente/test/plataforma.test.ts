import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Los scripts tienen que funcionar igual en macOS y en el cmd.exe de Windows.
describe('scripts de npm en cualquier sistema', () => {
  it('ningún script de npm usa la sintaxis de variables de POSIX', () => {
    const { scripts } = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    for (const [nombre, orden] of Object.entries(scripts)) expect(orden, nombre).not.toMatch(/\b[A-Z_]+='/)
  })

  it('el .npmrc del repo da a Node los flags de sqlite', () => {
    expect(readFileSync(path.join(raiz, '.npmrc'), 'utf8')).toContain('node-options=--experimental-sqlite --no-warnings=ExperimentalWarning')
  })
})
