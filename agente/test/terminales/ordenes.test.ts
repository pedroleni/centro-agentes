import type { Agente, Proyecto } from '@centro/compartido'
import { describe, expect, it } from 'vitest'
import { ordenTerminal } from '../../src/terminales/ordenes.js'

const base = {
  modo: 'interactivo', titulo: 'Arreglar el login', cwd: '/Users/p/proyecto', proyectoIds: ['aaaaaaaaaaaa'],
  estado: 'cerrada', rol: 'claude', ultimaAccion: null, resumenActividad: { comandos: 0, ediciones: 0, mensajes: 0, ficheros: [] },
  modelo: null, esfuerzo: null, contexto: null, tokensTotales: null, ultimoPrompt: null, rama: null, pr: null,
  inicioMs: null, ultimaActividadMs: 1, padreId: null, entrada: null, tareas: [], commitsPorProyecto: {},
} as const
const claude = { ...base, id: 'claude:323ca3f4-7985-4de1-869d-e6b0dc0cace0', tipo: 'claude', puedeContinuar: true } as unknown as Agente
const codex = { ...base, id: 'codex:01a15a2c-2c0c-7be2-84db-21399519cc26', tipo: 'codex', rol: 'codex', puedeContinuar: true } as unknown as Agente
const proyecto = { id: 'aaaaaaaaaaaa', nombre: 'centro-agentes', ruta: '/Users/p/centro-agentes' } as unknown as Proyecto

describe('ordenTerminal', () => {
  it('continúa una sesión cerrada de Claude en su carpeta', () => {
    expect(ordenTerminal({ accion: 'continuar', agente: claude })).toEqual({
      cwd: '/Users/p/proyecto',
      argv: ['/bin/zsh', '-lc', 'exec claude --resume 323ca3f4-7985-4de1-869d-e6b0dc0cace0'],
      titulo: 'Claude · Arreglar el login',
      tipo: 'claude',
      agenteId: claude.id,
      proyectoId: 'aaaaaaaaaaaa',
    })
  })

  it('continúa un hilo de Codex', () => {
    expect(ordenTerminal({ accion: 'continuar', agente: codex })).toMatchObject({
      argv: ['/bin/zsh', '-lc', 'exec codex resume 01a15a2c-2c0c-7be2-84db-21399519cc26'],
      tipo: 'codex',
    })
  })

  it('abre una sesión nueva de Claude o de Codex en la carpeta del proyecto', () => {
    expect(ordenTerminal({ accion: 'nueva', tipo: 'claude', proyecto })).toEqual({
      cwd: '/Users/p/centro-agentes', argv: ['/bin/zsh', '-lc', 'exec claude'], titulo: 'Claude · centro-agentes',
      tipo: 'claude', agenteId: null, proyectoId: 'aaaaaaaaaaaa',
    })
    expect(ordenTerminal({ accion: 'nueva', tipo: 'codex', proyecto })).toMatchObject({ argv: ['/bin/zsh', '-lc', 'exec codex'] })
  })

  it('no continúa una sesión que sigue abierta en otro sitio', () => {
    expect(ordenTerminal({ accion: 'continuar', agente: { ...claude, puedeContinuar: false } })).toEqual({ error: 'Esta sesión sigue abierta en otro sitio' })
  })

  it('rechaza ids con caracteres de shell, subagentes y tareas sin hilo', () => {
    for (const id of ['codex:--full-auto', 'codex:--dangerously-bypass-approvals-and-sandbox', 'claude:------------------------------------', 'claude:abc; rm -rf ~', 'claude:323ca3f4-7985-4de1-869d-e6b0dc0cace0 && ls', 'claude:323ca3f4-7985-4de1-869d-e6b0dc0cace0:agente', 'codex:$(whoami)', 'codex-tarea:0123456789abcdef']) {
      expect(ordenTerminal({ accion: 'continuar', agente: { ...claude, id, tipo: id.startsWith('claude') ? 'claude' : 'codex' } as Agente })).toHaveProperty('error')
    }
  })

  it('exige una carpeta absoluta', () => {
    expect(ordenTerminal({ accion: 'continuar', agente: { ...claude, cwd: '' } })).toHaveProperty('error')
    expect(ordenTerminal({ accion: 'nueva', tipo: 'claude', proyecto: { ...proyecto, ruta: 'relativa' } })).toHaveProperty('error')
  })
})
