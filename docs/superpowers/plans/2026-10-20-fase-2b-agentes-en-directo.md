# Fase 2b · Agentes en directo, detalle de agente y avatares — Plan

> **Para agentes:** SUB-SKILL OBLIGATORIA: superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que el panel enseñe *qué hace y qué ha hecho cada agente*. Para eso:
- una franja **"En directo"** arriba, con los agentes activos y su última acción;
- un **muñeco 3D distinto por tipo de agente**;
- un **detalle de agente** con su línea de tiempo en vivo;
- **tarjetas de proyecto enteras clicables**;
- un **indicador "En vivo"** que cuenta los segundos;
- la **caché del navegador** arreglada.

**Por qué (Pedro, 2026-10-20):** tras ver el panel dijo que no lo veía muy visual, que no podía entrar en los proyectos, que no veía los agentes ejecutados ni "el actualizado actual", y pidió "muñecos 3D" distintos para los agentes usados en cada tarea. El detalle de agente, que la especificación tenía en la fase 3, se adelanta aquí.

**Arquitectura:** el agente añade a cada `Agente` su `rol`, su `ultimaAccion` y un `resumenActividad`, que salen de los mismos reductores incrementales. Las rutas de los ficheros de cada agente se quedan en un registro **en memoria** del agente y nunca se envían. Una API nueva, `GET /api/agentes/<id>/linea`, pagina la línea de tiempo a partir de ese registro. El front añade el componente `Avatar`, la franja `EnDirecto`, la ruta `#/agente/<id>` y el indicador `EnVivo`.

**Especificación:** `docs/superpowers/specs/2026-10-19-centro-agentes-design.md` (§2.3 detalle de agente, §4, §7). Avatares: `web/public/agentes/*.png`, generados por Codex según `.superpowers/avatares.md`.

## Restricciones globales

- Todo lo de las fases 1 y 2 sigue vigente: guardián, enmascarado, solo `127.0.0.1`, Host estricto, solo GET y HEAD, CSP `default-src 'self'` y textos en español.
- **Roles y nombres visibles** (exactos):

  | rol | Nombre visible |
  |---|---|
  | `claude` | Claude |
  | `claude-explorador` | Explorador |
  | `claude-arquitecto` | Arquitecto |
  | `claude-inspector` | Inspector |
  | `claude-ayudante` | Ayudante |
  | `codex` | Codex |
  | `codex-obrero` | Obrero |
  | `codex-guardian` | Guardián |

  La imagen de cada rol es `/agentes/<rol>.png`.
- La API **nunca devuelve rutas de fichero** y los ids de agente solo se resuelven contra el registro en memoria.
- Los textos de la línea de tiempo pasan por `enmascararSecretos`. La salida de un comando se recorta a 2 000 caracteres.

## Foco de revisión

1. **Transcript de varios MB**: `/linea` lee solo la cola (`ultimasLineas`, 200 líneas) y pagina con `antes`. Nunca se lee entero. Test en la Tarea 9.
2. **Agente que desaparece de la instantánea** (sesión borrada): `/linea` responde 404 y el front muestra "Este agente ya no está disponible". Tests en las Tareas 9 y 11.
3. **Un id manipulado** (`../`, `%2F`, un id que no está en el registro) → 404 sin tocar el disco. Test en la Tarea 9.
4. **Imagen de avatar que falta**: si falla, se muestra el icono de texto (✱ en Claude, ◎ en Codex) sobre un círculo de color, nunca una imagen rota. Test en la Tarea 10.
5. **Usuario con "reducir movimiento"**: con `prefers-reduced-motion: reduce` no hay animaciones de rebote ni de pulso. Regla CSS en la Tarea 10, comprobada por Claude.

---

### Tarea 8: Rol, última acción y resumen de actividad · Codex (high)

**Ficheros:** `compartido/src/esquemas.ts`, `agente/src/lectores/claudeTranscripts.ts`, `agente/src/lectores/codexRollouts.ts`, `agente/src/lectores/codexTareas.ts`, `agente/src/instantanea.ts`, nuevo `agente/src/actividad.ts`, y los tests correspondientes.

