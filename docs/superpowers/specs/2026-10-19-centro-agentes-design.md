# centro-agentes: diseño

Fecha: 2026-10-19 · Estado: pendiente de aprobación · Sustituye a la
versión anterior de este mismo fichero, que era solo local y de lectura.

## 1. Para qué sirve

Pedro trabaja en varios proyectos a la vez con dos tipos de agentes,
**Claude Code** y **Codex CLI**, repartidos en **tres máquinas**:

- un MacBook (este portátil);
- un **Mac mini** que está siempre encendido;
- un **Windows**, donde usa los agentes directamente desde la terminal de
  Windows (PowerShell). No usa WSL.

Hoy no tiene ningún sitio donde ver qué hace cada agente, en qué máquina,
proyecto y rama, cuánto contexto lleva gastado, qué tareas quedan ni qué se
ha hecho de verdad. Tampoco puede retomar una sesión sin sentarse delante de
la máquina donde corre.

centro-agentes es un **panel web privado** que:

1. junta en una sola vista las sesiones de Claude y Codex de las tres
   máquinas;
2. muestra, dentro de cada proyecto, las tareas con sus fechas y el
   historial real de desarrollo (commits y sesiones de agentes mezclados);
3. permite **continuar o abrir sesiones** en cualquiera de las tres máquinas
   desde un terminal dentro del navegador, también desde el móvil.

