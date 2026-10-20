# Fase 2 · Panel web en modo local — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para ejecutar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** `npm run panel` sirve en `http://127.0.0.1:4600` el panel visual de esta máquina. Tiene una vista general con tarjetas por proyecto y sus agentes, y una ficha de cada proyecto con su historial de commits y sesiones por día, sus tareas con fecha y sus sesiones.

**Arquitectura:** el agente de la fase 1 añade un servidor HTTP mínimo (`node:http`) que solo escucha en `127.0.0.1`. Ese servidor:
- sirve `GET /api/instantanea` (con caché de 5 s);
- sirve `GET /api/proyectos/:id/commits`;
- entrega el front compilado.

El front es Vite + React + TypeScript, sin librería de rutas: usa rutas con hash (`#/` y `#/proyecto/<id>`). Toda la lógica de agrupar, filtrar, formatear y construir el historial vive en funciones puras con tests, y los componentes solo pintan.

**Tecnología:** la de la fase 1, más React, Vite, `@vitejs/plugin-react`, jsdom y Testing Library.

**Especificación:** `docs/superpowers/specs/2026-10-19-centro-agentes-design.md` (§2.1, §2.2, §6.6 y la fase 2 de §9). Diseño visual: `docs/superpowers/specs/maquetas/estilo-tarjetas-v2.html`.

## Restricciones globales

- Rige todo lo de la fase 1: Node ≥ 22.12 con `--experimental-sqlite`, ESM, TS strict, identificadores en español, git solo con el helper seguro de `git.ts`, guardián y enmascarado.
- **El servidor escucha solo en `127.0.0.1`**, con el puerto por defecto **4600**. Se rechaza con 403 cualquier `Host` distinto de `127.0.0.1:<puerto>` o `localhost:<puerto>`. Los métodos que no sean `GET`/`HEAD` reciben 405. No hay cabeceras CORS. Toda respuesta lleva `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'`, `X-Content-Type-Options: nosniff` y `Referrer-Policy: no-referrer`.
- La API **no acepta rutas de fichero**, solo ids de proyecto.
- **Textos de la interfaz en español**, con estos exactos:
  - título "Centro de agentes";
  - estados: "Trabajando", "Esperándote", "Cerrada", "En curso", "Terminado" e "Interrumpido";
  - filtros: "Todos", "Con agentes activos", "Esperándome" y "Con pendientes";
  - botón de continuar desactivado con el texto "Llega con el terminal".
- **Estilo**: el de la maqueta `estilo-tarjetas-v2.html`, con sus clases `ca-*` y `cd-*` y sus colores. Tema claro. A 390 px de ancho no puede haber scroll horizontal.
- **Codex no puede abrir puertos**: los tests que él ejecuta no hacen `listen`. Las pruebas con sockets reales y las de navegador las hace Claude.
- Commits **sin atribución a Claude**. Rama `fase-2/panel-local` e integración por PR.

## Foco de revisión

1. **Máquina sin proyectos ni agentes**: la vista general muestra "No hay proyectos en las carpetas escaneadas", no una página en blanco. Test en la Tarea 5.
2. **La API cae o se reinicia mientras la página está abierta**: aparece el aviso "Sin conexión con el agente · reintentando", se conservan los últimos datos y se reintenta cada 5 s. Test en la Tarea 5.
3. **Títulos, prompts o rutas muy largos y sin espacios**: se cortan con elipsis y no rompen el ancho de 390 px. Regla CSS en la Tarea 5 y comprobación de Claude con Playwright en la Tarea 7.
4. **Varias peticiones a `/api/instantanea` mientras se construye**: comparten una sola construcción. Si la construcción falla, la respuesta es un 500 JSON `{ error }` y el servidor no se cae. Test en la Tarea 3.
5. **Id de proyecto desconocido**, en la URL con hash o en la API: el front muestra la vista "Proyecto no encontrado" y la API responde 404. Tests en las Tareas 3 y 6.

---

### Tarea 1: Workspace `web/` y scripts · Ejecuta: **Claude**

