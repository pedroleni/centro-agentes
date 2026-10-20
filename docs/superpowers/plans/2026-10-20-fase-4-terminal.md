# Fase 4 · Terminal en el navegador — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans. Los pasos usan casillas (`- [ ]`).

**Objetivo:** desde el panel, local o a través del hub, se puede **continuar** una sesión cerrada de Claude o Codex, abrir una **sesión nueva** en un proyecto y **volver a entrar** en los terminales abiertos desde el panel. Todo funciona desde el móvil, con una barra de teclas extra.

**Arquitectura** (especificación §6.4):
- El agente tiene un **gestor de terminales**. Cada terminal es una sesión de **tmux** llamada `ca-<12 hex>`, creada en la carpeta del proyecto con una orden **cerrada**.
- Para mostrarlo, el agente se engancha con **node-pty** (`tmux attach-session -t ca-…`) y reenvía los bytes.
- Hay **tres operaciones**, siempre con ids y nunca con rutas ni órdenes: `crear` (continuar o nueva), `adjuntar(terminalId)` y `cerrar(terminalId)`.
- **En el hub**, los bytes viajan por la conexión del agente que ya existe (mensajes `terminal-*`) y el navegador abre su propio WebSocket con el hub.
- **En el panel local**, el navegador se conecta directamente al agente.
- El front usa **xterm.js** con el complemento de ajuste de tamaño.

**Especificación:** `docs/superpowers/specs/2026-10-19-centro-agentes-design.md` (§4 "No debe duplicar una sesión viva", §6.4 y §7).

## Restricciones globales

- **Órdenes permitidas** (el agente las monta él; el hub nunca envía órdenes):
  - continuar una sesión de Claude: `claude --resume <sessionId>`, solo si `sessionId` cumple `/^[0-9a-f-]{36}$/`;
  - continuar un hilo de Codex: `codex resume <threadId>`, solo si `threadId` cumple `/^[0-9a-z-]{8,64}$/`;
  - sesión nueva: `claude` o `codex`.

  Todas se ejecutan como `/bin/zsh -lc 'exec <orden>'`, para que los LaunchAgents encuentren el PATH del usuario, y con `-c <cwd>`, que el **agente** resuelve a partir de su propia instantánea: el `cwd` del agente, o la ruta del proyecto en una sesión nueva. Al terminar la orden, el terminal se cierra; no se deja ningún shell abierto.
- **Solo se puede continuar** un agente con `puedeContinuar === true` en la instantánea **del propio agente** en ese momento. Si no, se responde "Esta sesión sigue abierta en otro sitio".
- **Límites**: como máximo **6 terminales** abiertos por máquina; un mensaje de datos de como mucho 64 KiB; y un tamaño de entre 20×5 y 400×120.
- tmux: `set-option -t <s> window-size latest` (manda el último cliente que redimensiona) y `TERM=xterm-256color`.
- **Seguridad en el hub**: crear, adjuntar y cerrar exigen sesión, Origin y Tailscale, igual que el resto. El **WebSocket del navegador** (`/api/maquinas/<mid>/terminales/<tid>/ws`) comprueba el Host, la cookie de sesión, el `Origin` (que tiene que ser uno de los permitidos) y Tailscale **en el apretón de manos**. Cada apertura y cada cierre se **auditan** con la máquina, el agente o proyecto, el terminal y la IP.
- **Seguridad en el panel local**: el mismo WebSocket bajo `/api/maquinas/<mid>/terminales/<tid>/ws`, con el `Host` y el `Origin` exactos de `127.0.0.1:<puerto>` o `localhost:<puerto>`. Esto impide que una web cualquiera abra un terminal por WebSocket desde el navegador.
- **Aviso visible** en todo terminal: "Sesión real en <máquina> · lo que escribas se ejecuta allí".
- Los datos del terminal **no** se enmascaran (especificación §7): es la sesión real.
- Las pruebas con sockets o con tmux reales se saltan si existe `CODEX_SANDBOX`.

## Foco de revisión

