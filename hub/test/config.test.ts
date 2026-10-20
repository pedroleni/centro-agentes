import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { guardarConfigHub, leerConfigHub } from '../src/config.js'

const temporales: string[] = []
afterEach(async () => {
  await Promise.all(temporales.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

it('guarda la configuración con permisos 0600 en una carpeta 0700 y la vuelve a leer', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'centro-cfg-'))
  temporales.push(base)
  const ruta = path.join(base, 'centro-agentes', 'hub.json')
  const cfg = { puerto: 4700, hostPublico: 'mini.ts.net', propietarioTailscale: 'p@e.com', exigirTailscale: true, contrasena: { sal: 's', hash: 'h' } }
  await guardarConfigHub(ruta, cfg)
  expect((await stat(ruta)).mode & 0o777).toBe(0o600)
  expect((await stat(path.dirname(ruta))).mode & 0o777).toBe(0o700)
  expect(await leerConfigHub(ruta)).toEqual(cfg)
  expect(await readFile(ruta, 'utf8')).not.toContain('contrasena":"')
})

it('rechaza una configuración incompleta', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'centro-cfg-'))
  temporales.push(base)
  const ruta = path.join(base, 'hub.json')
  await guardarConfigHub(ruta, { puerto: 4700 } as never).catch(() => undefined)
  await expect(leerConfigHub(ruta)).rejects.toThrow()
})
