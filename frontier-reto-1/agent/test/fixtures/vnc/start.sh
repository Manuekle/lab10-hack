#!/bin/sh
set -e
PASSWORD="${VNC_PASSWORD:-testpass}"
mkdir -p /root/.vnc
printf '%s\n' "$PASSWORD" | vncpasswd -f > /root/.vnc/passwd
chmod 600 /root/.vnc/passwd
Xvnc :1 -geometry 1280x800 -depth 24 -rfbauth /root/.vnc/passwd -SecurityTypes VncAuth -rfbport 5901 -AlwaysShared &
sleep 1
export DISPLAY=:1 LANG=C.UTF-8 LC_ALL=C.UTF-8
xsetroot -solid '#2b4a6f'
# Campo de texto: todo lo tecleado termina en /tmp/typed.txt al pulsar Return.
xterm -u8 -fa 'DejaVu Sans Mono' -fs 14 -geometry 60x10+40+40 -T typed -e sh -c 'while IFS= read -r line; do printf "%s\n" "$line" >> /tmp/typed.txt; done' &
# Registro de clics con marca de tiempo del servidor X.
xev -geometry 400x300+760+60 -event button > /tmp/xev.log &
exec websockify 6080 localhost:5901
