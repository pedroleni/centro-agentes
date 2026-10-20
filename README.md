# centro-agentes

Panel privado para ver y controlar las sesiones de **Claude Code** y
**Codex** en varias máquinas (MacBook, Mac mini y Windows).

Estado: **fase 3** (hub con varias máquinas). Ver `docs/superpowers/`.

## Panel

```bash
npm run panel        # compila el front y abre el panel en http://127.0.0.1:4600
```

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
- Solo escucha en `127.0.0.1`, rechaza cualquier otro `Host`, no acepta
  escrituras y no sale de tu máquina. Para cambiar el puerto:
  `npm run panel -- --puerto 4700`.
- Continuar sesiones y ver varias máquinas llegan en las fases siguientes.

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

### Windows

Llega en la **fase 5** (necesita un lanzador multiplataforma para los
scripts y probarlo en tu Windows).

## Desarrollo

```bash
npm install
npm test             # vitest
npm run lint
npm run build
npm run instantanea  # JSON con todo lo que el agente ve en esta máquina
npm run dev:web      # front con recarga en caliente (requiere el panel en marcha para la API)
```

Requiere Node ≥ 22.12. Los scripts activan `node:sqlite` con
`--experimental-sqlite`.

## Configuración del agente

Copia `agente.config.example.json` a `agente.config.json`, que no se
versiona, y ajusta las carpetas raíz que se escanean en busca de proyectos.

## Trabajar con Codex

```bash
npm run codex:monitor                            # http://localhost:4545, sigue la última tarea
npm run codex:task -- "prompt" <esfuerzo> [modelo]
```