**Ficheros:**
- Crear: `web/package.json` (`@centro/web`, depende de `@centro/compartido`), `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/src/main.tsx` y `web/src/App.tsx` (provisional: pinta "Centro de agentes")
- Modificar: `package.json` (añadir el workspace `web`, y los scripts `build:web` → `vite build web`, `dev:web` → `vite web` y `panel`), `vitest.config.ts` (incluir `web/test/**/*.test.{ts,tsx}`) y `eslint.config.js` (ficheros `.tsx`)
- Test: `web/test/humo.test.tsx`

**Interfaces:**
- Produce el script `npm run panel` = `npm run build:web && NODE_OPTIONS='--experimental-sqlite --no-warnings=ExperimentalWarning' tsx agente/src/cli.ts panel`.
- Produce `vite.config.ts` con `build.outDir = 'dist'` dentro de `web/` y, en desarrollo, un proxy de `/api` a `http://127.0.0.1:4600`.
- Los tests de componentes declaran `// @vitest-environment jsdom` en su primera línea.

- [ ] **Paso 1:** crear la rama `fase-2/panel-local` e instalar `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `jsdom`, `@testing-library/react` y `@testing-library/dom`.
- [ ] **Paso 2:** escribir el test de humo: `render(<App/>)` y `getByText('Centro de agentes')`.
- [ ] **Paso 3:** `npm test` → PASA. `npm run lint && npm run build && npm run build:web` → sin errores.
- [ ] **Paso 4:** commit `Prepara el workspace del front`.

---

### Tarea 2: Commits del proyecto y enlace con las sesiones · Ejecuta: **Codex** (medium)

**Ficheros:**
- Modificar: `compartido/src/esquemas.ts` (añadir `Commit` y `Agente.commitsMs`), `agente/src/lectores/claudeTranscripts.ts` (`ResumenClaude.commitsMs`), `agente/src/instantanea.ts` (rellenar `commitsMs`; para Codex, `[]`) y `agente/src/lectores/git.ts` (`commitsRecientes`)
- Crear: `compartido/src/historial.ts`
- Test: `compartido/test/historial.test.ts` y ampliar `agente/test/lectores/claudeTranscripts.test.ts` y `agente/test/lectores/git.test.ts`

**Interfaces:**
- `Commit = z.object({ hash: z.string(), mensaje: z.string(), fechaMs: z.number(), autor: z.string() })`.
- `Agente.commitsMs: z.array(z.number())` guarda las marcas de tiempo en que la sesión ejecutó un `git commit`.
- En `ResumenClaude.commitsMs` entra el `timestamp` de cada línea con un `tool_use` llamado `Bash` cuyo `input.command` cumpla `/\bgit\b[^\n]*\bcommit\b/`.
- `commitsRecientes(ruta: string, desdeMs: number, maximo = 200): Promise<Commit[]>`, en `git.ts`:
  - usa el helper seguro con `log --no-show-signature --since=<ISO> -n <maximo> --format=%h%x00%s%x00%ct%x00%an`;
  - devuelve los commits de más reciente a más antiguo, con `mensaje` pasado por `enmascararSecretos`;
  - si falla, devuelve `[]`.
- `enlazarCommits(commits: Commit[], agentes: Agente[], proyectoId: string): Map<string, Commit[]>` (clave: `agente.id`). Un commit va a un agente del proyecto si alguna marca de `agente.commitsMs` está en `[commit.fechaMs - 120_000, commit.fechaMs + 5_000]`. Si encajan varios agentes, gana el de la marca más cercana. Cada commit va a un solo agente.

- [ ] **Paso 1:** escribir los tests.
  - `enlazarCommits`:
    - un commit a 30 s de la marca de un agente del proyecto → enlazado;
    - un commit a 10 min → no se enlaza;
    - un agente de otro proyecto → nunca;
    - dos agentes candidatos → gana el más cercano.
  - Transcript: un `Bash` con `git add . && git commit -m "x"` → `commitsMs` contiene su timestamp; un `Bash` con `git status` → no entra.
  - `commitsRecientes`: un repo con 3 commits a fechas fijas → 3 en orden descendente con `autor`; un mensaje con `sk-` seguido de 20 caracteres → enmascarado; una ruta inexistente → `[]`.
- [ ] **Paso 2:** `npm test -- compartido/test/historial.test.ts agente/test/lectores` → FALLA.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `npm test && npm run lint && npm run build` → PASA.
- [ ] **Paso 5:** commit `Añade los commits del proyecto y su enlace con las sesiones`.

---

### Tarea 3: Servidor del panel · Ejecuta: **Codex** (high) + prueba con sockets de **Claude**

**Ficheros:**
- Crear: `agente/src/panel/cache.ts`, `agente/src/panel/estaticos.ts`, `agente/src/panel/manejador.ts` y `agente/src/panel/servidor.ts`
- Modificar: `agente/src/cli.ts` (subcomando `panel [--puerto N] [--config <ruta>]`)
- Test: `agente/test/panel/cache.test.ts`, `agente/test/panel/estaticos.test.ts` y `agente/test/panel/manejador.test.ts`

**Interfaces:**
- `crearCacheInstantanea(construir: () => Promise<Instantanea>, ttlMs = 5_000, ahora = Date.now): { obtener(): Promise<Instantanea> }`.
  - Las llamadas que coinciden mientras se construye comparten la misma promesa.
  - Un fallo no se cachea: la siguiente llamada vuelve a construir.
- `resolverEstatico(dirWeb: string, rutaUrl: string): string | null`.
  - Decodifica la URL y quita la query.
  - `/` se resuelve como `index.html`.
  - Devuelve `null` si la ruta normalizada sale de `dirWeb`, contiene `\0` o empieza por `/api`.
- `tipoContenido(ruta: string): string`: html, js, css, svg, png, json, ico y woff2; cualquier otra extensión da `application/octet-stream`.
- `Peticion = { metodo: string; url: string; host: string | undefined }`.
- `Respuesta = { estado: number; cabeceras: Record<string, string>; cuerpo: string | Buffer }`.
- `crearManejador(dep: { puerto: number; obtenerInstantanea(): Promise<Instantanea>; obtenerCommits(proyectoId: string): Promise<Commit[] | null>; leerEstatico(ruta: string): Promise<Buffer | null>; dirWeb: string }): (p: Peticion) => Promise<Respuesta>`.
  - **Host** distinto de `127.0.0.1:<puerto>` o `localhost:<puerto>` → 403.
  - **Método** distinto de `GET`/`HEAD` → 405.
  - **`/api/instantanea`** → 200 con el JSON, o 500 `{error}`.
  - **`/api/proyectos/<id>/commits`**: `<id>` debe cumplir `/^[0-9a-f]{12}$/`, o 404. Devuelve 200 `{commits}`, o 404 si `obtenerCommits` da `null`.
  - **Otra `/api/...`** → 404.
  - **Estáticos**: si existen, se sirven. Si no, y la ruta no tiene extensión, se sirve `index.html` (fallback de SPA). Si tiene extensión, 404.
  - **Cabeceras de seguridad** (las de las Restricciones globales) en todas las respuestas; `Cache-Control: no-store` en la API.
- `arrancarPanel(opciones: { puerto: number; manejador: (p: Peticion) => Promise<Respuesta> }): Promise<import('node:http').Server>` escucha en `127.0.0.1`.
- `cli.ts panel`:
  - `obtenerCommits(id)` busca el proyecto en la última instantánea y llama a `commitsRecientes(proyecto.ruta, ahora - 30 días)`;
  - `dirWeb = <raíz del repo>/web/dist`;
  - imprime `Panel: http://127.0.0.1:<puerto>`.

