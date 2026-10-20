import path from 'node:path'

function estaDentro(base: string, candidata: string): boolean {
  const relativa = path.relative(base, candidata)
  return relativa === '' || (!relativa.startsWith(`..${path.sep}`) && relativa !== '..' && !path.isAbsolute(relativa))
}

export function resolverEstatico(dirWeb: string, rutaUrl: string): string | null {
  const rutaSinQuery = rutaUrl.split('?', 1)[0]
  if (rutaSinQuery === undefined) return null

  let decodificada: string
  try {
    decodificada = decodeURIComponent(rutaSinQuery)
  } catch {
    return null
  }

  if (
    !decodificada.startsWith('/') ||
    decodificada.includes('\0') ||
    decodificada.includes('\\') ||
    decodificada.split('/').includes('..') ||
    decodificada.startsWith('/api')
  ) {
    return null
  }

  const base = path.resolve(dirWeb)
  const relativa = decodificada === '/' ? 'index.html' : decodificada.slice(1)
  const candidata = path.resolve(base, relativa)
  return estaDentro(base, candidata) ? candidata : null
}

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

export function tipoContenido(ruta: string): string {
  return TIPOS[path.extname(ruta).toLowerCase()] ?? 'application/octet-stream'
}
