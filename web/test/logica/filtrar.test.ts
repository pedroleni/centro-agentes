import { describe, expect, it } from 'vitest'
import type { Agente, Proyecto } from '@centro/compartido'
import type { Grupo, TarjetaDatos } from '../../src/logica/agrupar.js'
import { filtrarGrupos } from '../../src/logica/filtrar.js'

function crearAgente(cambios: Partial<Agente> = {}): Agente {
  return {
    id: 'claude:uno', tipo: 'claude', modo: 'interactivo', titulo: 'Sesión', cwd: '/proyecto',
    proyectoIds: ['proyecto-1'], estado: 'cerrada', rol: 'claude', ultimaAccion: null,
    resumenActividad: { comandos: 0, ediciones: 0, mensajes: 0, ficheros: [] }, modelo: null, esfuerzo: null,
    contexto: null, tokensTotales: null, ultimoPrompt: null, rama: null, pr: null,
    inicioMs: null, ultimaActividadMs: 0, padreId: null, entrada: null,
    puedeContinuar: true, tareas: [], commitsPorProyecto: {}, ...cambios,
  }
}

function crearProyecto(cambios: Partial<Proyecto> = {}): Proyecto {
  return {
    id: 'proyecto-1', nombre: 'tech-study-tracker', ruta: '/proyecto', grupo: 'Trabajo',
    git: { rama: 'main', ultimoCommit: null, cambios: 0, adelante: 0, atras: 0, ramas: ['main'], actividad14d: Array.from({ length: 14 }, () => 0) },
    pendientes: [], ultimaActividadMs: 0, ...cambios,
  }
}

function tarjeta(cambios: Partial<TarjetaDatos> = {}): TarjetaDatos {
  return {
    proyecto: crearProyecto(), agentes: [], ultimoPrompt: null, pendientes: 0, activo: false,
    ...cambios,
  }
}

function grupos(...tarjetas: TarjetaDatos[]): Grupo[] {
  return [{ nombre: 'Trabajo', tarjetas, inactivas: [] }]
}

describe('filtrarGrupos', () => {
  it('deja solo las tarjetas con un agente esperándome', () => {
    const esperando = tarjeta({
      proyecto: crearProyecto({ id: 'esperando', nombre: 'Esperando' }),
      agentes: [crearAgente({ estado: 'esperandote' })],
    })
    const trabajando = tarjeta({
      proyecto: crearProyecto({ id: 'trabajando', nombre: 'Trabajando' }),
      agentes: [crearAgente({ estado: 'trabajando' })],
    })

    expect(filtrarGrupos(grupos(esperando, trabajando), 'esperandome', '')[0]?.tarjetas).toEqual([
      esperando,
    ])
  })

  it('deja solo las tarjetas con pendientes', () => {
    const pendiente = tarjeta({ pendientes: 2 })
    const alDia = tarjeta({ proyecto: crearProyecto({ id: 'al-dia' }) })

    expect(filtrarGrupos(grupos(pendiente, alDia), 'pendientes', '')[0]?.tarjetas).toEqual([
      pendiente,
    ])
  })

  it('busca el nombre sin distinguir mayúsculas', () => {
    const encontrada = tarjeta()

    expect(filtrarGrupos(grupos(encontrada), 'todos', 'TECH-STUDY')[0]?.tarjetas).toEqual([
      encontrada,
    ])
  })

  it('busca títulos sin distinguir acentos', () => {
    const encontrada = tarjeta({ agentes: [crearAgente({ titulo: 'Aplicación' })] })

    expect(filtrarGrupos(grupos(encontrada), 'todos', 'aplicacion')[0]?.tarjetas).toEqual([
      encontrada,
    ])
  })

  it('busca en la rama y elimina grupos vacíos', () => {
    const encontrada = tarjeta({ proyecto: crearProyecto({ git: { ...crearProyecto().git, rama: 'fase-panel' } }) })

    expect(filtrarGrupos(grupos(encontrada), 'todos', 'inexistente')).toEqual([])
    expect(filtrarGrupos(grupos(encontrada), 'todos', 'FASE-PANEL')).toHaveLength(1)
  })
})