**Interfaces:**
- `Rol = z.enum([...los 8 roles de la tabla...])`.
- `Accion = z.object({ tipo: z.enum(['comando','edicion','lectura','busqueda','subagente','pregunta','mensaje','otro']), texto: z.string(), fechaMs: z.number() })`.
- `Agente` suma estos campos:
  - `rol: Rol`;
  - `ultimaAccion: Accion | null`;
  - `resumenActividad: { comandos: number; ediciones: number; mensajes: number; ficheros: string[] }`, donde `ficheros` son, como mucho, los 6 nombres base editados más recientemente.
- En `agente/src/actividad.ts`:
  - `accionDeToolUse(nombre: string, input: unknown, fechaMs: number): Accion`. Asigna así:
    - `Bash`: `comando`, con la primera línea de `command`;
    - `Edit`, `Write`, `MultiEdit` y `NotebookEdit`: `edicion`, con el nombre base del fichero;
    - `Read`: `lectura`, con el nombre base;
    - `Grep` y `Glob`: `busqueda`, con el `pattern`;
    - `Agent` y `Task`: `subagente`, con la `description`;
    - `AskUserQuestion`: `pregunta`, con la primera `question`;
    - cualquier otro: `otro`, con el nombre de la herramienta.

    El `texto` va enmascarado y recortado a 160 caracteres.
  - `rolClaude(agentType: string | null, descripcion: string | null): Rol`. Sin `agentType` es una sesión principal → `claude`. Si no:
    - `Explore` → `claude-explorador`;
    - `Plan` → `claude-arquitecto`;
    - si `agentType` o `descripcion` cumplen `/revis|review|audit/i` → `claude-inspector`;
    - en otro caso → `claude-ayudante`.
  - `rolCodex(source: string, modelo: string | null, esTarea: boolean): Rol`. Si `source` contiene `guardian` o el modelo es `codex-auto-review` → `codex-guardian`; si es `esTarea` o `source === 'exec'` → `codex-obrero`; en otro caso → `codex`.
- **Claude**:
  - los subagentes leen su `agent-<id>.meta.json` (al lado del `.jsonl`, pasando por el guardián): `agentType` decide el rol y `description` pasa a ser el **título**;
  - la última acción es el último `tool_use`, o el último texto del asistente (`mensaje`) si es posterior.
- **Codex rollout**:
  - `response_item.function_call` → `comando`, con `cmd` o `command` de sus `arguments`;
  - `response_item.custom_tool_call` con `name === 'apply_patch'` → `edicion`, con los ficheros de `*** Update File:` y `*** Add File:`;
  - `event_msg.agent_message` → `mensaje`.
- **Codex `.codex-logs`**:
  - `item.completed` con `command_execution` → `comando`;
  - `item.completed` con `file_change` → `edicion`;
  - `item.completed` con `agent_message` → `mensaje`.
- `construirInstantanea` acepta en sus dependencias un `registrarFuente?: (agenteId: string, fuente: { tipo: 'claude' | 'codex-rollout' | 'codex-log'; ruta: string }) => void` opcional y lo llama con cada ruta ya validada por el guardián.

- [ ] Tests primero:
  - una tabla de `accionDeToolUse` con los 8 tipos, más un comando con `sk-…` que sale enmascarado;
  - `rolClaude` (`'Explore'` → `explorador`; `'general-purpose'` con la descripción `'Final review'` → `inspector`; `'general-purpose'` con `'Builder check'` → `ayudante`; `null` → `claude`);
  - `rolCodex` (con `{"subagent":{"other":"guardian"}}` → `guardian`; `exec` → `obrero`; `vscode` → `codex`);
  - el subagente con su `meta.json` → título igual a la descripción;
  - el rollout con `function_call` → la última acción es `comando`;
  - el log con `file_change` → `edicion`;
  - `resumenActividad` cuenta bien;
  - `registrarFuente` recibe la ruta del transcript.

  Ejecutarlos → FALLA. Implementar → PASA. Después, `npm test && npm run lint && npm run build`.

### Tarea 9: Línea de tiempo y caché · Codex (high) + curl de Claude

**Ficheros:** nuevo `agente/src/linea.ts`, `agente/src/panel/manejador.ts`, `agente/src/cli.ts`, y sus tests.