- [ ] **Paso 1:** escribir los tests (sin sockets).
  - **Caché:**
    - 3 `obtener()` simultáneos → `construir` se llama 1 vez;
    - tras 5 s → se reconstruye;
    - si `construir` lanza → el error se propaga y la siguiente llamada reintenta.
  - **Estáticos:** `resolverEstatico('/w', '/../etc/passwd')`, `'/%2e%2e/x'` y `'/a%00b'` → `null`; `'/'` → `/w/index.html`; `'/assets/x.js?v=1'` → `/w/assets/x.js`.
  - **Manejador:**
    - `host: 'evil.com:4600'` → 403;
    - `POST` → 405;
    - `/api/instantanea` → 200 con las cabeceras de seguridad;
    - cuando construir lanza → 500 `{error}`;
    - `/api/proyectos/../../x/commits` y un id desconocido → 404;
    - `/proyecto/abc` sin fichero → `index.html`;
    - `/no-existe.js` → 404.
- [ ] **Paso 2:** `npm test -- agente/test/panel` → FALLA.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `npm test && npm run lint && npm run build` → PASA.
- [ ] **Paso 5 (Claude):** `npm run panel` y luego `curl` para comprobar:
  - `-H 'Host: 127.0.0.1:4600'` → 200;
  - `-H 'Host: evil.com'` → 403;
  - `-X POST` → 405;
  - `lsof -iTCP:4600 -sTCP:LISTEN` muestra solo `127.0.0.1`.
