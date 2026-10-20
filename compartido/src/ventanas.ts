const VENTANA_UN_MILLON = 1_000_000

export function ventanaContexto(modelo: string, extra: Record<string, number> = {}): number | null {
  const configurada = extra[modelo]
  if (configurada !== undefined) return configurada

  const base = modelo.replace(/\[[^\]]*\]$/, '')
  const configuradaBase = extra[base]
  if (configuradaBase !== undefined) return configuradaBase

  if (
    base.startsWith('claude-fable-5') ||
    base.startsWith('claude-mythos-5') ||
    base.startsWith('claude-opus-5') ||
    base.startsWith('claude-sonnet-5') ||
    base.startsWith('claude-haiku-5') ||
    /^claude-(opus|sonnet)-4-[678]$/.test(base) ||
    base === 'claude-sonnet-4-6'
  ) {
    return VENTANA_UN_MILLON
  }

  if (base === 'claude-haiku-4-5') return 200_000
  return null
}
