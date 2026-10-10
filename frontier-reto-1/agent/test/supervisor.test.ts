import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Child } from '../src/ipc.ts';
import type { Limits } from '../src/config.ts';
import { TaskStore } from '../src/store.ts';
import { Supervisor, type DriverChild, type WorkerChild } from '../src/supervisor.ts';

const fx = (name: string) => path.resolve(import.meta.dirname, 'fixtures', name);
const limits = (over: Partial<Limits> = {}): Limits => ({
  revokeMs: 1_500,
  hardStopMs: 2_500,
  inferenceTimeoutMs: 1_000,
  inferenceAttempts: 1,
  maxProposals: 10,
  maxActiveTasks: 2,
  ...over,
});

function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function setup(opts: { script?: unknown[]; worker?: 'fake' | 'hang' | 'blocked'; driver?: 'normal' | 'hang-execute' | 'ignore-close' | 'disconnect-once' | 'blocked'; limits?: Partial<Limits>; tarea?: string; store?: TaskStore }) {
  const store = opts.store ?? TaskStore.open(':memory:');
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sup-')), 'driver.log');
  const children: Array<DriverChild | WorkerChild> = [];
  const logs: Array<{ event: string; data: Record<string, unknown> }> = [];
  const sup = new Supervisor({
    store,
    config: { openrouterApiKey: 'sk-or-v1-testkey', openrouterModel: 'm', openrouterFallbackModel: undefined, openrouterCoords: 'pixel', limits: limits(opts.limits) },
    secrets: ['ftr_teamtoken123456'],
    spawnDriver: () => {
      const c: DriverChild =
        opts.driver === 'blocked'
          ? Child.spawn(fx('blocked-process.ts'))
          : Child.spawn(fx('fake-driver.ts'), { env: { ...process.env, FAKE_DRIVER: opts.driver ?? 'normal', FAKE_LOG: logFile } });
      children.push(c);
      return c;
    },
    spawnWorker: () => {
      const c: WorkerChild =
        opts.worker === 'blocked'
          ? Child.spawn(fx('blocked-process.ts'))
          : Child.spawn(fx('fake-worker.ts'), { env: { ...process.env, FAKE_SCRIPT: JSON.stringify(opts.script ?? []), FAKE_WORKER: opts.worker ?? 'fake' } });
      children.push(c);
      return c;
    },
    log: (event, data) => logs.push({ event, data }),
  });
  let released = 0;
  const run = (id = 't1', password = 'clave-escritorio') => {
    const tarea = opts.tarea ?? 'tarea';
    store.insertTask({ id, tarea, desktopKey: 'k' });
    const receivedAt = performance.now();
    const done = sup.start({ id, tarea, desktop: { url: 'wss://d.example/websockify', password }, receivedAt }, () => released++);
    return { done, receivedAt };
  };
  const driverLog = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');
  return { store, sup, run, children, logs, driverLog, released: () => released };
}

test('flujo normal: acción, finish con respuesta, procesos detenidos antes de publicar', async () => {
  const s = setup({
    script: [{ action: { type: 'click', x: 5, y: 5 } }, { action: { type: 'finish', status: 'terminada', summary: 'Conté 45 facturas vencidas. clave-escritorio', answer: '45' } }],
  });
  const { done } = s.run();
  await done;
  const t = s.store.get('t1')!;
  assert.equal(t.estado, 'terminada');
  assert.match(t.resumen, /^respuesta: 45\n/);
  assert.doesNotMatch(t.resumen, /clave-escritorio/);
  assert.equal(s.released(), 1);
  assert.ok(s.children.every((c) => !c.alive && !alive(c.proc.pid)));
  assert.deepEqual(s.store.events('t1').map((e) => e.stage), ['step', 'finish']);
  assert.match(s.driverLog(), /connect wss:\/\/d\.example/);
});

test('worker bloqueado: revoca a tiempo, fallida y sin hijos vivos antes del corte', async () => {
  const s = setup({ worker: 'hang' });
  const { done, receivedAt } = s.run();
  await done;
  const elapsed = performance.now() - receivedAt;
  const t = s.store.get('t1')!;
  assert.equal(t.estado, 'fallida');
  assert.match(t.resumen, /tiempo/);
  assert.doesNotMatch(t.resumen, /respuesta:/);
  assert.ok(elapsed >= 1_400 && elapsed < 2_500, `terminó en ${elapsed} ms`);
  assert.ok(s.children.every((c) => !alive(c.proc.pid)));
});

