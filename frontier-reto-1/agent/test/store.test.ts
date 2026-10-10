import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { RESTART_SUMMARY, TaskStore } from '../src/store.ts';

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-store-')), 'nested', 'agent.db');
}

test('registro y lectura sin credenciales', () => {
  const s = TaskStore.open(':memory:');
  const t = s.insertTask({ id: 't1', tarea: 'Registra al cliente X', desktopKey: 'wss://d.example/websockify' });
  assert.equal(t.estado, 'en_curso');
  assert.equal(t.fase, 'admitida');
  assert.equal(s.get('nope'), undefined);
  assert.ok(s.setPhase('t1', 'ejecutando'));
  s.addEvent('t1', 'accion', { type: 'click' });
  assert.deepEqual(s.events('t1')[0]!.data, { type: 'click' });
  assert.ok(s.ping());
});

test('terminal inmutable', () => {
  const s = TaskStore.open(':memory:');
  s.insertTask({ id: 't1', tarea: 'x', desktopKey: 'k' });
  assert.ok(s.finish('t1', 'terminada', 'hecho'));
  assert.equal(s.finish('t1', 'fallida', 'otra'), false);
  assert.equal(s.setPhase('t1', 'cerrando'), false);
  assert.equal(s.get('t1')!.estado, 'terminada');
  assert.equal(s.get('t1')!.resumen, 'hecho');
});

test('rollback de admisión fallida', () => {
  const s = TaskStore.open(':memory:');
  assert.throws(() =>
    s.transaction(() => {
      s.insertTask({ id: 't1', tarea: 'x', desktopKey: 'k' });
      throw new Error('falló la reserva');
    }),
  );
  assert.equal(s.get('t1'), undefined);
  s.insertTask({ id: 't2', tarea: 'x', desktopKey: 'k' });
  assert.throws(() => s.insertTask({ id: 't2', tarea: 'x', desktopKey: 'k' }));
});

test('reinicio: abiertas pasan a fallida sin replay y terminales se conservan', () => {
  const file = tmpDb();
  const a = TaskStore.open(file);
  a.insertTask({ id: 'abierta', tarea: 'x', desktopKey: 'k' });
  a.setPhase('abierta', 'ejecutando');
  a.insertTask({ id: 'cerrada', tarea: 'y', desktopKey: 'k' });
  a.finish('cerrada', 'terminada', 'ok');
  a.close();

  const b = TaskStore.open(file);
  assert.equal(b.recoverInterrupted(), 1);
  assert.equal(b.get('abierta')!.estado, 'fallida');
  assert.equal(b.get('abierta')!.resumen, RESTART_SUMMARY);
  assert.equal(b.get('cerrada')!.resumen, 'ok');
  assert.equal(b.listOpen().length, 0);
  assert.equal(b.recoverInterrupted(), 0);
  b.close();
});
