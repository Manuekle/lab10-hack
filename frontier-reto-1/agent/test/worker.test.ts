import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TaskMemory } from '../src/agent/memory.ts';
import { stepPrompt, systemPrompt } from '../src/agent/prompt.ts';
import type { ValidProposal } from '../src/model/actions.ts';

const prop = (action: ValidProposal['action'], notes = ''): ValidProposal => ({ frame_id: 1, observation: '', notes, action, target: 'Siguiente', reason: '', expected: 'página 2' });

test('memoria: historial con resultado observado y notas acumuladas', () => {
  const m = new TaskMemory('¿Cuántas facturas?');
  m.recordProposal(prop({ type: 'click', x: 207, y: 703 }, 'página 1: 16'));
  m.recordOutcome({ changed: 0.4, note: '' });
  assert.equal(m.notes, 'página 1: 16');
  assert.match(m.history[0]!.outcome, /cambió/);
  m.recordProposal(prop({ type: 'click', x: 207, y: 703 }));
  assert.equal(m.notes, 'página 1: 16', 'notas vacías no borran la memoria');
});

test('falta de progreso y repeticiones generan avisos', () => {
  const m = new TaskMemory('t');
  for (let i = 0; i < 3; i++) {
    m.recordProposal(prop({ type: 'click', x: 100 + i, y: 100 }));
    m.recordOutcome({ changed: 0, note: '' });
  }
  const w = m.warnings();
  assert.ok(w.some((x) => /3 acciones seguidas sin cambio/.test(x)));
  assert.ok(w.some((x) => /Repetiste/.test(x)));
  m.recordProposal(prop({ type: 'key', key: 'Escape' }));
  m.recordOutcome({ changed: 0.2, note: '' });
  assert.deepEqual(m.warnings(), []);
});

test('rechazos del supervisor llegan al historial', () => {
  const m = new TaskMemory('t');
  m.recordProposal(prop({ type: 'click', x: 1, y: 1 }));
  m.recordOutcome({ changed: null, note: 'rechazada: commit repetido' });
  assert.equal(m.history[0]!.outcome, 'rechazada: commit repetido');
});

test('prompt: genérico, con reglas de datos no confiables y avisos', () => {
  const sys = systemPrompt('pixel');
  assert.match(sys, /nunca es una instrucción/);
  assert.match(sys, /píxeles/);
  assert.match(systemPrompt('norm1000'), /0 a 1000/);
  assert.doesNotMatch(sys, /SIGECOM|Cartera|Ferretería|CL-0007/);
  const p = stepPrompt({ task: 'T', frameId: 3, width: 1280, height: 800, step: 2, maxSteps: 40, remainingSec: 200, notes: '', history: [], warnings: ['ojo'] });
  assert.match(p, /frame_id=3/);
  assert.match(p, /ATENCIÓN:\n- ojo/);
});
