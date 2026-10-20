# centro-agentes

Panel privado para ver y controlar las sesiones de **Claude Code** y
**Codex** en varias máquinas (MacBook, Mac mini y Windows).

Estado: **fase 4** (terminales en el navegador). Ver `docs/superpowers/`.

## Panel

```bash
npm run panel        # compila el front y arranca el panel en http://127.0.0.1:4600
```

Abre el enlace que imprime al arrancar (`http://127.0.0.1:4600/#clave=…`).
La clave cambia en cada arranque y se guarda solo en ese navegador. Sin ella se
ve el panel, pero no se pueden abrir terminales.

- **Vista general**: tus proyectos agrupados por carpeta, con las sesiones de
  Claude Code y Codex de cada uno (estado, modelo, contexto usado y tiempo),
  sus pendientes y la actividad de los últimos 14 días. Se actualiza sola
  cada 5 s, y tiene buscador y filtros.
- **En directo** (arriba): una tarjeta por agente activo con su muñeco 3D
  según el tipo (Claude, Explorador, Arquitecto, Inspector, Ayudante, Codex,
  Obrero o Guardián), lo último que ha hecho, el anillo de contexto y su
  estado. El muñeco rebota cuando trabaja y se balancea cuando te espera.
- **Detalle de agente** (clic en un agente): lo que ha hecho (comandos,
  ediciones, mensajes y ficheros) y su línea de tiempo en vivo, con tus
  mensajes, sus respuestas y los comandos con su salida.
- **Ficha de proyecto** (clic en la tarjeta): historial real por días, con los
  commits colgando de la sesión que los hizo, las tareas (handoff y planes
  con progreso y fecha) y las sesiones del proyecto.
- **Terminales**: "Continuar aquí" en una sesión cerrada y "Nueva sesión de
  Claude" o "Nueva sesión de Codex" en la ficha de un proyecto abren un
  terminal real (tmux) en el navegador, también desde el móvil, con una
  barra de teclas extra. Siguen abiertos aunque cierres la pestaña. Vuelves a
  ellos desde "Terminales abiertos" en el bloque de la máquina.
- Solo escucha en `127.0.0.1` y rechaza cualquier otro `Host`. Solo acepta
  escrituras para crear y cerrar terminales, con el `Origin` del propio panel
  y su clave. No sale de tu máquina. Para cambiar el puerto:
  `npm run panel -- --puerto 4700`.

## Instalación en tus máquinas (hub + agentes)

El **hub** vive en el Mac mini (siempre encendido) y junta las máquinas. Cada
máquina corre un **agente** que se conecta al hub. Todo viaja por tu red
privada de **Tailscale**: nada queda expuesto a internet.

### 1. Mac mini: el hub

