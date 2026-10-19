# centro-agentes: diseño v1

Fecha: 2026-10-19 · Estado: pendiente de aprobación

## 1. Para qué sirve

Pedro trabaja en varios proyectos a la vez con dos tipos de agentes:
sesiones de **Claude Code** (sobre todo desde VS Code) e hilos o tareas de
**Codex CLI**. Hoy no hay ningún sitio donde ver todo junto. Para saber qué
agente está trabajando, en qué proyecto, en qué rama y qué quedó pendiente,
tiene que abrir terminales, abrir `HANDOFF.md` y levantar el monitor de
Codex (`localhost:4545`) de cada repo por separado.

centro-agentes es un **panel web local** que lee lo que esas herramientas ya
guardan en disco y lo enseña en un solo sitio. Pedro no tiene que apuntar
nada a mano.

## 2. Objetivos v1

1. **Inicio**: ver de un vistazo todos los proyectos, con su estado de git,
   los agentes activos en cada uno y lo que tienen pendiente.
2. **Agentes**: ver todas las sesiones de Claude Code y los hilos y tareas
   de Codex en una lista, filtrable por proyecto y por estado.
3. **Detalle de agente**: abrir cualquier agente y ver su línea de tiempo
   (mensajes, comandos, herramientas), en directo si está trabajando. Esto
   sustituye al `codex-monitor.mjs` de cada repo.
4. **Ficha de proyecto**: estado de git, ramas, últimos commits, historial
   de agentes y contenido del `HANDOFF.md`.
5. Todo se actualiza solo, sin recargar la página.

## 3. Fuera de la v1 (llega después)

- **v2**: lanzar tareas de Codex desde el panel, eligiendo modelo y esfuerzo.
- **v3**: enviar mensajes a una sesión de Claude Code abierta (por su socket
  `messagingSocketPath`).
- Ver PRs de GitHub (necesita red y el token de `gh`).

**En la v1 no hay ningún endpoint que escriba, lance procesos ni modifique
nada.** La única excepción es ejecutar `git` en modo lectura.

## 4. Lo que no debe pasar (anti-objetivos)

- **Que el panel exponga credenciales.** No debe leer ni servir nunca
  `~/.codex/auth.json`, ficheros `*.key`, `.env*`, `client_secret*` ni
  nada de `~/.claude/session-env`. Si una ruta pedida acaba ahí (también
  tras resolver symlinks y `..`), se rechaza.
- **Que sea accesible desde fuera de la máquina.** Escucha solo en
  `127.0.0.1`. Además, rechaza peticiones cuya cabecera `Host` no sea
  `127.0.0.1:<puerto>` o `localhost:<puerto>`, para cerrar el DNS
  rebinding.
- **Que estropee el estado de las herramientas.** La base de datos de Codex
  se abre en solo lectura. Nunca se escribe en `~/.claude` ni en `~/.codex`.
- **Que se vuelva lento.** Los transcripts de Claude pasan de 20 000
  líneas. Nunca se cargan enteros en memoria: se lee la cola del fichero
  (últimos N eventos) y se pagina hacia atrás bajo demanda.
- **Que dependa de la nube.** Todo funciona sin conexión a internet.

## 5. Fuentes de datos (verificadas en la máquina el 2026-10-19)

### 5.1 Proyectos

Se descubren uniendo dos fuentes:

- **Escaneo de carpetas raíz** configurables. Por defecto `~/Desktop` y
  `~/Downloads`, con profundidad 2. Cuenta como proyecto toda carpeta que
  tenga `.git`. Hoy salen 9, entre ellos `Proyectos IA/tech-study-tracker`,
  `Proyectos IA/codebase-memory-local`, `Desktop/Apuntes`,
  `Downloads/Apuntes`, `javascript-proyectos`…
- **Proyectos de confianza de Codex**: las claves `[projects."<ruta>"]` de
  `~/.codex/config.toml`. Se **excluyen** las rutas bajo `/private/tmp` o
  `/tmp`, el propio `$HOME` y las rutas que ya no existen.

