const OCULTO = '«oculto»'
const MAXIMO_CARACTERES = 20_000

const PATRONES_SECRETOS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bghp_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
]

function truncar(texto: string): string {
  return texto.length <= MAXIMO_CARACTERES
    ? texto
    : `${texto.slice(0, MAXIMO_CARACTERES)}…`
}

function enmascararClavesPrivadas(texto: string): string {
  let resultado = ''
  let posicion = 0
  const inicioBase = '-----BEGIN '

  while (posicion < texto.length) {
    const inicio = texto.indexOf(inicioBase, posicion)
    if (inicio === -1) return resultado + texto.slice(posicion)
    const finLinea = texto.indexOf('-----', inicio + inicioBase.length)
    if (finLinea === -1) return resultado + texto.slice(posicion)

    const encabezado = texto.slice(inicio, finLinea + 5)
    if (!/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----$/.test(encabezado)) {
      resultado += texto.slice(posicion, inicio + inicioBase.length)
      posicion = inicio + inicioBase.length
      continue
    }

    const cierre = encabezado.replace('-----BEGIN ', '-----END ')
    const inicioCierre = texto.indexOf(cierre, finLinea + 5)
    if (inicioCierre === -1) return resultado + texto.slice(posicion)
    resultado += texto.slice(posicion, inicio) + OCULTO
    posicion = inicioCierre + cierre.length
  }

  return resultado
}

function nombreSecreto(nombre: string): boolean {
  const mayusculas = nombre.toUpperCase()
  return ['KEY', 'SECRET', 'TOKEN', 'PASSWORD'].some((parte) => mayusculas.includes(parte))
}

function valorOculto(valor: string): string {
  const limpio = valor.trim()
  const comilla = limpio[0]
  return comilla !== undefined && (comilla === '"' || comilla === "'") && limpio.endsWith(comilla)
    ? `${comilla}${OCULTO}${comilla}`
    : OCULTO
}

function enmascararAsignacion(linea: string): string {
  const igual = linea.indexOf('=')
  if (igual === -1) return linea

  let nombre = linea.slice(0, igual).trim()
  if (/^export\s+/i.test(nombre)) nombre = nombre.replace(/^export\s+/i, '')
  if (/^\$env:/i.test(nombre)) nombre = nombre.slice(5)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nombre) || !nombreSecreto(nombre)) return linea

  const despuesIgual = linea.slice(igual + 1)
  const espacios = /^[ \t]*/.exec(despuesIgual)?.[0] ?? ''
  return `${linea.slice(0, igual + 1)}${espacios}${valorOculto(despuesIgual)}`
}

function enmascararYaml(linea: string): string {
  const dosPuntos = linea.indexOf(':')
  if (dosPuntos === -1) return linea
  const nombre = linea.slice(0, dosPuntos).trim().toLowerCase()
  if (nombre !== 'password' && nombre !== 'token') return linea

  const despues = linea.slice(dosPuntos + 1)
  const espacios = /^[ \t]*/.exec(despues)?.[0] ?? ''
  return `${linea.slice(0, dosPuntos + 1)}${espacios}${valorOculto(despues)}`
}

function porLineas(texto: string, transformar: (linea: string) => string): string {
  return texto
    .split(/(\r?\n)/)
    .map((fragmento, indice) => (indice % 2 === 0 ? transformar(fragmento) : fragmento))
    .join('')
}

export function enmascararSecretos(texto: string): string {
  let enmascarado = enmascararClavesPrivadas(truncar(texto))
    .replace(
      /("(?:api_key|password|authorization)"[ \t]*:[ \t]*")[^"\r\n]*(")/gi,
      `$1${OCULTO}$2`,
    )
    .replace(/(Authorization[ \t]*:[ \t]*)[^\r\n]+/gi, `$1${OCULTO}`)

  enmascarado = porLineas(enmascarado, enmascararAsignacion)
  enmascarado = porLineas(enmascarado, enmascararYaml)

  for (const patron of PATRONES_SECRETOS) {
    enmascarado = enmascarado.replace(patron, OCULTO)
  }

  return enmascarado
}
