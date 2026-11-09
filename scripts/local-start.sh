#!/usr/bin/env bash
# SkillForge local start/stop/reset (POSIX bash)
# Usage: scripts/local-start.sh <start|stop|reset>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERB="${1:-start}"
PORT="${SKILLFORGE_PORT:-8787}"
DATA_DIR="${SKILLFORGE_DATA_DIR:-$ROOT/data}"

required_node_range() {
  node -e "const p=require('./package.json'); process.stdout.write(String(p.engines.node))"
}

check_node_engine() {
  local range actual need have
  range="$(required_node_range)"
  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: Node.js is not installed or not on PATH. Required: $range" >&2
    exit 1
  fi
  actual="$(node -v)"
  need="$(printf '%s' "$range" | sed -n 's/[^0-9]*\([0-9][0-9]*\).*/\1/p')"
  have="$(printf '%s' "$actual" | sed -n 's/v*\([0-9][0-9]*\).*/\1/p')"
  if [ -n "$need" ] && [ -n "$have" ] && [ "$have" -lt "$need" ]; then
    echo "ERROR: Node version $actual does not satisfy engines.node '$range' (required major >= $need)." >&2
    exit 1
  fi
}

port_busy() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :$p )" 2>/dev/null | grep -q ":$p"
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -E "[:.]$p[[:space:]].*LISTEN" >/dev/null
    return $?
  fi
  return 1
}

stop_port() {
  local p="$1"
  if ! port_busy "$p"; then
    echo "No process listening on port $p."
    return 0
  fi
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "${p}/tcp" 2>/dev/null || true)"
  fi
  if [ -n "$pids" ]; then
    # Only the SkillForge server process is stopped; anything else on the port is left alone.
    for pid in $pids; do
      if ! ps -o args= -p "$pid" 2>/dev/null | grep -Eq 'packages/server/dist/index\.js'; then
        echo "ERROR: port $p is busy by PID $pid ($(ps -o comm= -p "$pid" 2>/dev/null)), which is not the SkillForge server. Not stopping it." >&2
        exit 1
      fi
    done
    echo "Stopping SkillForge server PID(s) $pids on port $p..."
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.5
  else
    echo "ERROR: port $p is in use but neither lsof nor fuser is available to stop it. Free the port manually." >&2
    exit 1
  fi
  if port_busy "$p"; then
    echo "ERROR: port $p is still in use after stop. Free it manually, then retry." >&2
    exit 1
  fi
  echo "Stopped listener(s) on port $p."
}

case "$VERB" in
  start)
    check_node_engine
    if port_busy "$PORT"; then
      echo "ERROR: port $PORT is already in use. Run 'npm run local:stop' or set SKILLFORGE_PORT to another free port." >&2
      exit 1
    fi
    echo "Building SkillForge..."
    npm run build
    echo "Starting SkillForge on port $PORT (foreground). Data dir: $DATA_DIR"
    echo "Initial admin password (if generated) is saved to $DATA_DIR/initial-admin-password.txt"
    npm start
    ;;
  stop)
    stop_port "$PORT"
    ;;
  reset)
    if port_busy "$PORT"; then
      echo "ERROR: server still listening on port $PORT. Run 'npm run local:stop' before reset." >&2
      exit 1
    fi
    if [ "${LOCAL_RESET_CONFIRM:-}" != "1" ]; then
      echo "ERROR: reset deletes the data directory ($DATA_DIR)." >&2
      echo "Set LOCAL_RESET_CONFIRM=1 to confirm, then re-run: LOCAL_RESET_CONFIRM=1 npm run local:reset" >&2
      exit 1
    fi
    if [ -d "$DATA_DIR" ]; then
      # Delete only a SkillForge data directory.
      full="$(cd "$DATA_DIR" && pwd -P)"
      if [ "$full" = "/" ] || [ "$full" = "$(cd "$HOME" && pwd -P)" ] || [ "$full" = "$(cd "$ROOT" && pwd -P)" ]; then
        echo "ERROR: refusing to delete $full (root, home or repository directory)." >&2
        exit 1
      fi
      if [ ! -e "$full/skillforge.db" ] && [ ! -d "$full/blobs" ]; then
        echo "ERROR: $full does not look like a SkillForge data directory (no skillforge.db or blobs/). Nothing deleted." >&2
        exit 1
      fi
      rm -rf "$full"
      echo "Removed data directory: $DATA_DIR"
      echo "Next 'npm run local:start' will re-seed the admin user."
    else
      echo "Data directory already absent: $DATA_DIR"
    fi
    ;;
  *)
    echo "Usage: $0 <start|stop|reset>" >&2
    exit 1
    ;;
esac
