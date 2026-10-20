import { randomBytes } from 'node:crypto'
import {
  LIMITE_MENSAJE_BYTES,
  MensajeAgente,
  type Instantanea,
  type MaquinaVista,
  type MensajeHub,
  type Peticion,
  type SO,
} from '@centro/compartido'

// Registro de los agentes conectados al hub: guarda la última instantánea y el
// último latido de cada máquina, y hace de puente para las peticiones de lectura
// (commits y línea de tiempo) que el navegador pide a una máquina concreta.

const LATIDO_MAXIMO_MS = 20_000

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

type Pendiente = {
  maquinaId: string
  resolver(datos: unknown): void
  rechazar(error: Error): void
  temporizador: ReturnType<typeof setTimeout>
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

  function rechazarPendientes(maquinaId: string): void {
    for (const [id, pendiente] of pendientes) {
      if (pendiente.maquinaId !== maquinaId) continue
      clearTimeout(pendiente.temporizador)
      pendientes.delete(id)
      pendiente.rechazar(new SinConexion())
    }
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
