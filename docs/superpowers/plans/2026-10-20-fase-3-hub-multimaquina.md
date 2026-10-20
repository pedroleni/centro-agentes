# Fase 3 · Hub y varias máquinas — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans. Los pasos usan casillas (`- [ ]`).

**Objetivo:** un **hub** en el Mac mini junta en un solo panel las instantáneas del MacBook, del Mac mini y del Windows. Cada máquina corre su **agente**, que se conecta al hub (conexión saliente por WebSocket) y responde a las peticiones de commits y de línea de tiempo. Para entrar al panel hacen falta la red Tailscale de Pedro **y** una contraseña.

**Arquitectura:**
- `hub/` es un servidor Node (`node:http` + `ws`) que escucha en `127.0.0.1:4700`. `tailscale serve` lo publica en la red privada con HTTPS.
- El **agente** se da de alta una vez con un código de un solo uso, guarda su token y, con `agente conectar`, abre un WebSocket saliente a `wss://<hub>/api/agente`. Envía `hola` y una instantánea cada 5 s, y contesta peticiones `commits` y `linea`.
- El **front** es el mismo de la fase 2, pero ahora consume `/api/maquinas`, que existe tanto en el hub (N máquinas) como en el panel local (1 máquina). Así no hay dos fronts.

**Tecnología:** la de las fases 1 y 2, más `ws` (servidor del hub). El cliente del agente usa el `WebSocket` global de Node 22. El hub guarda sus datos en `node:sqlite`.

**Especificación:** `docs/superpowers/specs/2026-10-19-centro-agentes-design.md` (§5.1–5.4, §7 y la fase 3 de §9).

## Restricciones globales

- **Red y Host:**
  - el hub escucha **solo en `127.0.0.1`**, puerto por defecto **4700**;
  - `Host` aceptados: `127.0.0.1:<puerto>`, `localhost:<puerto>` y `config.hostPublico` (el nombre `*.ts.net` del Mac mini). Cualquier otro → 403.
- **Inicio de sesión del navegador**, con **las dos condiciones**:
  1. si `config.exigirTailscale` es `true` (valor por defecto), la cabecera `Tailscale-User-Login` es igual a `config.propietarioTailscale`;
  2. la contraseña es correcta: hash scrypt (`N=16384, r=8, p=1`, sal de 16 bytes, comparación con `timingSafeEqual`).
- **Sesión:**
  - cookie `ca_sesion` con 32 bytes aleatorios en base64url, `HttpOnly; Secure; SameSite=Strict; Path=/`, de 12 h;
  - las sesiones viven **en memoria**: al reiniciar el hub hay que volver a entrar;
  - como máximo **5 intentos de contraseña por minuto** por `X-Forwarded-For`, o por IP si no viene.
