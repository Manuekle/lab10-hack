#!/bin/sh
set -e
PASSWORD="${VNC_PASSWORD:-testpass}"
mkdir -p /root/.vnc
printf '%s\n' "$PASSWORD" | vncpasswd -f > /root/.vnc/passwd
chmod 600 /root/.vnc/passwd
Xvnc :1 -geometry 1280x800 -depth 24 -rfbauth /root/.vnc/passwd -SecurityTypes VncAuth -rfbport 5901 -AlwaysShared &
sleep 1
export DISPLAY=:1
cd /app && python3 server.py &
sleep 1
chromium --no-sandbox --kiosk --no-first-run --disable-gpu --disable-dev-shm-usage --window-size=1280,800 --window-position=0,0 http://localhost:8000/index.html >/dev/null 2>&1 &
exec websockify 6080 localhost:5901
