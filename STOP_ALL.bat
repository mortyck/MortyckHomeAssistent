@echo off
title MortyckHomeAssistent - Shutdown
setlocal enabledelayedexpansion

echo ============================================================
echo   Stopping MortyckHomeAssistent Services
echo ============================================================
echo.

:: 1. Terminate go2rtc.exe
echo [1/3] Stopping go2rtc media engine...
taskkill /F /IM go2rtc.exe 2>nul
if %errorlevel% equ 0 (
    echo       go2rtc terminated.
) else (
    echo       go2rtc was not running.
)

:: 2. Terminate processes on port 4000 (Backend)
echo [2/3] Freeing Backend port 4000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
    echo       Backend PID %%a terminated.
)

:: 3. Terminate processes on port 3000 (Frontend)
echo [3/4] Freeing Frontend port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
    echo       Frontend PID %%a terminated.
)

:: 4. Terminate processes on port 8556 (Blurams RTSP Bridge)
echo [4/4] Freeing Blurams Bridge port 8556...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8556 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
    echo       Blurams Bridge PID %%a terminated.
)

:: Also kill cmd windows by title
taskkill /F /FI "WINDOWTITLE eq MortyckHomeAssistent - Backend*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq MortyckHomeAssistent - Frontend*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq MortyckHomeAssistent - go2rtc*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq MortyckHomeAssistent - Blurams Bridge*" >nul 2>&1

echo.
echo ============================================================
echo   All MortyckHomeAssistent services stopped cleanly.
echo ============================================================
echo.
ping -n 3 127.0.0.1 >nul
exit /b 0
