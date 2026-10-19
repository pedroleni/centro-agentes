#!/usr/bin/env node
// Tiny local dashboard that tails a `codex exec --json` log file and serves
// it live over HTTP, auto-refreshing every second. Dev tooling only — not
// part of the shipped app. See README.md "Ver a Codex trabajar en vivo".
//
// Usage:
//   node scripts/dev/codex-monitor.mjs                 # watches the newest
//                                                       # file in .codex-logs/
//   node scripts/dev/codex-monitor.mjs <path> [port]    # watch a specific log
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..')
const logsDir = path.join(projectRoot, '.codex-logs')

const argPath = process.argv[2] && !process.argv[2].match(/^\d+$/) ? process.argv[2] : null
const port = Number(process.argv[3] || (argPath ? process.argv[2] : null) || 4545) || 4545

function findLatestLog() {
  if (!fs.existsSync(logsDir)) return null
  const files = fs
    .readdirSync(logsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(logsDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  return files[0] ? path.join(logsDir, files[0].f) : null
}

// Sin ruta explícita, el monitor sigue siempre el log más reciente: cuando
// arranca otra tarea de Codex, la página se vacía y pasa a la nueva sola.
const currentLog = () => argPath || findLatestLog()

const HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Codex monitor</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: ui-monospace, "SF Mono", Menlo, monospace;
    background: #0b0d12; color: #d7dbe0; font-size: 13px;
  }
  header {
    position: sticky; top: 0; background: #11141a; border-bottom: 1px solid #23262e;
    padding: 10px 16px; display: flex; align-items: center; gap: 10px; z-index: 1;
  }
  header .dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
  header .dot.done { background: #64748b; }
  header .title { font-weight: 600; color: #f1f5f9; }
  header .path { color: #64748b; font-size: 11px; }
  header .meta { color: #94a3b8; font-size: 11px; }
  main { padding: 16px; max-width: 980px; margin: 0 auto; }
  .item { margin-bottom: 10px; border-radius: 8px; overflow: hidden; border: 1px solid #23262e; }
  .item .head {
    padding: 8px 12px; background: #14171d; display: flex; gap: 8px; align-items: center;
    cursor: pointer; user-select: none;
  }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; letter-spacing: .02em; }
  .badge.msg { background: #1e3a5f; color: #7dd3fc; }
  .badge.cmd { background: #3f2e1e; color: #fbbf24; }
  .badge.done { background: #14321f; color: #4ade80; }
  .head .summary { color: #9aa4b2; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .body { padding: 10px 14px; background: #0e1015; white-space: pre-wrap; word-break: break-word; display: none; border-top: 1px solid #23262e; }
  .item.open .body { display: block; }
  .msgtext { color: #e2e8f0; padding: 10px 14px; white-space: pre-wrap; }
  .cmdline { color: #fbbf24; margin-bottom: 6px; }
  .usage { color: #64748b; font-size: 11px; margin-top: 20px; padding-top: 10px; border-top: 1px dashed #23262e; }
  footer { text-align: center; color: #475569; padding: 20px; font-size: 11px; }
</style>
</head>
<body>
<header>
  <span class="dot" id="dot"></span>
  <span class="title">Codex monitor</span>
  <span class="path" id="path"></span>
  <span class="meta" id="meta"></span>
</header>
<main id="feed"></main>
<footer>actualiza cada 1s · dev tool local, no forma parte de la app</footer>
<script>
let offset = 0
let log = null
const feed = document.getElementById('feed')
const dot = document.getElementById('dot')
const meta = document.getElementById('meta')
const pathEl = document.getElementById('path')
pathEl.textContent = 'esperando a que Codex arranque una tarea…'

function badge(type) {
  if (type === 'command_execution') return '<span class="badge cmd">CMD</span>'
  if (type === 'agent_message') return '<span class="badge msg">MSG</span>'
  const span = document.createElement('span')
  span.className = 'badge'
  span.textContent = type
  return span.outerHTML
}

function renderItem(evt) {
  const item = evt.item || {}
  const div = document.createElement('div')
  div.className = 'item'
  if (item.type === 'agent_message') {
    div.innerHTML = '<div class="head" style="cursor:default">' + badge(item.type) +
      '<span class="summary">agent</span></div><div class="msgtext"></div>'
    div.querySelector('.msgtext').textContent = item.text || ''
  } else if (item.type === 'command_execution') {
    const cmd = (item.command || '').slice(0, 90)
    div.innerHTML = '<div class="head">' + badge(item.type) +
      '<span class="summary"></span></div><div class="body"><div class="cmdline"></div><div class="out"></div></div>'
    div.querySelector('.summary').textContent = cmd
    div.querySelector('.cmdline').textContent = '$ ' + (item.command || '')
    div.querySelector('.out').textContent = item.aggregated_output || '(sin output aún)'
    div.querySelector('.head').onclick = () => div.classList.toggle('open')
  } else {
    div.innerHTML = '<div class="head" style="cursor:default">' + badge(item.type || evt.type) +
      '<span class="summary"></span></div>'
    div.querySelector('.summary').textContent = JSON.stringify(item).slice(0, 200)
  }
  feed.appendChild(div)
}

function renderUsage(evt) {
  const div = document.createElement('div')
  div.className = 'usage'
  const u = evt.usage || {}
  div.textContent = 'turn completado — input: ' + (u.input_tokens ?? '?') +
    ' (cache: ' + (u.cached_input_tokens ?? 0) + ') · output: ' + (u.output_tokens ?? '?') +
    ' · reasoning: ' + (u.reasoning_output_tokens ?? 0)
  feed.appendChild(div)
  dot.classList.add('done')
}

async function poll() {
  try {
    const res = await fetch('/events?offset=' + offset)
    const data = await res.json()
    if (data.log !== log) {
      log = data.log
      offset = 0
      feed.innerHTML = ''
      dot.classList.remove('done')
      pathEl.textContent = log || 'esperando a que Codex arranque una tarea…'
      setTimeout(poll, 0)
      return
    }
    offset = data.offset
    for (const line of data.lines) {
      try {
        const evt = JSON.parse(line)
        if (evt.type === 'task_meta') {
          meta.textContent = 'model: ' + (evt.model || 'default') + ' · effort: ' + (evt.effort || '?')
        } else if (evt.type === 'item.completed') renderItem(evt)
        else if (evt.type === 'turn.completed') renderUsage(evt)
      } catch {}
    }
    if (data.lines.length) window.scrollTo(0, document.body.scrollHeight)
  } catch {}
  setTimeout(poll, 1000)
}
poll()
</script>
</body>
</html>`

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(HTML)
    return
  }
  if (url.pathname === '/events') {
    const offset = Number(url.searchParams.get('offset') || 0)
    const logPath = currentLog()
    const log = logPath ? path.relative(projectRoot, logPath) : null
    let content = ''
    try {
      const stat = fs.statSync(logPath)
      if (stat.size > offset) {
        const fd = fs.openSync(logPath, 'r')
        const buf = Buffer.alloc(stat.size - offset)
        fs.readSync(fd, buf, 0, buf.length, offset)
        fs.closeSync(fd)
        content = buf.toString('utf8')
      }
      const lines = content.split('\n').filter((l) => l.trim().startsWith('{'))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ log, offset: stat.size, lines }))
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ log, offset, lines: [] }))
    }
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Codex monitor: http://localhost:${port}  (sigue el log más reciente de .codex-logs/)`)
})
