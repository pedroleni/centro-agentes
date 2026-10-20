import { describe, expect, it } from 'vitest'
import { accionDeToolUse, rolClaude, rolCodex } from '../src/actividad.js'

describe('accionDeToolUse', () => {
  it('convierte SubagentHandback en el mensaje de entrega del informe', () => {
    expect(accionDeToolUse('SubagentHandback', {}, 456)).toEqual({
      tipo: 'mensaje',
      texto: 'Entregó su informe',
      fechaMs: 456,
    })
  })

  it.each([
    ['Bash', { command: 'npm test\necho despues' }, 'comando', 'npm test'],
    ['Edit', { file_path: '/repo/src/uno.ts' }, 'edicion', 'uno.ts'],
    ['Write', { file_path: '/repo/src/dos.ts' }, 'edicion', 'dos.ts'],
    ['MultiEdit', { file_path: '/repo/src/tres.ts' }, 'edicion', 'tres.ts'],
    ['NotebookEdit', { notebook_path: '/repo/cuatro.ipynb' }, 'edicion', 'cuatro.ipynb'],
    ['Read', { file_path: '/repo/README.md' }, 'lectura', 'README.md'],
    ['Grep', { pattern: 'ultimaAccion' }, 'busqueda', 'ultimaAccion'],
    ['Glob', { pattern: '**/*.ts' }, 'busqueda', '**/*.ts'],
    ['Agent', { description: 'Explorar lectores' }, 'subagente', 'Explorar lectores'],
    ['Task', { description: 'Ejecutar pruebas' }, 'subagente', 'Ejecutar pruebas'],
    [
      'AskUserQuestion',
      { questions: [{ question: '¿Qué opción prefieres?' }] },
      'pregunta',
      '¿Qué opción prefieres?',
    ],
    ['HerramientaNueva', {}, 'otro', 'HerramientaNueva'],
  ])('convierte %s en una acción %s', (nombre, input, tipo, texto) => {
    expect(accionDeToolUse(nombre, input, 123)).toEqual({ tipo, texto, fechaMs: 123 })
  })

  it('enmascara secretos antes de recortar el texto', () => {
    expect(
      accionDeToolUse('Bash', { command: 'curl -H sk-1234567890abcdef https://example.test' }, 7),
    ).toEqual({
      tipo: 'comando',
      texto: 'curl -H «oculto» https://example.test',
      fechaMs: 7,
    })
  })
})

describe('rolClaude', () => {
  it.each([
    ['Explore', null, 'claude-explorador'],
    ['general-purpose', 'Final review', 'claude-inspector'],
    ['general-purpose', 'Builder check', 'claude-ayudante'],
    [null, null, 'claude'],
  ])('clasifica %s / %s como %s', (agentType, descripcion, esperado) => {
    expect(rolClaude(agentType, descripcion)).toBe(esperado)
  })
})

describe('rolCodex', () => {
  it.each([
    ['{"subagent":{"other":"guardian"}}', 'gpt-5.6', false, 'codex-guardian'],
    ['vscode', 'codex-auto-review', false, 'codex-guardian'],
    ['exec', 'gpt-5.6', false, 'codex-obrero'],
    ['vscode', 'gpt-5.6', false, 'codex'],
  ])('clasifica %s / %s como %s', (source, modelo, esTarea, esperado) => {
    expect(rolCodex(source, modelo, esTarea)).toBe(esperado)
  })
})