Un fichero `centro-agentes.config.json` en la raíz del repo permite cambiar
las carpetas raíz, ocultar proyectos y fijar el puerto. Ese fichero no se
versiona; en su lugar se versiona un `centro-agentes.config.example.json`.

Por cada proyecto se obtiene, ejecutando `git` con `execFile` (nunca con un
shell) y un timeout:

- rama actual;
- último commit (hash corto, mensaje, fecha relativa);
- número de ficheros modificados o sin seguimiento (`status --porcelain`);
- commits por delante o por detrás del upstream, si lo hay;
- ramas locales;
- si existe `HANDOFF.md` en la raíz o en la carpeta padre (como en
  `Proyectos IA/HANDOFF.md`), su contenido y el primer punto de su sección
  "LO QUE FALTA" o equivalente, si se puede detectar. Si no se detecta, se
  muestra el primer encabezado.

### 5.2 Sesiones de Claude Code

- **Sesiones vivas**: `~/.claude/sessions/<pid>.json`. Campos que se usan:
  `pid`, `sessionId`, `cwd`, `name` (p. ej. `apuntes-ab`), `status`
  (`idle` | `busy`), `entrypoint` (`claude-vscode`, cli…), `startedAt` y
  `updatedAt` (ms). Hay que comprobar que el `pid` sigue vivo
  (`process.kill(pid, 0)`). Si no lo está, la sesión se marca como
  "cerrada" y no como "activa".
- **Historial y transcript**: `~/.claude/projects/<slug>/<sessionId>.jsonl`.
  El `<slug>` es el `cwd` con `/` y espacios cambiados por `-`
  (p. ej. `-Users-pedroleridanieto-Desktop-Proyectos-IA`). Cada línea es un
  JSON con un `type`. Para la línea de tiempo solo interesan `user` y
  `assistant` (texto y nombres de herramientas usadas) y `ai-title` (título
  de la sesión). Los demás tipos se ignoran. Las sesiones pasadas salen de
  listar esos `.jsonl`.
- Los ficheros `*.key` de `~/.claude/sessions/` **no se leen nunca**.

### 5.3 Codex

- **Hilos**: tabla `threads` de `~/.codex/state_5.sqlite`, abierta en solo
  lectura. Columnas que se usan: `id`, `title`, `cwd`, `model`,
  `reasoning_effort`, `tokens_used`, `git_branch`, `source` (`vscode`,
  `exec`, o JSON como `{"subagent":…}`), `archived`, `updated_at_ms`,
  `created_at_ms` y `rollout_path`. El nombre del fichero lleva versión
  (`state_5`), así que se busca el `state_*.sqlite` con el número más alto.
- **Línea de tiempo de un hilo**: el `.jsonl` que indica `rollout_path`,
  bajo `~/.codex/sessions/AAAA/MM/…`.
- **Tareas lanzadas con `codex-task.sh`**: los `<proyecto>/.codex-logs/*.jsonl`
  de cada proyecto descubierto. La primera línea es
  `{"type":"task_meta","effort","model","prompt"}` y le siguen eventos de
  `codex exec --json`: `thread.started`, `turn.started`, `turn.completed`,
  `item.started` e `item.completed`, con `item.type` en `agent_message`,
  `command_execution`, etc. Una tarea está **en curso** si su log cambió
  hace menos de 2 minutos y todavía no tiene `turn.completed`.

### 5.4 Cómo se asigna un agente a un proyecto

Se asigna por el `cwd` del agente: gana el proyecto cuya ruta sea el prefijo
más largo de ese `cwd`. Si ningún proyecto encaja, el agente va al grupo
"Sin proyecto".

### 5.5 Reglas de modelo de datos (decisiones de Claude, tras la revisión del builder)

- **Una tarea de `codex-task.sh` es un solo agente.** Su log en
  `.codex-logs` y su hilo `source=exec` de la base de datos se unen por el
  id de `thread.started`. Para el estado y la línea de tiempo manda el log
  de la tarea; el modelo, el esfuerzo y los tokens salen de la base de
  datos. Los hilos `exec` que no tengan log se muestran solo con los datos
  de la base de datos, usando su rollout como línea de tiempo.