- [ ] **Paso 6:** commit `Añade el servidor local del panel`.

---

### Tarea 4: Lógica pura del front · Ejecuta: **Codex** (medium)

**Ficheros:**
- Crear: `web/src/logica/formato.ts`, `web/src/logica/agrupar.ts`, `web/src/logica/filtrar.ts` y `web/src/logica/historial.ts`
- Test: un fichero por módulo en `web/test/logica/`

**Interfaces:**
- **formato.ts:**
  - `etiquetaEstado(e: EstadoAgente): string`, con los textos de las Restricciones globales;
  - `porcentajeContexto(a: Agente): number | null` = `Math.round(100 * usados / ventana)`, o `null` si no hay ventana;
  - `duracionCorta(ms: number): string`: `'45 s'`, `'12 min'`, `'1 h 10 min'`, `'3 d'`;
  - `fechaRelativa(ms: number, ahora: number): string`: `'ahora'` si es menos de 60 s, `'hace 12 min'`, `'hace 3 h'`, `'ayer'`, y fuera de eso `'11 sep'` (formato `es-ES`, día y mes corto sin punto).
- **agrupar.ts:**
  - `TarjetaDatos = { proyecto: Proyecto; agentes: Agente[]; ultimoPrompt: string | null; pendientes: number; activo: boolean }`;
  - `Grupo = { nombre: string; tarjetas: TarjetaDatos[]; inactivas: TarjetaDatos[] }`;
  - `agruparProyectos(inst: Instantanea, ahora: number): { grupos: Grupo[]; sinProyecto: Agente[] }`.

  Reglas de `agruparProyectos`:
  - los grupos se forman por `proyecto.grupo`;
  - los `agentes` de cada tarjeta son los que tienen ese proyecto en `proyectoIds` y `padreId === null`, ordenados primero por estado (trabajando, esperandote, en-curso, interrumpido, cerrada, terminado) y después por `ultimaActividadMs` descendente;
  - `ultimoPrompt` es el del agente más reciente que tenga uno;
  - `pendientes` cuenta los planes con `hechas < total` más el handoff, si existe;
  - una tarjeta es `activo` si tiene algún agente en `trabajando`, `esperandote` o `en-curso`;
  - una tarjeta va a `inactivas` si no está activa, no tiene agentes y su `ultimaActividadMs` es anterior a `ahora - 30 días`;
  - las tarjetas se ordenan primero las activas y después por actividad descendente;
  - los grupos se ordenan por la actividad máxima de sus tarjetas;
  - `sinProyecto` son los agentes sin proyecto y sin padre.
- **filtrar.ts:** `filtrarGrupos(grupos: Grupo[], filtro: 'todos'|'activos'|'esperandome'|'pendientes', texto: string): Grupo[]`.
  - El texto se compara, sin distinguir mayúsculas ni acentos, con el nombre del proyecto, la rama y los títulos de sus agentes.
  - Se eliminan los grupos que quedan vacíos.
- **historial.ts:**
  - `Evento = { tipo: 'commit'; fechaMs: number; commit: Commit } | { tipo: 'sesion'; fechaMs: number; agente: Agente; commits: Commit[] }`;
  - `Dia = { clave: string; etiqueta: string; eventos: Evento[] }`;
  - `historialPorDia(commits: Commit[], agentes: Agente[], proyectoId: string, ahora: number): Dia[]`.

  Reglas de `historialPorDia`:
  - usa `enlazarCommits` (Tarea 2);
  - los commits enlazados solo aparecen dentro de su sesión;
  - la `fechaMs` de una sesión es su `ultimaActividadMs`;
  - los días y los eventos van en orden descendente;
  - `etiqueta`: `'Hoy'`, `'Ayer'` o el día de la semana con la fecha (`'jueves 11 sep'`).

