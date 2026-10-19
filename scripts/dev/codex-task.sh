#!/usr/bin/env bash
# Launch a `codex exec` task with this project's standard flags and log to
# .codex-logs/ (gitignored) so scripts/dev/codex-monitor.mjs can tail it live.
#
# Why these flags, not just `codex exec "<prompt>"`:
# - `< /dev/null`: closes stdin. Without it, a background-launched codex exec
#   can hang indefinitely waiting for stdin EOF that never comes — happened
#   for real during development, cost ~30 minutes before it was diagnosed.
# - `--json`: streams structured events as they happen instead of buffering
#   all output until the process exits, which is what makes live monitoring
#   possible at all.
# - `-c model_reasoning_effort=...`: don't leave every task on the default —
#   pick per task (low for mechanical/well-scoped work, medium/high for
#   security-sensitive or ambiguous work) to avoid burning tokens on
#   reasoning effort a simple task doesn't need.
#
# Usage:
#   scripts/dev/codex-task.sh "<prompt>" [reasoning_effort] [model]
#   scripts/dev/codex-task.sh "Add a groupBy helper in src/lib/utils" low
#
# Then, in another terminal:
#   npm run codex:monitor

set -euo pipefail

PROMPT="${1:?Usage: codex-task.sh \"<prompt>\" [reasoning_effort] [model]}"
EFFORT="${2:-medium}"

# Los flags se acumulan en un array que NUNCA queda vacío (siempre lleva al
# menos `exec`). Es deliberado: macOS trae bash 3.2, donde expandir un array
# vacío con "${arr[@]}" bajo `set -u` aborta con "unbound variable" — bash
# 4.4+ ya no lo hace, así que el fallo solo aparece en macOS. Pasó de verdad:
# la primera versión de este script montaba un MODEL_ARGS=() aparte y moría
# antes de lanzar codex siempre que no se pasaba modelo explícito.
CODEX_ARGS=(exec --sandbox workspace-write --json -c model_reasoning_effort="$EFFORT")
if [ -n "${3:-}" ]; then
  CODEX_ARGS+=(-m "$3")
fi
CODEX_ARGS+=("$PROMPT")

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

mkdir -p .codex-logs
LOGFILE=".codex-logs/$(date +%Y%m%d-%H%M%S)-task.jsonl"

# codex's npm-global bin isn't always on PATH in non-interactive/background
# shells even when it is in an interactive one — add it defensively, but only
# if codex isn't already resolvable, para no pisar una instalación distinta
# (ni impedir sustituirlo por un stub al probar este script).
if ! command -v codex >/dev/null 2>&1; then
  export PATH="$HOME/.npm-global/bin:$PATH"
fi

echo "Log: $LOGFILE"
echo "Monitor: npm run codex:monitor"
echo

node -e 'process.stdout.write(JSON.stringify({ type: "task_meta", effort: process.argv[1], model: process.argv[2], prompt: process.argv[3] }) + "\n")' \
  "$EFFORT" "${3:-default}" "$PROMPT" > "$LOGFILE"

codex "${CODEX_ARGS[@]}" < /dev/null | tee -a "$LOGFILE"
