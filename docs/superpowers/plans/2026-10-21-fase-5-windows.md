# Fase 5: Windows. Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para ejecutar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** el agente corre en el Windows de Pedro (PowerShell, sin WSL), aparece en el hub con sus proyectos y sesiones, y desde el panel se pueden continuar sesiones y abrir otras nuevas en un terminal ConPTY.

**Arquitectura:**
- Los lectores ya entienden Windows desde la fase 1: rutas base, procesos de Codex con PowerShell y carpetas sin distinguir mayúsculas.
- Esta fase cambia cuatro cosas:
  1. Los scripts de npm pasan a ser multiplataforma.
  2. Las órdenes de terminal se lanzan con PowerShell.
  3. Hay un gestor de terminales ConPTY con registro en memoria, en lugar de tmux.
  4. El agente arranca como tarea programada al iniciar sesión, y hay un diagnóstico para que Pedro verifique su máquina.
- Claude no tiene acceso al Windows: lo que solo se puede probar allí queda en una lista de comprobación del README.

**Tecnología:** Node 22.12+, TypeScript strict ESM, node-pty 1.1 (ConPTY en Windows), PowerShell 5.1 (`powershell.exe`), Programador de tareas (`Register-ScheduledTask`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-centro-agentes-design.md` (§5.2, §5.4, §6, §6.4, §9 fase 5).

## Restricciones globales

- **Sin WSL**: Windows se usa "directamente desde la terminal de Windows (PowerShell)" (§1).
- **ConPTY**: en Windows el terminal "corre directamente en ConPTY. La sesión vive mientras el agente esté en marcha, y se acepta así" (§5.2).
- **Registro en memoria**: los terminales del panel se identifican "en Windows, con un registro en memoria del agente" (§6.4).
- **Tarea programada**: "en Windows, el agente es una tarea programada 'al iniciar sesión'". No se usan servicios de sistema que corran antes de iniciar sesión (§5.4).
- **Rutas base**: `%USERPROFILE%` en Windows (§6). "El builder debe verificarlo allí antes de cerrar la fase de Windows": aquí lo hace Pedro con `npm run agente:diagnostico`.
- **Topes**: como mucho 6 terminales por máquina y uno por sesión.
- **Órdenes cerradas**: solo `claude`, `codex`, `claude --resume <uuid>` y `codex resume <id>`, con los ids validados por las expresiones de `ordenes.ts` (§6.4).
- **Secretos**: nunca se leen ni envían `auth.json`, `*.key`, `.env*`, `client_secret*` ni `~/.claude/session-env` (§4). El diagnóstico solo cuenta entradas y comprueba si existen.
- **Rutas en código**: con `node:path`, y `path.win32` cuando la función recibe el SO (AGENTS.md).
- **Tests**: con fixtures sintéticos en `os.tmpdir()`, nunca con el `$HOME` real.
- **Idioma**: textos, identificadores y mensajes en español.
- **Commits** sin coautoría de Claude.

## Puntos para la revisión

1. **Windows en español con OneDrive**: Escritorio y Documentos están redirigidos a `%OneDrive%`, y sin ellos no aparecen los proyectos. Lo cubre la Tarea 4 con el test `incluye las carpetas de OneDrive en Windows`.
2. **`claude` y `codex` instalados con npm son `.cmd`**: lanzarlos directamente con node-pty falla, porque no resuelve `PATHEXT`. Hay que pasar por `powershell.exe -Command`. Lo cubre la Tarea 2 con el test `en Windows lanza la orden con PowerShell`.
3. **Límite del Programador de tareas**: por defecto mata la tarea a las 72 h y no la reinicia si falla, así que el agente moriría a los tres días. Lo cubre la Tarea 5 con el test `la tarea programada no caduca y se reinicia si falla`.
4. **Volver a un terminal ConPTY**: sin tmux no hay repintado y se vería la pantalla en blanco, así que se reenvía la salida reciente. Lo cubre la Tarea 3 con el test `al volver a entrar reenvía la salida reciente`.
5. **`cwd` de Codex con prefijo `\\?\` o la letra de unidad en otro caso**: la sesión no casaría con su proyecto y "Continuar" abriría en otra carpeta. Lo cubre la Tarea 4 con el test `normaliza las rutas largas de Windows`.

---

### Tarea 1: Scripts de npm multiplataforma

Los scripts usan `NODE_OPTIONS='…' tsx …`, sintaxis de POSIX que cmd.exe no entiende. En su lugar, el `.npmrc` del repo fija `node-options`, y npm pone él mismo `NODE_OPTIONS` en cada script, en cualquier sistema. Comprobado con npm 10.9 y Node 22.12.

**Ficheros:**
- Crear: `.npmrc`
- Modificar: `package.json` (scripts `test`, `instantanea`, `panel`, `hub`, `hub:configurar`, `agente:alta`, `agente:conectar`)
- Test: `agente/test/plataforma.test.ts`

**Interfaces:**
- Produce: `npm run <script>` funciona igual en macOS y Windows, y `node:sqlite` carga sin aviso.

- [ ] **Paso 1: test que falla**

```ts
it('ningún script de npm usa la sintaxis de variables de POSIX', () => {
  const { scripts } = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  for (const [nombre, orden] of Object.entries(scripts)) expect(orden, nombre).not.toMatch(/\b[A-Z_]+='/)
})
it('el .npmrc del repo da a Node los flags de sqlite', () => {
  expect(readFileSync(path.join(raiz, '.npmrc'), 'utf8')).toContain('node-options=--experimental-sqlite --no-warnings=ExperimentalWarning')
})
```

- [ ] **Paso 2:** `npm test -- agente/test/plataforma.test.ts`. Resultado esperado: FALLA.
- [ ] **Paso 3:** crear `.npmrc` con esa línea y quitar `NODE_OPTIONS='…' ` de los siete scripts.
- [ ] **Paso 4:** `npm test` (la suite entera carga `node:sqlite` a través del `.npmrc`), `npm run lint` y `npm run build`. Resultado esperado: todo PASA.
- [ ] **Paso 5:** commit "Scripts de npm multiplataforma: los flags de Node van en el .npmrc".

### Tarea 2: Órdenes de terminal en Windows

**Ficheros:**
- Modificar: `agente/src/terminales/ordenes.ts`, `agente/src/terminales/servicio.ts`
- Test: `agente/test/terminales/ordenes.test.ts`, `agente/test/terminales/servicio.test.ts`

**Interfaces:**
- Produce: `ordenTerminal(peticion: PeticionTerminal, so: SO): OrdenTerminal | { error: string }`.
  - En `windows`: `argv = ['powershell.exe', '-NoLogo', '-Command', orden]`, sin `-NoProfile`, para que cargue el PATH del perfil como hace `zsh -lc` en macOS. La carpeta se valida con `path.win32.isAbsolute`.
  - En `macos`: lo de ahora, con `path.posix.isAbsolute`.
- Produce: `crearTerminalPedido(pedido, instantanea: Pick<Instantanea, 'maquina' | 'agentes' | 'proyectos' | 'terminales'>, gestor)`. Pasa `instantanea.maquina.so`.

- [ ] **Paso 1: tests que fallan** (fixtures de Windows con `cwd: 'C:\\Users\\pedro\\web'`)

```ts
it('en Windows lanza la orden con PowerShell', () => {
  expect(ordenTerminal({ accion: 'continuar', agente: claudeWin }, 'windows')).toMatchObject({
    cwd: 'C:\\Users\\pedro\\web',
    argv: ['powershell.exe', '-NoLogo', '-Command', 'claude --resume 323ca3f4-7985-4de1-869d-e6b0dc0cace0'],
  })
  expect(ordenTerminal({ accion: 'nueva', tipo: 'codex', proyecto: proyectoWin }, 'windows')).toMatchObject({ argv: ['powershell.exe', '-NoLogo', '-Command', 'codex'] })
})
it('cada sistema solo acepta sus carpetas absolutas', () => {
  expect(ordenTerminal({ accion: 'nueva', tipo: 'claude', proyecto: { ...proyectoWin, ruta: 'web' } }, 'windows')).toEqual({ error: 'La carpeta del proyecto no es válida' })
  expect(ordenTerminal({ accion: 'nueva', tipo: 'claude', proyecto: proyectoWin }, 'macos')).toEqual({ error: 'La carpeta del proyecto no es válida' })
})
```

  En `servicio.test.ts`, con `maquina.so = 'windows'`, `crear` recibe `argv[0] === 'powershell.exe'`. Las llamadas existentes pasan `'macos'`.
- [ ] **Paso 2:** `npm test -- agente/test/terminales`. Resultado esperado: FALLA.
- [ ] **Paso 3:** implementar. `enShell(orden, so)` decide el `argv`; los ids siguen validándose con las mismas expresiones antes de entrar en la cadena.
- [ ] **Paso 4:** `npm test -- agente/test/terminales` y `npm run build`. Resultado esperado: PASA.
- [ ] **Paso 5:** commit "Órdenes de terminal en Windows con PowerShell".

### Tarea 3: Gestor de terminales ConPTY

**Ficheros:**
- Modificar: `agente/src/terminales/gestor.ts` (convertir `GestorTerminales` en un tipo explícito)
- Crear: `agente/src/terminales/gestorConpty.ts`, `agente/src/terminales/sistema.ts`
- Modificar: `agente/src/cli.ts` (`crearDatos` usa `crearGestorTerminalesDelSistema(process.platform)`)
- Test: `agente/test/terminales/gestorConpty.test.ts`

**Interfaces:**
- Produce, en `gestor.ts`:

```ts
export type GestorTerminales = {
  listar(): Promise<TerminalInfo[]>
  crear(orden: OrdenTerminal): Promise<TerminalInfo>
  adjuntar(id: string, tamano: { cols: number; rows: number }, alDatos: (datos: string) => void, alSalir: () => void): Enganche
  cerrar(id: string): Promise<void>
}
```

  `crearGestorTerminales` (tmux) devuelve ese tipo.
- Produce, en `gestorConpty.ts`:
  - `type AbrirPtyConpty = (argv: string[], opciones: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv }) => PtyMinimo`
  - `crearGestorTerminalesConpty(dep: { abrirPty: AbrirPtyConpty; ahora?: () => number; maximo?: number; memoria?: number }): GestorTerminales`, con `maximo` 6 y `memoria` 128 KiB.
  - `crearGestorTerminalesConptyReal(): GestorTerminales`, que usa `node-pty` con `useConpty: true` y lo carga con `createRequire`, como en `gestor.ts`.
- Produce, en `sistema.ts`: `crearGestorTerminalesDelSistema(plataforma: NodeJS.Platform): GestorTerminales`. En `'win32'` devuelve ConPTY; en el resto, tmux.
- Consume: `entornoTerminal` de `gestor.ts`; `OrdenTerminal` de la Tarea 2.

- [ ] **Paso 1: tests que fallan** (con un pty falso que guarda `write`, `resize`, `kill` y sus callbacks)
  - `crea el proceso con su orden y carpeta y lo lista`. `abrirPty` recibe `(orden.argv, { cwd: orden.cwd, cols: 120, rows: 32, env: expect.objectContaining({ TERM: 'xterm-256color' }) })`. `listar()` contiene el id, de 12 hex, con su título y su `agenteId`.
  - `no pasa de 6 terminales y una sesión tiene un solo terminal`:
    - el séptimo `crear` rechaza con `'Ya hay 6 terminales abiertos en esta máquina'`;
    - dos `crear` con el mismo `agenteId` devuelven el mismo id y llaman a `abrirPty` una sola vez.
  - `al volver a entrar reenvía la salida reciente`:
    - el pty emite `'hola'`, y después `adjuntar` recibe primero `'hola'`;
    - con 200 KiB emitidos, lo reenviado ocupa como mucho 128 KiB y acaba con lo último.
  - `varios navegadores a la vez; soltar uno no mata el proceso`: dos `adjuntar` reciben los mismos datos; `soltar()` de uno no llama a `kill` y el otro sigue recibiendo; `redimensionar(1000, 1)` llama a `resize(400, 5)`.
  - `al terminar avisa a todos y desaparece de la lista`: el callback de `onExit` llama a `alSalir` de cada enganche y `listar()` deja de incluirlo.
  - `cerrar mata el proceso; ids desconocidos fallan`:
    - `cerrar(id)` llama a `kill` y lo quita de la lista;
    - `cerrar('ffffffffffff')` rechaza;
    - `adjuntar('x; ls', …)` lanza.
- [ ] **Paso 2:** `npm test -- agente/test/terminales/gestorConpty.test.ts`. Resultado esperado: FALLA.
- [ ] **Paso 3:** implementar.
  - El registro es un `Map` en memoria.
  - Entre la comprobación del tope o del `agenteId` y el `set` del registro no hay ningún `await`, así que dos peticiones no se cuelan.
  - La memoria de salida es una lista de trozos recortada por bytes UTF-8.
- [ ] **Paso 4:** `npm test`, `npm run lint` y `npm run build`. Resultado esperado: PASA. Los tests de tmux siguen igual.
- [ ] **Paso 5:** commit "Terminales ConPTY para Windows con registro en memoria".

### Tarea 4: Rutas de Windows (OneDrive y rutas largas)

**Ficheros:**
- Modificar: `agente/src/rutas/base.ts`, `agente/src/config.ts`, `agente/src/lectores/codexHilos.ts`, `agente/src/cli.ts`
- Test: `agente/test/rutas/base.test.ts`, `agente/test/config.test.ts`, `agente/test/lectores/codexHilos.test.ts` (o los ficheros de test existentes de esos módulos)

**Interfaces:**
- Produce, en `base.ts`: `normalizarRutaWindows(ruta: string): string`.
  - `\\?\C:\x` → `C:\x`;
  - `\\?\UNC\srv\share\x` → `\\srv\share\x`;
  - `c:\x` → `C:\x`;
  - cualquier otra ruta, incluidas las de macOS, queda igual.
- Produce: `cargarConfig(ruta: string | null, home: string, so: SO = 'macos', env: Record<string, string | undefined> = {}): ConfigAgente`. En Windows, si `env.OneDrive` (o `env.OneDriveConsumer`) existe, añade a las raíces por defecto `<OneDrive>\Desktop`, `<OneDrive>\Documents`, `<OneDrive>\Escritorio` y `<OneDrive>\Documentos`, con `path.win32`. El escáner ya ignora las raíces que no existen.
- `codexHilos` aplica `normalizarRutaWindows` a `cwd` y `rollout`.

- [ ] **Paso 1: tests que fallan**
  - `normaliza las rutas largas de Windows`: los cuatro casos de arriba, más `/Users/p/x` sin cambios.
  - `incluye las carpetas de OneDrive en Windows`: `cargarConfig(null, 'C:\\Users\\pedro', 'windows', { OneDrive: 'C:\\Users\\pedro\\OneDrive' }).raices` contiene `'C:\\Users\\pedro\\OneDrive\\Escritorio'` y `'C:\\Users\\pedro\\Desktop'`. En `'macos'` no hay ninguna de OneDrive.
  - En `codexHilos`, un hilo de fixture con `cwd = '\\\\?\\C:\\Users\\pedro\\web'` sale con `cwd === 'C:\\Users\\pedro\\web'`.
- [ ] **Paso 2:** ejecutar esos tests. Resultado esperado: FALLA.
- [ ] **Paso 3:** implementar. `cli.ts` llama a `cargarConfig(rutaConfig, home, so, process.env)`.
- [ ] **Paso 4:** `npm test`, `npm run lint` y `npm run build`. Resultado esperado: PASA.
- [ ] **Paso 5:** commit "Rutas de Windows: OneDrive y rutas largas de Codex".

### Tarea 5: Arranque en Windows, diagnóstico y guía

**Ficheros:**
- Crear: `scripts/servicios/agente-windows.ps1`, `scripts/servicios/instalar-agente-windows.ps1`, `agente/src/diagnostico.ts`
- Modificar: `agente/src/cli.ts` (orden `diagnostico`), `package.json` (script `agente:diagnostico`), `README.md` (sección "Windows")
- Test: `agente/test/diagnostico.test.ts`, `agente/test/serviciosWindows.test.ts`

**Interfaces:**
- Produce, en `diagnostico.ts`, `diagnosticar(dep: { so: SO; rutas: RutasBase; raices: string[]; ejecutar(cmd: string, args: string[]): Promise<string>; cargarPty(): boolean; version: string }): Promise<Diagnostico>`, con:

```ts
type Diagnostico = {
  so: SO; node: string
  claude: { existe: boolean; proyectos: number; sesionesVivas: number }
  codex: { existe: boolean; baseDeDatos: string | null; rollouts: boolean }
  git: string | null            // salida de `git --version`, o null
  terminales: { tipo: 'tmux' | 'conpty'; disponible: boolean }
  raices: { ruta: string; existe: boolean }[]
}
```

  Solo usa `readdir` y `stat` para contar entradas y ver si existen. No abre ningún fichero: así ni toca los secretos.
- Orden `diagnostico` de la CLI: imprime el `Diagnostico` en JSON con sangría. Script `"agente:diagnostico": "tsx agente/src/cli.ts diagnostico"`.
- `agente-windows.ps1`: se sitúa en la raíz del repo (dos niveles por encima de `$PSScriptRoot`), crea `$env:LOCALAPPDATA\centro-agentes` y ejecuta `npm run agente:conectar *>> "$env:LOCALAPPDATA\centro-agentes\agente.log"`. Termina con `exit $LASTEXITCODE`.
- `instalar-agente-windows.ps1`: `Register-ScheduledTask -TaskName 'centro-agentes agente'` con estas piezas:
  - **disparador**: `New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME`;
  - **acción**: `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File <ruta de agente-windows.ps1>`;
  - **ajustes**: `New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`.

  Con `-Desinstalar`, ejecuta `Unregister-ScheduledTask -TaskName 'centro-agentes agente' -Confirm:$false`.

- [ ] **Paso 1: tests que fallan**
  - `cuenta lo que hay sin leer secretos`, con un home de fixture en `os.tmpdir()`:
    - `.claude/projects/a`, `.claude/projects/b` y `.claude/sessions/1.json`;
    - `.codex/state_5.sqlite`, `.codex/sessions/` y `.codex/auth.json`, con el texto `SECRETO-NO`.

    Espera `claude.proyectos === 2`, `codex.baseDeDatos === 'state_5.sqlite'` y que `JSON.stringify(resultado)` no contenga `SECRETO-NO`. `git` es `null` si `ejecutar` rechaza.
  - `la tarea programada no caduca y se reinicia si falla`, sobre el texto de `instalar-agente-windows.ps1`: contiene `-AtLogOn`, `[TimeSpan]::Zero`, `-RestartCount`, `-WindowStyle Hidden` y `agente-windows.ps1`. `agente-windows.ps1` contiene `npm run agente:conectar` y `exit $LASTEXITCODE`.
- [ ] **Paso 2:** ejecutar los dos tests. Resultado esperado: FALLA.
- [ ] **Paso 3:** implementar los dos scripts, `diagnosticar` y la orden de la CLI.
- [ ] **Paso 4:** README, sección "Windows", con la lista de comprobación de Pedro:
  1. instalar Node 22 LTS, Git y Tailscale (entrando con su cuenta);
  2. `git clone` y `npm ci`;
  3. `npm run agente:diagnostico`, y comprobar que `claude.existe`, `codex.existe` y `terminales.disponible` salen `true`;
  4. dar de alta la máquina con el código del hub: `npm run agente:alta -- --hub https://<mac-mini>.<tailnet>.ts.net --codigo <CÓDIGO> --nombre Windows`;
  5. `powershell -ExecutionPolicy Bypass -File scripts\servicios\instalar-agente-windows.ps1`, cerrar sesión, volver a entrar y ver la máquina "Conectada" en el hub;
  6. desde el móvil, "Nueva sesión de Claude" en un proyecto del Windows: se abre y responde; salir y volver, y se ve la salida;
  7. "Continuar aquí" en una sesión cerrada de Codex del Windows.
- [ ] **Paso 5:** `npm test`, `npm run lint` y `npm run build`. Resultado esperado: PASA. Commit "Windows: tarea programada, diagnóstico y guía de instalación".

### Tarea 6: Verificación, revisión y PR (Claude)

- [ ] **Paso 1:** `npm test`, `npm run lint`, `npm run build` y `npm run build:web`. Resultado esperado: todo en verde.
- [ ] **Paso 2:** en macOS no cambia nada: reiniciar el panel y el agente, y repetir la prueba de Playwright de la fase 4 (local y hub).
- [ ] **Paso 3:** revisión independiente (opus) de la rama, centrada en los "Puntos para la revisión" y en que ConPTY no amplíe las órdenes posibles. Hallazgos corregidos RED→GREEN.
- [ ] **Paso 4:** PR `fase-5/windows` → `main` sin coautoría, y fusión.
- [ ] **Paso 5:** la fase se cierra cuando Pedro complete la lista de comprobación en su Windows. Lo que falle allí se corrige con su salida de `npm run agente:diagnostico`.