- [ ] **Paso 1:** escribir los tests con instantáneas sintéticas construidas en el propio test.
  - **Estados y contexto:** cada uno de los 6 estados con su texto; `porcentajeContexto` 114 000/1 000 000 → 11.
  - **Duraciones y fechas:** `duracionCorta(4_200_000) === '1 h 10 min'`; `fechaRelativa` del día anterior → `'ayer'`.
  - **Agrupación:**
    - un proyecto con un agente `trabajando` sale primero en su grupo y en `activo`;
    - uno con 40 días sin actividad va a `inactivas`;
    - un subagente no aparece en la tarjeta;
    - un agente sin proyecto va a `sinProyecto`.
  - **Filtros:** `'esperandome'` deja solo las tarjetas con algún agente `esperandote`; `'pendientes'` deja las que tienen `pendientes > 0`; el texto `'TECH-STUDY'` encuentra `tech-study-tracker` y `'aplicacion'` encuentra una sesión titulada `'Aplicación'`.
  - **Historial:** un commit enlazado sale dentro de su sesión y no suelto; dos días distintos → 2 `Dia` con las etiquetas `'Hoy'` y `'Ayer'`.
- [ ] **Paso 2:** `npm test -- web/test/logica` → FALLA.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `npm test && npm run lint && npm run build` → PASA.
- [ ] **Paso 5:** commit `Añade la lógica del panel`.

---

### Tarea 5: Vista general · Ejecuta: **Codex** (medium)

**Ficheros:**
- Crear: `web/src/api.ts`, `web/src/usarInstantanea.ts`, `web/src/estilos.css`, `web/src/vistas/VistaGeneral.tsx`, `web/src/vistas/TarjetaProyecto.tsx` y `web/src/vistas/FilaAgente.tsx`
- Modificar: `web/src/App.tsx` (rutas con hash: `#/` es la vista general y `#/proyecto/<id>` la ficha, que en esta tarea es solo un marcador "Cargando…") y `web/src/main.tsx` (importa `estilos.css`)
- Test: `web/test/vistas/VistaGeneral.test.tsx`

**Interfaces:**
- Consume la Tarea 4.
- `obtenerInstantanea(): Promise<Instantanea>` hace `fetch('/api/instantanea')` y lo valida con `Instantanea.parse`.
- `obtenerCommits(id: string): Promise<Commit[]>`.
- `usarInstantanea(intervaloMs = 5_000): { datos: Instantanea | null; error: boolean; actualizadaMs: number | null }`. Hace polling y, si falla, conserva los datos anteriores y pone `error: true`.
- `VistaGeneral({ datos, error, actualizadaMs, ahora }: …)` es un componente presentacional sin `fetch`. `App` le pasa lo que devuelve `usarInstantanea`.
- **`estilos.css`** traslada los tokens y las clases `ca-*` de la maqueta. Además:
  - `.ca-card`, los textos de tarjeta y las filas usan `min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis` y `white-space: nowrap`;
  - por debajo de 640 px la rejilla es de 1 columna y la barra superior pasa a 2 líneas.
- **Estructura**, según la maqueta:
  - barra con "Centro de agentes", las píldoras "● N trabajando" y "◌ N esperándote" y el buscador;
  - chips de filtro;
  - cabecera de máquina: `💻 <maquina.nombre>`, más "actualizado hace X" con `fechaRelativa`;
  - un bloque por grupo con sus tarjetas, y abajo las inactivas como chips;
  - un bloque final "Sin proyecto" si hay agentes sin proyecto.
- **Tarjeta:**
  - el nombre enlaza a `#/proyecto/<id>`;
  - `ultimoPrompt` en cursiva;
  - chips de rama, de "N sin commit" (si `cambios > 0`) y de "⚑ N pendientes";
  - hasta 4 `FilaAgente` y después "+N más";
  - pie con "Último commit <fechaRelativa>" y una barra de actividad de 14 días;
  - `FilaAgente` lleva el icono ✱ si es Claude o ◎ si es Codex, el título, el estado con su punto de color, el modelo, la barra de contexto y el `%`, y el tiempo desde `inicioMs`.

