// Punto de entrada del servicio: configuración, recuperación, HTTP y parada ordenada.
import http from 'node:http';
import { Admission } from './admission.ts';
import { ConfigError, loadServiceConfig } from './config.ts';
import { Child, siblingModule, type DriverRequest, type DriverResponse, type WorkerRequest, type WorkerResponse } from './ipc.ts';
import { OpenRouterClient } from './model/openrouter.ts';
import { Observatory } from './observatory.ts';
import { log } from './redact.ts';
import { createHandler } from './server.ts';
import { TaskStore } from './store.ts';
import { Supervisor } from './supervisor.ts';

let config;
try {
  config = loadServiceConfig();
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : 'No se pudo cargar la configuración');
  process.exit(1);
}
const secrets = [config.teamToken, config.openrouterApiKey];
const allowPrivate = process.env.ALLOW_PRIVATE_DESKTOPS === 'true';

const store = TaskStore.open(config.databasePath);
const recovered = store.recoverInterrupted();
const admission = new Admission(config.limits.maxActiveTasks);
// UI de observación (/ui): última captura por tarea y lecciones aprendidas u olvidadas, enganchado sin tocar el supervisor.
const observatory = new Observatory(store);
// Los hijos no heredan secretos del servicio por entorno: el worker recibe sólo la clave de OpenRouter por IPC.
const childEnv = { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV ?? 'production' };
// Aprendizaje: extracción de lecciones de UI con el modelo barato, fuera de la ruta crítica de cada tarea.
const learner = new OpenRouterClient({
  apiKey: config.openrouterApiKey,
  model: config.openrouterFallbackModel ?? config.openrouterModel,
  timeoutMs: 20_000,
  attempts: 1,
});
const supervisor = new Supervisor({
  store,
  config,
  secrets,
  allowPrivateDesktops: allowPrivate,
  // RFB_ZRLE=false vuelve a Raw sin cambiar código (válvula de seguridad).
  zrle: process.env.RFB_ZRLE !== 'false',
  learner,
  log: (event, data, logSecrets) => {
    log(event, data, logSecrets);
    observatory.onLog(event, data, logSecrets);
  },
  spawnDriver: () => observatory.watchDriver(Child.spawn<DriverRequest, DriverResponse>(siblingModule(import.meta.url, 'driver'), { env: childEnv })),
  spawnWorker: () => Child.spawn<WorkerRequest, WorkerResponse>(siblingModule(import.meta.url, 'worker'), { env: childEnv }),
});

let ready = false;
const server = http.createServer(
  createHandler({
    teamToken: config.teamToken,
    store,
    admission,
    supervisor: { start: (run, release) => observatory.track(run.id, () => supervisor.start(run, release)) },
    isReady: () => ready,
    allowPrivateDesktops: allowPrivate,
    log: (event, data) => log(event, data, secrets),
    frames: observatory,
    secrets,
  }),
);
server.keepAliveTimeout = 65_000;
// Contra clientes lentos que retienen conexiones: el contrato sólo usa cuerpos pequeños.
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.listen(config.port, '0.0.0.0', () => {
  ready = true;
  log('service_ready', { port: config.port, model: config.openrouterModel, fallback: config.openrouterFallbackModel, recovered, allowPrivate, zrle: process.env.RFB_ZRLE !== 'false' });
});

let stopping = false;
async function shutdown(signal: string, code = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  ready = false;
  log('service_stopping', { signal, active: supervisor.active });
  server.close();
  // Tope propio por si algo se cuelga: Railway reinicia el contenedor al salir con error.
  setTimeout(() => process.exit(code || 1), 9_000).unref();
  await supervisor.stopAll('el servicio se detuvo antes de terminar');
  store.close();
  process.exit(code);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
// Un error inesperado no debe dejar el servicio a medias: parada ordenada y salida con error para que la plataforma lo reinicie.
process.on('uncaughtException', (e) => {
  log('uncaught_exception', { error: e instanceof Error ? e.message : String(e) }, secrets);
  void shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (e) => {
  log('unhandled_rejection', { error: e instanceof Error ? e.message : String(e) }, secrets);
  void shutdown('unhandledRejection', 1);
});
