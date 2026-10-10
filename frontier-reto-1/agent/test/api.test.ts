import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { Admission } from '../src/admission.ts';
import type { FrameSnapshot } from '../src/observatory.ts';
import { createHandler } from '../src/server.ts';
import { TaskStore } from '../src/store.ts';
import type { TaskRun } from '../src/supervisor.ts';

const TOKEN = 'ftr_team_token_0123456789';
const OPENROUTER_KEY = 'or-key-de-prueba-abcdef123456';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const frames = new Map<string, FrameSnapshot>();
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
    frames: { frame: (id) => frames.get(id) },
    secrets: [OPENROUTER_KEY],
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
  assert.equal((await fetch(`${base}/tasks`, { method: 'PUT', headers: auth })).status, 405);
});

// Observatorio (/ui): rutas de sólo lectura con el mismo token; nunca devuelven secretos.
const VIEW_ROUTES = ['/tasks', '/tasks/abc/events', '/tasks/abc/frame.png', '/knowledge', '/ui/incidente.json', '/ui/assets/antes-v39.png'];

test('observatorio: 401 sin token o con token inválido en cada ruta nueva', async () => {
  for (const path of VIEW_ROUTES) {
    const r1 = await fetch(`${base}${path}`);
    assert.equal(r1.status, 401, `${path} sin token`);
    assert.deepEqual(Object.keys(((await r1.json()) as { error: object }).error), ['code', 'message']);
    assert.equal((await fetch(`${base}${path}`, { headers: { Authorization: 'Bearer otro-token' } })).status, 401, `${path} token inválido`);
  }
});

test('observatorio: /ui es pública, sin datos y con CSP estricta', async () => {
  const r = await fetch(`${base}/ui`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/html/);
  const csp = r.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'sha256-/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  const html = await r.text();
  assert.doesNotMatch(html, new RegExp(`${TOKEN}|${OPENROUTER_KEY}`));
  assert.doesNotMatch(html, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/, 'los datos entran al DOM sólo como texto');
  assert.equal((await fetch(`${base}/ui`, { method: 'POST' })).status, 405);
});

test('observatorio: lista, eventos y conocimiento sin secretos ni desktop_key', async () => {
  store.insertTask({ id: 'obs-1', tarea: `Registra al cliente; token ${TOKEN}`, desktopKey: 'wss://desk-secreto.example.com:443/websockify?token=abc' });
  store.addEvent('obs-1', 'step', { step: 1, action: 'click (10,20)', target: 'Botón Entendido del modal', cost: 0.01, inferMs: 900, actMs: 300 });
  store.addEvent('obs-1', 'step', { step: 2, action: `type_text "${OPENROUTER_KEY}"`, target: 'Campo', cost: 0.02 });
  store.addEvent('obs-1', 'verified', { step: 3, target: 'Botón Aplicar', evidence: `Aviso con Bearer ${TOKEN}` });
  store.addEvent('obs-1', 'knowledge_reset', { app: 'sigecom', reason: 'la tarea falló usando lecciones previas' });
  store.saveKnowledge('sigecom', { lessons: `- El menú Comercial abre Clientes\n- Clave ${OPENROUTER_KEY}` });

  const list = (await (await fetch(`${base}/tasks`, { headers: auth })).json()) as { tasks: Array<Record<string, unknown>> };
  const item = list.tasks.find((t) => t.id === 'obs-1')!;
  assert.deepEqual(Object.keys(item).sort(), ['cost', 'created_at', 'estado', 'fase', 'finished_at', 'id', 'resumen', 'steps', 'tarea']);
  assert.equal(item.steps, 3);
  assert.equal(item.cost, 0.03);

  const ev = await fetch(`${base}/tasks/obs-1/events`, { headers: auth });
  assert.equal(ev.status, 200);
  const evBody = (await ev.json()) as { task: { id: string }; events: Array<{ stage: string }> };
  assert.equal(evBody.task.id, 'obs-1');
  assert.deepEqual(evBody.events.map((e) => e.stage), ['step', 'step', 'verified', 'knowledge_reset']);

  const know = (await (await fetch(`${base}/knowledge`, { headers: auth })).json()) as { apps: Array<{ app: string; lessons: string[] }>; history: Array<{ stage: string }> };
  assert.equal(know.apps.find((a) => a.app === 'sigecom')!.lessons.length, 2);
  assert.ok(know.history.some((h) => h.stage === 'knowledge_reset'));

  for (const text of [JSON.stringify(list), JSON.stringify(evBody), JSON.stringify(know)]) {
    assert.doesNotMatch(text, new RegExp(`${TOKEN}|${OPENROUTER_KEY}|desk-secreto|desktop`));
  }
  assert.equal((await fetch(`${base}/tasks/no-existe/events`, { headers: auth })).status, 404);
});

test('observatorio: frame.png devuelve la última captura con la marca del clic, sin secretos', async () => {
  assert.equal((await fetch(`${base}/tasks/obs-1/frame.png`, { headers: auth })).status, 404);
  frames.set('obs-1', { png: PNG, width: 1280, height: 800, at: 1_700_000_000_000, action: 'click', points: [[840, 483]] });
  const r = await fetch(`${base}/tasks/obs-1/frame.png`, { headers: auth });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-frame-points'), '840,483');
  assert.equal(r.headers.get('x-frame-size'), '1280x800');
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), PNG);
  assert.doesNotMatch(JSON.stringify([...r.headers]), new RegExp(`${TOKEN}|${OPENROUTER_KEY}`));
});

test('observatorio: contrato del evaluador intacto', async () => {
  assert.deepEqual(await (await fetch(`${base}/health`, { headers: auth })).json(), { ok: true });
  assert.deepEqual(await (await fetch(`${base}/tasks/obs-1`, { headers: auth })).json(), { estado: 'en_curso', resumen: '' });
  const r = await post(body('wss://desk-z.example.com/websockify'));
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys((await r.json()) as object), ['task_id']);
  await new Promise((r) => setImmediate(r));
  releases.get(started.at(-1)!.id)!();
});
