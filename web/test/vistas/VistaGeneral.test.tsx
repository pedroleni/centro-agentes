// @vitest-environment jsdom
import type { Agente, Instantanea, MaquinaVista, Proyecto, RespuestaMaquinas } from '@centro/compartido'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VistaGeneral } from '../../src/vistas/VistaGeneral.js'

const AHORA = new Date(2026, 9, 20, 12).getTime()

afterEach(cleanup)

function crearProyecto(cambios: Partial<Proyecto> = {}): Proyecto {
  return {
    id: 'centro-agentes',
    nombre: 'centro-agentes',
    ruta: '/proyectos/centro-agentes',
    grupo: 'Proyectos IA',
    git: {
      rama: 'main',
      ultimoCommit: {
        hash: '0123456',
        mensaje: 'Añade la vista general',
        fechaMs: AHORA - 60_000,
      },
      cambios: 2,
      adelante: 0,
      atras: 0,
      ramas: ['main'],
      actividad14d: [0, 1, 0, 2, 3, 1, 0, 0, 4, 2, 0, 1, 3, 2],
    },
    pendientes: [],
    ultimaActividadMs: AHORA - 30_000,
    ...cambios,
  }
}

function crearAgente(cambios: Partial<Agente> = {}): Agente {
  return {
    id: 'claude:sesion-1',
    tipo: 'claude',
    modo: 'interactivo',
    titulo: 'Implementar la vista general',
    cwd: '/proyectos/centro-agentes',
    proyectoIds: ['centro-agentes'],
    estado: 'trabajando',
    rol: 'claude',
    ultimaAccion: null,
    resumenActividad: { comandos: 0, ediciones: 0, mensajes: 0, ficheros: [] },
    modelo: 'Opus 5.5',
    esfuerzo: null,
    contexto: { usados: 11, ventana: 100 },
    tokensTotales: 11,
    ultimoPrompt: 'Implementa exactamente la vista general',
    rama: 'main',
    pr: null,
    inicioMs: AHORA - 60 * 60_000,
    ultimaActividadMs: AHORA - 10_000,
    padreId: null,
    entrada: null,
    puedeContinuar: true,
    tareas: [],
    commitsPorProyecto: {},
    ...cambios,
  }
}

function crearInstantanea(
  proyectos: Proyecto[] = [crearProyecto()],
  agentes: Agente[] = [crearAgente()],
): Instantanea {
  return {
    version: 1,
    maquina: { id: 'mac', nombre: 'Mac de pruebas', so: 'macos', avisos: [] },
    generadaMs: AHORA - 5_000,
    proyectos,
    agentes,
  }
}

function maquina(instantanea: Instantanea | null, cambios: Partial<MaquinaVista> = {}): MaquinaVista {
  return {
    id: 'aaaaaaaaaaaa',
    nombre: instantanea?.maquina.nombre ?? 'Mac de pruebas',
    so: 'macos',
    conectada: true,
    ultimoLatidoMs: AHORA - 5_000,
    instantanea,
    ...cambios,
  }
}

function local(datos: Instantanea): RespuestaMaquinas {
  return { modo: 'local', maquinas: [maquina(datos)] }
}

function pintar(datos = crearInstantanea(), error = false) {
  return render(
    <VistaGeneral respuesta={local(datos)} error={error} actualizadaMs={datos.generadaMs} ahora={AHORA} />,
  )
}