- **Estados de Codex**: "en curso" si la última actividad (mtime del log o
  del rollout, o `updated_at_ms`) fue hace menos de 2 min y no hay
  `turn.completed`. "Terminado" si hay `turn.completed`. "Interrumpido" si
  no hay `turn.completed` y lleva más de 2 min sin actividad. Los hilos de
  VS Code usan la misma regla sobre su rollout y también tienen línea de
  tiempo en directo.
- **Subagentes**: los hilos de Codex con `source={"subagent":…}` y los
  transcripts de subagentes de Claude van **anidados bajo su agente
  padre**. No aparecen como filas propias ni cuentan en Inicio. Si no se
  puede encontrar el padre, van a "Sin proyecto" con una etiqueta de
  subagente.
- **`HANDOFF.md` compartido**: si un `HANDOFF.md` de la carpeta padre tiene
  secciones `## …` cuyo título contiene el nombre de carpeta del proyecto
  (p. ej. `## 1. tech-study-tracker — …`), ese proyecto muestra solo su
  sección. Si no las tiene, se muestra el documento entero.
- **Rutas**: la API **no acepta rutas de fichero**, solo ids de proyecto o
  de agente. La protección de rutas se aplica a las que calcula el propio
  servidor (`rollout_path`, `HANDOFF.md`, logs, transcripts), en dos capas:
  1. **lista permitida**: solo bajo las carpetas raíz de proyectos,
     `~/.claude/projects`, `~/.claude/sessions/*.json` y `~/.codex/sessions`;
  2. **lista prohibida** (§4), comprobada después de `realpath`.

  Si una ruta calculada no pasa el filtro, el endpoint responde 403. Se
  prueba con tests unitarios del guardián y con un test de endpoint que
  usa un fixture cuyo `rollout_path` apunta a `auth.json`.
- **Secretos dentro de transcripts**: antes de servir una línea de tiempo
  se enmascaran los patrones habituales: `sk-…`, `ghp_…`/`github_pat_…`,
  JWT `eyJ…`, `AKIA…`, cabeceras `Authorization:` y líneas `CLAVE=valor`
  cuyo nombre contenga KEY, SECRET, TOKEN o PASSWORD. En la v1 no hay
  forma de desactivarlo. Tiene sus propios tests.

## 6. Pantallas

1. **Inicio**: una fila por proyecto. Aparecen primero los que tienen
   agentes activos y después los demás, del más reciente al más antiguo.
   Cada fila muestra el nombre, la rama, el último commit, un indicador de
   cambios sin commitear, los agentes activos (iconos distintos para Claude
   y Codex, con estado) y la primera línea pendiente del handoff.
2. **Agentes**: tabla con tipo (Claude o Codex), nombre o título, proyecto,
   estado (Claude: ocupado, inactivo, cerrado; Codex: en curso, terminado,
   interrumpido), modelo y
   esfuerzo (en Codex), tokens (en Codex) y última actividad. Filtros por
   tipo, proyecto y estado. Por defecto muestra lo de los últimos 7 días.
3. **Detalle de agente**: cabecera con los metadatos y, debajo, la línea de
   tiempo de eventos (mensajes, comandos con su salida plegada, nombres de
   herramientas). Si el agente está activo, la línea de tiempo se actualiza
   en directo y se puede seguir el final automáticamente. Hay un botón
   "cargar anteriores" para paginar hacia atrás.
4. **Ficha de proyecto**: git (rama, ramas locales, últimos 10 commits,
   cambios), agentes de ese proyecto (activos e históricos) y el
   `HANDOFF.md` renderizado como Markdown **saneado**, sin HTML crudo.

La interfaz va en **español**, con modo claro y oscuro según el sistema, y
debe funcionar bien en pantalla de portátil. El uso en móvil no es
prioritario.

## 7. Arquitectura (decisión de Claude, no de Pedro)

- **Repo propio**: `~/Desktop/Proyectos IA/centro-agentes`, privado en
  GitHub (`pedroleni/centro-agentes`).
