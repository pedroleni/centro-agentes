import { randomBytes } from 'node:crypto'
import {
  CIERRE_TERMINAL,
  LIMITE_MENSAJE_BYTES,
  MensajeAgente,
  type Instantanea,
  type MaquinaVista,
  type MensajeHub,
  type Peticion,
  type SO,
} from '@centro/compartido'

// Registro de los agentes conectados al hub: guarda la última instantánea y el
// último latido de cada máquina, hace de puente para las peticiones que el
// navegador pide a una máquina concreta y lleva los canales de los terminales
// abiertos en el navegador hasta el agente que los tiene.

const LATIDO_MAXIMO_MS = 20_000
const MAXIMO_CANALES_POR_MAQUINA = 16
// Trozos de entrada de 16 K unidades UTF-16: como mucho 48 KiB en UTF-8, por
// debajo de los 64 KiB que admite cada mensaje terminal-entrada.
const TROZO_ENTRADA = 16 * 1024

export type ConexionAgente = {
  enviar(mensaje: MensajeHub): void
  cerrar(codigo: number, motivo: string): void
}

export class SinConexion extends Error {
  constructor() { super('La máquina no está conectada') }
}

export class SinRespuesta extends Error {
  constructor() { super('La máquina no responde') }
}

export class DemasiadosCanales extends Error {
  constructor() { super('Demasiados terminales abiertos en esta máquina') }
}

// El lado del navegador de un canal: recibe la salida del terminal y su final.
export type NavegadorCanal = {
  datos(bytes: Buffer): void
  fin(codigo: number, motivo: string): void
}

export type Canal = {
  escribir(texto: string): void
  redimensionar(cols: number, rows: number): void
  soltar(): void
}

type Pendiente = {
  maquinaId: string
  resolver(datos: unknown): void
  rechazar(error: Error): void
  temporizador: ReturnType<typeof setTimeout>
}

type CanalAbierto = { maquinaId: string; navegador: NavegadorCanal }

// Parte el texto sin separar los pares sustitutos, así cada trozo es UTF-8 válido.
function trocear(texto: string): string[] {
  const trozos: string[] = []
  let inicio = 0
  while (inicio < texto.length) {
    let fin = Math.min(texto.length, inicio + TROZO_ENTRADA)
    const ultimo = texto.charCodeAt(fin - 1)
    if (fin < texto.length && ultimo >= 0xd800 && ultimo <= 0xdbff) fin -= 1
    trozos.push(texto.slice(inicio, fin))
    inicio = fin
  }
  return trozos
}

type DistribuirSinId<T> = T extends unknown ? Omit<T, 'id' | 'tipo'> : never
export type PeticionSinId = DistribuirSinId<Peticion>

// La identidad de la máquina la decide el hub (alta), no lo que diga el agente.
function imponerMaquina(instantanea: Instantanea | null, maquina: { id: string; nombre: string; so: SO }): Instantanea | null {
  if (instantanea === null) return null
  return { ...instantanea, maquina: { ...instantanea.maquina, id: maquina.id, nombre: maquina.nombre, so: maquina.so } }
}

