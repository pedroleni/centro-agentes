import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { cargarConfig } from '../../src/config.js'
import { descubrirProyectos, idProyecto } from '../../src/lectores/proyectos.js'
import type { RutasBase } from '../../src/rutas/base.js'

const temporales: string[] = []

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((ruta) => rm(ruta, { recursive: true, force: true })))
})

async function temporal(): Promise<string> {
  const ruta = await mkdtemp(path.join(os.tmpdir(), 'centro-proyectos-'))
  temporales.push(ruta)
  return ruta
}

async function marcarProyecto(ruta: string): Promise<void> {
  await mkdir(path.join(ruta, '.git'), { recursive: true })
}

describe('cargarConfig', () => {
  test('usa los valores predeterminados sin leer el home real', () => {
    const home = path.join(os.tmpdir(), 'home-sintetico-inexistente')
    const config = cargarConfig(null, home)

    expect(config.raices).toEqual([
      path.join(home, 'Desktop'),
      path.join(home, 'Downloads'),
      path.join(home, 'Documents'),
    ])
    expect(config.profundidad).toBe(2)
    expect(config.ocultos).toEqual([])
    expect(config.ventanasContexto).toEqual({})
    expect(config.nombreMaquina).toBe(os.hostname())
  })

  test('expande el ~ inicial de cada raíz con el home inyectado', async () => {
    const base = await temporal()
    const home = path.join(base, 'home falso')
    const rutaConfig = path.join(base, 'agente.config.json')
    await writeFile(
      rutaConfig,
      JSON.stringify({
        nombreMaquina: 'Pruebas',
        raices: ['~/Desktop', '~/Grupo X/Año ñ', '/ruta/absoluta'],
        profundidad: 3,
        ocultos: [],
        ventanasContexto: { prueba: 123 },
      }),
    )

    expect(cargarConfig(rutaConfig, home)).toEqual({
      nombreMaquina: 'Pruebas',
      raices: [path.join(home, 'Desktop'), path.join(home, 'Grupo X/Año ñ'), '/ruta/absoluta'],
      profundidad: 3,
      ocultos: [],
      ventanasContexto: { prueba: 123 },
    })
  })
})

describe('descubrirProyectos', () => {
  test('descubre, agrupa, filtra y elimina duplicados', async () => {
    const base = await temporal()
    const raiz = path.join(base, 'Raíz de proyectos')
    const home = path.join(base, 'home-sintético')
    const codex = path.join(base, 'codex-sintético')
    const temporalExcluido = path.join(base, 'temporal', 'repo')
    const a = path.join(raiz, 'A')
    const conAcentos = path.join(raiz, 'Grupo X', 'Año ñ')
    const demasiadoProfundo = path.join(raiz, 'a', 'b', 'c')
    const sinGit = path.join(raiz, 'C')
    const anidado = path.join(a, 'sub')
    const externo = path.join(base, 'Fuera de raíces', 'Externo')
    const oculto = path.join(raiz, 'Oculto')
    const inexistente = path.join(base, 'ya-no-existe')

    await Promise.all([
      marcarProyecto(a),
      marcarProyecto(conAcentos),
      marcarProyecto(demasiadoProfundo),
      mkdir(sinGit, { recursive: true }),
      marcarProyecto(anidado),
      marcarProyecto(externo),
      marcarProyecto(oculto),
      marcarProyecto(temporalExcluido),
      marcarProyecto(home),
      mkdir(codex, { recursive: true }),
    ])

    const proyectosToml = [externo, a, temporalExcluido, home, inexistente, '/private/tmp/x']
      .map((ruta) => `[projects.${JSON.stringify(ruta)}]\ntrust_level = "trusted"`)
      .join('\n')
    await writeFile(path.join(codex, 'config.toml'), proyectosToml)

    const cfg = {
      nombreMaquina: 'Pruebas',
      raices: [raiz],
      profundidad: 2,
      ocultos: [oculto],
      ventanasContexto: {},
    }
    const rutas: RutasBase = {
      home,
      claude: path.join(home, '.claude'),
      codex,
      temporales: [path.join(base, 'temporal'), '/private/tmp'],
    }

    const proyectos = await descubrirProyectos(cfg, rutas)
    const rutasEncontradas = proyectos.map((proyecto) => proyecto.ruta)
    const rutaRealA = await realpath(a)
    const rutaRealConAcentos = await realpath(conAcentos)
    const rutaRealExterno = await realpath(externo)

    expect(rutasEncontradas).toHaveLength(3)
    expect(rutasEncontradas).toEqual(
      expect.arrayContaining([rutaRealA, rutaRealConAcentos, rutaRealExterno]),
    )
    expect(rutasEncontradas).not.toEqual(
      expect.arrayContaining([
        demasiadoProfundo,
        sinGit,
        anidado,
        oculto,
        temporalExcluido,
        home,
        inexistente,
        '/private/tmp/x',
      ]),
    )
    expect(proyectos.find((proyecto) => proyecto.ruta === rutaRealA)?.grupo).toBe(path.basename(raiz))
    expect(proyectos.find((proyecto) => proyecto.ruta === rutaRealConAcentos)?.grupo).toBe('Grupo X')
  })

  test('genera un identificador estable a partir de la ruta real', () => {
    const ruta = path.join(os.tmpdir(), 'Grupo X', 'Año ñ')
    expect(idProyecto(ruta)).toBe(idProyecto(ruta))
    expect(idProyecto(ruta)).toMatch(/^[0-9a-f]{12}$/)
  })
})
