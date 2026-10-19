# Fase 1 · Base y lectores — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para ejecutar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** dejar listo el monorepo y todos los lectores locales del agente. Al terminar, `npm run instantanea` imprime la instantánea JSON validada de la máquina: proyectos, git, sesiones de Claude, hilos y tareas de Codex, y pendientes.

**Arquitectura:** monorepo con workspaces de npm. `compartido/` contiene los esquemas zod que comparten agente, hub y web. `agente/` contiene lectores puros y testeables; cada uno recibe sus rutas inyectadas y todas las lecturas de ficheros de agentes pasan por un guardián de rutas. Los ficheros `.jsonl` grandes se leen de forma incremental, desde el último offset.

**Tecnología:** Node ≥ 22.13 (ESM), TypeScript strict, `node:sqlite` en solo lectura, zod, smol-toml, Vitest, ESLint con typescript-eslint y tsx.

**Especificación:** `docs/superpowers/specs/2026-10-19-centro-agentes-design.md` (§4, §6, §7). Los implementadores leen el plan y la especificación.

## Restricciones globales

- `engines.node: ">=22.13"`. Todos los paquetes llevan `"type": "module"` y `tsconfig` con `strict: true`.
- Los identificadores, mensajes y textos van en español, igual que en la especificación.
- SQLite de Codex: `new DatabaseSync(ruta, { readOnly: true })`. Nunca se escribe en `~/.claude` ni en `~/.codex`.
- `git` siempre con `execFile` (nunca con shell), `timeout: 5000` y `env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }`, para no tomar locks del repo mientras los agentes trabajan.
- Rutas prohibidas, tras `realpath`: `auth.json`, `*.key`, `.env*`, `client_secret*` y todo lo que esté bajo `.claude/session-env`.
- Las rutas se componen siempre con `node:path`. Para Windows se usa `path.win32` cuando la función recibe el SO.
- Los tests usan **fixtures sintéticos** en `os.tmpdir()`. Ningún test lee el `$HOME` real.
- **Codex no tiene red**: no puede añadir dependencias. Si una tarea necesita una nueva, se para y lo dice.
- Rama `fase-1/base-y-lectores` e integración en `main` mediante PR. **Commits sin `Co-Authored-By` ni ninguna otra atribución a Claude.**
- Ventanas de contexto por defecto: los modelos `claude-*` de la generación 5.x y Opus/Sonnet 4.6+ tienen 1 000 000; `claude-haiku-4-5` tiene 200 000.

## Foco de revisión

1. **Línea `.jsonl` a medio escribir o con JSON inválido** (el agente está escribiendo el fichero): se ignora y no rompe la lectura. La línea sin `\n` final no se consume hasta que se completa. Test en la Tarea 4.
2. **Repo recién creado sin commits, o carpeta borrada entre el escaneo y el `git`**: `estadoGit` no lanza excepción, devuelve `ultimoCommit: null` y actividad a cero. Test en la Tarea 5.
3. **Rutas con espacios y acentos** (`Proyectos IA`, `Año ñ`): el descubrimiento, `git` y la búsqueda de transcripts funcionan. Tests en las Tareas 5 y 6.
4. **Falta `~/.codex` o la base de datos de Codex está en modo WAL mientras Codex escribe**: con WAL, la lectura en `readOnly` funciona. Si falta, la instantánea lleva el aviso `sin-codex` y la lista de hilos sale vacía. Test en la Tarea 7.
5. **Transcript enorme leído dos veces**: la segunda lectura solo procesa los bytes nuevos, y si el fichero se truncó lo relee entero. Test en la Tarea 4.

---

### Tarea 1: Monorepo, herramientas y entorno · Ejecuta: **Claude**

**Ficheros:**
- Crear: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `eslint.config.js`, `.nvmrc` (`22`)
- Crear: `compartido/package.json`, `compartido/tsconfig.json`, `compartido/src/index.ts`
- Crear: `agente/package.json`, `agente/tsconfig.json`, `agente/src/index.ts`
- Crear: `AGENTS.md`, `README.md`, `agente.config.example.json`
- Crear: `scripts/dev/codex-task.sh` y `scripts/dev/codex-monitor.mjs` (adaptados de tech-study-tracker; los logs van a `.codex-logs/` de este repo)
- Test: `compartido/test/humo.test.ts`

**Interfaces:**
- Produce estos scripts raíz:
  - `npm test` → `vitest run`;
  - `npm run lint` → `eslint .`;
  - `npm run build` → `tsc -b compartido agente`;
  - `npm run instantanea` → `tsx agente/src/cli.ts instantanea`;
  - `npm run codex:task` y `npm run codex:monitor`.
- Produce los nombres de paquete `@centro/compartido` y `@centro/agente`. `agente` depende de `@centro/compartido` (`"*"`).

