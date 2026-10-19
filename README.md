# centro-agentes

Panel privado para ver y controlar las sesiones de **Claude Code** y
**Codex** en varias máquinas (MacBook, Mac mini y Windows).

Estado: **fase 1** (base y lectores). Ver `docs/superpowers/`.

## Desarrollo

```bash
npm install
npm test             # vitest
npm run lint
npm run build
npm run instantanea  # JSON con todo lo que el agente ve en esta máquina
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