1. **Una sesión que sigue viva fuera del panel**: el botón "Continuar aquí" no aparece, y si se fuerza por la API la respuesta es 409 "Esta sesión sigue abierta en otro sitio". Tests en las Tareas 2 y 5.
2. **Cerrar la pestaña y volver**: el terminal sigue vivo en tmux. "Entrar" reengancha y se ve lo que ya había en pantalla (tmux lo redibuja). Prueba real de Claude en la Tarea 7.
3. **La orden termina** (por ejemplo, `/exit` en Claude): la sesión de tmux muere, el front muestra "La sesión ha terminado" y el terminal desaparece de la lista en ≤ 5 s. Tests en las Tareas 2 y 6.
4. **Una pestaña de otro sitio intenta abrir el WebSocket** (Origin ajeno o sin cookie): se rechaza en el apretón de manos y no se crea ningún pty. Tests de sockets en las Tareas 4 y 5.
5. **Móvil**: la barra Esc, Ctrl, Tab y flechas envía las secuencias correctas (Esc → `\x1b`, Tab → `\t`, ↑ → `\x1b[A`; Ctrl seguido de una letra → su código de control). Test en la Tarea 6.

---

### Tarea 1: Dependencias · Claude
- [ ] `brew install tmux` en este Mac; `node-pty` en el agente, con un `postinstall` que da permiso de ejecución a `spawn-helper` (node-pty 1.1 lo publica sin él); `@xterm/xterm` y `@xterm/addon-fit` en el front. Comprobado: un pty se engancha a una sesión `ca-…` de tmux y ve su contenido.

### Tarea 2: Gestor de terminales (agente) · Claude o Codex (high)

**Ficheros:** `agente/src/terminales/ordenes.ts`, `agente/src/terminales/gestor.ts` y sus tests.

**Interfaces:**
- `ordenTerminal(peticion: { accion: 'continuar'; agente: Agente } | { accion: 'nueva'; tipo: 'claude' | 'codex'; proyecto: Proyecto }): { cwd: string; argv: string[]; titulo: string; agenteId: string | null; proyectoId: string | null } | { error: string }`. Es una función pura con las reglas de las Restricciones globales. En `argv` va `['/bin/zsh', '-lc', 'exec claude --resume <id>']`, y el id se valida antes de entrar en la cadena.
- `crearGestorTerminales({ tmux: EjecutorTmux; abrirPty(argv, opciones): PtyMinimo; ahora; maximo = 6 })` devuelve:
  - `crear(orden): Promise<TerminalInfo>`, que lanza `new-session -d -s ca-<id> -c <cwd> -x 120 -y 32 -- <argv…>`, después `set-option window-size latest` y `set-option -t … status off`;
  - `listar(): Promise<TerminalInfo[]>`, a partir de `list-sessions -F '#{session_name}\t#{session_created}'` filtrado por `ca-`, más los metadatos en memoria;
  - `adjuntar(id, { cols, rows }, alDatos, alSalir): { escribir(datos: string): void; redimensionar(cols, rows): void; soltar(): void }`, que abre un pty con `tmux attach-session -t ca-<id>`;
  - `cerrar(id): Promise<void>`, que hace `kill-session`.
- `TerminalInfo = { id, titulo, agenteId, proyectoId, tipo: 'claude' | 'codex', creadoMs }`. La instantánea añade `terminales: TerminalInfo[]` (esquema en `compartido`).

- [ ] Tests:
  - `ordenTerminal`: los 4 casos válidos; un id con `;` o con espacios → error; un agente con `puedeContinuar: false` → error "Esta sesión sigue abierta en otro sitio"; un proyecto sin ruta → error.
  - Gestor con tmux y pty falsos: `crear` llama a `new-session` con `-c` y el `argv` exacto; el séptimo terminal → error de máximo; `listar` ignora las sesiones sin el prefijo `ca-`; `adjuntar` reenvía datos y redimensiona, y fuera de rango se acota; `cerrar` → `kill-session`.
  - Integración con **tmux real** (se salta en el sandbox): crear un terminal con `argv` `['/bin/sh', '-c', 'echo hola; sleep 5']`, adjuntarse y recibir "hola"; `cerrar` hace que desaparezca de `listar`.

### Tarea 3: Protocolo de terminales · Claude o Codex (medium)

**Ficheros:** `compartido/src/protocolo.ts` y sus tests.

**Interfaces:**
- `Peticion` suma estas operaciones:
  - `terminal-crear`: `{ accion: 'continuar', agenteId } | { accion: 'nueva', tipo, proyectoId }` → `TerminalInfo`;
  - `terminal-cerrar`: `{ terminalId }`.
- `MensajeHub` suma:
  - `{ tipo: 'terminal-adjuntar', canal, terminalId, cols, rows }`;
  - `{ tipo: 'terminal-entrada', canal, datos }`, con `datos` en base64 y como mucho 64 KiB;
  - `{ tipo: 'terminal-tamano', canal, cols, rows }`;
  - `{ tipo: 'terminal-soltar', canal }`.