- [ ] **Paso 1:** comprobar `node -v`. Si es menor que 22.13, actualizar Node con el mismo método con el que está instalado (`/usr/local/bin/node`: instalador oficial `.pkg` de la última 22.x LTS) y volver a comprobar.
- [ ] **Paso 2:** crear la rama `fase-1/base-y-lectores` y los ficheros de la lista.
  - `AGENTS.md` explica el reparto (Claude planifica y verifica, Codex implementa), dice que Codex no tiene red ni puede tocar `.git`, y enlaza este plan y la especificación.
  - Devdeps raíz: `typescript`, `vitest`, `@types/node`, `eslint`, `typescript-eslint` y `tsx`.
  - `compartido`: `zod`.
  - `agente`: `smol-toml`.
- [ ] **Paso 3:** `npm install`.
- [ ] **Paso 4:** escribir el test de humo `expect(1 + 1).toBe(2)`, ejecutar `npm test` (esperado: 1 passed) y luego `npm run lint && npm run build` (esperado: sin errores).
- [ ] **Paso 5:** arrancar `npm run codex:monitor` en segundo plano y comprobar con `lsof -nP -iTCP:4545 -sTCP:LISTEN` que escucha.
- [ ] **Paso 6:** commit `Prepara el monorepo y las herramientas de Codex`.

---

### Tarea 2: Esquemas compartidos y ventanas de contexto · Ejecuta: **Codex** (low)

**Ficheros:**
- Crear: `compartido/src/esquemas.ts`, `compartido/src/ventanas.ts`
- Modificar: `compartido/src/index.ts` (reexporta los dos ficheros)
- Test: `compartido/test/esquemas.test.ts`, `compartido/test/ventanas.test.ts`

**Interfaces:**
- Produce, en `esquemas.ts`, los esquemas zod y sus tipos con `z.infer`, con el mismo nombre:
  - `SO = z.enum(['macos','windows','linux'])`
  - `EstadoGit = { rama: string|null, ultimoCommit: {hash, mensaje, fechaMs}|null, cambios: int, adelante: int|null, atras: int|null, ramas: string[], actividad14d: int[] (exactamente 14; el índice 13 es hoy) }`
  - `Pendiente = { origen: 'plan'|'handoff'|'sesion', titulo: string, fechaMs: number|null, hechas: int|null, total: int|null, quizaDesactualizado: boolean }`
  - `Proyecto = { id: string, nombre: string, ruta: string, grupo: string, git: EstadoGit, pendientes: Pendiente[], ultimaActividadMs: number }`
  - `EstadoAgente = z.enum(['trabajando','esperandote','cerrada','en-curso','terminado','interrumpido'])`
  - `TareaSesion = { texto: string, estado: 'pendiente'|'en-curso'|'hecha' }`
  - `Agente = { id, tipo: 'claude'|'codex', modo: 'interactivo'|'tarea', titulo, cwd, proyectoIds: string[], estado: EstadoAgente, modelo: string|null, esfuerzo: string|null, contexto: {usados: number, ventana: number|null}|null, tokensTotales: number|null, ultimoPrompt: string|null, rama: string|null, pr: {numero: number, url: string}|null, inicioMs: number|null, ultimaActividadMs: number, padreId: string|null, entrada: string|null, puedeContinuar: boolean, tareas: TareaSesion[] }`
  - `Maquina = { id: string, nombre: string, so: SO, avisos: ('sin-claude'|'sin-codex')[] }`
  - `Instantanea = { version: z.literal(1), maquina: Maquina, generadaMs: number, proyectos: Proyecto[], agentes: Agente[] }`
