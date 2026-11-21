#!/usr/bin/env bash
# MortyckHomeAssistent - Linux Startup Script
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "============================================================"
echo "  Starting MortyckHomeAssistent (Linux / Cross-Platform)"
echo "============================================================"

# Ensure logs dir exists
mkdir -p "$ROOT_DIR/logs"

# Resolve Python
PYTHON_BIN="python3"
if [ -f "$ROOT_DIR/venv/bin/python" ]; then
    PYTHON_BIN="$ROOT_DIR/venv/bin/python"
elif [ -f "$ROOT_DIR/venv/bin/python3" ]; then
    PYTHON_BIN="$ROOT_DIR/venv/bin/python3"
fi

# 1. Start go2rtc WebRTC engine
echo "[1/4] Launching go2rtc media engine..."
if [ -f "$ROOT_DIR/docker/go2rtc" ]; then
    chmod +x "$ROOT_DIR/docker/go2rtc"
    "$ROOT_DIR/docker/go2rtc" -config "$ROOT_DIR/docker/go2rtc.yaml" > "$ROOT_DIR/logs/go2rtc.log" 2>&1 &
elif command -v go2rtc >/dev/null 2>&1; then
    go2rtc -config "$ROOT_DIR/docker/go2rtc.yaml" > "$ROOT_DIR/logs/go2rtc.log" 2>&1 &
else
    echo "[WARN] docker/go2rtc binary not found, backend will attempt auto-start."
fi

# 2. Start Blurams RTSP bridge
echo "[2/4] Launching Blurams RTSP Bridge on port 8556..."
if [ -f "$ROOT_DIR/scripts/blurams_bridge.py" ]; then
    "$PYTHON_BIN" "$ROOT_DIR/scripts/blurams_bridge.py" > "$ROOT_DIR/logs/blurams_bridge.log" 2>&1 &
fi

# 3. Check / build frontend if needed
if [ ! -d "$ROOT_DIR/frontend/dist" ]; then
    echo "[3/4] Building production frontend dashboard..."
    (cd "$ROOT_DIR/frontend" && npm run build)
fi

# 4. Start Backend Server (which also serves the frontend on port 4000)
echo "[4/4] Launching Backend server on port 4000..."
(cd "$ROOT_DIR/backend" && npm start > "$ROOT_DIR/logs/backend.log" 2>&1 &)

echo ""
echo "============================================================"
echo "  MortyckHomeAssistent is now RUNNING!"
echo "  - Full Web Dashboard: http://localhost:4000"
echo "  - Backend API:        http://localhost:4000/api"
echo "  - WebSocket:          ws://localhost:4000/ws"
echo "  - go2rtc WebRTC:      http://localhost:1984"
echo "  - Blurams Bridge:     rtsp://127.0.0.1:8556/blurams_garage"
echo ""
echo "  To stop all services cleanly, run ./stop_all.sh"
echo "============================================================"