**Interfaces:**
- `EventoLinea = { fechaMs: number; tipo: 'usuario'|'asistente'|'comando'|'edicion'|'lectura'|'busqueda'|'subagente'|'pregunta'|'otro'; texto: string; detalle: string | null }`.
- `leerLinea(fuente: Fuente, antes: number | null, n = 200): Promise<{ eventos: EventoLinea[]; antes: number | null }>`.
  - Usa `ultimasLineas`.
  - Convierte cada línea según el tipo de fuente: en Claude, `user` con texto da `usuario`, el texto de `assistant` da `asistente` y cada `tool_use` da su tipo con `accionDeToolUse`; el `detalle` de un comando sale de su `tool_result`, emparejado por `tool_use_id`, si está en la página. Codex usa el mapeo de la Tarea 8.
  - Los eventos se devuelven en orden cronológico ascendente.
  - `antes` es el `desdeByte` de la página, o `null` si es el principio del fichero.
- El manejador añade la ruta `GET /api/agentes/<idCodificado>/linea?antes=<n>`. El id se decodifica una vez y se busca en un `Map` en memoria (`obtenerLinea(id, antes)`); si no está, 404. `antes` tiene que ser un entero ≥ 0, o 400.
- **Caché HTTP**:
  - `index.html` y el fallback de la SPA llevan `Cache-Control: no-cache`;
  - `/assets/*` lleva `public, max-age=31536000, immutable`;
  - `/agentes/*` lleva `public, max-age=86400`.
- `cli.ts panel` mantiene un registro `Map<id, Fuente>` que se rellena con `registrarFuente` en cada construcción y se sustituye entero cuando la construcción termina.

- [ ] Tests primero:
  - **Línea de tiempo**:
    - un transcript sintético con un mensaje del usuario, un texto del asistente, un `Bash` y su `tool_result` → 3 eventos, con la salida del comando en `detalle`;
    - un rollout sintético → sus eventos;
    - un fichero de 5 000 líneas: la primera página trae 200 y `antes` no es nulo, y al pedir con `antes` llegan las 200 anteriores;
    - un secreto en un comando → sale enmascarado.
  - **Manejador**:
    - un id desconocido → 404;
    - `..%2F..%2Fetc` → 404 sin llamar a `obtenerLinea`;
    - `antes=-1` → 400;
    - las cabeceras de caché de `/`, `/assets/x.js` y `/agentes/claude.png`.

  Implementar → PASA. Claude prueba después con `curl` contra el panel real.

### Tarea 10: Avatares, "En directo", tarjetas clicables e indicador en vivo · Codex (medium)

**Ficheros:** `web/src/vistas/Avatar.tsx`, `web/src/vistas/EnDirecto.tsx`, `web/src/vistas/EnVivo.tsx`, `web/src/logica/roles.ts`, `web/src/vistas/VistaGeneral.tsx`, `TarjetaProyecto.tsx`, `FilaAgente.tsx`, `web/src/estilos.css`, y sus tests.

**Interfaces:**
- `nombreRol(rol: Rol): string` usa la tabla de las Restricciones globales. `colorRol(rol)` devuelve terracota en la familia Claude y negro en la de Codex.
- `Avatar({ rol, estado, tamano })` pinta `<img src="/agentes/<rol>.png" alt="<nombreRol>">` dentro de un círculo. Si la imagen da error, cambia al icono de texto (✱ en Claude, ◎ en Codex) sobre un círculo de `colorRol`. Clases según el estado:
  - `trabajando` → `av-trabaja`: rebote suave y anillo azul que late;
  - `esperandote` → `av-espera`: balanceo lento y anillo ámbar;
  - `en-curso` → igual que `trabajando`;
  - el resto → `av-reposo`: 60 % de opacidad y desaturado.

  Con `@media (prefers-reduced-motion: reduce)` no hay ninguna animación.
- `EnDirecto({ agentes, proyectos, ahora })`:
  - es una franja, en rejilla, con **una tarjeta grande por agente** en `trabajando`, `esperandote` o `en-curso`, más los que hayan terminado hace menos de 15 min, que van al final y en reposo;
  - cada tarjeta lleva el avatar de 88 px, `nombreRol`, el título, el nombre del proyecto (o "Sin proyecto"), la **última acción** con su icono (⌨ comando, ✎ edición, 👁 lectura, 🔍 búsqueda, 🤖 subagente, ❓ pregunta, 💬 mensaje) y su `fechaRelativa`, un anillo SVG con el % de contexto, el estado y `tiempoAgente`;
  - toda la tarjeta es un enlace a `#/agente/<encodeURIComponent(id)>`;
  - si no hay ninguno: "Ningún agente trabajando ahora mismo".
