import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'

export const ConfigHub = z.object({
  puerto: z.number().int().min(1).max(65_535),
  hostPublico: z.string().min(1).nullable(),
  propietarioTailscale: z.string().min(1).nullable(),
  exigirTailscale: z.boolean(),
  contrasena: z.object({ sal: z.string().min(1), hash: z.string().min(1) }),
})
export type ConfigHub = z.infer<typeof ConfigHub>

export function carpetaCentro(): string {
  return path.join(os.homedir(), '.config', 'centro-agentes')
}

export async function leerConfigHub(ruta: string): Promise<ConfigHub> {
  return ConfigHub.parse(JSON.parse(await readFile(ruta, 'utf8')))
}

// La configuración lleva el hash de la contraseña: carpeta 0700 y fichero 0600.
export async function guardarConfigHub(ruta: string, cfg: ConfigHub): Promise<void> {
  const valida = ConfigHub.parse(cfg)
  await mkdir(path.dirname(ruta), { recursive: true, mode: 0o700 })
  await chmod(path.dirname(ruta), 0o700)
  await writeFile(ruta, `${JSON.stringify(valida, null, 2)}\n`, { mode: 0o600 })
  await chmod(ruta, 0o600)
}
