import { mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { leerHandoff, leerPlanes } from '../../src/lectores/pendientes.js'

const temporales: string[] = []

async function fixture(): Promise<{ raiz: string; proyecto: string }> {
  const raiz = path.join(os.tmpdir(), `centro-pendientes-${Date.now()}-${Math.random()}`)
  await mkdir(raiz, { recursive: true })
  temporales.push(raiz)
  const proyecto = path.join(raiz, 'proyecto-a')
  await mkdir(path.join(proyecto, 'docs', 'superpowers', 'plans'), { recursive: true })
  return { raiz, proyecto }
}

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((ruta) => rm(ruta, { recursive: true, force: true })))
})

describe('lectores de pendientes', () => {
  it('lee planes con fecha, título y progreso, e ignora los que no tienen casillas', async () => {
    const { proyecto } = await fixture()
    await writeFile(
      path.join(proyecto, 'docs/superpowers/plans/2026-08-31-git.md'),
      '# Plan de git\n\n- [x] Uno\n  - [X] Dos\n- [ ] Tres\n    - [ ] Cuatro\n- [ ] Cinco\n',
    )
    await writeFile(path.join(proyecto, 'docs/superpowers/plans/2026-09-01-vacio.md'), '# Sin tareas\n')

    await expect(leerPlanes(proyecto)).resolves.toEqual([
      {
        origen: 'plan',
        titulo: 'Plan de git',
        fechaMs: Date.UTC(2026, 7, 31),
        hechas: 2,
        total: 5,
        quizaDesactualizado: false,
      },
    ])
  })

  it('lee la sección del proyecto en un handoff de la carpeta padre', async () => {
    const { raiz, proyecto } = await fixture()
    await writeFile(
      path.join(raiz, 'HANDOFF.md'),
      '# Estado al cerrar sesión — 2026-08-14\n\n## 1. proyecto-a — feature a medio camino\n\n**LO QUE FALTA, y es lo primero que hay que hacer:**\n\n1. **Aplicar `0004.sql` a mano** en el SQL Editor…\n2. **Verificación final** de la migración\n\n## 2. proyecto-b — otro\n',
    )
    const pendiente = await leerHandoff(proyecto, Date.UTC(2026, 8, 11))
    expect(pendiente).toEqual({
      origen: 'handoff',
      titulo: 'Aplicar 0004.sql a mano en el SQL Editor…',
      fechaMs: Date.UTC(2026, 7, 14),
      hechas: null,
      total: null,
      quizaDesactualizado: true,
    })
  })

  it('devuelve null cuando el handoff padre no tiene sección del proyecto', async () => {
    const { raiz, proyecto } = await fixture()
    await writeFile(path.join(raiz, 'HANDOFF.md'), '# Estado\n\n## 1. proyecto-b\n\n- Otra cosa\n')
    await expect(leerHandoff(proyecto, null)).resolves.toBeNull()
  })

  it('usa un HANDOFF propio aunque no haya sección y toma su mtime sin fecha', async () => {
    const { proyecto } = await fixture()
    const ruta = path.join(proyecto, 'HANDOFF.md')
    await writeFile(ruta, '# Estado\n\n**Pendiente:**\n\n- Revisar cambios\n')
    const fecha = new Date(Date.UTC(2026, 7, 20))
    await utimes(ruta, fecha, fecha)
    const pendiente = await leerHandoff(proyecto, null)
    expect(pendiente?.titulo).toBe('Revisar cambios')
    expect(pendiente?.fechaMs).toBe(fecha.getTime())
  })
  it('una sección sin "lo que falta" usa su propio encabezado, nunca un título vacío', async () => {
    const { raiz } = await fixture()
    const proyectoB = path.join(raiz, 'proyecto-b')
    await mkdir(proyectoB, { recursive: true })
    await writeFile(
      path.join(raiz, 'HANDOFF.md'),
      '# Estado — 2026-08-14\n\n## 1. proyecto-a — algo\n\n- x\n\n## 2. proyecto-b — terminado y funcionando\n\nRepo aparte, ya en GitHub.\n',
    )

    const pendiente = await leerHandoff(proyectoB, null)
    expect(pendiente?.titulo).toBe('2. proyecto-b — terminado y funcionando')
  })

  it('une un elemento de lista partido en varias líneas', async () => {
    const { raiz, proyecto } = await fixture()
    await writeFile(
      path.join(raiz, 'HANDOFF.md'),
      '# Estado — 2026-08-14\n\n## 1. proyecto-a — algo\n\n**LO QUE FALTA:**\n1. **Aplicar `0004.sql` a mano** en el SQL Editor de\n   Supabase, copiando el fichero.\n2. Otra cosa\n',
    )

    const pendiente = await leerHandoff(proyecto, null)
    expect(pendiente?.titulo).toBe('Aplicar 0004.sql a mano en el SQL Editor de Supabase, copiando el fichero.')
  })
})