- `EnVivo({ actualizadaMs, error, ahora })` muestra "● En vivo · actualizado hace N s", con N recalculado **cada segundo** (un `setInterval` propio) y el punto latiendo un instante cuando cambia `actualizadaMs`. Con `error` pasa a "● Sin conexión · reintentando", en rojo.
- `TarjetaProyecto`:
  - toda la tarjeta es un enlace a la ficha, con `cursor: pointer` y una elevación al pasar el ratón;
  - las filas de agente usan un `Avatar` de 28 px en vez de ✱ o ◎, y muestran debajo la última acción en una línea con elipsis;
  - las filas de agente enlazan a su detalle, con `stopPropagation` para no abrir también la ficha.
- En `VistaGeneral`, el orden es: barra, `EnVivo` junto a la cabecera de máquina, `EnDirecto`, filtros y grupos.

- [ ] Tests primero (jsdom):
  - el avatar pinta `img[src="/agentes/claude-explorador.png"]` y, tras disparar `error` en la imagen, muestra ✱;
  - "En directo" muestra el agente `trabajando` con su última acción "npm test" y no muestra uno `cerrada` de hace 2 h;
  - con 0 activos sale el texto vacío;
  - `EnVivo` con `vi.useFakeTimers` pasa de "hace 0 s" a "hace 3 s" al avanzar 3 s;
  - al pulsar el cuerpo de la tarjeta, el hash cambia a `#/proyecto/<id>`.

  Implementar → PASA. Después, `npm test && npm run lint && npm run build && npm run build:web`.

### Tarea 11: Detalle de agente · Codex (medium)

**Ficheros:** `web/src/vistas/DetalleAgente.tsx`, `web/src/vistas/LineaTiempo.tsx`, `web/src/api.ts` (`obtenerLinea(id, antes)`), `web/src/App.tsx` (ruta `#/agente/<id>`), `FichaProyecto.tsx`, `Sesiones.tsx` y `Historial.tsx` (avatares y enlaces al detalle), y sus tests.

**Interfaces:**
- `DetalleAgente({ agente, proyectos, linea, cargarAnteriores, ahora })` es presentacional. `App` carga la línea al entrar y la refresca **cada 3 s mientras el agente esté activo**: pide la última página y añade los eventos nuevos sin duplicar, comparando `fechaMs` y `texto`.
- **Cabecera**: avatar de 120 px; `nombreRol` y título; un enlace al proyecto o proyectos; modelo y esfuerzo; un anillo de contexto grande; estado y `tiempoAgente`.
- **Bloque "Qué ha hecho"**: tres contadores grandes (comandos, ediciones y mensajes) y los chips de los ficheros tocados.
- **Línea de tiempo**: vertical, con un icono y un color por tipo de evento.
  - Los de `usuario` van en una burbuja a la derecha, con la etiqueta "Tú".
  - Los de `asistente`, en una burbuja a la izquierda con el avatar pequeño.
  - Los comandos van en una caja oscura monoespaciada y su `detalle` se puede desplegar.
  - Si está activo, la vista sigue el final automáticamente mientras el usuario no haya subido.
  - Tiene un botón "Cargar anteriores" mientras `antes !== null`.
- Si el agente no está en la instantánea: "Este agente ya no está disponible", con un enlace "Volver".
- En la ficha del proyecto, las sesiones y las sesiones del historial llevan su avatar y enlazan al detalle.

- [ ] Tests primero (jsdom):
  - el detalle muestra "Explorador" y los contadores 3/2/5;
  - un evento `usuario` aparece con "Tú";
  - el `detalle` de un comando está oculto hasta que se despliega;
  - "Cargar anteriores" llama a `cargarAnteriores`;
  - un agente inexistente da el texto de no disponible;
  - en la ficha, la sesión enlaza a `#/agente/…`.

  Implementar → PASA. Después, `npm test && npm run lint && npm run build && npm run build:web`.

### Tarea 12: Cierre · Claude

- [ ] Revisar los 8 avatares generados. Reducirlos a 256 px (`sips -Z 256`) para que pesen poco y regenerar los que no encajen en estilo.
- [ ] Verificación visual con Playwright, con datos reales, a 1280 y 390 px:
  - la franja "En directo" con esta misma sesión trabajando;
  - el detalle de un agente con su línea de tiempo;
  - un subagente con su muñeco;
  - sin scroll horizontal;
  - la consola sin errores.
- [ ] Revisión final independiente de la rama, corrección de lo crítico e importante, y PR sin atribución.
