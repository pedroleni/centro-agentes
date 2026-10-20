// Teclas de la barra del terminal en el móvil, donde el teclado no las tiene.

export type Tecla = 'Esc' | 'Tab' | 'Arriba' | 'Abajo' | 'Derecha' | 'Izquierda'

const SECUENCIAS: Record<Tecla, string> = {
  Esc: '\x1b',
  Tab: '\t',
  Arriba: '\x1b[A',
  Abajo: '\x1b[B',
  Derecha: '\x1b[C',
  Izquierda: '\x1b[D',
}

export function secuenciaTecla(tecla: Tecla): string {
  return SECUENCIAS[tecla]
}

// Ctrl activado + una tecla: letras y [\]^_ dan su código de control (Ctrl+C = \x03).
export function conCtrl(texto: string): string {
  if (texto.length !== 1) return texto
  const codigo = texto.toUpperCase().charCodeAt(0)
  return codigo >= 64 && codigo <= 95 ? String.fromCharCode(codigo - 64) : texto
}
