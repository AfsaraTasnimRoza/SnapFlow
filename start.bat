@echo off
echo ==========================================================
echo   SnapFlow - Website ^& GitHub Screenshot Sequencer
echo ==========================================================
if not exist node_modules (
  echo [1/2] Installing Node packages and Chromium browser...
  call npm install
  call npx playwright install chromium
)
echo [2/2] Starting server on http://localhost:3000 ...
start http://localhost:3000
call npm start
pause
