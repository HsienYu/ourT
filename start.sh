#!/bin/bash
# ourT — Development Launcher
# Starts Node.js server (App 1 + 3) and optionally the YOLO GUI (App 2).
#
# Usage:
#   ./start.sh          # start both servers
#   ./start.sh --no-yolo  # start Node.js server only

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  ourT — Development Launcher"
echo "  ────────────────────────────────────"

# ── Node.js server ────────────────────────────────────────────────────────────
echo "  Configure API keys and providers in http://localhost:3000/control"

echo "  Starting Node.js server (port 3000)…"
cd "$SCRIPT_DIR/server"
npm start &
SERVER_PID=$!
echo "  Server PID: $SERVER_PID"

# ── YOLO Python GUI ───────────────────────────────────────────────────────────
if [[ "$*" != *"--no-yolo"* ]]; then
  VENV="$SCRIPT_DIR/app2-yolo/venv/bin/activate"
  if [ -f "$VENV" ]; then
    echo "  Starting YOLO Camera GUI (port 3001)…"
    cd "$SCRIPT_DIR/app2-yolo"
    source "$VENV" && python app.py &
    YOLO_PID=$!
    echo "  YOLO PID: $YOLO_PID"
  else
    echo "  YOLO venv not found — skipping App 2."
    echo "  To set up: cd app2-yolo && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
  fi
fi

echo ""
echo "  Servers running. Open in browser:"
echo "    Operator:   http://localhost:3000/control"
echo "    Projection: http://localhost:3000/projection"
echo "    Monitor:    http://localhost:3000/monitor"
echo "    YOLO panel: http://localhost:3001/panel"
echo ""
echo "  Press Ctrl+C to stop all."
echo ""

trap "echo ''; echo '  Stopping…'; kill $SERVER_PID $YOLO_PID 2>/dev/null; exit 0" INT TERM
wait