- Produce, en `ventanas.ts`, `ventanaContexto(modelo: string, extra?: Record<string, number>): number | null`. Primero mira `extra`. Después quita un sufijo `[…]` y aplica los prefijos: `claude-fable-5`, `claude-mythos-5`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-5`, `claude-opus-4-6/7/8` y `claude-sonnet-4-6` dan 1 000 000; `claude-haiku-4-5` da 200 000; cualquier otro, `null`.

- [ ] **Paso 1:** escribir los tests.
  - `Instantanea.parse(ejemploValido)` no lanza. El ejemplo se construye en el propio test, con un proyecto y un agente.
  - Un agente con `estado: 'raro'` lanza error.
  - `actividad14d` con 13 elementos lanza error.
  - `ventanaContexto('claude-opus-5-5') === 1_000_000`.
  - `ventanaContexto('claude-opus-5-5[1m]') === 1_000_000`.
  - `ventanaContexto('claude-haiku-4-5') === 200_000`.
  - `ventanaContexto('gpt-5.6-sol') === null`.
  - `ventanaContexto('gpt-5.6-sol', {'gpt-5.6-sol': 258400}) === 258400`.
- [ ] **Paso 2:** `npx vitest run compartido` → FALLA (módulos inexistentes).
- [ ] **Paso 3:** implementar `esquemas.ts` y `ventanas.ts` tal como se describen arriba.
- [ ] **Paso 4:** `npx vitest run compartido` → PASA.
- [ ] **Paso 5:** commit `Añade los esquemas de la instantánea y las ventanas de contexto`.

---

### Tarea 3: Rutas base, guardián y enmascarado · Ejecuta: **Codex** (high: es la frontera de seguridad)

**Ficheros:**
- Crear: `agente/src/rutas/base.ts`, `agente/src/rutas/guardian.ts`, `agente/src/util/enmascarar.ts`
- Test: `agente/test/rutas/base.test.ts`, `agente/test/rutas/guardian.test.ts`, `agente/test/util/enmascarar.test.ts`

**Interfaces:**
- `rutasBase(so: SO, home: string, env: Record<string, string|undefined>): RutasBase`, donde `RutasBase = { home: string; claude: string; codex: string; temporales: string[] }`.
  - `codex` vale `env.CODEX_HOME` si existe y, si no, `<home>/.codex`.
  - `temporales` es `['/tmp', '/private/tmp']` en macOS y Linux. En Windows es `[env.TEMP, env.TMP]` sin vacíos, y las rutas se unen con `path.win32`.
- `class RutaProhibida extends Error { motivo: 'fuera'|'prohibida'|'no-existe' }`.
- `crearGuardian(opts: { permitidas: string[] }): { comprobar(ruta: string): Promise<string> }`. Devuelve el `realpath` si la ruta está dentro de alguna permitida (también pasada por `realpath`) y no coincide con las prohibidas de las Restricciones globales. Si no, lanza `RutaProhibida`.
- `enmascararSecretos(texto: string): string`. Cada coincidencia se sustituye por `«oculto»`.

- [ ] **Paso 1:** escribir los tests.
  - **base:**
    - `rutasBase('macos','/Users/p',{}).claude === '/Users/p/.claude'`.
    - Con `{CODEX_HOME:'/x'}`, `.codex === '/x'`.
    - `rutasBase('windows','C:\\Users\\p',{TEMP:'C:\\T'})` da `.claude === 'C:\\Users\\p\\.claude'` y `.temporales` igual a `['C:\\T']`.
  - **guardián** (en una carpeta temporal con `permitida/` y `fuera/`), lanza `RutaProhibida` con estos motivos:
    - fichero normal dentro de la permitida → devuelve su `realpath`;
    - fichero en `fuera/` → `'fuera'`;
    - symlink en `permitida/` que apunta a `fuera/x` → `'fuera'`;
    - `permitida/a/../../fuera/x` → `'fuera'`;
    - `permitida/auth.json`, `permitida/a.key`, `permitida/.env.local`, `permitida/client_secret_1.json` y `permitida/.claude/session-env/s` → `'prohibida'`;
    - ruta inexistente → `'no-existe'`.
  - **enmascarar:**
    - `'clave sk-ant-abc123def456ghi789'` → `'clave «oculto»'`;
    - `ghp_` seguido de 36 caracteres → `«oculto»`;
    - `github_pat_11ABC_xyz` → `«oculto»`;
    - un JWT `eyJhbGciOi.eyJzdWIi.firma` → `«oculto»`;
    - `AKIAIOSFODNN7EXAMPLE` → `«oculto»`;
    - `'Authorization: Bearer abc.def'` → `'Authorization: «oculto»'`;
    - `'DB_PASSWORD=hunter2'` → `'DB_PASSWORD=«oculto»'`;
    - `'API_KEY = x1'` → `'API_KEY = «oculto»'`;
    - `'NOMBRE=pedro'` no cambia;
    - `'sk-'` suelto, sin al menos 16 caracteres detrás, no cambia.
- [ ] **Paso 2:** `npx vitest run agente/test/rutas agente/test/util/enmascarar.test.ts` → FALLA.
- [ ] **Paso 3:** implementar. La comparación de "dentro de" usa `path.relative` y comprueba que el resultado no empiece por `..` ni sea absoluto.
- [ ] **Paso 4:** los mismos tests → PASA.
- [ ] **Paso 5:** commit `Añade el guardián de rutas y el enmascarado de secretos`.

---

### Tarea 4: Lectura de líneas e incremental · Ejecuta: **Codex** (medium)

**Ficheros:**
- Crear: `agente/src/util/lineas.ts`, `agente/src/util/incremental.ts`
- Test: `agente/test/util/lineas.test.ts`, `agente/test/util/incremental.test.ts`

**Interfaces:**
- `leerLineasDesde(ruta: string, desdeByte: number): AsyncGenerator<{ linea: string; finByte: number }>`. Solo devuelve las líneas que terminan en `\n`, sin el `\r\n`/`\n`. `finByte` es el offset justo después del salto.
- `ultimasLineas(ruta: string, n: number, antesDeByte?: number): Promise<{ lineas: string[]; desdeByte: number }>`. Lee hacia atrás por bloques de 64 KiB e ignora una última línea sin terminar.
- `crearLectorIncremental<S>(inicial: () => S, aplicar: (estado: S, obj: unknown) => void): { leer(ruta: string): Promise<S>; bytesUltimaLectura(ruta: string): number }`. Funciona así:
  - guarda en memoria, por ruta, `{ offset, tamano, estado }`;
  - en cada lectura solo procesa desde `offset`;
  - si el tamaño actual es menor que el guardado, vuelve a empezar con `inicial()`;
  - ignora las líneas que no son JSON válido.

- [ ] **Paso 1:** escribir los tests.
  - **líneas:**
    - un fichero de 1000 líneas `l0…l999` y `ultimasLineas(f,3)` → `['l997','l998','l999']`;
    - con `antesDeByte` igual al `desdeByte` anterior → `['l994','l995','l996']`;
    - un fichero CRLF → las líneas salen sin `\r`;
    - un fichero que termina en `'{"a":1'`, sin `\n` → esa línea no aparece ni en `ultimasLineas` ni en `leerLineasDesde`.
  - **incremental**, con un reductor que cuenta objetos y guarda el último `x`:
    - la primera lectura de 3 líneas → `{n:3}`;
    - al añadir 2 líneas → `{n:5}` y `bytesUltimaLectura` igual al tamaño de lo añadido;
    - una línea `'no json'` en medio → no cuenta y no lanza;
    - al reescribir el fichero más corto → empieza de cero;
    - una línea a medio escribir no cuenta, y cuenta cuando se completa.
- [ ] **Paso 2:** `npx vitest run agente/test/util` → FALLA.
- [ ] **Paso 3:** implementar con `fs.promises.open` y `read` por bloques. No usar `readFile` del fichero entero.
- [ ] **Paso 4:** los mismos tests → PASA.
- [ ] **Paso 5:** commit `Añade la lectura incremental de ficheros jsonl`.

---

### Tarea 5: Proyectos y estado de git · Ejecuta: **Codex** (medium)

**Ficheros:**
- Crear: `agente/src/config.ts`, `agente/src/lectores/proyectos.ts`, `agente/src/lectores/git.ts`
- Test: `agente/test/lectores/proyectos.test.ts`, `agente/test/lectores/git.test.ts`, `agente/test/ayudas/repo.ts` (ayuda: `crearRepo(dir, commits: {mensaje, fechaMs}[])`)

**Interfaces:**
- `ConfigAgente = { nombreMaquina: string; raices: string[]; profundidad: number; ocultos: string[]; ventanasContexto: Record<string, number> }`.
- `cargarConfig(ruta: string | null, home: string): ConfigAgente`. Si la ruta es `null` o no existe, usa los valores por defecto: `os.hostname()`, `[Desktop, Downloads, Documents]` bajo `home`, profundidad `2` y el resto vacío.
- `idProyecto(rutaReal: string): string`: los primeros 12 caracteres hex del sha1 de la ruta real.
- `descubrirProyectos(cfg: ConfigAgente, rutas: RutasBase): Promise<ProyectoBase[]>`, con `ProyectoBase = { id, nombre, ruta, grupo }`.
  - **Escaneo**: recorre cada raíz hasta `profundidad`. Una carpeta es proyecto si contiene `.git`, sea carpeta o fichero, y el recorrido no baja dentro de un proyecto ya encontrado.
  - **Proyectos de Codex**: añade las claves de `[projects]` de `<codex>/config.toml`, leídas con smol-toml.
  - **Excluye**: lo que esté bajo `temporales`, el propio `home`, lo que no existe y lo que esté en `ocultos`.
  - **Duplicados**: se eliminan por ruta real.
  - **Grupo**: el `basename` de la carpeta padre.
- `estadoGit(ruta: string, ahoraMs: number): Promise<EstadoGit>`. No lanza: ante cualquier error devuelve los valores vacíos. Comandos:
  - `symbolic-ref --short HEAD`;
  - `log -1 --format=%h%x00%s%x00%ct`;
  - `status --porcelain=v1 -z`;
  - `rev-list --left-right --count @{u}...HEAD`;
  - `for-each-ref --format=%(refname:short) refs/heads`;
  - `log --since=<ahora-14d> --format=%ct`.

- [ ] **Paso 1:** escribir los tests.
  - **proyectos**, con raíz temporal:
    - aparecen `A/.git` (grupo = nombre de la raíz) y `Grupo X/Año ñ/.git` (grupo `'Grupo X'`);
    - no aparecen `a/b/c/.git` con profundidad 2, `C/` sin `.git` ni `A/sub/.git` (está dentro de A);
    - un `config.toml` con un proyecto existente fuera de las raíces lo añade;
    - `'/private/tmp/x'`, el home y una ruta inexistente quedan fuera;
    - la misma ruta en las raíces y en el toml sale una sola vez;
    - `ocultos` la excluye;
    - `idProyecto` es estable entre dos llamadas.
  - **git:**
    - repo con commits a `ahora-2d` y `ahora`, un fichero modificado y uno sin seguimiento → `rama: 'main'`, `cambios: 2`, `ultimoCommit.mensaje` igual al del último commit, `actividad14d[13] === 1`, `actividad14d[11] === 1` y `adelante: null`;
    - rama `otra` → `ramas` contiene `['main','otra']`;
    - un clon de un repo bare más 1 commit local → `adelante: 1`, `atras: 0`;
    - un `git init -b main` sin commits → `ultimoCommit: null` y 14 ceros;
    - una ruta inexistente → valores vacíos y no lanza.
- [ ] **Paso 2:** `npx vitest run agente/test/lectores/proyectos.test.ts agente/test/lectores/git.test.ts` → FALLA.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** los mismos tests → PASA.
- [ ] **Paso 5:** commit `Añade el descubrimiento de proyectos y el estado de git`.

---

### Tarea 6: Sesiones y transcripts de Claude · Ejecuta: **Codex** (medium)

**Ficheros:**
- Crear: `agente/src/lectores/claudeSesiones.ts`, `agente/src/lectores/claudeTranscripts.ts`
- Test: `agente/test/lectores/claudeSesiones.test.ts`, `agente/test/lectores/claudeTranscripts.test.ts`

**Interfaces:**
- Consume `crearLectorIncremental` (Tarea 4).
- `SesionViva = { pid: number; sessionId: string; cwd: string; nombre: string; status: 'idle'|'busy'; entrada: string; inicioMs: number; actualizadaMs: number; vivo: boolean }`.
- `leerSesionesVivas(dir: string, pidVivo: (pid: number) => boolean, leer?: (ruta: string) => Promise<string>): Promise<SesionViva[]>`.
  - Lee solo los `*.json`; los `*.key` no se tocan nunca.
  - Los JSON inválidos se ignoran.
  - Los campos de origen son `name`, `entrypoint`, `startedAt` y `updatedAt`.
- `ResumenClaude = { sessionId; agenteSubId: string|null; titulo: string|null; ultimoPrompt: string|null; modelo: string|null; contextoUsado: number|null; rama: string|null; pr: {numero, url}|null; cwd: string|null; inicioMs: number|null; ultimaActividadMs: number|null; tareas: TareaSesion[]; ficherosEditados: string[] }`.
- `crearLectorClaude(): { resumen(ruta: string): Promise<ResumenClaude> }`. Es un reductor sobre `crearLectorIncremental`:
  - `ai-title.aiTitle` → título (el último);
  - `last-prompt.lastPrompt` → último prompt (el último);
  - `assistant`: `message.model` y `message.usage`, con `contextoUsado = input_tokens + cache_creation_input_tokens + cache_read_input_tokens` del último mensaje que tenga `usage`;
  - `gitBranch` → rama (el último no vacío);
  - `pr-link`: `{ numero: Number(prNumber), url: prUrl }`;
  - `cwd` y `timestamp` → el primero da `cwd` e `inicioMs`, el último da `ultimaActividadMs`;
  - último `tool_use` llamado `TodoWrite`: `input.todos[].content/status` → `in_progress` pasa a `'en-curso'`, `pending` a `'pendiente'` y `completed` a `'hecha'`;
  - `tool_use` de `Edit`, `Write`, `MultiEdit` o `NotebookEdit`: `input.file_path ?? input.notebook_path`, sin repetidos;
  - `agenteSubId`: si la ruta coincide con `/subagents/agent-<id>.jsonl`, es `<id>`.
- `listarTranscripts(dirProyectos: string, desdeMs: number): Promise<{ sessionId: string; agenteSubId: string|null; ruta: string; mtimeMs: number }[]>`. Busca `*/*.jsonl` y `*/*/subagents/agent-*.jsonl` con `mtime >= desdeMs`. En un subagente, `sessionId` es el nombre de su carpeta abuelo, que es la sesión padre.

- [ ] **Paso 1:** escribir los tests (líneas sintéticas que imitan los tipos reales de arriba).
  - **sesiones:** 2 `.json` válidos, 1 `.key` y 1 inválido → 2 sesiones. El espía `leer` nunca recibe una ruta acabada en `.key`. `vivo` coincide con `pidVivo`.
  - **transcripts:**
    - dos `ai-title` → gana el último;
    - `pr-link` con `prNumber: '18'` → `pr.numero === 18`;
    - el `usage` `{input_tokens:2, cache_creation_input_tokens:100, cache_read_input_tokens:900}` → `contextoUsado === 1002`;
    - el `TodoWrite` con 3 estados → mapeado como arriba;
    - dos `Edit` sobre el mismo fichero y un `Write` → 2 ficheros;
    - una ruta `…/<sid>/subagents/agent-abc.jsonl` → `agenteSubId === 'abc'`.
  - **listar:** una carpeta `-Users-p-Proyectos-IA` con `s1.jsonl`, más `s1/subagents/agent-x.jsonl`, más uno antiguo → salen 2 y el subagente lleva `sessionId: 's1'`.
- [ ] **Paso 2:** `npx vitest run agente/test/lectores/claude*` → FALLA.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** los mismos tests → PASA.
- [ ] **Paso 5:** commit `Añade los lectores de sesiones y transcripts de Claude`.

---

### Tarea 7: Codex (hilos, rollouts, tareas y procesos) · Ejecuta: **Codex** (medium)

**Ficheros:**
- Crear: `agente/src/lectores/codexHilos.ts`, `agente/src/lectores/codexRollouts.ts`, `agente/src/lectores/codexTareas.ts`, `agente/src/lectores/codexProcesos.ts`
- Test: uno por fichero en `agente/test/lectores/`

**Interfaces:**
- `HiloCodex = { id; titulo; cwd; modelo: string|null; esfuerzo: string|null; tokens: number; rama: string|null; source: string; creadoMs: number; actualizadoMs: number; rollout: string; padreId: string|null }`.
- `leerHilosCodex(dirCodex: string, desdeMs: number): HiloCodex[]`.
  - Abre el `state_<N>.sqlite` de mayor N en `readOnly`.
  - Toma los hilos con `archived = 0 AND updated_at_ms >= desdeMs`.
  - `padreId` sale de `LEFT JOIN thread_spawn_edges ON child_thread_id = threads.id`.
  - Si no hay base de datos, devuelve `[]`.
- `crearLectorRollouts(): { resumen(ruta): Promise<ResumenRollout> }`, con `ResumenRollout = { ultimoPrompt: string|null; contexto: {usados, ventana}|null; turnoAbierto: boolean; ultimaActividadMs: number|null }`. Es un reductor incremental:
  - `event_msg.user_message.message` → último prompt;
  - `event_msg.token_count.info` → `usados = last_token_usage.total_tokens` y `ventana = model_context_window`;
  - `task_started`/`task_complete` → `turnoAbierto` si el último es `task_started`;
  - `timestamp` → última actividad.
- `TareaCodex = { archivo; threadId: string|null; prompt; esfuerzo; modelo; ultimoMensaje: string|null; completada: boolean; mtimeMs: number }`.
- `leerTareasCodex(rutaProyecto: string): Promise<TareaCodex[]>`. Lee `.codex-logs/*.jsonl`: la primera línea es `task_meta`, `thread.started.thread_id` da el hilo, `turn.completed` marca la tarea como completada y el último `item.completed` con `item.type === 'agent_message'` da el último mensaje.
- `estadoTarea(completada: boolean, ultimaActividadMs: number, ahoraMs: number): 'en-curso'|'terminado'|'interrumpido'`. Con `completada` es `'terminado'`; si no, es `'en-curso'` cuando han pasado menos de 120 000 ms y `'interrumpido'` en otro caso.
- `ProcesoCodex = { pid: number; cwd: string|null; inicioMs: number; interactivo: boolean }`.
- `procesosCodex(so: SO, ejecutar: (cmd: string, args: string[]) => Promise<string>): Promise<ProcesoCodex[]>`.
  - **macOS:** `ps -axo pid=,lstart=,command=`. Se filtran los comandos cuyo ejecutable o primer argumento JS termina en `/codex` o en `codex.js`. `interactivo` es falso si los argumentos contienen ` exec `. El `cwd` sale de `lsof -a -d cwd -p <pid> -Fn`, en la línea que empieza por `n`.
  - **Windows:** `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'codex' } | Select ProcessId,CreationDate,CommandLine | ConvertTo-Json"`, con `cwd: null`.
- `hilosAbiertos(hilos: HiloCodex[], procesos: ProcesoCodex[]): Set<string>`. Recorre los procesos interactivos:
  - **con `cwd`**: marca el hilo no `exec` más reciente de ese `cwd` actualizado después de `inicioMs`;
  - **con `cwd: null`**: marca todos los hilos no `exec` actualizados después de `inicioMs`.

- [ ] **Paso 1:** escribir los tests.
  - **hilos:**
    - se crean `state_5.sqlite` y `state_7.sqlite` con `node:sqlite` y solo las columnas usadas, más `thread_spawn_edges` → se lee el 7;
    - un archivado no sale;
    - el padre se resuelve;
    - una base de datos abierta en modo WAL por otra conexión que escribe → se lee sin error;
    - sin base de datos → `[]`.
  - **rollouts:** `token_count` con `total_tokens: 20116` y `model_context_window: 258400` → `contexto` igual a `{usados: 20116, ventana: 258400}`; `task_started` sin `task_complete` → `turnoAbierto: true`.
  - **tareas:** un log con `task_meta`, `thread.started` y `turn.completed` → `completada: true` y `threadId`; `estadoTarea(false, ahora-60_000, ahora) === 'en-curso'`; con `ahora-180_000` → `'interrumpido'`.
  - **procesos:** salidas de ejemplo de `ps` y `lsof` (y el JSON de PowerShell) → los pids correctos, `interactivo` correcto y `cwd` correcto.
  - **hilosAbiertos:** dos hilos en el mismo `cwd` → solo se marca el más reciente; un hilo `exec` nunca se marca; con `cwd: null` se marcan todos los recientes.
- [ ] **Paso 2:** `npx vitest run agente/test/lectores/codex*` → FALLA.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** los mismos tests → PASA.
- [ ] **Paso 5:** commit `Añade los lectores de Codex`.

---

### Tarea 8: Pendientes (planes y handoff) · Ejecuta: **Codex** (low)

**Ficheros:**
- Crear: `agente/src/lectores/pendientes.ts`
- Test: `agente/test/lectores/pendientes.test.ts`

**Interfaces:**
- `leerPlanes(rutaProyecto: string): Promise<Pendiente[]>`. Lee `docs/superpowers/plans/*.md`:
  - `fechaMs` es la medianoche UTC del prefijo `AAAA-MM-DD-` del nombre;
  - `titulo` es el texto del primer `# `;
  - `hechas` cuenta las líneas `- [x]` o `- [X]`, y `total` es `hechas` más las `- [ ]`, con cualquier sangría;
  - los planes con `total === 0` se omiten.
- `leerHandoff(rutaProyecto: string, ultimoCommitMs: number | null): Promise<Pendiente | null>`.
  - Busca `HANDOFF.md` en el proyecto y, si no está, en la carpeta padre.
  - Si viene de la padre y tiene secciones `## ` cuyo título contiene `basename(rutaProyecto)`, usa solo esa sección. Si no hay ninguna, devuelve el documento entero en el proyecto y `null` desde la padre.
  - `titulo` es el primer elemento de lista, numerado o con viñeta y sin `**` ni comillas invertidas, que hay bajo un encabezado o línea en negrita que contenga "lo que falta", "pendiente" o "siguiente" (sin distinguir mayúsculas). Si no hay, es el primer encabezado.
  - `fechaMs` es la primera fecha `AAAA-MM-DD` del documento y, si no hay, el mtime.
  - `quizaDesactualizado` es `ultimoCommitMs !== null && ultimoCommitMs > fechaMs + 86_400_000`.

- [ ] **Paso 1:** escribir los tests.
  - **planes:** un plan `2026-08-31-git.md` con 2 `- [x]` y 3 `- [ ]` → `{titulo, hechas: 2, total: 5}` y `fechaMs` del 31 de agosto; un plan sin casillas no sale.
  - **handoff**, con un `HANDOFF.md` en la padre que imita el real (`# Estado al cerrar sesión — 2026-08-14`, una sección `## 1. proyecto-a — …` con `**LO QUE FALTA…**` y `1. **Aplicar 0004.sql a mano** …`, y una sección `## 2. proyecto-b`):
    - `proyecto-a` → `titulo === 'Aplicar 0004.sql a mano …'` (el texto de la línea sin el marcado);
    - con `ultimoCommitMs` del 11 de septiembre → `quizaDesactualizado: true`;
    - un proyecto sin sección y sin `HANDOFF.md` propio → `null`.
- [ ] **Paso 2:** `npx vitest run agente/test/lectores/pendientes.test.ts` → FALLA.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** el mismo test → PASA.
- [ ] **Paso 5:** commit `Añade los pendientes de planes y handoff`.

---

### Tarea 9: Asignación, instantánea y CLI · Ejecuta: **Codex** (high) + verificación real de **Claude**

**Ficheros:**
- Crear: `agente/src/asignacion.ts`, `agente/src/instantanea.ts`, `agente/src/cli.ts`
- Test: `agente/test/asignacion.test.ts`, `agente/test/instantanea.test.ts`, `agente/test/ayudas/homeFalso.ts`

**Interfaces:**
- Consume todo lo anterior.
- `asignarProyectos(cwd: string, ficherosEditados: string[], proyectos: ProyectoBase[]): string[]`. Aplica §6.5 de la especificación:
  1. el proyecto con el prefijo más largo del `cwd`;
  2. si no hay, los proyectos que contienen algún fichero editado, sin repetir y en orden de primera aparición;
  3. si tampoco, `[]`.
- `construirInstantanea(dep: { cfg: ConfigAgente; rutas: RutasBase; so: SO; ahoraMs: number; pidVivo; ejecutar }): Promise<Instantanea>`.
  - **Guardián**: todas las lecturas de transcripts, rollouts y logs pasan antes por un guardián con estas permitidas: `rutas.claude/projects`, `rutas.claude/sessions`, `rutas.codex/sessions` y cada proyecto.
  - **Ventana de tiempo**: transcripts e hilos de los últimos 7 días, más todas las sesiones vivas.
  - **Agente de Claude**:
    - `id` es `claude:<sessionId>`, o `claude:<sessionId>:<agenteSubId>` si es un subagente, y en ese caso `padreId` es `claude:<sessionId>`;
    - `estado`: viva con `busy` → `'trabajando'`; viva con `idle` → `'esperandote'`; en otro caso, `'cerrada'`;
    - `puedeContinuar = estado === 'cerrada' && !subagente`;
    - `contexto.ventana = ventanaContexto(modelo, cfg.ventanasContexto)`.
  - **Agente de Codex**:
    - `id` es `codex:<threadId>`;
    - si el hilo tiene `source === 'exec'` o hay una tarea de `.codex-logs` con ese `threadId`, `modo` es `'tarea'`, el estado sale de `estadoTarea` y `puedeContinuar` es `false` mientras esté `'en-curso'`;
    - si no, `modo` es `'interactivo'` y el estado es: si está en `hilosAbiertos`, `'trabajando'` cuando el rollout cambió hace menos de 30 s o tiene `turnoAbierto`, y `'esperandote'` en otro caso; si no está, `'cerrada'` con `puedeContinuar: true`;
    - una tarea sin hilo da `id` `codex-tarea:<archivo>`.
  - **Proyecto**: `pendientes` son los planes, más el handoff, más las `tareas` no hechas de sus sesiones de Claude vivas (con `origen: 'sesion'`).
  - **Enmascarado**: `titulo` y `ultimoPrompt` pasan por `enmascararSecretos`.
  - **Avisos**: `sin-claude` o `sin-codex` si falta la carpeta correspondiente.
  - **Salida**: el resultado se valida con `Instantanea.parse`.
- `cli.ts instantanea [--config <ruta>]` imprime el JSON con sangría de 2. `pidVivo` usa `process.kill(pid, 0)`, y `ejecutar` usa `execFile` con timeout de 5 s.

- [ ] **Paso 1:** escribir los tests.
  - **asignación:**
    - `cwd` igual a `/r/Proyectos IA/b/src` → `[idB]`;
    - `cwd` igual a `/r/Proyectos IA` con un fichero editado en `/r/Proyectos IA/b/x.ts` → `[idB]`;
    - sin coincidencias → `[]`.
  - **instantánea**, con `homeFalso()`, que crea `Desktop/Proyectos IA/{a,b}` como repos, `.claude/sessions` y `projects`, y `.codex` con su base de datos:
    - una sesión viva `busy` en `a` → `estado: 'trabajando'` y `proyectoIds: [idA]`;
    - un transcript cerrado con `cwd` en `Proyectos IA` y `Edit` en `b` → `'cerrada'`, `puedeContinuar: true` y `[idB]`;
    - un hilo `exec` más su log `.codex-logs` en `a` → **un solo** agente, `modo: 'tarea'`, con el `modelo` de la base de datos;
    - un `ultimoPrompt` con `sk-ant-…` → sale enmascarado;
    - borrar `.codex` → `avisos: ['sin-codex']` y sin agentes de Codex;
    - un transcript cuyo `rollout`/ruta apunta a `.codex/auth.json` mediante un symlink → no se lee y no rompe la instantánea.
- [ ] **Paso 2:** `npx vitest run agente/test/asignacion.test.ts agente/test/instantanea.test.ts` → FALLA.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `npm test && npm run lint && npm run build` → todo PASA.
- [ ] **Paso 5 (Claude):** ejecutar `npm run instantanea > /tmp/instantanea.json` en este Mac y comprobar:
  - las sesiones vivas de `~/.claude/sessions` aparecen con su estado;
  - `tech-study-tracker` tiene 6 pendientes de plan con sus `hechas/total` reales (42/43, 54/54, 0/54…);
  - `grep -E 'sk-|ghp_|AKIA|auth\.json'` sobre la salida no devuelve nada;
  - la ejecución tarda menos de 5 s.
- [ ] **Paso 6:** commit `Construye la instantánea completa de la máquina`.

---

## Cierre de la fase (Claude)

- [ ] Revisión del diff de la rama completa. Lo que toca la Tarea 3 se revisa a fondo (es la frontera de seguridad) y el resto con una pasada ligera.
- [ ] `npm test && npm run lint && npm run build` en limpio.
- [ ] PR `fase-1/base-y-lectores` → `main` sin atribución a Claude. Merge cuando Pedro lo apruebe.
- [ ] Escribir el plan de la fase 2 (hub, agente conectado, alta de máquinas, inicio de sesión y vista general).
