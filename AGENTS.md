# AGENTS.md — centro-agentes

Panel privado para ver y controlar las sesiones de Claude Code y Codex en
varias máquinas. Lee primero:

- Especificación: `docs/superpowers/specs/2026-10-19-centro-agentes-design.md`
- Plan activo: `docs/superpowers/plans/2026-10-19-fase-1-base-y-lectores.md`

## Reparto del trabajo

- **Claude Code** planifica, instala dependencias, verifica (test, build,
  lint, Playwright), revisa y hace commits y PRs.
- **Codex** implementa la tarea concreta que se le pide en el prompt, con
  sus tests. No hace commits ni toca `.git`, porque su sandbox no se lo
  permite.

## Reglas para Codex

- **Sin red.** No instales dependencias. Si te falta una, para y dilo en tu
  respuesta final.
- **TDD.** Escribe primero los tests de la tarea, ejecútalos y comprueba que
  fallan. Después implementa y vuelve a ejecutarlos. En tu respuesta final
  pega el resumen de las dos ejecuciones (FALLA y PASA).
- **Tests.** `npm test -- <ruta>` para un fichero y `npm test` para todo.
  Antes de terminar, ejecuta también `npm run lint` y `npm run build`.
- **Datos.** Los tests usan fixtures **sintéticos** en `os.tmpdir()`.
  Nunca leas el `$HOME` real ni ficheros de `~/.claude` o `~/.codex`.
- **ESM con TypeScript strict.** Los imports relativos llevan extensión
  `.js` (`import { x } from './x.js'`). Para importar de `compartido`, usa
  `@centro/compartido`.
- **Identificadores y mensajes en español**, igual que en la especificación.
- **`git`** se ejecuta siempre con `execFile`, nunca con un shell, con
  `timeout: 5000` y `GIT_OPTIONAL_LOCKS=0`.
- **SQLite de Codex** siempre con `new DatabaseSync(ruta, { readOnly: true })`.
- **Rutas** con `node:path`. Para Windows, usa `path.win32` cuando la
  función recibe el SO.
- **No toques** nada fuera de lo que pide la tarea, ni `scripts/dev/`, ni
  `docs/`.