export function crearConexiones(ahora: () => number = Date.now) {
  const activas = new Map<string, ConexionAgente>()
  const latidos = new Map<string, number>()
  const instantaneas = new Map<string, Instantanea>()
  const pendientes = new Map<string, Pendiente>()
  const canales = new Map<string, CanalAbierto>()

  // Cuando un agente se va, todo lo que esperaba algo de él termina: las
  // peticiones con SinConexion y los terminales del navegador con 4502.
  function rechazarPendientes(maquinaId: string): void {
    for (const [id, pendiente] of pendientes) {
      if (pendiente.maquinaId !== maquinaId) continue
      clearTimeout(pendiente.temporizador)
      pendientes.delete(id)
      pendiente.rechazar(new SinConexion())
    }
    for (const [id, canal] of canales) {
      if (canal.maquinaId !== maquinaId) continue
      canales.delete(id)
      canal.navegador.fin(CIERRE_TERMINAL.maquinaDesconectada, 'La máquina se ha desconectado')
    }
  }

  // Solo la máquina que tiene el canal puede escribir en él.
  function canalDe(maquinaId: string, id: string): CanalAbierto | null {
    const canal = canales.get(id)
    return canal !== undefined && canal.maquinaId === maquinaId ? canal : null
  }

  return {
    conectar(maquinaId: string, conexion: ConexionAgente): void {
      const anterior = activas.get(maquinaId)
      if (anterior !== undefined && anterior !== conexion) {
        anterior.cerrar(4409, 'Otra copia de este agente se ha conectado')
        rechazarPendientes(maquinaId)
      }
      activas.set(maquinaId, conexion)
    },

    recibir(maquinaId: string, crudo: string): void {
      const conexion = activas.get(maquinaId)
      if (conexion === undefined) return
      if (Buffer.byteLength(crudo) > LIMITE_MENSAJE_BYTES) {
        conexion.cerrar(4400, 'Mensaje demasiado grande')
        return
      }
      let mensaje: MensajeAgente
      try {
        mensaje = MensajeAgente.parse(JSON.parse(crudo))
      } catch {
        conexion.cerrar(4400, 'Mensaje no válido')
        return
      }
      if (mensaje.tipo === 'hola') {
        latidos.set(maquinaId, ahora())
      } else if (mensaje.tipo === 'instantanea') {
        latidos.set(maquinaId, ahora())
        instantaneas.set(maquinaId, mensaje.instantanea)
      } else if (mensaje.tipo === 'terminal-salida') {
        canalDe(maquinaId, mensaje.canal)?.navegador.datos(Buffer.from(mensaje.datos, 'base64'))
      } else if (mensaje.tipo === 'terminal-fin') {
        const canal = canalDe(maquinaId, mensaje.canal)
        if (canal === null) return
        canales.delete(mensaje.canal)
        if (mensaje.motivo === 'no-encontrado') canal.navegador.fin(CIERRE_TERMINAL.noEncontrado, 'Terminal no encontrado')
        else canal.navegador.fin(CIERRE_TERMINAL.terminada, 'La sesión ha terminado')
      } else if (mensaje.tipo === 'respuesta') {
        const pendiente = pendientes.get(mensaje.id)
        if (pendiente === undefined || pendiente.maquinaId !== maquinaId) return
        clearTimeout(pendiente.temporizador)
        pendientes.delete(mensaje.id)
        if (mensaje.ok) pendiente.resolver(mensaje.datos)
        else pendiente.rechazar(new Error(mensaje.error ?? 'Error en la máquina'))
      }
    },

    desconectar(maquinaId: string, conexion: ConexionAgente): void {
      if (activas.get(maquinaId) !== conexion) return
      activas.delete(maquinaId)
      rechazarPendientes(maquinaId)
    },

    pedir(maquinaId: string, peticion: PeticionSinId, timeoutMs = 10_000): Promise<unknown> {
      const conexion = activas.get(maquinaId)
      if (conexion === undefined) return Promise.reject(new SinConexion())
      const id = randomBytes(8).toString('hex')
      return new Promise((resolver, rechazar) => {
        const temporizador = setTimeout(() => {
          pendientes.delete(id)
          rechazar(new SinRespuesta())
        }, timeoutMs)
        pendientes.set(id, { maquinaId, resolver, rechazar, temporizador })
        conexion.enviar({ ...peticion, tipo: 'peticion', id } as MensajeHub)
      })
    },

    abrirCanal(maquinaId: string, terminalId: string, tamano: { cols: number; rows: number }, navegador: NavegadorCanal): Canal {
      const conexion = activas.get(maquinaId)
      if (conexion === undefined) throw new SinConexion()
      const abiertos = [...canales.values()].filter((canal) => canal.maquinaId === maquinaId).length
      if (abiertos >= MAXIMO_CANALES_POR_MAQUINA) throw new DemasiadosCanales()
      const id = randomBytes(8).toString('hex')
      canales.set(id, { maquinaId, navegador })
      conexion.enviar({ tipo: 'terminal-adjuntar', canal: id, terminalId, cols: tamano.cols, rows: tamano.rows })
      // Tras soltar el canal o perder la máquina, lo que llegue del navegador se descarta.
      const enviar = (mensaje: MensajeHub): void => {
        if (canales.get(id)?.maquinaId === maquinaId) activas.get(maquinaId)?.enviar(mensaje)
      }
      return {
        escribir(texto) {
          for (const trozo of trocear(texto)) {
            enviar({ tipo: 'terminal-entrada', canal: id, datos: Buffer.from(trozo, 'utf8').toString('base64') })
          }
        },
        redimensionar(cols, rows) {
          enviar({ tipo: 'terminal-tamano', canal: id, cols, rows })
        },
        soltar() {
          enviar({ tipo: 'terminal-soltar', canal: id })
          canales.delete(id)
        },
      }
    },

    vista(maquinas: { id: string; nombre: string; so: SO }[]): MaquinaVista[] {
      return maquinas.map((maquina) => {
        const latido = latidos.get(maquina.id) ?? null
        return {
          id: maquina.id,
          nombre: maquina.nombre,
          so: maquina.so,
          conectada: activas.has(maquina.id) && latido !== null && ahora() - latido < LATIDO_MAXIMO_MS,
          ultimoLatidoMs: latido,
          instantanea: imponerMaquina(instantaneas.get(maquina.id) ?? null, maquina),
        }
      })
    },

    cerrarMaquina(maquinaId: string, codigo: number, motivo: string): void {
      const conexion = activas.get(maquinaId)
      if (conexion === undefined) return
      activas.delete(maquinaId)
      rechazarPendientes(maquinaId)
      conexion.cerrar(codigo, motivo)
    },
  }
}

export type Conexiones = ReturnType<typeof crearConexiones>
