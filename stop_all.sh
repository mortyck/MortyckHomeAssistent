#!/usr/bin/env bash
# MortyckHomeAssistent - Linux Shutdown Script

echo "============================================================"
echo "  Stopping MortyckHomeAssistent Services"
echo "============================================================"

# Kill go2rtc
pkill -f "go2rtc.*go2rtc.yaml" 2>/dev/null || true

# Kill Blurams bridge
pkill -f "blurams_bridge.py" 2>/dev/null || true

# Kill backend node processes
pkill -f "node.*dist/index.js" 2>/dev/null || true

# Free ports 4000, 3000, 8556, 1984 if still bound
for port in 4000 3000 8556 1984; do
    fuser -k "${port}/tcp" 2>/dev/null || true
done

echo "All MortyckHomeAssistent services stopped cleanly."
