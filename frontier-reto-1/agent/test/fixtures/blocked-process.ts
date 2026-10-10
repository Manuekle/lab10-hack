// Proceso que ignora mensajes y SIGTERM: sólo SIGKILL lo detiene.
process.on('SIGTERM', () => {});
process.on('message', () => {});
setInterval(() => {}, 1_000);