describe('VistaGeneral', () => {
  it('pinta el título del panel', () => {
    pintar()
    expect(screen.getByText('Centro de agentes')).toBeTruthy()
  })

  it('muestra el estado y el contexto del agente que trabaja', () => {
    const { container } = pintar()
    // El agente aparece en "En directo" y en su tarjeta: se comprueba la tarjeta.
    const tarjeta = container.querySelector<HTMLElement>('.ca-card-clickable')
    expect(tarjeta).not.toBeNull()
    expect(within(tarjeta!).getByText('Trabajando')).toBeTruthy()
    expect(within(tarjeta!).getByText('11%')).toBeTruthy()
  })

  it('oculta una tarjeta sin agentes esperando al activar Esperándome', () => {
    pintar()
    fireEvent.click(screen.getByRole('button', { name: 'Esperándome' }))
    expect(screen.queryByRole('link', { name: 'centro-agentes' })).toBeNull()
  })

  it('filtra las tarjetas al escribir en el buscador', () => {
    const otro = crearProyecto({ id: 'otro', nombre: 'otro-proyecto' })
    pintar(crearInstantanea([crearProyecto(), otro]))

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'otro' } })

    expect(screen.queryByRole('link', { name: 'centro-agentes' })).toBeNull()
    expect(screen.getByRole('link', { name: 'otro-proyecto' })).toBeTruthy()
  })

  it('muestra un mensaje cuando no hay proyectos ni agentes', () => {
    pintar(crearInstantanea([], []))
    expect(screen.getByText('No hay proyectos en las carpetas escaneadas')).toBeTruthy()
  })

  it('avisa del error y conserva visibles los datos', () => {
    pintar(crearInstantanea(), true)
    expect(screen.getByText(/Sin conexión · reintentando/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'centro-agentes' })).toBeTruthy()
  })

  it('enlaza la tarjeta con la ficha del proyecto', () => {
    pintar()
    window.location.hash = '#/'

    fireEvent.click(screen.getByTestId('tarjeta-proyecto-centro-agentes'))

    expect(window.location.hash).toBe('#/m/aaaaaaaaaaaa/proyecto/centro-agentes')
  })

  it('no muestra acciones de editor ni terminal todavía no disponibles', () => {
    pintar()
    expect(screen.queryByText('⌘')).toBeNull()
    expect(screen.queryByText('>_')).toBeNull()
  })

  it('usa singular y plural al contar los proyectos de un grupo', () => {
    const { rerender } = pintar()
    expect(screen.getByText('· 1 proyecto')).toBeTruthy()

    const datos = crearInstantanea([
      crearProyecto(),
      crearProyecto({ id: 'otro', nombre: 'otro-proyecto' }),
    ])
    rerender(
      <VistaGeneral respuesta={local(datos)} error={false} actualizadaMs={datos.generadaMs} ahora={AHORA} />,
    )
    expect(screen.getByText('· 2 proyectos')).toBeTruthy()
  })
  it('si la primera carga falla muestra el aviso de conexión en lugar de "Cargando…"', () => {
    render(<VistaGeneral respuesta={null} error={true} actualizadaMs={null} ahora={AHORA} />)
    expect(screen.getByText(/Sin conexión con el agente/)).toBeTruthy()
    expect(screen.queryByText('Cargando…')).toBeNull()
  })
  describe('varias máquinas', () => {
    const mac = crearInstantanea([crearProyecto()], [crearAgente()])
    const windows = crearInstantanea([crearProyecto({ id: 'pwin', nombre: 'proyecto-windows' })], [crearAgente({ id: 'codex:w', titulo: 'Tarea en Windows', proyectoIds: ['pwin'] })])
    const hub: RespuestaMaquinas = {
      modo: 'hub',
      maquinas: [
        maquina(mac, { id: 'aaaaaaaaaaaa', nombre: 'MacBook' }),
        maquina(windows, { id: 'bbbbbbbbbbbb', nombre: 'Windows', so: 'windows', conectada: false, ultimoLatidoMs: AHORA - 120_000 }),
        maquina(null, { id: 'cccccccccccc', nombre: 'Mac mini', conectada: false, ultimoLatidoMs: null }),
      ],
    }

    it('pinta un bloque por máquina con su estado de conexión', () => {
      render(<VistaGeneral respuesta={hub} error={false} actualizadaMs={AHORA} ahora={AHORA} />)
      const bloques = document.querySelectorAll('.ma-bloque')
      expect(bloques).toHaveLength(3)
      expect(within(bloques[0] as HTMLElement).getByText('MacBook')).toBeTruthy()
      expect(within(bloques[0] as HTMLElement).getByText(/Conectada/)).toBeTruthy()
      expect(within(bloques[1] as HTMLElement).getByText(/Desconectada · último latido hace 2 min/)).toBeTruthy()
      expect(within(bloques[2] as HTMLElement).getByText(/Todavía no se ha conectado/)).toBeTruthy()
    })

    it('En directo junta los agentes de todas las máquinas con su píldora y enlaces con máquina', () => {
      const { container } = render(<VistaGeneral respuesta={hub} error={false} actualizadaMs={AHORA} ahora={AHORA} />)
      const franja = container.querySelector('.ca-direct') as HTMLElement
      expect(within(franja).getByText('MacBook')).toBeTruthy()
      expect(within(franja).getByText('Windows')).toBeTruthy()
      const enlaces = [...franja.querySelectorAll('a')].map((a) => a.getAttribute('href'))
      expect(enlaces).toContain('#/m/bbbbbbbbbbbb/agente/codex%3Aw')
      const tarjeta = container.querySelector('.ca-card-link') as HTMLElement
      expect(tarjeta.getAttribute('href')).toMatch(/^#\/m\/aaaaaaaaaaaa\/proyecto\//)
    })

    it('muestra "Añadir máquina" solo en el hub', () => {
      const { rerender } = render(<VistaGeneral respuesta={hub} error={false} actualizadaMs={AHORA} ahora={AHORA} />)
      expect(screen.getByRole('button', { name: /Añadir máquina/ })).toBeTruthy()
      rerender(<VistaGeneral respuesta={local(mac)} error={false} actualizadaMs={AHORA} ahora={AHORA} />)
      expect(screen.queryByRole('button', { name: /Añadir máquina/ })).toBeNull()
    })
  })
})
