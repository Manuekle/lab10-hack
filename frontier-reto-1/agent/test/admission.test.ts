import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Admission } from '../src/admission.ts';
import { isPrivateHost, parseDesktopUrl } from '../src/desktop-url.ts';

test('URL de escritorio: normalización sin contraseña y rechazo de redes privadas', () => {
  const a = parseDesktopUrl('wss://Desk.Example.com/websockify/', false);
  const b = parseDesktopUrl('wss://desk.example.com:443/websockify', false);
  assert.ok(a.ok && b.ok && a.key === b.key);
  assert.equal(parseDesktopUrl('ws://localhost:6080/websockify', false).ok, false);
  assert.equal(parseDesktopUrl('ws://localhost:6080/websockify', true).ok, true);
  for (const h of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1', 'api.internal']) assert.ok(isPrivateHost(h), h);
  for (const h of ['frontier-r1-tm51-production.up.railway.app', '8.8.8.8', '172.32.0.1']) assert.equal(isPrivateHost(h), false, h);
});

test('admisión: un ejecutor por escritorio y tope de activas', () => {
  const ad = new Admission(2);
  assert.equal(ad.acquire('t1', 'A'), 'ok');
  assert.equal(ad.acquire('t2', 'A'), 'desktop_busy');
  assert.equal(ad.acquire('t3', 'B'), 'ok');
  assert.equal(ad.acquire('t4', 'C'), 'capacity');
  ad.release('t1');
  ad.release('t1');
  assert.equal(ad.active, 1);
  assert.equal(ad.acquire('t5', 'A'), 'ok');
});