- [ ] **Paso 1:** escribir los tests (jsdom, con una instantánea sintética). Añadir `commitsMs: []` a los agentes de los fixtures existentes que lo necesiten tras la Tarea 2.
  - Se pinta el título "Centro de agentes".
  - La tarjeta de un proyecto con un agente `trabajando` muestra "Trabajando" y "11%".
  - Al pulsar el filtro "Esperándome" se oculta una tarjeta sin agentes esperando.
  - Al escribir en el buscador se filtra.
  - Con `proyectos: []` y `agentes: []` aparece "No hay proyectos en las carpetas escaneadas".
  - Con `error: true` y datos aparece "Sin conexión con el agente · reintentando" y los datos siguen visibles.
  - El enlace de la tarjeta apunta a `#/proyecto/<id>`.
- [ ] **Paso 2:** `npm test -- web/test/vistas` → FALLA.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `npm test && npm run lint && npm run build && npm run build:web` → PASA.
- [ ] **Paso 5:** commit `Añade la vista general del panel`.

---

### Tarea 6: Ficha de proyecto · Ejecuta: **Codex** (medium)

**Ficheros:**
- Crear: `web/src/vistas/FichaProyecto.tsx`, `web/src/vistas/Historial.tsx`, `web/src/vistas/Tareas.tsx` y `web/src/vistas/Sesiones.tsx`
- Modificar: `web/src/App.tsx` y `web/src/estilos.css` (las clases `cd-*` de la maqueta)
- Test: `web/test/vistas/FichaProyecto.test.tsx`

**Interfaces:**
- Consume `historialPorDia`, `obtenerCommits` y `usarInstantanea`.
- `FichaProyecto({ proyecto, agentes, commits, ahora })` es presentacional. `App` carga los commits cuando cambia el id.
- **Estructura**, según la maqueta:
  - miga "Proyectos › <grupo> ›", el nombre y los chips de rama, "N ramas" y "N sin commit";
  - columna izquierda "Historial de desarrollo": por día, cada evento con su hora `HH:MM`. Un commit muestra su hash en un chip y su mensaje. Una sesión muestra "Claude" o "Codex", el título, el modelo y el estado, y debajo los commits que produjo;
  - columna derecha con dos paneles:
    - **"Tareas"**: el handoff primero, con el aviso "Puede estar desactualizado" si `quizaDesactualizado`; después los planes con su barra `hechas/total` y su fecha, y por último las tareas de las sesiones vivas;
    - **"Sesiones"**: cada agente del proyecto con su estado y un botón "Continuar", siempre desactivado y con el título "Llega con el terminal". Las sesiones con `puedeContinuar: false` no muestran botón.
  - por debajo de 900 px, una sola columna;
  - un id desconocido muestra "Proyecto no encontrado" con un enlace "Volver" a `#/`.

- [ ] **Paso 1:** escribir los tests (jsdom).
  - Un proyecto con 2 commits y una sesión que tiene uno enlazado → la sesión muestra su commit y el otro sale suelto.
  - Un plan 42/43 → aparece "42/43".
  - El handoff con `quizaDesactualizado` → aparece "Puede estar desactualizado".
  - El botón "Continuar" existe y está `disabled`.
  - Un id desconocido → "Proyecto no encontrado".
- [ ] **Paso 2:** `npm test -- web/test/vistas/FichaProyecto.test.tsx` → FALLA.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `npm test && npm run lint && npm run build && npm run build:web` → PASA.
- [ ] **Paso 5:** commit `Añade la ficha de proyecto`.

---

### Tarea 7: Verificación visual y cierre · Ejecuta: **Claude**

- [ ] **Paso 1:** `npm run panel` con los datos reales.
- [ ] **Paso 2:** Playwright a 1280×900 y a 390×844, con capturas de la vista general y de la ficha de tech-study-tracker. Comprobar:
  - sin scroll horizontal (`scrollWidth <= innerWidth`);
  - el parecido con la maqueta;
  - que el estado se actualiza solo: arrancar una sesión y ver que aparece en menos de 10 s;
  - que si se para el servidor sale el aviso de conexión y, al volver a arrancarlo, se recupera.
- [ ] **Paso 3:** corregir lo que se vea mal, cada corrección con su test si es de lógica.
- [ ] **Paso 4:** README con la sección "Panel" (`npm run panel`, la URL y qué se ve).
- [ ] **Paso 5:** revisión final independiente de la rama, corrección de lo crítico e importante, y PR `fase-2/panel-local` → `main` sin atribución.
