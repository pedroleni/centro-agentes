import { crearGestorTerminalesReal, type GestorTerminales } from './gestor.js'
import { crearGestorTerminalesConptyReal } from './gestorConpty.js'

export function crearGestorTerminalesDelSistema(plataforma: NodeJS.Platform): GestorTerminales {
  return plataforma === 'win32' ? crearGestorTerminalesConptyReal() : crearGestorTerminalesReal()
}
