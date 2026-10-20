#!/usr/bin/env bash
set -e
echo "=========================================================="
echo "  SnapFlow - Website & GitHub Screenshot Sequencer"
echo "=========================================================="
if [ ! -d "node_modules" ]; then
  echo "[1/2] Installing Node packages and Chromium browser..."
  npm install
  npx playwright install chromium
fi
echo "[2/2] Starting server on http://localhost:3000 ..."
npm start
