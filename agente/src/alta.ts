import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { SO } from '@centro/compartido'

// Alta de esta máquina en el hub: canjea el código de un solo uso por un token
// propio y lo guarda en ~/.config/centro-agentes/agente.json con permisos 0600.

export const ConfigConexion = z.object({
  hub: z.string().url(),
  maquinaId: z.string().regex(/^[0-9a-f]{12}$/),
  token: z.string().min(1),
  nombre: z.string().min(1),
})
export type ConfigConexion = z.infer<typeof ConfigConexion>

export function rutaConfigConexion(): string {
  return path.join(os.homedir(), '.config', 'centro-agentes', 'agente.json')
}

export async function leerConfigConexion(ruta: string): Promise<ConfigConexion> {
  return ConfigConexion.parse(JSON.parse(await readFile(ruta, 'utf8')))
}

export async function darDeAlta(opciones: {
  hub: string
  codigo: string
  nombre: string
  so: SO
  fetch: typeof fetch
  rutaConfig: string
}): Promise<{ maquinaId: string }> {
  const hub = opciones.hub.replace(/\/+$/, '')
  const respuesta = await opciones.fetch(`${hub}/api/alta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: opciones.codigo, nombre: opciones.nombre, so: opciones.so }),
  })
  const cuerpo = (await respuesta.json().catch(() => ({}))) as { maquinaId?: string; token?: string; error?: string }
  if (!respuesta.ok || cuerpo.maquinaId === undefined || cuerpo.token === undefined) {
    throw new Error(cuerpo.error ?? `El hub respondió con ${respuesta.status}`)
  }
  const config = ConfigConexion.parse({ hub, maquinaId: cuerpo.maquinaId, token: cuerpo.token, nombre: opciones.nombre })
  await mkdir(path.dirname(opciones.rutaConfig), { recursive: true, mode: 0o700 })
  await writeFile(opciones.rutaConfig, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await chmod(opciones.rutaConfig, 0o600)
  return { maquinaId: config.maquinaId }
}
