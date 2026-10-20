import { Fragment, type ReactNode } from 'react'

// Intérprete mínimo de Markdown para los mensajes de la línea de tiempo. Genera
// elementos de React (nunca HTML en crudo), así que ningún texto de un agente puede
// inyectar etiquetas. Cubre lo que usan los agentes: párrafos, saltos de línea,
// listas, bloques de código, encabezados, **negrita**, *cursiva*, `código` y enlaces
// http(s).

type Bloque =
  | { tipo: 'parrafo'; lineas: string[] }
  | { tipo: 'lista'; ordenada: boolean; elementos: string[] }
  | { tipo: 'codigo'; texto: string }
  | { tipo: 'titulo'; texto: string }

const VINETA = /^\s*[-*+]\s+(.*)$/
const NUMERO = /^\s*\d+[.)]\s+(.*)$/
const TITULO = /^#{1,6}\s+(.*)$/

function bloques(texto: string): Bloque[] {
  const resultado: Bloque[] = []
  const lineas = texto.replace(/\r\n/g, '\n').split('\n')
  let indice = 0
  while (indice < lineas.length) {
    const linea = lineas[indice] ?? ''
    if (linea.trimStart().startsWith('```')) {
      const codigo: string[] = []
      indice += 1
      while (indice < lineas.length && !(lineas[indice] ?? '').trimStart().startsWith('```')) {
        codigo.push(lineas[indice] ?? '')
        indice += 1
      }
      resultado.push({ tipo: 'codigo', texto: codigo.join('\n') })
      indice += 1
      continue
    }
    if (linea.trim() === '') {
      indice += 1
      continue
    }
    const titulo = TITULO.exec(linea)
    if (titulo) {
      resultado.push({ tipo: 'titulo', texto: titulo[1] ?? '' })
      indice += 1
      continue
    }
    const ordenada = NUMERO.test(linea)
    if (ordenada || VINETA.test(linea)) {
      const patron = ordenada ? NUMERO : VINETA
      const elementos: string[] = []
      while (indice < lineas.length && patron.test(lineas[indice] ?? '')) {
        elementos.push(patron.exec(lineas[indice] ?? '')?.[1] ?? '')
        indice += 1
      }
      resultado.push({ tipo: 'lista', ordenada, elementos })
      continue
    }
    const parrafo: string[] = []
    while (
      indice < lineas.length &&
      (lineas[indice] ?? '').trim() !== '' &&
      !(lineas[indice] ?? '').trimStart().startsWith('```') &&
      !TITULO.test(lineas[indice] ?? '') &&
      !VINETA.test(lineas[indice] ?? '') &&
      !NUMERO.test(lineas[indice] ?? '')
    ) {
      parrafo.push(lineas[indice] ?? '')
      indice += 1
    }
    resultado.push({ tipo: 'parrafo', lineas: parrafo })
  }
  return resultado
}

// Código, enlace, negrita y cursiva, en ese orden de prioridad.
const EN_LINEA = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/g

function enLinea(texto: string, clave: string): ReactNode[] {
  const nodos: ReactNode[] = []
  let ultimo = 0
  for (const coincidencia of texto.matchAll(EN_LINEA)) {
    const inicio = coincidencia.index ?? 0
    if (inicio > ultimo) nodos.push(texto.slice(ultimo, inicio))
    const k = `${clave}-${inicio}`
    const [, codigo, textoEnlace, url, negrita, negrita2, cursiva, cursiva2] = coincidencia
    if (codigo !== undefined) {
      nodos.push(<code key={k}>{codigo}</code>)
    } else if (textoEnlace !== undefined) {
      nodos.push(/^https?:\/\//i.test(url ?? '')
        ? <a key={k} href={url} target="_blank" rel="noopener noreferrer">{textoEnlace}</a>
        : <Fragment key={k}>{textoEnlace}</Fragment>)
    } else if ((negrita ?? negrita2) !== undefined) {
      nodos.push(<strong key={k}>{enLinea(negrita ?? negrita2 ?? '', k)}</strong>)
    } else {
      nodos.push(<em key={k}>{cursiva ?? cursiva2}</em>)
    }
    ultimo = inicio + coincidencia[0].length
  }
  if (ultimo < texto.length) nodos.push(texto.slice(ultimo))
  return nodos
}

export function Markdown({ texto }: { texto: string }) {
  return (
    <div className="md">
      {bloques(texto).map((bloque, i) => {
        const clave = `b${i}`
        if (bloque.tipo === 'codigo') return <pre key={clave}><code>{bloque.texto}</code></pre>
        if (bloque.tipo === 'titulo') return <p key={clave} className="md-titulo"><strong>{enLinea(bloque.texto, clave)}</strong></p>
        if (bloque.tipo === 'lista') {
          const elementos = bloque.elementos.map((elemento, j) => <li key={`${clave}-${j}`}>{enLinea(elemento, `${clave}-${j}`)}</li>)
          return bloque.ordenada ? <ol key={clave}>{elementos}</ol> : <ul key={clave}>{elementos}</ul>
        }
        return (
          <p key={clave}>
            {bloque.lineas.map((linea, j) => (
              <Fragment key={`${clave}-${j}`}>
                {j > 0 && <br />}
                {enLinea(linea, `${clave}-${j}`)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
