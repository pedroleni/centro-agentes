import { describe, expect, it } from 'vitest'
import { asignarProyectos } from '../src/asignacion.js'
import type { ProyectoBase } from '../src/lectores/proyectos.js'

const proyectos: ProyectoBase[] = [
  { id: 'raiz', nombre: 'Proyectos IA', ruta: '/r/Proyectos IA', grupo: 'r' },
  { id: 'idA', nombre: 'a', ruta: '/r/Proyectos IA/a', grupo: 'Proyectos IA' },
  { id: 'idB', nombre: 'b', ruta: '/r/Proyectos IA/b', grupo: 'Proyectos IA' },
]

describe('asignarProyectos', () => {
  it('elige el prefijo de cwd mas largo', () => {
    expect(asignarProyectos('/r/Proyectos IA/b/src', [], proyectos)).toEqual(['idB'])
  })

  it('usa los ficheros editados, sin repetidos y por primera aparicion, si cwd no coincide', () => {
    expect(
      asignarProyectos(
        '/r',
        [
          '/r/Proyectos IA/b/x.ts',
          '/r/Proyectos IA/a/y.ts',
          '/r/Proyectos IA/b/z.ts',
        ],
        proyectos.slice(1),
      ),
    ).toEqual(['idB', 'idA'])
  })

  it('devuelve vacio sin coincidencias', () => {
    expect(asignarProyectos('/otra', ['/fuera/x.ts'], proyectos)).toEqual([])
  })
})