La referencia es AI Beacon (https://blog.marcnuri.com/dashboard-agentes-ia-codificacion),
pero con dos diferencias: este soporta **Codex** y se construye en casa.
AI Beacon no soporta Codex y su código todavía no es público.

## 2. Objetivos

1. **Vista general por máquina**: un bloque por máquina (MacBook, Mac mini,
   Windows) con su estado (conectada o desconectada, último latido) y
   tarjetas de proyecto con:
   - el último mensaje escrito a un agente;
   - la rama y los cambios sin commitear;
   - los avisos de pendientes;
   - una fila por agente con su tipo, título, modelo, **porcentaje de
     contexto usado**, estado y tiempo transcurrido.

   El estilo es el de la maqueta de referencia `maquetas/estilo-tarjetas-v2.html`: claro, con
   tarjetas, inspirado en AI Beacon y más afinado.
2. **Ficha de proyecto**:
   - **historial de desarrollo** agrupado por día, que mezcla commits y
     sesiones de agentes y enseña bajo cada sesión los commits que produjo;
   - **tareas con fecha**, sacadas de los planes y del `HANDOFF.md`, con su
     progreso;
   - las sesiones del proyecto, cada una con su botón para continuarla.
3. **Detalle de agente**: línea de tiempo con mensajes, comandos y
   herramientas, en directo si el agente está trabajando.
4. **Terminal en el navegador**:
   - continuar una sesión cerrada (`claude --resume <id>`,
     `codex resume <id>`);
   - abrir una sesión nueva de Claude o de Codex en un proyecto de
     cualquier máquina;
   - volver a entrar en las sesiones abiertas desde el panel.

   Debe funcionar también desde el móvil, con una barra de teclas extra:
   Esc, Ctrl, Tab y flechas.
5. **Actualización en tiempo real** sin recargar la página.

## 3. Fuera de esta versión (después)

- Un estado "necesita permiso" fiable. Requiere añadir hooks de Claude Code
  a la configuración de cada máquina, y Pedro tiene que aprobar ese cambio
  antes.
- Notificaciones push: "te necesita", "terminado", "PR abierto".
- Enviar mensajes a una sesión **abierta en VS Code**. En esta versión se
  muestra como "abierta en VS Code en <máquina>" y no se puede controlar
  desde el panel (ver §6.4).
- Crear git worktrees desde el panel. Plantillas tipo "Implementar issue".
- Unir en una sola ficha el mismo repo clonado en varias máquinas. En esta
  versión sale una tarjeta por máquina.
- Ver PRs consultando GitHub. Lo que sí se usa son los PR que ya aparecen en
  los transcripts (entradas `pr-link`).

## 4. Lo que no debe pasar (anti-objetivos)

Un panel que abre terminales en tres máquinas da **control total** sobre
ellas. Por eso:

- **Nunca debe ser accesible desde internet.** Solo se llega a él a través
  de la red privada de Tailscale (§5.3).
- **Nadie debe poder abrir un terminal sin autenticarse dos veces**: tiene
  que estar dentro de la red Tailscale de Pedro **y** haber iniciado sesión
  en el panel (§7).
- **Nunca debe exponer credenciales.** No lee ni envía:
  - `~/.codex/auth.json`;
  - ficheros `*.key`;
  - `.env*`;
  - `client_secret*`;
  - `~/.claude/session-env`.

  Esto también vale tras resolver symlinks y `..`. Los secretos que aparezcan
  dentro de transcripts o de la salida de comandos se enmascaran (§7).
- **Nunca debe estropear el estado de las herramientas.** La base de datos
  de Codex se abre en solo lectura y nunca se escribe en `~/.claude` ni en
  `~/.codex`.
- **No debe ser lento.** Los transcripts pasan de 20 000 líneas. Se lee la
  cola del fichero y se pagina hacia atrás bajo demanda; nunca se carga
  entero.
- **No debe duplicar una sesión viva.** Si una sesión sigue abierta en otro
  sitio, porque su `pid` está vivo, el panel no ofrece "continuar".

## 5. Arquitectura

### 5.1 Piezas

```
 MacBook ─┐                      ┌──────────── Mac mini ─────────────┐
 Windows ─┼─ agente ──WSS──────▶ │  hub (web + API + relay)  agente  │ ◀── navegador
 Mac mini ┘  (conexión saliente) └───────────────────────────────────┘     (portátil, móvil)
            todo por la red privada de Tailscale
```

- **Agente** (`agente/`): proceso Node que corre en **cada una** de las tres
  máquinas, también en el Mac mini. Hace cuatro cosas:
  - lee las fuentes locales (§6);
  - manda al hub una **instantánea** cada 5 s y eventos cuando algo cambia;
  - responde a las peticiones del hub (historial, ficha de proyecto, página
    de línea de tiempo);
  - abre y gestiona los **terminales** (§6.4).

  La conexión con el hub la abre siempre el agente (WebSocket saliente), así
  que ninguna máquina abre puertos. Si se corta, reconecta con backoff.
- **Hub** (`hub/`): proceso Node en el **Mac mini**. Hace cuatro cosas:
  - sirve el front;
  - mantiene la última instantánea de cada máquina en memoria y en SQLite;
  - reenvía las peticiones del navegador al agente que toca;
  - hace de **puente** del terminal entre el navegador y el agente.

  Escucha solo en `127.0.0.1` y se publica en la red Tailscale con
  `tailscale serve`, que además le da HTTPS con certificado válido
  (`https://<mac-mini>.<tailnet>.ts.net`).
- **Front** (`web/`): Vite + React + TypeScript, con xterm.js para el
  terminal. Es responsive y se usa también en el móvil.

### 5.2 Tecnología (decisión de Claude)

- **Node 22.13 o superior y TypeScript** en las tres piezas. Es el mismo
  lenguaje en Mac y Windows y Codex lo maneja bien. En Node 22.13+
  `node:sqlite` ya no necesita flag; en el MacBook hay 22.12, así que hay
  que actualizarlo.
- **Terminales**: `node-pty`.
  - En macOS cada sesión corre dentro de **`tmux`**, que hay que instalar
    con `brew install tmux` en los dos Mac. Así sobrevive a reinicios del
    agente y del hub.
  - En Windows corre directamente en ConPTY. La sesión vive mientras el
    agente esté en marcha, y se acepta así.
- **Protocolo agente ↔ hub**: mensajes JSON sobre WebSocket, tipados con
  esquemas compartidos (`compartido/`) y validados al recibirlos. Los tres
  tipos de mensaje son instantánea, evento y petición/respuesta con
  `requestId`. Los datos del terminal van por un canal binario separado,
  identificado por `terminalId`.
- **Monorepo** con workspaces de npm: `compartido/`, `agente/`, `hub/` y
  `web/`.

### 5.3 Red: Tailscale

- Tailscale se instala en el MacBook, el Mac mini, el Windows y el móvil de
  Pedro. Es gratis para uso personal y funciona igual en casa que fuera.
- Instalarlo y entrar con su cuenta lo hace **Pedro**. El builder solo
  documenta los pasos en el README.

### 5.4 Arranque y reinicios (respuesta de Pedro y decisión de Claude)

Pedro: el Mac mini y el Windows **se quedan en la pantalla de contraseña**
al arrancar, no tienen inicio de sesión automático. Decisión: **se mantiene
así**. No se activa el inicio automático ni se usan servicios de sistema
que corran antes de iniciar sesión, porque necesitarían otra forma de pasar
credenciales y chocarían con §4.

- **Cómo arrancan las piezas**:
  - en macOS, el agente y el hub son **LaunchAgents de usuario** que
    arrancan al iniciar sesión;
  - en Windows, el agente es una tarea programada "al iniciar sesión".
- **Reinicio del MacBook o del Windows**: el hub sigue en pie y muestra esa
  máquina como **"Desconectada · ¿reiniciada? Inicia sesión en ella"**,
  junto a la hora de su último latido.
- **Reinicio del Mac mini**: el panel entero queda inaccesible hasta que
  Pedro inicie sesión en él. Se acepta porque es raro (actualizaciones).
  - El README explica cómo dejar el Mac mini listo para este caso:
    "Arrancar automáticamente tras un corte de luz" y que el hub y el agente
    vuelvan solos al iniciar sesión.
  - El README también documenta como **opcional** una mejora: instalar
    `tailscaled` como servicio de sistema y activar Compartir pantalla.
    Así Pedro podría iniciar sesión en el Mac mini a distancia después de un
    reinicio. Esto no forma parte del trabajo del builder.
- **Permisos de privacidad de macOS**: la primera vez, Pedro concede desde
  el escritorio de cada Mac el acceso a Escritorio, Documentos y Descargas
  al proceso del agente (o a `node`). El README indica dónde hacerlo.
- **En el panel**: cada máquina muestra su último latido. La vista general
  avisa arriba si alguna está desconectada.

## 6. Qué lee y hace el agente en cada máquina

Las rutas base dependen del sistema: `~` en macOS y `%USERPROFILE%` en
Windows. Todo lector recibe sus rutas inyectadas, para poder probarlo con
fixtures. Si en una máquina no existe `~/.claude` o `~/.codex`, el agente lo
indica en su instantánea y el panel lo muestra ("no encuentro Codex en esta
máquina"), en vez de dejarla vacía sin explicación.

Las fuentes de las secciones 6.1 a 6.3 se comprobaron en el MacBook el
2026-10-19. En Windows se asume la misma estructura bajo `%USERPROFILE%`, y
el builder debe verificarlo allí antes de cerrar la fase de Windows.

### 6.1 Proyectos

- **Escaneo de carpetas raíz** configurable por máquina en
  `agente.config.json`, que no se versiona; sí se versiona un `.example`.
  - **Por defecto**: `~/Desktop`, `~/Downloads` y `~/Documents`, con
    profundidad 2.
  - **Qué cuenta como proyecto**: toda carpeta con `.git`.
- Se le suman los proyectos de confianza de Codex: las claves
  `[projects."<ruta>"]` de `~/.codex/config.toml`. Se excluyen:
  - las rutas bajo `/tmp`, `/private/tmp` o la carpeta temporal de Windows;
  - el propio home;
  - las rutas que ya no existen.
- **Agrupación**: los proyectos se agrupan por su carpeta padre (Downloads,
  Proyectos IA, Desktop…). Los que llevan 30 días sin actividad se muestran
  en pequeño al final.
- **Datos de git** de cada proyecto, ejecutando `git` con `execFile`, nunca
  con un shell, y con timeout:
  - rama actual;
  - último commit;
  - ficheros modificados o sin seguimiento;
  - commits por delante o por detrás del upstream;
  - ramas locales;
  - actividad por día de los últimos 14 días.

### 6.2 Sesiones de Claude Code

- **Sesiones vivas**: `~/.claude/sessions/<pid>.json`. Campos usados:
  - `pid`, `sessionId`, `cwd`, `name`;
  - `status` (`idle` o `busy`);
  - `entrypoint` (`claude-vscode` o cli);
  - `startedAt` y `updatedAt`.

  Si el `pid` está vivo, `busy` se muestra como "Trabajando" e `idle` como
  "Esperándote". Si el `pid` está muerto, la sesión se muestra como
  "Cerrada". Los ficheros `*.key` de esa carpeta **no se leen nunca**.
- **Transcripts**: `~/.claude/projects/<slug>/<sessionId>.jsonl`. El slug es
  el `cwd` con `/`, espacios y otros caracteres no alfanuméricos cambiados
  por `-`, pero para encontrar el fichero conviene buscar
  `*/<sessionId>.jsonl`. Tipos de línea que se usan:
  - `ai-title`: el título;
  - `last-prompt`: el último mensaje de Pedro;
  - `user` y `assistant`: la línea de tiempo;
  - `pr-link`: el PR;
  - `gitBranch`: la rama, cuando la línea lo trae.
- **Contexto usado**: se toma el `usage` del último mensaje `assistant`
  (`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`)
  y se divide entre la ventana de contexto del modelo. Esa ventana sale de
  una tabla configurable; si el modelo no está en ella, se muestran los
  tokens sin porcentaje.
- **Tareas de sesión**: la última llamada `TodoWrite` del transcript da la
  lista de tareas de esa sesión.

### 6.3 Codex

- **Hilos**: tabla `threads` del `state_<N>.sqlite` de número más alto, en
  `~/.codex/`, abierta en solo lectura. Columnas usadas:
  - `id`, `title`, `cwd`;
  - `model`, `reasoning_effort`, `tokens_used`;
  - `git_branch`, `source`, `archived`;
  - `created_at_ms`, `updated_at_ms`, `rollout_path`.
- **Línea de tiempo y contexto**: el `.jsonl` de `rollout_path`. Sus eventos
  `token_count` traen `model_context_window`, que da el porcentaje de
  contexto.
- **Tareas lanzadas con `codex-task.sh`**: los
  `<proyecto>/.codex-logs/*.jsonl`. La primera línea es `task_meta` y luego
  vienen eventos de `codex exec --json`. Se unen con su hilo `source=exec`
  por el id de `thread.started`: para el estado y la línea de tiempo manda
  el log, y para el modelo y los tokens manda la base de datos.
- **Estados**:
  - **En curso**: hubo actividad hace menos de 2 min y aún no hay
    `turn.completed`.
  - **Terminado**: hay `turn.completed`.
  - **Interrumpido**: no hay `turn.completed` y lleva más de 2 min sin
    actividad.

- **Sesiones interactivas de Codex abiertas** (decisión de Claude): Codex no
  tiene un fichero por `pid`. El agente busca los procesos `codex` que estén
  en marcha:
  - en macOS, con `ps` y con `lsof -a -d cwd -p <pid>` para saber su `cwd`;
  - en Windows, con `Get-CimInstance Win32_Process` y su línea de comandos.

  Si un proceso `codex` interactivo (no `exec`) está vivo en el `cwd` de un
  hilo y ese hilo es el más reciente de ese `cwd` desde que arrancó el
  proceso, el hilo se marca como **"Abierto"**. Aparece entonces como
  "Esperándote", o como "Trabajando" si su rollout cambió hace menos de
  30 s, y no se ofrece "continuar". Si no se puede emparejar con seguridad,
  se trata como abierto cualquier hilo de ese `cwd` actualizado desde que
  arrancó el proceso. Ante la duda, se prefiere no ofrecer "continuar" antes
  que duplicar una sesión.

### 6.4 Terminales: continuar y abrir sesiones

| Caso | Qué hace el panel |
|---|---|
| Sesión **cerrada** de Claude | "Continuar aquí": abre un terminal en esa máquina, en el `cwd` de la sesión, y ejecuta `claude --resume <sessionId>` |
| Hilo **cerrado** de Codex | igual, con `codex resume <id>` |
| Sesión **viva fuera del panel** (VS Code u otra terminal) | No ofrece continuar. Muestra "Abierta en VS Code en <máquina>" |
| Sesión **abierta desde el panel** | "Entrar": se vuelve a conectar al mismo terminal, desde cualquier dispositivo |
| **Nueva** sesión | Se elige máquina, proyecto y agente (Claude o Codex) y se ejecuta `claude` o `codex` en la carpeta del proyecto |

- Los terminales del panel se identifican así:
  - en macOS, con sesiones `tmux` llamadas `ca-<id>`;
  - en Windows, con un registro en memoria del agente.

  El agente los incluye en su instantánea.
- Al abrir un terminal, el panel avisa de que es una sesión **real** en esa
  máquina, con los permisos que tenga el agente.
- El agente nunca ejecuta comandos libres que mande el hub. Solo hay tres
  operaciones cerradas:
  - `resume(tipo, id)`;
  - `nueva(tipo, proyectoId)`;
  - `adjuntar(terminalId)`.

  El hub envía **ids**, nunca rutas ni comandos, y el agente resuelve él
  mismo las rutas a partir de su propio escaneo. Lo que Pedro escribe dentro
  del terminal es otra cosa: eso sí va tal cual al proceso.

### 6.5 Cómo se asigna un agente a un proyecto

1. **Por `cwd`**: gana el proyecto cuya ruta es el prefijo más largo.
2. **Si el `cwd` no es un proyecto** (por ejemplo, la carpeta padre
   `Proyectos IA`), se usan las rutas de los ficheros que tocó la sesión
   (`file_path` de sus llamadas Edit y Write). Se asigna al proyecto o
   proyectos donde editó. Así una sesión abierta en `Proyectos IA` que
   trabajó en `tech-study-tracker` aparece en ese proyecto.
3. **Si no hay nada de lo anterior**, va a "Sin proyecto".

### 6.6 Historial y tareas de un proyecto

- **Historial**: los commits (`git log`) y las sesiones de Claude y Codex,
  ordenados por tiempo y agrupados por día. Un commit se cuelga bajo la
  sesión que lo hizo si la sesión ejecutó `git commit` en ese repo dentro de
  su intervalo de tiempo. Si no se puede saber, aparece suelto.
- **Tareas**:
  - planes en `docs/superpowers/plans/*.md`, con la fecha del nombre del
    fichero y el progreso contando `- [x]` frente a `- [ ]`;
  - el `HANDOFF.md` del proyecto o de su carpeta padre. Si está en la padre
    y tiene secciones con el nombre del proyecto, solo se muestra esa
    sección. Si es más antiguo que los últimos commits, se avisa de que
    puede estar desactualizado;
  - las listas `TodoWrite` de las sesiones recientes.

## 7. Seguridad

- **Red**: el hub escucha solo en `127.0.0.1` y únicamente `tailscale serve`
  lo publica, solo dentro de la red Tailscale. Nunca se usa `tailscale
  funnel`.
- **Entrar al panel**: hacen falta dos cosas.
  1. Que la cabecera `Tailscale-User-Login`, que pone `tailscale serve`,
     coincida con la cuenta de Pedro configurada en el hub.
  2. Una **contraseña** guardada con hash (scrypt o argon2) que da una
     cookie de sesión `HttpOnly`, `Secure` y `SameSite=Strict`.

  Las peticiones que cambian algo, entre ellas abrir un terminal, también
  comprueban `Origin`. El WebSocket del navegador comprueba la cookie y el
  `Origin` al conectarse.
- **Máquinas**: cada agente se da de alta con un **código de un solo uso**
  que se genera en el panel ("Añadir máquina") y caduca a los 10 minutos.
  El hub le devuelve un token propio, guarda solo su hash y permite
  revocarlo.
- **Rutas**: la API y el protocolo nunca aceptan rutas, solo ids. El agente
  aplica una lista permitida (carpetas raíz de proyectos, `~/.claude/projects`,
  `~/.claude/sessions/*.json`, `~/.codex/sessions`) y la lista prohibida de
  §4, después de `realpath`.
- **Secretos en la salida**: antes de enviar una línea de tiempo se
  enmascaran estos patrones:
  - `sk-…`, `ghp_…`, `github_pat_…`, JWT `eyJ…` y `AKIA…`;
  - cabeceras `Authorization:`;
  - líneas `CLAVE=valor` cuyo nombre contenga KEY, SECRET, TOKEN o PASSWORD.

  Lo que se ve dentro del terminal en vivo **no** se enmascara, porque es
  la sesión real.
- **Registro de auditoría** en el hub: quién abrió qué terminal, en qué
  máquina, desde qué dispositivo y cuándo. Se ve en una pantalla de ajustes.

## 8. Forma de trabajo: Claude planifica, Codex implementa

- **Claude**:
  - escribe el diseño y el plan por fases;
  - elige el modelo y el esfuerzo de Codex para cada tarea;
  - **instala las dependencias** (Codex no tiene red);
  - crea las ramas;
  - ejecuta él mismo `test`, `build` y `lint`;
  - hace las **pruebas de integración** que abren puertos o sockets (Codex
    no puede abrir puertos en su sandbox de macOS);
  - verifica la interfaz con Playwright;
  - revisa el código y hace commits, pushes y PRs.
- **Codex** implementa cada fase a partir de un prompt concreto, con su
  lógica pura y sus tests unitarios.
- El repo lleva su propio `scripts/dev/codex-task.sh`,
  `scripts/dev/codex-monitor.mjs` y `AGENTS.md`. Cada vez que se lanza
  Codex se le da a Pedro la URL del monitor, después de comprobar que está
  escuchando.
- **Commits sin ninguna coautoría de Claude.** Se trabaja en ramas y se
  integra mediante PR. El repo sigue **privado**.
- **Trabajo en otras máquinas**: lo que haya que hacer en el Mac mini o en
  el Windows (instalar Tailscale, tmux o Node, clonar el repo, dar de alta
  el agente) lo hace Pedro siguiendo pasos que Claude deja escritos en el
  README. Claude no tiene acceso a esas máquinas.

## 9. Fases (sugeridas; el plan las detalla)

**Cambio de orden del 2026-10-20 (Pedro):** al terminar la fase 1 sin nada
visual, Pedro pidió ver el front cuanto antes. El panel web se adelanta a la
fase 2 en **modo local** y el hub pasa a la fase 3.

1. **Base y lectores** (hecha, PR #1): monorepo, esquemas compartidos,
   lectores de §6.1 a §6.3 y §6.6, guardián y enmascarado.
2. **Panel web en modo local**: el agente sirve el front y una API de solo
   lectura en `http://127.0.0.1:4600` (`npm run panel`) para la máquina
   donde corre. Incluye:
   - la **vista general** de §2.1 con un solo bloque de máquina;
   - la **ficha de proyecto** de §2.2: historial de commits y sesiones por
     día, tareas con fecha y sesiones del proyecto. El botón "Continuar"
     aparece desactivado con el texto "Llega con el terminal".

   **Seguridad del modo local:**
   - escucha solo en `127.0.0.1`;
   - rechaza cualquier `Host` que no sea `127.0.0.1:<puerto>` o
     `localhost:<puerto>`;
   - solo admite `GET` y `HEAD`;
   - no envía cabeceras CORS;
   - manda una CSP `default-src 'self'`.

   No hay contraseña porque no sale de la máquina. El mismo front lo
   servirá el hub en la fase 3.
3. **Hub y varias máquinas**: conexión WSS, alta de máquinas, inicio de
   sesión, Tailscale (`tailscale serve` en el Mac mini) y bloques por
   máquina en la vista general. También el detalle de agente con su línea
   de tiempo en vivo.
4. **Terminal en el navegador** en los Mac (tmux): continuar, nueva sesión,
   entrar y barra de teclas para el móvil.
5. **Windows**: agente y terminal ConPTY, verificados por Pedro en su
   máquina.

## 10. Lo que queda a criterio del builder

- El framework HTTP, el router del front, la librería de WebSocket y el
  formato exacto de los mensajes, siempre que estén tipados y validados.
- Cómo se arranca el agente como servicio: launchd en macOS y una tarea
  programada o equivalente en Windows.
- La heurística de "lo pendiente" en el `HANDOFF.md`, que si falla muestra
  el primer encabezado.
- El tamaño de página de la línea de tiempo (sugerencia: 200 eventos) y la
  tabla de ventanas de contexto por modelo.
- El estilo visual fino, mientras respete la maqueta `estilo-tarjetas-v2`.

### Qué es la maqueta y qué no (decisión de Claude)

La maqueta define el **estilo visual** y la **disposición** de la vista
general y de la ficha. **La lista de funciones es la de §2.** La maqueta se
hizo antes de que hubiera varias máquinas, así que la vista general tiene
que añadir los **bloques por máquina** de §2.1, al estilo de la captura de
AI Beacon. Sobre los elementos de la maqueta que §2 no menciona:

- **Buscador y chips de filtro**: sí entran, pero filtrando **en el
  navegador** sobre las instantáneas ya recibidas (nombres de proyectos y
  sesiones, ramas). No buscan en commits ni consultan a las máquinas.
- **Pestaña "Ramas"**: sí entra, con las ramas locales que ya manda §6.1.
- **"Abrir en VS Code"** y **chip "🔒 privado"**: no entran.
- **"Nueva tarea Codex"**: se refiere a la **nueva sesión interactiva** de
  Codex de §6.4. No es un `codex exec` con un prompt escrito, así que el
  agente sigue aceptando solo las tres operaciones cerradas.

## 11. Cuándo está terminado

- Desde el portátil y desde el móvil, a través de Tailscale, se entra al
  panel con contraseña y se ven las **tres máquinas**, cada una con sus
  proyectos y agentes reales.
- Sin estar en la red Tailscale no se llega al panel. Estando en ella pero
  sin contraseña no se ve nada ni se abre ningún terminal.
- Una sesión de Claude o Codex abierta en cualquier máquina aparece en
  menos de 10 s con su estado y su porcentaje de contexto. Al cerrarla,
  pasa a "Cerrada".
- Desde el móvil se puede continuar una sesión cerrada de Claude en el Mac
  mini, escribir en ella, cerrar la pestaña, volver a abrirla y seguir en
  el mismo terminal.
- En la ficha de tech-study-tracker se ven su historial real, sus planes con
  fecha y progreso, y su handoff con el aviso de que puede estar
  desactualizado.
- Las pruebas de rutas prohibidas, del `Origin`, de la cookie, de la
  revocación de tokens y del enmascarado de secretos pasan. `test`, `build`
  y `lint` pasan, y Claude ha hecho la verificación visual con Playwright.
