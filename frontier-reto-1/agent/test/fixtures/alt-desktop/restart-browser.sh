#!/bin/sh
# Reinicia el navegador kiosko tras /reset para que la app recargue su estado.
pkill -x chromium 2>/dev/null || true
sleep 1
DISPLAY=:1 nohup chromium --no-sandbox --kiosk --no-first-run --disable-gpu --disable-dev-shm-usage --window-size=1280,800 --window-position=0,0 http://localhost:8000/index.html >/dev/null 2>&1 &
