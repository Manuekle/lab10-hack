# Escritorio con una app distinta de SIGECOM (INVENTRA) para medir transferencia sin cambiar el agente.
# /state (puerto 8000) expone el estado sólo al harness; el agente sólo ve la pantalla por VNC.
FROM alpine:3.24
RUN apk add --no-cache tigervnc websockify python3 chromium font-dejavu
WORKDIR /app
COPY server.py index.html start.sh restart-browser.sh ./
RUN chmod +x start.sh restart-browser.sh
EXPOSE 6080 8000
CMD ["/app/start.sh"]
