import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateSummary } from '../scripts/evaluate-summary.ts';

const q = { id: 'E3', instruccion: '', estado_esperado: 'terminada' as const, respuesta_esperada: '45' };
const fail = { id: 'E5', instruccion: '', estado_esperado: 'fallida' as const, claves_razon: ['52345678', '1019876543'] };

test('evaluador: número en la línea respuesta, primer número', () => {
  assert.ok(evaluateSummary(q, 'terminada', 'respuesta: 45\nRevisé 3 páginas', []).ok);
  assert.ok(evaluateSummary(q, 'terminada', 'Conté.\nrespuesta: 45 facturas (16+18+11)', []).ok);
  assert.match(evaluateSummary(q, 'terminada', 'respuesta: 51', []).reasons.join(), /respuesta 51/);
  assert.match(evaluateSummary(q, 'terminada', 'Son 45 facturas', []).reasons.join(), /falta la línea/);
  assert.match(evaluateSummary(q, 'fallida', 'respuesta: 45', []).reasons.join(), /estado fallida/);
});

test('evaluador: fallida nombra las claves y no lleva respuesta', () => {
  assert.ok(evaluateSummary(fail, 'fallida', 'Hay dos Ana Torres: NIT 52345678 y 1019876543', []).ok);
  assert.match(evaluateSummary(fail, 'fallida', 'Hay dos Ana Torres: 52345678', []).reasons.join(), /1019876543/);
  assert.match(evaluateSummary(fail, 'fallida', 'respuesta: 52345678; 1019876543', []).reasons.join(), /no debe llevar/);
  assert.match(evaluateSummary(fail, 'terminada', 'NIT 52345678 y 1019876543', []).reasons.join(), /estado terminada/);
});

test('evaluador: dos datos en orden y secretos', () => {
  const two = { id: 'X', instruccion: '', estado_esperado: 'terminada' as const, respuesta_esperada: '3; Bogotá' };
  assert.ok(evaluateSummary(two, 'terminada', 'respuesta: 3; bogota', []).ok);
  assert.equal(evaluateSummary(two, 'terminada', 'respuesta: Bogotá; 3', []).ok, false);
  assert.match(evaluateSummary(q, 'terminada', 'respuesta: 45 clave s3cr3t', ['s3cr3t']).reasons.join(), /secreto/);
});