- `MensajeAgente` suma:
  - `{ tipo: 'terminal-salida', canal, datos }`;
  - `{ tipo: 'terminal-fin', canal, motivo }`.
- `canal` es un id aleatorio por cada pestaña del navegador conectada.

- [ ] Tests de validación: los límites de tamaño y de cols y rows, y que una `op` desconocida se rechaza.

### Tarea 4: Panel local con terminales · Claude o Codex (high)

- [ ] **API**:
  - `POST /api/maquinas/<mid>/terminales` con `{accion…}` → 201 `TerminalInfo`, o 409 o 400 con el error de `ordenTerminal`;
  - `DELETE /api/maquinas/<mid>/terminales/<tid>` → 204.

  El panel local pasa a aceptar `POST` y `DELETE` **solo** en esas rutas y **solo** con un `Origin` exacto. El resto sigue siendo solo GET.
- [ ] **WebSocket** `/api/maquinas/<mid>/terminales/<tid>/ws`, con `ws` en `noServer`: Host y Origin exactos; los mensajes del navegador son `{tipo:'entrada'|'tamano'}` en JSON y la salida va como trama binaria.
- [ ] Tests:
  - manejador puro: Origin ajeno → 403; `POST` en otra ruta → 405;
  - sockets reales: WebSocket con Origin ajeno → rechazado sin abrir pty; con Origin bueno → recibe la salida de un terminal real de prueba.

### Tarea 5: Hub con terminales · Claude o Codex (high)

- [ ] El hub reenvía `POST /api/maquinas/<mid>/terminales` y `DELETE` al agente con `pedir`, audita y aplica el máximo.
- [ ] **WebSocket del navegador** `/api/maquinas/<mid>/terminales/<tid>/ws`: Host, Tailscale, cookie y Origin en el apretón de manos. Al conectar crea un `canal`, envía `terminal-adjuntar` al agente y reenvía `terminal-salida`/`terminal-fin` ⇄ `terminal-entrada`/`terminal-tamano`. Si el navegador se va → `terminal-soltar`; si el agente se desconecta → cierra el WebSocket del navegador con 4502.
- [ ] El **agente**, en `conexionHub`, maneja los canales con su gestor.
- [ ] Tests:
  - de unidad en conexiones: enrutado por canal, un canal desconocido se ignora, y un agente que se va cierra sus canales;
  - de sockets reales: un WebSocket sin cookie o con Origin ajeno → rechazado; extremo a extremo con un agente falso.

### Tarea 6: Front del terminal · Claude o Codex (medium)

- [ ] **Ruta y vista**: `#/m/<mid>/terminal/<tid>` → `VistaTerminal`, con xterm.js a pantalla completa, `FitAddon`, el aviso de "Sesión real…", el botón "Cerrar terminal" (pide confirmación en la propia página) y la **barra de teclas** (Esc, Tab, Ctrl, ←↑→↓).
- [ ] **Reconexión**: si se cierra el WebSocket por la red, reintenta a 1, 2 y 4 s mostrando "Reconectando…". Con un `terminal-fin` muestra "La sesión ha terminado" y un enlace para volver.
- [ ] **Botones**:
  - en el `DetalleAgente`, "Continuar aquí" cuando `puedeContinuar`. Hace `POST` y navega a la ruta del terminal;
  - en la `FichaProyecto`, "Nueva sesión de Claude" y "Nueva sesión de Codex";
  - en cada bloque de máquina, la lista "Terminales abiertos" con "Entrar".
- [ ] Tests (jsdom):
  - las secuencias de la barra de teclas (Ctrl+c → `\x03`);
  - "Continuar aquí" solo si `puedeContinuar`;
  - la lista de terminales abiertos;
  - con `terminal-fin` → el texto de terminada;
  - el `POST` correcto al pulsar "Nueva sesión de Claude".

### Tarea 7: Prueba real, revisión y PR · Claude

- [ ] Con un hub de prueba y el agente real: continuar una sesión **cerrada** de Claude de este Mac, escribir, cerrar la pestaña, volver con "Entrar" y comprobar que sigue; lo mismo en la vista móvil con la barra de teclas; abrir y cerrar una sesión nueva de Codex; comprobar la auditoría. Capturas.
- [ ] Revisión de seguridad independiente, correcciones con su test y PR sin atribución.
