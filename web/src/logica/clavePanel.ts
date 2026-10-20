// Clave del panel local (ver agente/src/panel/clave.ts): llega en el enlace que
// imprime `npm run panel` (#clave=…) y se guarda en localStorage, que es de este
// origen, puerto incluido. En el hub no hay clave: allí manda la sesión.

const NOMBRE = 'ca_clave_panel'
const FORMATO = /^#clave=([A-Za-z0-9_-]{20,128})$/

export function claveDelEnlace(hash: string): string | null {
  return FORMATO.exec(hash)?.[1] ?? null
}

export function guardarClavePanel(clave: string): void {
  try {
    localStorage.setItem(NOMBRE, clave)
  } catch {
    // Sin almacenamiento (modo privado estricto): solo se pierde poder abrir terminales.
  }
}

export function clavePanel(): string | null {
  try {
    return localStorage.getItem(NOMBRE)
  } catch {
    return null
  }
}
