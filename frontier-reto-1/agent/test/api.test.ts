import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { Admission } from '../src/admission.ts';
import { createHandler } from '../src/server.ts';
import { TaskStore } from '../src/store.ts';
import type { TaskRun } from '../src/supervisor.ts';

const TOKEN = 'ftr_team_token_0123456789';
const store = TaskStore.open(':memory:');
const admission = new Admission(2);
const started: TaskRun[] = [];
const releases = new Map<string, () => void>();
let ready = true;
let base = '';
const server = http.createServer(
  createHandler({
    teamToken: TOKEN,
    store,
    admission,
    supervisor: {
      start: async (run, release) => {
        started.push(run);
        releases.set(run.id, release);
      },
    },
    isReady: () => ready,
    allowPrivateDesktops: false,
    log: () => {},
  }),
);

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const auth = { Authorization: `Bearer ${TOKEN}` };
const body = (url = 'wss://desk-a.example.com/websockify', password = 'clave-secreta') => JSON.stringify({ tarea: 'Registra al cliente X', escritorio: { url, password } });
const post = (b: string, headers: Record<string, string> = auth) => fetch(`${base}/tasks`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: b });

test('autenticación obligatoria en las tres rutas', async () => {
  for (const [method, path] of [['GET', '/health'], ['POST', '/tasks'], ['GET', '/tasks/abc']] as const) {
    const r1 = await fetch(`${base}${path}`, { method });
    assert.equal(r1.status, 401, `${method} ${path} sin token`);
    const r2 = await fetch(`${base}${path}`, { method, headers: { Authorization: 'Bearer otro-token' } });
    assert.equal(r2.status, 401);
    assert.deepEqual(Object.keys(((await r2.json()) as { error: object }).error), ['code', 'message']);
  }
});

test('health: 200 listo, 503 si no', async () => {
  const r = await fetch(`${base}/health`, { headers: auth });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  ready = false;
  assert.equal((await fetch(`${base}/health`, { headers: auth })).status, 503);
  ready = true;
});

test('POST /tasks: admite en <2 s, registra y lanza sin exponer la contraseña', async () => {
  const t0 = performance.now();
  const r = await post(body());
  const ms = performance.now() - t0;
  assert.equal(r.status, 200);
  const { task_id } = (await r.json()) as { task_id: string };
  assert.ok(ms < 2_000, `admisión ${ms} ms`);
  assert.match(task_id, /^[0-9a-f-]{36}$/);
  await new Promise((r) => setImmediate(r));
  assert.equal(started.at(-1)!.id, task_id);
  assert.equal(started.at(-1)!.desktop.password, 'clave-secreta');
  const g = await fetch(`${base}/tasks/${task_id}`, { headers: auth });
  assert.deepEqual(await g.json(), { estado: 'en_curso', resumen: '' });
  assert.doesNotMatch(JSON.stringify(store.get(task_id)), /clave-secreta/);
  releases.get(task_id)!();
  store.finish(task_id, 'terminada', 'hecho');
});

test('mismo escritorio normalizado: 409; capacidad: 503; sin crear tareas', async () => {
  const a = (await (await post(body('wss://desk-b.example.com/websockify'))).json()) as { task_id: string };
  const dup = await post(body('WSS://DESK-B.example.com:443/websockify/', 'otra'));
  assert.equal(dup.status, 409);
  const b = (await (await post(body('wss://desk-c.example.com/websockify'))).json()) as { task_id: string };
  const full = await post(body('wss://desk-d.example.com/websockify'));
  assert.equal(full.status, 503);
  const count = started.length;
  releases.get(a.task_id)!();
  releases.get(b.task_id)!();
  const again = await post(body('wss://desk-b.example.com/websockify'));
  assert.equal(again.status, 200);
  await new Promise((r) => setImmediate(r));
  assert.equal(started.length, count + 1);
  releases.get(started.at(-1)!.id)!();
});

test('cuerpos inválidos: 422 sin reflejar valores', async () => {
  const cases = [
    'no json',
    JSON.stringify({ tarea: '', escritorio: { url: 'wss://x.example.com', password: 'p' } }),
    JSON.stringify({ tarea: 'x', escritorio: { url: 'https://x.example.com', password: 'p' } }),
    JSON.stringify({ tarea: 'x', escritorio: { url: 'wss://localhost:6080/websockify', password: 'p' } }),
    JSON.stringify({ tarea: 'x', escritorio: { url: 'wss://10.0.0.5/websockify', password: 'p' } }),
    JSON.stringify({ tarea: 'x', escritorio: { url: 'wss://u:secretpw@x.example.com/websockify', password: 'p' } }),
    JSON.stringify({ tarea: 'x', escritorio: { url: 'wss://x.example.com/websockify', password: 5 } }),
    JSON.stringify({ tarea: 'x' }),
  ];
  for (const c of cases) {
    const r = await post(c);
    assert.equal(r.status, 422, c);
    assert.doesNotMatch(await r.text(), /secretpw/);
  }
});

test('GET de tarea inexistente: 404; ruta desconocida: 404; método incorrecto: 405', async () => {
  assert.equal((await fetch(`${base}/tasks/no-existe`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${base}/otra`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${base}/tasks`, { headers: auth })).status, 405);
});
