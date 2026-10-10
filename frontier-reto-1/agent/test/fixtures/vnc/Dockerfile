# Escritorio VNC local para probar el driver RFB sin usar el escritorio del evento.
# Xvnc (VncAuth) + websockify en :6080/websockify, un xterm que guarda lo tecleado y xev que registra clics.
FROM alpine:3.24
RUN apk add --no-cache tigervnc websockify xterm xev font-misc-misc font-dejavu xsetroot
COPY start.sh /start.sh
RUN chmod +x /start.sh
EXPOSE 6080
CMD ["/start.sh"]