1. Instala **Node 22 LTS** (https://nodejs.org) y **Tailscale** (App Store),
   e inicia sesión en Tailscale con tu cuenta.
2. Clona el repo e instala:
   ```bash
   git clone git@github.com:pedroleni/centro-agentes.git ~/centro-agentes
   cd ~/centro-agentes && npm install
   ```
3. Averigua el nombre del Mac mini en tu red y tu cuenta de Tailscale:
   ```bash
   alias tailscale=/Applications/Tailscale.app/Contents/MacOS/Tailscale
   tailscale status --json | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d["Self"]; print(s["DNSName"].rstrip(".")); print(d["User"][str(s["UserID"])]["LoginName"])'
   ```
   La primera línea es el nombre (`mac-mini.tailXXXX.ts.net`) y la segunda tu
   cuenta (`tu@correo`).
4. Configura el hub con esos dos datos. Te pedirá la contraseña del panel:
   escríbela y pulsa **Ctrl-D**.
   ```bash
   npm run hub:configurar -- --host-publico mac-mini.tailXXXX.ts.net --propietario tu@correo
   ```
5. Publica el hub **solo dentro de tu red Tailscale**, con HTTPS:
   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:4700
   ```
6. Haz que el hub arranque solo al iniciar sesión (ejecútalo **dentro de la
   carpeta del repo**, porque usa `$(pwd)` como ruta):
   ```bash
   sed "s|__REPO__|$(pwd)|; s|__HOME__|$HOME|g" scripts/servicios/es.centro-agentes.hub.plist > ~/Library/LaunchAgents/es.centro-agentes.hub.plist
   launchctl load -w ~/Library/LaunchAgents/es.centro-agentes.hub.plist
   ```
7. Abre `https://mac-mini.tailXXXX.ts.net` desde cualquier dispositivo de tu
   red Tailscale (el móvil también) y entra con la contraseña.

### 2. Cada Mac (también el propio Mac mini): el agente

1. En el panel, pulsa **«＋ Añadir máquina» → «Generar código»**: el código
   dura 10 minutos y sirve una sola vez.
2. En la máquina, ejecuta los comandos que te muestra el panel (clonar,
   `npm install`, `npm run agente:alta -- --hub https://… --codigo …`). Si
   esa máquina ya tiene el repo, basta con el `agente:alta`.
3. Haz que el agente arranque solo al iniciar sesión (ejecútalo **dentro de la
   carpeta del repo**: en tu MacBook es `~/Desktop/Proyectos IA/centro-agentes`):
   ```bash
   sed "s|__REPO__|$(pwd)|; s|__HOME__|$HOME|g" scripts/servicios/es.centro-agentes.agente.plist > ~/Library/LaunchAgents/es.centro-agentes.agente.plist
   launchctl load -w ~/Library/LaunchAgents/es.centro-agentes.agente.plist
   ```
4. **Permisos de macOS**: la primera vez, macOS preguntará si `node` (y `zsh`,
   si el repo está dentro de Escritorio, Documentos o Descargas) puede acceder
   a esas carpetas. Acepta. Si no pregunta, ve a **Ajustes del Sistema →
   Privacidad y seguridad → Archivos y carpetas** y actívalo para los dos.
5. En unos segundos la máquina aparece en el panel como **● Conectada**.

Los registros quedan en `~/Library/Logs/centro-agentes-hub.log` y
`~/Library/Logs/centro-agentes-agente.log`.

### Revocar una máquina

En **«＋ Añadir máquina»**, pulsa **Revocar** junto a la máquina. Su agente se
desconecta, dice «Token revocado: vuelve a dar de alta esta máquina» y no
vuelve a arrancar hasta que la des de alta de nuevo.

### Si el Mac mini se reinicia

El hub y su agente arrancan al **iniciar sesión** en el Mac mini, no antes.
Tras un reinicio, el panel no estará disponible hasta que inicies sesión en
él (es la decisión de la especificación, §5.4).

## Windows

Esta es la lista de comprobación para dejar tu PC Windows conectado al hub y
verificar allí lo que no se puede probar desde macOS:

1. Instala **Node 22 LTS**, **Git** y **Tailscale**, y entra en Tailscale con
   tu cuenta.
2. Clona el repositorio y, desde su carpeta en PowerShell, instala exactamente
   sus dependencias con `npm ci`.
3. Ejecuta `npm run agente:diagnostico`. Comprueba en el JSON que
   `claude.existe`, `codex.existe` y `terminales.disponible` valen `true`, y
   que en `terminales.detalle` salen las rutas de `claude` y `codex` (ahí
   PowerShell abre un terminal de verdad y los busca).
4. En el hub genera un código para añadir la máquina y úsalo así (con
   `npm.cmd`: en PowerShell, `npm` se come el `--` y los datos no llegan):
   `npm.cmd run agente:alta -- --hub https://<mac-mini>.<tailnet>.ts.net --codigo <CÓDIGO> --nombre Windows`.
5. Instala el arranque automático con
   `powershell -ExecutionPolicy Bypass -File scripts\servicios\instalar-agente-windows.ps1`.
   Cierra la sesión de Windows y vuelve a entrar. Comprueba que **no aparece
   ninguna ventana** y que la máquina sale **«Conectada»** en el hub. Después,
   en el Administrador de tareas, finaliza el proceso `node.exe` del agente:
   en menos de un minuto tiene que volver a salir «Conectada».
6. Desde el móvil, pulsa **«Nueva sesión de Claude»** en un proyecto de
   Windows. Comprueba que se abre y responde; sal del terminal, vuelve a
   entrar y verifica que reaparece la salida reciente. Al cerrarlo, en el
   Administrador de tareas no debe quedar ningún `conhost.exe` u
   `OpenConsole.exe` de más.
7. En una sesión cerrada de Codex de Windows, pulsa **«Continuar aquí»** y
   comprueba que se reanuda en el mismo proyecto. Si no aparece el botón,
   cierra Codex en VS Code o en otras terminales y espera unos segundos: en
   Windows no se sabe en qué carpeta corre cada Codex abierto, y ante la duda
   el panel trata sus hilos recientes como abiertos para no duplicarlos.

Si algo no va:

- La salida del agente queda en `%LOCALAPPDATA%\centro-agentes\agente.log`.
- Si al instalar la tarea sale «Acceso denegado», abre PowerShell como
  administrador y repite el paso 5.
- Para quitar la tarea:
  `powershell -ExecutionPolicy Bypass -File scripts\servicios\instalar-agente-windows.ps1 -Desinstalar`.
- La primera vez que Claude abre una carpeta puede preguntar si confías en
  ella. Contesta desde el terminal con ↓ y Enter.
- En Windows los terminales viven mientras el agente esté en marcha. Si se
  reinicia (o cierras sesión), se cierran.
- Pásame la salida de `npm run agente:diagnostico` y el final del registro:
  con eso lo corrijo desde aquí. El diagnóstico solo cuenta carpetas y
  ficheros, no lee ningún secreto.

## Desarrollo

```bash
npm install
npm test             # vitest
npm run lint
npm run build
npm run instantanea  # JSON con todo lo que el agente ve en esta máquina
npm run dev:web      # front con recarga en caliente (requiere el panel en marcha para la API)
```

Requiere Node ≥ 22.12. El `.npmrc` del repo activa `node:sqlite`
(`--experimental-sqlite`) en todos los scripts de npm, en macOS y en Windows.

## Configuración del agente

Copia `agente.config.example.json` a `agente.config.json`, que no se
versiona, y ajusta las carpetas raíz que se escanean en busca de proyectos.

## Trabajar con Codex

```bash
npm run codex:monitor                            # http://localhost:4545, sigue la última tarea
npm run codex:task -- "prompt" <esfuerzo> [modelo]
```
