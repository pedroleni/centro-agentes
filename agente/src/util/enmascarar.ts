const OCULTO = '«oculto»'

const PATRONES_SECRETOS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bghp_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
]

export function enmascararSecretos(texto: string): string {
  let enmascarado = texto
    .replace(/(Authorization\s*:\s*)[^\r\n]+/gi, `$1${OCULTO}`)
    .replace(
      /^(\s*[A-Za-z_][A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_]*\s*=\s*)[^\r\n]*$/gim,
      `$1${OCULTO}`,
    )

  for (const patron of PATRONES_SECRETOS) {
    enmascarado = enmascarado.replace(patron, OCULTO)
  }

  return enmascarado
}
