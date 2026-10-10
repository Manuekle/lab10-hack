import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildResumen, failureResumen } from '../src/summary.ts';

test('pregunta terminada: línea respuesta primero, sin duplicar la del modelo', () => {
  const r = buildResumen({ status: 'terminada', summary: 'Revisé 3 páginas.\nrespuesta: 51', answer: '45' }, []);
  assert.equal(r, 'respuesta: 45\nRevisé 3 páginas.');
});

test('dos datos en la misma línea y en orden', () => {
  assert.match(buildResumen({ status: 'terminada', summary: 'ok', answer: '3;\n Bogotá' }, []), /^respuesta: 3; Bogotá$/m);
});

test('fallida: nunca lleva línea respuesta y nombra los datos', () => {
  const r = buildResumen({ status: 'fallida', summary: 'Hay dos Ana Torres: NIT 52345678 y 1019876543.\nrespuesta: 52345678', answer: '52345678' }, []);
  assert.doesNotMatch(r, /respuesta:/);
  assert.match(r, /52345678/);
  assert.match(r, /1019876543/);
});

test('redacta secretos del resumen', () => {
  const r = buildResumen({ status: 'terminada', summary: 'Usé la clave s3cr3t-desk y el token ftr_abcdef123456', answer: null }, ['s3cr3t-desk']);
  assert.doesNotMatch(r, /s3cr3t-desk|ftr_abcdef123456/);
  const f = failureResumen('tiempo agotado', 'respuesta: 4\nvi 4 filas', []);
  assert.doesNotMatch(f, /respuesta:/);
});
