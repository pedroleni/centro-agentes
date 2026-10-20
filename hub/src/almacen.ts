import { createHash, randomBytes, randomInt } from 'node:crypto'
import { chmodSync, closeSync, openSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { SO } from '@centro/compartido'

// Datos persistentes del hub: máquinas dadas de alta, códigos de alta y auditoría.
// Ni los códigos ni los tokens se guardan en claro: solo su sha256.

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const VIDA_CODIGO_MS = 10 * 60_000
const MAXIMO_AUDITORIA = 10_000

function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex')
}

function codigoAleatorio(): string {
  let codigo = ''
  for (let i = 0; i < 8; i += 1) codigo += ALFABETO[randomInt(ALFABETO.length)]
  return codigo
}

export type MaquinaGuardada = {
  id: string
  nombre: string
  so: SO
  creadaMs: number
  revocadaMs: number | null
}

export function crearAlmacen(ruta: string, ahora: () => number = Date.now) {
  // El fichero se crea con 0600 antes de que SQLite lo abra.
  closeSync(openSync(ruta, 'a', 0o600))
  chmodSync(ruta, 0o600)
  const db = new DatabaseSync(ruta)
  db.exec(`
    CREATE TABLE IF NOT EXISTS maquinas (
      id TEXT PRIMARY KEY, nombre TEXT NOT NULL, so TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, creada_ms INTEGER NOT NULL, revocada_ms INTEGER
    );
    CREATE TABLE IF NOT EXISTS codigos (
      codigo_hash TEXT PRIMARY KEY, caduca_ms INTEGER NOT NULL, usado INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fecha_ms INTEGER NOT NULL, evento TEXT NOT NULL, detalle TEXT NOT NULL
    );
  `)

  return {
    crearCodigoAlta(): { codigo: string; caducaMs: number } {
      const codigo = codigoAleatorio()
      const caducaMs = ahora() + VIDA_CODIGO_MS
      db.prepare('INSERT INTO codigos (codigo_hash, caduca_ms) VALUES (?, ?)').run(sha256(codigo), caducaMs)
      return { codigo, caducaMs }
    },

    canjearCodigo(codigo: string, nombre: string, so: SO): { maquinaId: string; token: string } | null {
      db.exec('BEGIN IMMEDIATE')
      try {
        const marcado = db
          .prepare('UPDATE codigos SET usado = 1 WHERE codigo_hash = ? AND usado = 0 AND caduca_ms >= ?')
          .run(sha256(codigo.trim().toUpperCase()), ahora())
        if (marcado.changes !== 1) {
          db.exec('ROLLBACK')
          return null
        }
        const maquinaId = randomBytes(6).toString('hex')
        const token = randomBytes(32).toString('base64url')
        db.prepare('INSERT INTO maquinas (id, nombre, so, token_hash, creada_ms) VALUES (?, ?, ?, ?, ?)')
          .run(maquinaId, nombre, so, sha256(token), ahora())
        db.exec('COMMIT')
        return { maquinaId, token }
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    maquinaDeToken(token: string): { id: string; nombre: string; so: SO } | null {
      const fila = db
        .prepare('SELECT id, nombre, so FROM maquinas WHERE token_hash = ? AND revocada_ms IS NULL')
        .get(sha256(token)) as { id: string; nombre: string; so: SO } | undefined
      return fila === undefined ? null : { id: fila.id, nombre: fila.nombre, so: fila.so }
    },

    listarMaquinas(): MaquinaGuardada[] {
      const filas = db
        .prepare('SELECT id, nombre, so, creada_ms, revocada_ms FROM maquinas ORDER BY creada_ms')
        .all() as { id: string; nombre: string; so: SO; creada_ms: number; revocada_ms: number | null }[]
      return filas.map((f) => ({ id: f.id, nombre: f.nombre, so: f.so, creadaMs: f.creada_ms, revocadaMs: f.revocada_ms }))
    },

    revocar(id: string): boolean {
      return db.prepare('UPDATE maquinas SET revocada_ms = ? WHERE id = ? AND revocada_ms IS NULL').run(ahora(), id).changes === 1
    },

    auditar(evento: string, detalle: Record<string, unknown>): void {
      const { lastInsertRowid } = db.prepare('INSERT INTO auditoria (fecha_ms, evento, detalle) VALUES (?, ?, ?)').run(ahora(), evento, JSON.stringify(detalle))
      // Tope de filas: la auditoría no puede crecer sin límite.
      db.prepare('DELETE FROM auditoria WHERE id <= ?').run(Number(lastInsertRowid) - MAXIMO_AUDITORIA)
    },

    ultimosEventos(n: number): { fechaMs: number; evento: string; detalle: Record<string, unknown> }[] {
      const filas = db
        .prepare('SELECT fecha_ms, evento, detalle FROM auditoria ORDER BY fecha_ms DESC, id DESC LIMIT ?')
        .all(n) as { fecha_ms: number; evento: string; detalle: string }[]
      return filas.map((f) => ({ fechaMs: f.fecha_ms, evento: f.evento, detalle: JSON.parse(f.detalle) as Record<string, unknown> }))
    },

    cerrar(): void {
      db.close()
    },
  }
}

export type Almacen = ReturnType<typeof crearAlmacen>