test('driver que ignora el cierre y SIGTERM se mata antes del corte; sin acciones tras la revocación', async () => {
  const s = setup({ driver: 'ignore-close', script: [{ action: { type: 'click', x: 5, y: 5 } }] });
  const { done, receivedAt } = s.run();
  await done;
  const elapsed = performance.now() - receivedAt;
  assert.ok(elapsed < 2_500, `terminó en ${elapsed} ms`);
  assert.equal(s.store.get('t1')!.estado, 'fallida');
  assert.ok(s.children.every((c) => !alive(c.proc.pid)));
  const finished = s.logs.find((l) => l.event === 'task_finished')!;
  assert.equal(finished.data.driverKilled, true);
  assert.equal((s.driverLog().match(/execute/g) ?? []).length, 1);
});

test('procesos que no responden a nada: SIGKILL y publicación antes del corte', async () => {
  const s = setup({ worker: 'blocked', driver: 'blocked' });
  const { done, receivedAt } = s.run();
  await done;
  assert.ok(performance.now() - receivedAt < 2_500);
  assert.equal(s.store.get('t1')!.estado, 'fallida');
  assert.ok(s.children.every((c) => !alive(c.proc.pid)));
});

test('no repite Guardar sin verificar y rechaza frames vencidos', async () => {
  const s = setup({
    limits: { revokeMs: 8_000, hardStopMs: 9_000 },
    script: [
      { action: { type: 'click', x: 5, y: 5 }, target: 'Botón Guardar' },
      { action: { type: 'click', x: 5, y: 5 }, target: 'botón guardar' },
      { action: { type: 'click', x: 5, y: 5 }, frame_id: 99 },
      { action: { type: 'click', x: 500, y: 5 } },
      { action: { type: 'finish', status: 'fallida', summary: 'No pude verificar', answer: '3' } },
    ],
  });
  await s.run().done;
  const stages = s.store.events('t1').map((e) => `${e.stage}:${String(e.data.why ?? '')}`);
  assert.deepEqual(stages, ['step:', 'rejected:escritura pendiente sin verificar', 'rejected:frame vencido', 'rejected:coordenadas fuera de pantalla', 'finish:']);
  const t = s.store.get('t1')!;
  assert.equal(t.estado, 'fallida');
  assert.doesNotMatch(t.resumen, /respuesta:/);
  assert.equal((s.driverLog().match(/execute/g) ?? []).length, 1);
});

test('máximo de propuestas: fallida sin falso éxito', async () => {
  const s = setup({ limits: { revokeMs: 8_000, hardStopMs: 9_000, maxProposals: 3 }, script: [{ action: { type: 'wait', ms: 100 } }] });
  await s.run().done;
  const t = s.store.get('t1')!;
  assert.equal(t.estado, 'fallida');
  assert.match(t.resumen, /máximo de 3 propuestas/);
});

test('stopAll (SIGTERM del servicio): publica fallida y detiene hijos', async () => {
  const s = setup({ worker: 'hang', limits: { revokeMs: 60_000, hardStopMs: 70_000 } });
  const { done } = s.run();
  await new Promise((r) => setTimeout(r, 300));
  await s.sup.stopAll('el servicio se detuvo antes de terminar');
  await done;
  const t = s.store.get('t1')!;
  assert.equal(t.estado, 'fallida');
  assert.match(t.resumen, /servicio se detuvo/);
  assert.ok(s.children.every((c) => !alive(c.proc.pid)));
});

