import { describe, expect, it } from 'vitest'
import { leerRuta, maquinaDeRuta, rutaAgente, rutaProyecto } from '../../src/logica/rutas.js'

const instantanea = (proyectos: string[], agentes: string[]) => ({
  version: 1 as const,
  maquina: { id: 'x', nombre: 'x', so: 'macos' as const, avisos: [] },
  generadaMs: 1,
  proyectos: proyectos.map((id) => ({ id })) as never[],
  agentes: agentes.map((id) => ({ id })) as never[],
})
const maquinas = [
  { id: 'aaaaaaaaaaaa', nombre: 'MacBook', so: 'macos' as const, conectada: true, ultimoLatidoMs: 1, instantanea: instantanea(['p1'], ['claude:a']) },
  { id: 'bbbbbbbbbbbb', nombre: 'Windows', so: 'windows' as const, conectada: false, ultimoLatidoMs: 1, instantanea: instantanea(['p2'], ['codex:b']) },
]

describe('rutas', () => {
  it('construye y lee las rutas nuevas con máquina', () => {
    expect(rutaProyecto('aaaaaaaaaaaa', 'p1')).toBe('#/m/aaaaaaaaaaaa/proyecto/p1')
    expect(rutaAgente('aaaaaaaaaaaa', 'claude:a')).toBe('#/m/aaaaaaaaaaaa/agente/claude%3Aa')
    expect(leerRuta('#/m/aaaaaaaaaaaa/proyecto/p1')).toEqual({ vista: 'proyecto', maquinaId: 'aaaaaaaaaaaa', proyectoId: 'p1' })
    expect(leerRuta('#/m/aaaaaaaaaaaa/agente/claude%3Aa')).toEqual({ vista: 'agente', maquinaId: 'aaaaaaaaaaaa', agenteId: 'claude:a' })
  })

  it('sigue leyendo las rutas antiguas sin máquina, y lo demás es la vista general', () => {
    expect(leerRuta('#/proyecto/p1')).toEqual({ vista: 'proyecto', maquinaId: null, proyectoId: 'p1' })
    expect(leerRuta('#/agente/codex%3Ab')).toEqual({ vista: 'agente', maquinaId: null, agenteId: 'codex:b' })
    expect(leerRuta('#/')).toEqual({ vista: 'general' })
    expect(leerRuta('#/agente/%E0%A4%A')).toEqual({ vista: 'general' })
  })

  it('resuelve la máquina por su id o, en rutas antiguas, por quién tiene el proyecto o el agente', () => {
    expect(maquinaDeRuta({ vista: 'proyecto', maquinaId: 'bbbbbbbbbbbb', proyectoId: 'p2' }, maquinas)?.nombre).toBe('Windows')
    expect(maquinaDeRuta({ vista: 'agente', maquinaId: null, agenteId: 'codex:b' }, maquinas)?.nombre).toBe('Windows')
    expect(maquinaDeRuta({ vista: 'proyecto', maquinaId: null, proyectoId: 'p1' }, maquinas)?.nombre).toBe('MacBook')
    expect(maquinaDeRuta({ vista: 'proyecto', maquinaId: 'cccccccccccc', proyectoId: 'p1' }, maquinas)).toBeNull()
  })
})
