#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/battleship"
BRANCH="master"

echo "==> Deploying battleship to $(date -u +%FT%TZ)"
cd "$APP_DIR"

echo "[1/4] git pull"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "[2/4] npm install --production"
npm install --production

echo "[3/4] (re)start via pm2"
if command -v pm2 >/dev/null 2>&1; then
  if pm2 show battleship >/dev/null 2>&1; then
    pm2 reload ecosystem.config.js --env production
  else
    pm2 start ecosystem.config.js --env production
    pm2 save
  fi
else
  echo "pm2 not found, falling back to PORT=3000 npm start (background)"
  PORT=3000 nohup npm start > app.log 2>&1 &
fi

echo "[4/4] status"
command -v pm2 >/dev/null 2>&1 && pm2 status || true

echo "==> Done"