test('si el padre muere, el driver real termina', async () => {
  const parent = spawn(process.execPath, [fx('crash-parent.ts')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const childPid = await new Promise<number>((resolve, reject) => {
    parent.stdout.on('data', (d: Buffer) => {
      const m = /child:(\d+)/.exec(d.toString());
      if (m) resolve(Number(m[1]));
    });
    setTimeout(() => reject(new Error('sin pid')), 5_000);
  });
  assert.ok(alive(childPid));
  parent.kill('SIGKILL');
  const start = Date.now();
  while (alive(childPid) && Date.now() - start < 3_000) await new Promise((r) => setTimeout(r, 50));
  assert.equal(alive(childPid), false);
});

const slow = { revokeMs: 8_000, hardStopMs: 9_000 };

test('guardrail: borrar o exportar sólo si la tarea lo pide (no por una nota en pantalla)', async () => {
  const s = setup({
    limits: slow,
    tarea: 'Corrige la dirección del cliente Distribuciones El Faro: ahora es Calle 80 # 24-15.',
    script: [
      { action: { type: 'click', x: 5, y: 5 }, target: 'Botón Eliminar pedidos en estado Borrador' },
      { action: { type: 'click', x: 5, y: 5 }, target: 'Botón Exportar' },
      { action: { type: 'finish', status: 'fallida', summary: 'no', answer: null } },
    ],
  });
  await s.run().done;
  assert.deepEqual(s.store.events('t1').map((e) => `${e.stage}:${String(e.data.why ?? '')}`), ['rejected:fuera de la tarea', 'rejected:fuera de la tarea', 'finish:']);
  assert.equal((s.driverLog().match(/execute/g) ?? []).length, 0);
});

test('guardrail: no termina "terminada" tras guardar sin evidencia; con evidencia sí', async () => {
  const s = setup({
    limits: slow,
    script: [
      { action: { type: 'click', x: 5, y: 5 }, target: 'Botón Guardar' },
      { action: { type: 'finish', status: 'terminada', summary: 'listo', answer: null } },
      { action: { type: 'finish', status: 'terminada', summary: 'listo', answer: null }, evidence: 'La lista muestra el cliente nuevo con sus valores' },
    ],
  });
  await s.run().done;
  assert.deepEqual(s.store.events('t1').map((e) => `${e.stage}:${String(e.data.why ?? '')}`), ['step:', 'rejected:terminada sin evidencia', 'verified:', 'finish:']);
  assert.equal(s.store.get('t1')!.estado, 'terminada');
});

test('guardrail: tres finish sin evidencia tras guardar terminan en fallida', async () => {
  const s = setup({
    limits: slow,
    script: [{ action: { type: 'click', x: 5, y: 5 }, target: 'Botón Guardar' }, { action: { type: 'finish', status: 'terminada', summary: 'listo', answer: null } }],
  });
  await s.run().done;
  const t = s.store.get('t1')!;
  assert.equal(t.estado, 'fallida');
  assert.match(t.resumen, /no se pudo demostrar/);
});

test('recuperación: caída de conexión durante Guardar deja la escritura como incierta y sigue', async () => {
  const s = setup({
    limits: slow,
    driver: 'disconnect-once',
    script: [
      { action: { type: 'click', x: 5, y: 5 }, target: 'Botón Guardar' },
      { action: { type: 'click', x: 5, y: 5 }, target: 'Botón Guardar' },
      { action: { type: 'finish', status: 'fallida', summary: 'No pude confirmar si se guardó', answer: null } },
    ],
  });
  await s.run().done;
  assert.deepEqual(s.store.events('t1').map((e) => `${e.stage}:${String(e.data.why ?? '')}`), ['disconnected:', 'rejected:escritura pendiente sin verificar', 'finish:']);
  assert.match(s.driverLog(), /observe/);
  assert.equal((s.driverLog().match(/execute/g) ?? []).length, 1);
});

test('aprendizaje: carga lo aprendido de la app y guarda la experiencia', async () => {
  const store = TaskStore.open(':memory:');
  store.saveKnowledge('app de prueba', { lessons: '- Los listados están en el menú Datos', slowdownMs: 0 });
  const s = setup({ limits: slow, store, script: [{ action: { type: 'wait', ms: 100 } }, { action: { type: 'finish', status: 'terminada', summary: 'ok', answer: '1' } }] });
  await s.run().done;
  assert.match(s.logs.find((l) => l.event === 'task_app')!.data.app as string, /^app de prueba$/);
  const finish = s.store.events('t1').find((e) => e.stage === 'finish')!;
  assert.ok(finish);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(store.getKnowledge('app de prueba')!.tasks, 2);
});
