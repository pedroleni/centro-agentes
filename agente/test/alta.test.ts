import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { darDeAlta, leerConfigConexion } from '../src/alta.js'

const temporales: string[] = []
afterEach(async () => {
  await Promise.all(temporales.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

it('se da de alta en el hub y guarda el token con permisos 0600, sin el código', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'centro-alta-'))
  temporales.push(dir)
  const rutaConfig = path.join(dir, 'centro-agentes', 'agente.json')
  const fetch = vi.fn(async () => new Response(JSON.stringify({ maquinaId: 'abcdefabcdef', token: 'TOKEN123' }), { status: 200 }))
  const resultado = await darDeAlta({ hub: 'https://mini.ts.net/', codigo: 'G9KND9MX', nombre: 'MacBook', so: 'macos', fetch, rutaConfig })
  expect(resultado).toEqual({ maquinaId: 'abcdefabcdef' })
  expect(fetch).toHaveBeenCalledWith('https://mini.ts.net/api/alta', expect.objectContaining({ method: 'POST' }))
  const guardado = await readFile(rutaConfig, 'utf8')
  expect(guardado).not.toContain('G9KND9MX')
  expect((await stat(rutaConfig)).mode & 0o777).toBe(0o600)
  expect(await leerConfigConexion(rutaConfig)).toEqual({ hub: 'https://mini.ts.net', maquinaId: 'abcdefabcdef', token: 'TOKEN123', nombre: 'MacBook' })
})

it('explica el fallo si el hub rechaza el código', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'centro-alta-'))
  temporales.push(dir)
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'Código no válido o caducado' }), { status: 400 }))
  await expect(darDeAlta({ hub: 'https://mini.ts.net', codigo: 'X', nombre: 'M', so: 'macos', fetch, rutaConfig: path.join(dir, 'a.json') }))
    .rejects.toThrow('Código no válido o caducado')
})