- **Servidor**: Node 22 + TypeScript. Para el SQLite se usa el `node:sqlite`
  que trae Node, con `--experimental-sqlite` en Node 22.12, en vez de
  `better-sqlite3`. Así no hay módulos nativos que compilar, y Codex no
  tiene red para instalarlos. La API es HTTP JSON bajo `/api/*` más un
  endpoint SSE `/api/agents/:id/stream` para la línea de tiempo en directo
  (vigilando el fichero con `fs.watch` y relectura incremental desde el
  último offset). El framework HTTP queda a criterio del builder; lo ideal
  es mínimo, como Hono o `node:http`.
- **Front**: Vite + React + TypeScript. Las listas se refrescan con polling
  cada 5 s y la línea de tiempo abierta usa SSE.
- **Producción local**: un solo comando (`npm start`) compila el front y lo
  sirve desde el mismo servidor. El puerto por defecto es **4600**, para no
  chocar con el monitor de Codex (4545).
- **Capa de lectores**: un módulo por fuente (`proyectos`, `git`,
  `claudeSessions`, `claudeTranscript`, `codexThreads`, `codexLogs`,
  `handoff`). Cada uno recibe sus rutas base inyectadas, para poder
  probarlo con fixtures en vez de con el `$HOME` real.
- **Tests**: Vitest. Cada lector tiene tests con fixtures **sintéticos**
  (nada copiado de los ficheros reales de Pedro). También hay tests de la
  lista de rutas prohibidas (incluido escapar con `..` y con symlinks) y del
  rechazo por cabecera `Host`.

## 8. Forma de trabajo: Claude planifica, Codex implementa

- **Claude** escribe este diseño y el plan por fases, elige el modelo y el
  esfuerzo de Codex para cada tarea, instala las dependencias (Codex no
  tiene red), crea las ramas, ejecuta `test`, `build` y `lint` por su
  cuenta, verifica la interfaz con Playwright, revisa el código y hace los
  commits, pushes y PRs.
- **Codex** implementa cada fase a partir de un prompt concreto, con
  `codex exec --sandbox workspace-write --json`, y escribe sus propios
  tests.
- El repo lleva **su propio** `scripts/dev/codex-task.sh`,
  `scripts/dev/codex-monitor.mjs` y `AGENTS.md`, adaptados de
  tech-study-tracker. No se reutiliza el de otro repo. Cada vez que se lanza
  Codex se le da a Pedro la URL del monitor, y antes se comprueba que está
  escuchando.
- **Commits**: sin coautoría de Claude, ni `Co-Authored-By` ni "Generated
  with Claude Code". Se trabaja en ramas y se integra en `main` mediante PR.
- El repo sigue **privado** hasta que Pedro diga lo contrario.

## 9. Lo que queda a criterio del builder

- El framework HTTP, el router del front, el estilo visual y los
  componentes.
- El formato exacto de la API JSON.
- La heurística para extraer "lo pendiente" de un `HANDOFF.md`, siempre que
  degrade a mostrar el primer encabezado.
- El tamaño de página de la línea de tiempo (sugerencia: 200 eventos).

## 10. Cuándo está terminada la v1

- `npm start` levanta el panel en `http://127.0.0.1:4600` y en Inicio
  aparecen los proyectos reales de la máquina, con su estado de git.
- Las sesiones de Claude Code abiertas salen como activas u ocupadas y, al
  cerrar una, pasan a "cerrada" en menos de 10 s.
- Una tarea lanzada con `codex-task.sh` en cualquier proyecto se ve en
  directo en el detalle de agente.
- Los hilos de Codex aparecen con su modelo, su esfuerzo y sus tokens.
- Un agente cuyo fichero calculado cae fuera de la lista permitida, o
  dentro de la prohibida, devuelve 403. Una petición con `Host: evil.com`
  también se rechaza. Los secretos de los transcripts salen enmascarados.
- `test`, `build` y `lint` pasan, y Claude ha hecho la verificación visual
  con Playwright.
