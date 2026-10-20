# centro-agentes

Panel privado para ver y controlar las sesiones de **Claude Code** y
**Codex** en varias máquinas (MacBook, Mac mini y Windows).

Estado: **fase 2** (panel web en modo local). Ver `docs/superpowers/`.

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