- **Escrituras del navegador** (`POST` y `DELETE`): exigen sesión **y** que el `Origin` coincida con `https://<hostPublico>` o con `http://127.0.0.1:<puerto>`. El WebSocket del agente no usa cookie, sino `Authorization: Bearer <token>`.
- **Alta de máquinas:**
  - un código de 8 caracteres en mayúsculas sin ambiguos (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`), que caduca a los **10 minutos** y sirve **una sola vez**. Se guarda el hash sha256, nunca el código;
  - al dar de alta, el hub entrega un token de 32 bytes en base64url y guarda **solo su sha256**. La máquina se puede **revocar**: su token deja de valer y su WebSocket se cierra.
- **Ficheros del hub:**
  - configuración en `~/.config/centro-agentes/hub.json` (`puerto`, `hostPublico`, `propietarioTailscale`, `exigirTailscale` y `contrasena: { sal, hash }`), creada con `npm run hub:configurar`;
  - base de datos en `~/.config/centro-agentes/hub.sqlite`;
  - permisos `0600` en los ficheros y `0700` en la carpeta.
- **Datos del agente:** `~/.config/centro-agentes/agente.json` (`hub`, `maquinaId` y `token`), con permisos `0600`.
- **Protocolo:** JSON validado con zod **en las dos puntas**; mensajes de más de **8 MB** → se cierra la conexión. Las peticiones del hub al agente tienen un timeout de **10 s**. Una máquina pasa a **desconectada** si lleva **20 s** sin enviar instantánea.
- **El agente nunca ejecuta nada que le pida el hub**: solo contesta `commits(proyectoId)` y `linea(agenteId, antes)`, igual que el panel local, con el mismo guardián y el mismo enmascarado.
- Todo lo de las fases 1 y 2 sigue vigente. Commits sin atribución. Rama `fase-3/hub` y PR.

## Foco de revisión

1. **Agente que se cae y vuelve**: reconecta con backoff (1, 2, 4… hasta 30 s), la máquina pasa a "Desconectada · último latido hace X" y vuelve a "Conectada" sola. Tests en las Tareas 5 y 7.
2. **Token revocado o falso**: el WebSocket se rechaza con 401, y si estaba abierto se cierra con el código 4401. El agente deja de reintentar y dice "Token revocado: vuelve a dar de alta esta máquina". Tests en las Tareas 5 y 7.
3. **Sesión caducada mientras la página está abierta**: la API responde 401 y el front vuelve a la pantalla de entrada sin perder la ruta. Test en la Tarea 8.
4. **Una petición al agente que no contesta**: a los 10 s la API responde 504 `{error: 'La máquina no responde'}` y no se queda colgada. Test en la Tarea 5.
5. **Dos agentes con el mismo token** (máquina clonada): se queda con la conexión más reciente y cierra la anterior con el código 4409. Test en la Tarea 5.

---

### Tarea 1: Workspace `hub/` · Claude

- [ ] Crear `hub/package.json` (`@centro/hub`, que depende de `@centro/compartido` y `@centro/agente`) y `hub/tsconfig.json` (con referencia a compartido y agente).
- [ ] Añadir `exports` a `agente/package.json` para `"./panel/*": "./src/panel/*.ts"`, `"./linea": "./src/linea.ts"` y `"./util/*": "./src/util/*.ts"`.
- [ ] Instalar `ws` y `@types/ws`.
- [ ] Scripts:
  - `hub` → `npm run build:web && NODE_OPTIONS=… tsx hub/src/cli.ts servir`;
  - `hub:configurar` → `tsx hub/src/cli.ts configurar`;
  - `agente:alta` → `tsx agente/src/cli.ts alta`;
  - `agente:conectar` → `NODE_OPTIONS=… tsx agente/src/cli.ts conectar`.
- [ ] Incluir `hub/test/**` en vitest y `hub` en `build`, con un test de humo.
- [ ] `npm test && npm run lint && npm run build` → OK, y commit.

### Tarea 2: Protocolo y tipos de la API · Codex (medium)

**Ficheros:** `compartido/src/protocolo.ts` y `compartido/test/protocolo.test.ts`.

**Interfaces:**
- `MensajeAgente = z.discriminatedUnion('tipo', [...])` con tres variantes:
  - `hola`: `{ maquina: Maquina, version: z.literal(1) }`;
  - `instantanea`: `{ instantanea: Instantanea }`;
  - `respuesta`: `{ id: string, ok: boolean, datos?: unknown, error?: string }`.
- `MensajeHub` con dos variantes:
  - `peticion`: `{ id: string, op: 'commits', proyectoId: string } | { id, op: 'linea', agenteId: string, antes: number | null }`;
  - `adios`: `{ motivo: string }`.
- `MaquinaVista = { id: string, nombre: string, so: SO, conectada: boolean, ultimoLatidoMs: number | null, instantanea: Instantanea | null }`.
- `RespuestaMaquinas = { maquinas: MaquinaVista[], modo: 'local' | 'hub' }`.
- `LIMITE_MENSAJE_BYTES = 8 * 1024 * 1024`.

- [ ] Tests: cada variante pasa la validación; un `tipo` desconocido falla; `peticion linea` con `antes: -1` falla (debe ser un entero ≥ 0 o `null`). FALLA → implementar → PASA. Commit.

### Tarea 3: Almacén del hub · Codex (high)

**Ficheros:** `hub/src/almacen.ts` y `hub/test/almacen.test.ts`.

**Interfaces:** `crearAlmacen(ruta: string, ahora = Date.now)` devuelve:
- `crearCodigoAlta(): { codigo: string; caducaMs: number }`;
- `canjearCodigo(codigo: string, nombre: string, so: SO): { maquinaId: string; token: string } | null`. Es transaccional: se puede canjear una sola vez y nunca si ha caducado. Crea la máquina con `id` = 12 hex aleatorios;
- `maquinaDeToken(token: string): { id: string; nombre: string; so: SO } | null`. Compara sha256, y una máquina revocada da `null`;
- `listarMaquinas(): { id, nombre, so, creadaMs, revocadaMs }[]`;
- `revocar(id: string): boolean`;
- `auditar(evento: string, detalle: Record<string, unknown>): void`;
- `ultimosEventos(n: number): { fechaMs, evento, detalle }[]`;
- `cerrar(): void`.

La base de datos se abre con `DatabaseSync`, con las tablas `maquinas`, `codigos` y `auditoria`. La ruta se crea con permisos `0600`.

- [ ] Tests:
  - un código canjeado dos veces → la segunda vez da `null`;
  - un código caducado (`ahora` + 10 min + 1) → `null`;
  - el token sirve en `maquinaDeToken` y uno alterado no;
  - tras revocar, `maquinaDeToken` da `null`;
  - la base de datos no contiene ni el código ni el token en claro (se busca la cadena en el fichero);
  - el fichero tiene permisos `0600`.

  FALLA → PASA. Commit.

### Tarea 4: Autenticación del navegador · Codex (high)

**Ficheros:** `hub/src/auth.ts` y `hub/test/auth.test.ts`.

**Interfaces:**
- `hashContrasena(contrasena: string): { sal: string; hash: string }` y `comprobarContrasena(contrasena, guardada): boolean`.
- `crearSesiones(ahora = Date.now)` devuelve `{ crear(): string; valida(token): boolean; cerrar(token): void }`, con una vida de 12 h.
- `crearLimitador(maximo = 5, ventanaMs = 60_000, ahora = Date.now)` devuelve `{ permitir(clave: string): boolean }`.
- `leerCookie(cabecera: string | undefined, nombre: string): string | null` y `cookieSesion(token: string, maxAgeS: number): string`.
- `evaluarPeticion(p: { metodo, host, origin, cookie, tailscaleLogin }, cfg: ConfigHub, sesiones): 'ok' | 'host' | 'tailscale' | 'sin-sesion' | 'origen'`. Las comprobaciones van en este orden: Host, Tailscale si se exige, sesión salvo en `POST /api/sesion`, y Origin en `POST` y `DELETE`.

- [ ] Tests:
  - con la contraseña correcta o incorrecta;
  - con la sesión caducada a las 12 h y 1 ms;
  - el sexto intento en 60 s → `false`;
  - la cookie lleva `HttpOnly`, `Secure` y `SameSite=Strict`;
  - `evaluarPeticion` con un Host ajeno → `host`, con Tailscale ajeno → `tailscale`, sin cookie → `sin-sesion` y con un `POST` de Origin ajeno → `origen`;
  - con `exigirTailscale: false` y sin cabecera → `ok` si hay sesión.

  FALLA → PASA. Commit.

### Tarea 5: Conexiones de agentes · Codex (high)

**Ficheros:** `hub/src/conexiones.ts` y `hub/test/conexiones.test.ts`.

**Interfaces:**
- `ConexionAgente = { enviar(m: MensajeHub): void; cerrar(codigo: number, motivo: string): void }`.
- `crearConexiones(ahora = Date.now)` devuelve:
  - `conectar(maquinaId: string, c: ConexionAgente): void`. Si ya había una conexión de esa máquina, la cierra con 4409;
  - `recibir(maquinaId: string, crudo: string): void`. Valida con `MensajeAgente`; si el mensaje es inválido o mayor que el límite, cierra con 4400. Un `hola` o una `instantanea` actualizan el latido, y una `respuesta` resuelve su petición;
  - `desconectar(maquinaId: string, c: ConexionAgente): void`;
  - `pedir(maquinaId, peticion sin id, timeoutMs = 10_000): Promise<unknown>`. Rechaza con `SinConexion` si la máquina no está conectada y con `SinRespuesta` si vence el timeout;
  - `vista(maquinas: {id, nombre, so}[]): MaquinaVista[]`. Una máquina está `conectada` si tiene conexión y su último latido es de hace menos de 20 s;
  - `cerrarMaquina(maquinaId, codigo, motivo): void`.

- [ ] Tests, con una conexión falsa:
  - un `hola` y una instantánea → `vista` la da como conectada y con su instantánea;
  - 21 s sin latido → desconectada, pero conserva la última instantánea y `ultimoLatidoMs`;
  - una segunda conexión cierra la primera con 4409;
  - un JSON inválido → 4400;
  - `pedir` resuelve con la `respuesta` del mismo id;
  - `pedir` sin respuesta → `SinRespuesta` a los 10 s;
  - `pedir` a una máquina desconectada → `SinConexion`.

  FALLA → PASA. Commit.

### Tarea 6: API y servidor del hub · Codex (high) + curl de Claude

**Ficheros:** `hub/src/manejador.ts`, `hub/src/servidor.ts`, `hub/src/config.ts` y `hub/src/cli.ts` (`configurar` y `servir`), con sus tests.

**Interfaces y rutas** (todas pasan antes por `evaluarPeticion`):
- **Sesión:**
  - `POST /api/sesion {contrasena}` → 204 con `Set-Cookie`, 401 o 429. Se audita;
  - `DELETE /api/sesion` → 204;
  - `GET /api/sesion` → 200 `{propietario}` o 401.
- **Máquinas:**
  - `GET /api/maquinas` → `RespuestaMaquinas` con `modo: 'hub'`;
  - `GET /api/maquinas/<mid>/proyectos/<pid>/commits` → se pide al agente: 200 `{commits}`, 404, 502 (`SinConexion`, `{error:'La máquina no está conectada'}`) o 504 (`SinRespuesta`);
  - `GET /api/maquinas/<mid>/agentes/<aid>/linea?antes=` → lo mismo;
  - `DELETE /api/maquinas/<mid>` → revoca y cierra su WebSocket. Se audita.
- **Alta:**
  - `POST /api/maquinas/codigos` → 200 `{codigo, caducaMs}`;
  - `POST /api/alta {codigo, nombre, so}` → **no exige sesión ni Tailscale, porque lo usa el agente**, pero sí Host, el límite de 5 por minuto y un código válido. Responde 200 `{maquinaId, token}` o 400. Se audita.
- **Auditoría:** `GET /api/auditoria` → los últimos 100 eventos.
- **WebSocket** `GET /api/agente` (upgrade): Host válido y `Authorization: Bearer` válido, o se cierra con 401. Usa `maxPayload = LIMITE_MENSAJE_BYTES`.
- **Estáticos y cabeceras:** el servidor sirve `web/dist` con las mismas reglas y cabeceras de seguridad y de caché que el panel local (se reutilizan `resolverEstatico`, `tipoContenido` y las cabeceras de `@centro/agente/panel/*`).
- **Configuración:** `hub configurar --host-publico <x> --propietario <email> [--puerto 4700] [--sin-tailscale]` lee la contraseña de **stdin** (nunca de un argumento) y escribe `hub.json` con permisos `0600`.

- [ ] Tests del manejador como función pura, con el almacén, las sesiones y las conexiones falsos:
  - cada código de estado de arriba;
  - `POST /api/alta` sin sesión → 200 con un código válido;
  - un `DELETE` con Origin ajeno → 403;
  - la respuesta de `/api/maquinas` no contiene tokens ni hashes.

  FALLA → PASA.
- [ ] Claude: arrancar el hub con una configuración temporal en `127.0.0.1:4700` (`--sin-tailscale`) y probar con `curl` la entrada, el 401 sin sesión, el 403 con un Host ajeno, el límite de intentos y un WebSocket sin token rechazado. Commit.

### Tarea 7: Agente conectado · Codex (high)

**Ficheros:** `agente/src/conexionHub.ts`, `agente/src/alta.ts`, `agente/src/cli.ts` (`alta` y `conectar`), `agente/src/panel/manejador.ts` (rutas `/api/maquinas…` en modo local) y sus tests.

**Interfaces:**
- `darDeAlta({ hub, codigo, nombre, so, fetch, rutaConfig }): Promise<{ maquinaId }>`. Hace `POST <hub>/api/alta` y escribe `agente.json` con permisos `0600`.
- `crearConexionHub({ url, token, obtenerInstantanea, obtenerCommits, obtenerLinea, crearSocket, esperar, maquina, log })` devuelve `{ arrancar(): void; parar(): void }`.
  - Al abrir envía `hola`.
  - Cada 5 s envía la `instantanea` de la caché.
  - Contesta las peticiones con `respuesta` (`ok: false` y `error` si algo lanza).
  - Si la conexión se cierra, reintenta con backoff de 1, 2, 4, 8, 16 y 30 s (con un jitter de ±20 %), y el backoff vuelve a 1 s tras 60 s conectado.
  - Con los códigos 4401 o 4409 **no reintenta** y escribe por `log` "Token revocado: vuelve a dar de alta esta máquina" o "Otra copia de este agente se ha conectado".
- **Panel local:** añade `GET /api/maquinas` (`modo: 'local'`, una sola máquina, siempre conectada), `GET /api/maquinas/<mid>/proyectos/<pid>/commits` y `GET /api/maquinas/<mid>/agentes/<aid>/linea`, que delegan en lo que ya existe. Las rutas antiguas se mantienen.
- **CLI:**
  - `alta --hub <url> --codigo <c> [--nombre <n>]`;
  - `conectar [--config <ruta>]`, que lee `agente.json` y reutiliza la caché de la instantánea y `crearObtenerLinea` del panel.

- [ ] Tests, con un socket y unos temporizadores falsos:
  - envía `hola` y después instantáneas cada 5 s;
  - contesta `commits` y `linea`;
  - el backoff es 1 → 2 → 4 y se reinicia;
  - con 4401 deja de reintentar y lo dice;
  - `darDeAlta` escribe el fichero con permisos `0600` y sin el código;
  - `/api/maquinas` local devuelve una sola máquina conectada.

  FALLA → PASA. Commit.

### Tarea 8: Front multimáquina · Codex (medium)

**Ficheros:** `web/src/api.ts`, `web/src/usarMaquinas.ts` (sustituye a `usarInstantanea`), `web/src/App.tsx`, `web/src/vistas/{VistaGeneral, EnDirecto, Entrar, AnadirMaquina}.tsx`, `web/src/logica/agrupar.ts`, y sus tests.

**Interfaces:**
- `obtenerMaquinas(): Promise<RespuestaMaquinas>`. Con un 401 lanza `ErrorApi(401)`.
- Las rutas pasan a `#/m/<mid>/proyecto/<pid>` y `#/m/<mid>/agente/<aid>`. Las antiguas `#/proyecto/<pid>` y `#/agente/<aid>` siguen funcionando cuando hay una sola máquina.
- **Vista general**: un **bloque por máquina** con su nombre, el icono del SO (🍎 en macOS, 🪟 en Windows y 🐧 en Linux), el estado "● Conectada" o "○ Desconectada · último latido hace X" y, dentro, sus grupos y tarjetas como ahora. La franja **En directo** junta los agentes activos de **todas** las máquinas y cada tarjeta lleva una píldora con el nombre de su máquina.
- **`Entrar`** aparece con cualquier 401: un campo de contraseña y un botón "Entrar" que hace `POST /api/sesion`. Al entrar vuelve a la ruta en la que estaba. Con un 429 muestra "Demasiados intentos, espera un minuto"; con un 403 de Tailscale, "Solo se puede entrar desde la red Tailscale de Pedro".
- **`AnadirMaquina`** (solo en `modo: 'hub'`) es un botón en la barra que abre un panel con el código, su cuenta atrás de 10 min y los comandos para copiar:

  ```
  git clone git@github.com:pedroleni/centro-agentes.git && cd centro-agentes && npm install
  npm run agente:alta -- --hub https://<host> --codigo <CODIGO>
  npm run agente:conectar
  ```

  El panel también tiene una lista de máquinas con un botón "Revocar", que pide confirmación.

- [ ] Tests (jsdom):
  - dos máquinas, una desconectada → dos bloques con sus estados;
  - En directo con agentes de las dos máquinas y sus píldoras;
  - un 401 → pantalla de entrada; tras entrar se cargan las máquinas;
  - un 429 → su mensaje;
  - el botón "Añadir máquina" no existe en modo local;
  - la ruta `#/m/<mid>/agente/<aid>` carga la línea desde la URL nueva.

  FALLA → PASA. Commit.

### Tarea 9: Prueba de extremo a extremo, documentación y cierre · Claude

- [ ] Arrancar en local un hub (`127.0.0.1:4700`, `--sin-tailscale` y una contraseña de prueba) y un agente dado de alta contra él. Con Playwright:
  - entrar al panel y ver la máquina conectada con sus proyectos;
  - parar el agente → desconectada en menos de 25 s → arrancarlo → conectada;
  - revocar → el agente para y lo dice;
  - abrir el detalle de un agente a través del hub.
- [ ] Escribir `scripts/servicios/`:
  - `es.centro-agentes.hub.plist` y `es.centro-agentes.agente.plist` (LaunchAgents de usuario, `RunAtLoad` y `KeepAlive`);
  - `agente-windows.xml` (tarea programada "al iniciar sesión").
- [ ] README, sección **"Instalación en tus máquinas"**, paso a paso para Pedro:
  - **Mac mini**: Node, Tailscale, `tailscale serve --bg --https=443 http://127.0.0.1:4700`, clonar, `npm install`, `npm run hub:configurar` y cargar el plist;
  - **cada máquina**: dar de alta con el código del panel y cargar el servicio del agente;
  - **macOS**: el permiso de Escritorio, Documentos y Descargas;
  - **Windows**: cómo importar la tarea programada.
- [ ] Revisión final independiente, corrección de lo crítico e importante, y PR sin atribución.
