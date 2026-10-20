// Parte un texto en trozos de como mucho `maximo` unidades UTF-16 sin separar
// los pares sustitutos, así cada trozo es UTF-8 válido. Con 16 K unidades, un
// trozo ocupa como mucho 48 KiB en UTF-8: cabe en un mensaje de terminal.
export function trocearTexto(texto: string, maximo = 16 * 1024): string[] {
  const trozos: string[] = []
  let inicio = 0
  while (inicio < texto.length) {
    let fin = Math.min(texto.length, inicio + maximo)
    const ultimo = texto.charCodeAt(fin - 1)
    if (fin < texto.length && fin - inicio > 1 && ultimo >= 0xd800 && ultimo <= 0xdbff) fin -= 1
    trozos.push(texto.slice(inicio, fin))
    inicio = fin
  }
  return trozos
}
