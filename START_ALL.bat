@echo off
title MortyckHomeAssistent - Startup
setlocal enabledelayedexpansion

echo ============================================================
echo   Starting MortyckHomeAssistent (Tablet Hub)
echo ============================================================
echo.

set ROOT_DIR=%~dp0

:: 1. Start go2rtc streaming engine (minimized)
echo [1/4] Launching go2rtc WebRTC media engine...
if exist "%ROOT_DIR%docker\go2rtc.exe" (
    start "MortyckHomeAssistent - go2rtc" /min "%ROOT_DIR%docker\go2rtc.exe" -config "%ROOT_DIR%docker\go2rtc.yaml"
) else (
    echo [WARN] docker\go2rtc.exe not found, skipping standalone go2rtc.
)

:: 2. Start Blurams RTSP Bridge (minimized)
echo [2/4] Launching Blurams RTSP Bridge on port 8556...
if exist "%ROOT_DIR%scripts\blurams_bridge.py" (
    start "MortyckHomeAssistent - Blurams Bridge" /min python "%ROOT_DIR%scripts\blurams_bridge.py"
)

:: 3. Start Backend Server (minimized, persistent)
echo [3/4] Launching Backend server on port 4000...
start "MortyckHomeAssistent - Backend" /min cmd /k "cd /d %ROOT_DIR%backend && node dist\index.js"

:: 4. Start Frontend UI (minimized, persistent)
echo [4/4] Launching Frontend PWA on port 3000...
start "MortyckHomeAssistent - Frontend" /min cmd /k "cd /d %ROOT_DIR%frontend && npm run dev"

echo.
echo Waiting 4 seconds for services to initialize...
ping -n 5 127.0.0.1 >nul

:: Open dashboard in default browser
echo Opening MortyckHomeAssistent Dashboard at http://localhost:3000 ...
start http://localhost:3000

echo.
echo ============================================================
echo   MortyckHomeAssistent is now RUNNING!
echo   - Web Dashboard:   http://localhost:3000
echo   - Backend API:     http://localhost:4000/api
echo   - WebSocket:       ws://localhost:4000/ws
echo   - go2rtc WebRTC:   http://localhost:1984
echo   - Blurams Bridge:  rtsp://127.0.0.1:8556/blurams_garage
echo.
echo   To stop all services cleanly, run STOP_ALL.bat
echo ============================================================
ping -n 3 127.0.0.1 >nul
exit /b 0
