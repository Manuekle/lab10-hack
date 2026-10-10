import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { Child, type DriverRequest, type DriverResponse, type FramePayload } from '../src/ipc.ts';
import { Observatory } from '../src/observatory.ts';
import { TaskStore } from '../src/store.ts';
import { Supervisor, type DriverChild, type WorkerChild } from '../src/supervisor.ts';

type Driver = Child<DriverRequest, DriverResponse>;

function payload(n: number, extra: Partial<FramePayload> = {}): FramePayload {
  return { width: 100, height: 50, png: new Uint8Array([n]), changed: 0.5, slowdownMs: 0, ...extra };
}

// Driver falso: devuelve capturas numeradas en orden.
function fakeDriver(frames: FramePayload[]): Driver {
  let i = 0;
  return { request: async () => ({ type: 'frame', frame: frames[i++]! }) } as unknown as Driver;
}

test('watchDriver: guarda la última captura de la tarea en curso con el punto de la acción', async () => {
  const obs = new Observatory(TaskStore.open(':memory:'), () => 42);
  const driver = await obs.track('t1', async () => obs.watchDriver(fakeDriver([payload(1), payload(2), payload(3), payload(4, { skipped: true })])));
  const opts = { timeoutMs: 1_000 };
  await driver.request({ type: 'connect', url: 'ws://x', password: 'p', allowPrivate: true, slowdownMs: 0, zrle: true }, opts);
  assert.deepEqual(obs.frame('t1')!.points, []);
  await driver.request({ type: 'execute', action: { type: 'click', x: 10, y: 20 } }, opts);
  assert.deepEqual({ ...obs.frame('t1')!, png: [...obs.frame('t1')!.png] }, { png: [2], width: 100, height: 50, at: 42, action: 'click', points: [[10, 20]] });
  // Una observación posterior conserva la marca de la última acción.
  await driver.request({ type: 'observe' }, opts);
  assert.deepEqual(obs.frame('t1')!.points, [[10, 20]]);
  assert.deepEqual([...obs.frame('t1')!.png], [3]);
  // Si la acción no se ejecutó (reconexión), no hay marca.
  await driver.request({ type: 'execute', action: { type: 'click', x: 1, y: 1 } }, opts);
  assert.deepEqual(obs.frame('t1')!.points, []);
});

test('watchDriver: fuera de una tarea no envuelve; guarda pocas tareas a la vez', async () => {
  const obs = new Observatory(TaskStore.open(':memory:'));
  const plain = fakeDriver([payload(1)]);
  assert.equal(obs.watchDriver(plain), plain);
  for (let n = 0; n < 9; n++) {
    const d = obs.track(`t${n}`, () => obs.watchDriver(fakeDriver([payload(n)])));
    await d.request({ type: 'observe' }, { timeoutMs: 1_000 });
  }
  assert.equal(obs.frame('t0'), undefined);
  assert.equal(obs.frame('t2'), undefined);
  assert.ok(obs.frame('t3'));
  assert.ok(obs.frame('t8'));
});

test('onLog: persiste aprendizaje y olvidos como eventos, redactados; ignora el resto', () => {
  const store = TaskStore.open(':memory:');
  store.insertTask({ id: 't1', tarea: 'x', desktopKey: 'k' });
  const obs = new Observatory(store);
  obs.onLog('task_app', { task_id: 't1', app: 'sigecom', knownLessons: 3 }, []);
  obs.onLog('knowledge_reset', { task_id: 't1', app: 'sigecom', reason: 'falló con clave-del-escritorio' }, ['clave-del-escritorio']);
  obs.onLog('task_step', { task_id: 't1', step: 1 }, []);
  obs.onLog('knowledge_updated', { app: 'sin tarea' }, []);
  obs.onLog('knowledge_updated', { task_id: 'no-existe', app: 'x' }, []); // FK: no debe lanzar
  assert.deepEqual(store.events('t1').map((e) => [e.stage, e.data]), [
    ['app', { app: 'sigecom', knownLessons: 3 }],
    ['knowledge_reset', { app: 'sigecom', reason: 'falló con [redactado]' }],
  ]);
});

// Mismo cableado que main.ts: el supervisor no sabe nada del observatorio.
test('con el supervisor real: última captura con el clic; conexión, app y aprendizaje como eventos', async () => {
  const fx = (name: string) => path.resolve(import.meta.dirname, 'fixtures', name);
  const store = TaskStore.open(':memory:');
  const obs = new Observatory(store);
  const script = [{ action: { type: 'click', x: 5, y: 7 } }, { action: { type: 'finish', status: 'terminada', summary: 'Listo.', answer: null } }];
  const sup = new Supervisor({
    store,
    config: {
      openrouterApiKey: 'sk-or-v1-testkey',
      openrouterModel: 'm',
      openrouterFallbackModel: undefined,
      openrouterCoords: 'pixel',
      limits: { revokeMs: 3_000, hardStopMs: 4_000, inferenceTimeoutMs: 1_000, inferenceAttempts: 1, maxProposals: 10, maxActiveTasks: 2 },
    },
    secrets: [],
    log: (event, data, secrets) => obs.onLog(event, data, secrets),
    spawnDriver: () => obs.watchDriver(Child.spawn(fx('fake-driver.ts'), { env: { ...process.env, FAKE_DRIVER: 'normal' } }) as DriverChild),
    spawnWorker: () => Child.spawn(fx('fake-worker.ts'), { env: { ...process.env, FAKE_SCRIPT: JSON.stringify(script), FAKE_WORKER: 'fake' } }) as WorkerChild,
  });
  store.insertTask({ id: 't1', tarea: 'tarea', desktopKey: 'k' });
  await obs.track('t1', () => sup.start({ id: 't1', tarea: 'tarea', desktop: { url: 'wss://d.example/websockify', password: 'p' }, receivedAt: performance.now() }, () => {}));
  const f = obs.frame('t1')!;
  assert.equal(f.width, 64);
  assert.deepEqual(f.points, [[5, 7]]);
  assert.equal(f.action, 'click');
  assert.deepEqual(store.events('t1').map((e) => e.stage), ['connected', 'app', 'step', 'finish', 'knowledge_updated']);
  assert.equal(store.get('t1')!.estado, 'terminada');
});
