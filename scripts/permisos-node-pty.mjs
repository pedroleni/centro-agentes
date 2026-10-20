// node-pty 1.1 publica `spawn-helper` sin permiso de ejecución en sus binarios
// precompilados de macOS, y sin él no se puede abrir ningún terminal
// ("posix_spawnp failed"). Se arregla tras cada `npm install`. En Windows no hace falta.
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

if (process.platform !== 'win32') {
  const prebuilds = path.join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds')
  if (existsSync(prebuilds)) {
    for (const carpeta of readdirSync(prebuilds)) {
      const helper = path.join(prebuilds, carpeta, 'spawn-helper')
      if (existsSync(helper)) chmodSync(helper, 0o755)
    }
  }
}
