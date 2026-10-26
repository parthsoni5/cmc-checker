@echo off
rem Double-click to start Content Compare. Keep this window open while you use the tool;
rem close it (or press Ctrl+C) to stop. Only this computer can reach the server (127.0.0.1).
cd /d "%~dp0"
title Content Compare - close this window to stop

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

rem Open the page after a short pause, once the server is up
start "" /min cmd /c "timeout /t 2 >nul & start "" http://localhost:8765/compare.html"
npx --yes http-server -p 8765 -c-1 -a 127.0.0.1 -s .
