#!/bin/zsh

set -u
unsetopt BG_NICE

ROOT="${0:A:h:h:h}"
STATE_DIR="$ROOT/.dev"
PID_FILE="$STATE_DIR/server.pid"
LOG_FILE="$STATE_DIR/server.log"
PORT="${PORT:-4173}"
HOST="127.0.0.1"
URL="http://$HOST:$PORT"
COMMAND="${1:-start}"

mkdir -p "$STATE_DIR"

line() {
  echo "========================================"
}

project_info() {
  if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Branch: $(git -C "$ROOT" branch --show-current 2>/dev/null || echo unknown)"
    echo "HEAD:   $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  fi
}

saved_pid() {
  if [ -f "$PID_FILE" ]; then
    local pid="$(tr -cd '0-9' < "$PID_FILE")"
    if [ -n "$pid" ]; then
      echo "$pid"
    fi
  fi
}

is_our_process() {
  local pid="$1"
  local process
  process="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  [[ "$process" == *"tooling/dev/serve.mjs"* ]]
}

is_healthy() {
  curl -fsS --max-time 2 "$URL/" >/dev/null 2>&1
}

port_pid() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1
  fi
}

show_status() {
  local pid="$(saved_pid)"
  echo
  echo "=== STATUS ==="
  if [ -n "$pid" ] && is_our_process "$pid" && is_healthy; then
    echo "Home:   HTTP 200"
    echo "Server: running — PID $pid"
    return 0
  fi
  if is_healthy; then
    echo "Home:   HTTP 200"
    echo "Server: another process is responding on :$PORT"
    return 1
  fi
  echo "Home:   unavailable"
  echo "Server: stopped"
  return 1
}

stop_server() {
  local pid="$(saved_pid)"
  if [ -z "$pid" ]; then
    echo "✓ Mycelium server already stopped"
    return 0
  fi
  if ! is_our_process "$pid"; then
    echo "✓ Saved PID $pid is no longer the Mycelium server"
    : > "$PID_FILE"
    return 0
  fi

  echo "Stopping Mycelium — PID $pid"
  kill "$pid" 2>/dev/null || true
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      : > "$PID_FILE"
      echo "✓ Server stopped"
      return 0
    fi
    sleep 0.25
  done
  echo "ERROR: server did not stop. See $LOG_FILE"
  return 1
}

start_server() {
  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: Node.js is required. Install Node.js 20 or later."
    return 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "ERROR: curl is required for the local health check."
    return 1
  fi

  local pid="$(saved_pid)"
  if [ -n "$pid" ] && is_our_process "$pid" && is_healthy; then
    echo "✓ Server is already healthy — PID $pid"
    echo "✓ Reusing it without rebuild or restart"
    return 0
  fi
  if [ -n "$pid" ] && is_our_process "$pid"; then
    echo "Saved server does not match the requested port or health check."
    stop_server || return 1
  fi

  local listener="$(port_pid)"
  if [ -n "$listener" ]; then
    echo "ERROR: port $PORT is already used by PID $listener."
    echo "Set another port with: PORT=4174 $ROOT/tooling/dev/dev.sh"
    return 1
  fi

  echo "Starting Mycelium on :$PORT"
  cd "$ROOT" || return 1
  nohup env PORT="$PORT" node "$ROOT/tooling/dev/serve.mjs" \
    > "$LOG_FILE" 2>&1 < /dev/null &
  pid=$!
  echo "$pid" > "$PID_FILE"

  for _ in {1..80}; do
    if is_healthy; then
      echo "✓ Server healthy — PID $pid"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done

  echo "ERROR: server failed to become healthy."
  tail -80 "$LOG_FILE" 2>/dev/null
  : > "$PID_FILE"
  return 1
}

case "$COMMAND" in
  start)
    line
    echo " MYCELIUM LOCAL DEV — START"
    line
    echo
    project_info
    echo
    echo "=== SERVER ==="
    start_server || exit 1
    ;;
  restart)
    line
    echo " MYCELIUM LOCAL DEV — RESTART"
    line
    echo
    project_info
    echo
    echo "=== STOP OLD SERVER ==="
    stop_server || exit 1
    echo
    echo "=== SERVER ==="
    start_server || exit 1
    ;;
  stop)
    line
    echo " MYCELIUM LOCAL DEV — STOP"
    line
    echo
    stop_server || exit 1
    line
    exit 0
    ;;
  status)
    line
    echo " MYCELIUM LOCAL DEV — STATUS"
    line
    show_status
    result=$?
    echo
    echo "Home: $URL"
    echo "Log:  $LOG_FILE"
    line
    exit "$result"
    ;;
  logs)
    if [ ! -f "$LOG_FILE" ]; then
      echo "No server log yet: $LOG_FILE"
      exit 0
    fi
    tail -f "$LOG_FILE"
    exit $?
    ;;
  *)
    echo "Usage: $ROOT/tooling/dev/dev.sh [start|restart|stop|status|logs]"
    echo "Optional custom port: PORT=4174 $ROOT/tooling/dev/dev.sh start"
    exit 2
    ;;
esac

show_status || exit 1
echo
line
echo " ✓ MYCELIUM LOCAL IS READY"
line
echo
echo "Home:"
echo "$URL"
echo
echo "Server log:"
echo "$LOG_FILE"
echo
echo "Stop server:"
echo "$ROOT/tooling/dev/dev.sh stop"
echo
echo "The terminal can be closed."
line
