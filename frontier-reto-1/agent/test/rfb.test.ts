import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { ByteQueue, RfbClient } from '../src/rfb/client.ts';
import { diffRatio, encodePng, Framebuffer } from '../src/rfb/framebuffer.ts';
import { chooseVersion, Encoding, parseServerVersion, vncAuthResponse } from '../src/rfb/protocol.ts';
import { DesktopSession } from '../src/rfb/session.ts';
import { FakeTransport, fbUpdate, rawPixels, rectHeader, serverInit, u32, waitFor } from './helpers/fake-transport.ts';

test('versión: elige la mayor soportada', () => {
  assert.equal(chooseVersion(parseServerVersion(Buffer.from('RFB 003.008\n'))), '3.8');
  assert.equal(chooseVersion(parseServerVersion(Buffer.from('RFB 003.889\n'))), '3.8');
  assert.equal(chooseVersion(parseServerVersion(Buffer.from('RFB 003.007\n'))), '3.7');
  assert.equal(chooseVersion(parseServerVersion(Buffer.from('RFB 003.003\n'))), '3.3');
  assert.throws(() => parseServerVersion(Buffer.from('HTTP/1.1 200\n')));
});

test('auth VNC: DES con bits invertidos de la contraseña', () => {
  const challenge = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  // Referencia independiente: DES-ECB vía 3DES con clave triplicada, bits invertidos a mano.
  const key = Buffer.from('password'.split('').map((c) => parseInt(c.charCodeAt(0).toString(2).padStart(8, '0').split('').reverse().join(''), 2)));
  const c = crypto.createCipheriv('des-ede3-ecb', Buffer.concat([key, key, key]), null);
  c.setAutoPadding(false);
  const expected = Buffer.concat([c.update(challenge), c.final()]);
  assert.deepEqual(vncAuthResponse(challenge, 'password'), expected);
  // Sólo cuentan los primeros 8 bytes.
  assert.deepEqual(vncAuthResponse(challenge, 'password-extra'), expected);
});

test('ByteQueue: lecturas que cruzan y parten trozos', async () => {
  const q = new ByteQueue();
  const p = q.read(5);
  q.push(Buffer.from([1, 2]));
  q.push(Buffer.from([3]));
  q.push(Buffer.from([4, 5, 6, 7]));
  assert.deepEqual([...(await p)], [1, 2, 3, 4, 5]);
  assert.deepEqual([...(await q.read(2))], [6, 7]);
  const pending = q.read(1);
  q.fail(new Error('cerrado'));
  await assert.rejects(pending, /cerrado/);
});

function handshake38(t: FakeTransport, w: number, h: number): Buffer {
  const challenge = crypto.randomBytes(16);
  t.feed(Buffer.from('RFB 003.008\n'), Buffer.from([2, 16, 2]), challenge, u32(0), serverInit(w, h, 'kiosko'));
  return challenge;
}

test('RFB 3.8: negociación, auth y composición Raw fragmentada en bytes', async () => {
  const t = new FakeTransport(1);
  const challenge = handshake38(t, 4, 3);
  t.feed(fbUpdate([rectHeader(0, 0, 4, 3, Encoding.Raw), rawPixels(0, 0, 4, 3)]));
  const c = await RfbClient.connect({ url: 'wss://x', password: 'secreto', transport: t });
  assert.equal(c.width, 4);
  assert.equal(c.height, 3);
  assert.equal(c.name, 'kiosko');
  assert.equal(c.metrics.version, '3.8');
  assert.equal(c.metrics.securityType, 2);

  // Mensajes del cliente: versión, tipo de seguridad, respuesta al reto, ClientInit, pixel format, encodings, petición.
  assert.equal(t.sent[0]!.toString(), 'RFB 003.008\n');
  assert.deepEqual([...t.sent[1]!], [2]);
  assert.deepEqual(t.sent[2], vncAuthResponse(challenge, 'secreto'));
  assert.deepEqual([...t.sent[3]!], [1]);
  assert.equal(t.sent[4]![0], 0); // SetPixelFormat
  assert.equal(t.sent[4]![4], 32);
  assert.equal(t.sent[5]![0], 2); // SetEncodings
  assert.equal(t.sent[6]![0], 3); // FramebufferUpdateRequest
  assert.equal(t.sent[6]![1], 0); // no incremental

  await waitFor(() => c.frameSeq >= 1);
  const f = c.snapshot();
  assert.deepEqual([...f.data.subarray((2 * 4 + 3) * 4, (2 * 4 + 3) * 4 + 4)], [3, 2, 100, 0]);
  // Tras una actualización pide la siguiente incremental.
  await waitFor(() => t.sent.some((m) => m[0] === 3 && m[1] === 1));
  c.close();
  assert.ok(t.closed);
});

test('RFB: CopyRect, actualización parcial y DesktopSize', async () => {
  const t = new FakeTransport(7);
  handshake38(t, 4, 3);
  const c = await RfbClient.connect({ url: 'wss://x', password: 'p', transport: t });
  t.feed(fbUpdate([rectHeader(0, 0, 4, 3, Encoding.Raw), rawPixels(0, 0, 4, 3)]));
  await waitFor(() => c.frameSeq >= 1);
  t.feed(
    fbUpdate(
      [rectHeader(2, 2, 2, 1, Encoding.CopyRect), Buffer.from([0, 0, 0, 0])],
      [rectHeader(0, 0, 1, 1, Encoding.Raw), Buffer.from([9, 9, 9, 0])],
    ),
  );
  await waitFor(() => c.frameSeq >= 2);
  const f = c.snapshot();
  const px = (x: number, y: number) => [...f.data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 3)];
  assert.deepEqual(px(0, 0), [9, 9, 9]);
  assert.deepEqual(px(2, 2), [0, 0, 100]); // copiado desde (0,0) original
  assert.deepEqual(px(3, 2), [1, 0, 100]);
  assert.deepEqual(px(1, 2), [1, 2, 100]); // intacto

  t.feed(fbUpdate([rectHeader(0, 0, 6, 5, Encoding.DesktopSize)]));
  await waitFor(() => c.width === 6);
  assert.equal(c.height, 5);
  const last = t.sent.at(-1)!;
  assert.equal(last[0], 3);
  assert.equal(last[1], 0); // pide completo tras redimensionar
  c.close();
});

test('RFB: refresh espera una actualización completa', async () => {
  const t = new FakeTransport(64);
  handshake38(t, 4, 3);
  const c = await RfbClient.connect({ url: 'wss://x', password: 'p', transport: t });
  const pending = c.refresh(1000);
  // Una actualización parcial no basta.
  t.feed(fbUpdate([rectHeader(0, 0, 1, 1, Encoding.Raw), Buffer.from([1, 1, 1, 0])]));
  t.feed(fbUpdate([rectHeader(0, 0, 4, 3, Encoding.Raw), rawPixels(0, 0, 4, 3, 7)]));
  const f = await pending;
  assert.equal(f.data[2], 7);
  c.close();
});

test('RFB 3.3 sin autenticación', async () => {
  const t = new FakeTransport(3);
  t.feed(Buffer.from('RFB 003.003\n'), u32(1), serverInit(2, 2, 'x'));
  const c = await RfbClient.connect({ url: 'wss://x', password: '', transport: t });
  assert.equal(c.metrics.version, '3.3');
  assert.equal(t.sent[0]!.toString(), 'RFB 003.003\n');
  assert.deepEqual([...t.sent[1]!], [1]); // ClientInit directamente
  c.close();
});

test('RFB: autenticación rechazada no filtra la contraseña', async () => {
  const t = new FakeTransport(5);
  const reason = Buffer.from('clave incorrecta');
  t.feed(Buffer.from('RFB 003.008\n'), Buffer.from([1, 2]), crypto.randomBytes(16), u32(1), u32(reason.length), reason);
  await assert.rejects(RfbClient.connect({ url: 'wss://x', password: 'supersecreta', transport: t }), (e: Error) => {
    assert.match(e.message, /Autenticación VNC rechazada: clave incorrecta/);
    assert.doesNotMatch(e.message, /supersecreta/);
    return true;
  });
  assert.ok(t.closed);
});

test('RFB: cierre del socket rechaza esperas pendientes', async () => {
  const t = new FakeTransport(16);
  handshake38(t, 4, 3);
  const c = await RfbClient.connect({ url: 'wss://x', password: 'p', transport: t });
  const pending = c.refresh(5000);
  t.close();
  await assert.rejects(pending, /closed/);
  assert.equal(c.isOpen, false);
  assert.throws(() => c.sendKey(true, 0x61), /closed/);
});

test('PNG: firma, dimensiones, recorte y zoom', () => {
  const fb = new Framebuffer(4, 3);
  fb.putRaw({ x: 0, y: 0, w: 4, h: 3 }, rawPixels(0, 0, 4, 3));
  const frame = fb.snapshot(1);
  const png = encodePng(frame, { crop: { x: 1, y: 1, w: 2, h: 2 }, scale: 2 });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 4);
  assert.equal(png.readUInt32BE(20), 4);
  const idatLen = png.readUInt32BE(33);
  const raw = zlib.inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(raw.length, 4 * (1 + 4 * 3));
  assert.deepEqual([...raw.subarray(1, 4)], [100, 1, 1]); // R,G,B de (1,1)
  assert.throws(() => encodePng(frame, { crop: { x: 3, y: 0, w: 2, h: 1 } }));
});

test('diffRatio detecta cambios de pantalla', () => {
  const fb = new Framebuffer(2, 2);
  const a = fb.snapshot(1);
  fb.putRaw({ x: 0, y: 0, w: 1, h: 1 }, Buffer.from([1, 2, 3, 0]));
  assert.equal(diffRatio(a, fb.snapshot(2)), 0.25);
});

test('settle: devuelve tras cambio + silencio, o al vencer el plazo sin cambios', async () => {
  const t = new FakeTransport(64);
  handshake38(t, 40, 30);
  const c = await RfbClient.connect({ url: 'wss://x', password: 'p', transport: t, activityThresholdPx: 100 });
  t.feed(fbUpdate([rectHeader(0, 0, 40, 30, Encoding.Raw), rawPixels(0, 0, 40, 30)]));
  await waitFor(() => c.frameSeq >= 1);
  await new Promise((r) => setTimeout(r, 50));

  let started = performance.now();
  await c.settle({ minMs: 20, quietMs: 100, changeWithinMs: 300, maxMs: 2_000 });
  const idle = performance.now() - started;
  assert.ok(idle >= 290 && idle < 600, `sin cambios: ${idle}`);

  started = performance.now();
  setTimeout(() => t.feed(fbUpdate([rectHeader(0, 0, 20, 10, Encoding.Raw), rawPixels(0, 0, 20, 10, 5)])), 150);
  const f = await c.settle({ minMs: 20, quietMs: 100, changeWithinMs: 1_000, maxMs: 2_000 });
  const busy = performance.now() - started;
  assert.ok(busy >= 240 && busy < 700, `con cambio: ${busy}`);
  assert.equal(f.data[2], 5);
  c.close();
});

test('servidor hostil: tamaños gigantes se rechazan sin reservar memoria', async () => {
  // ServerInit de 60000x60000
  const t1 = new FakeTransport(64);
  t1.feed(Buffer.from('RFB 003.008\n'), Buffer.from([1, 1]), u32(0), serverInit(60_000, 60_000, 'x'));
  await assert.rejects(RfbClient.connect({ url: 'wss://x', password: '', transport: t1 }), /no soportado/);

  // Rectángulo Raw fuera del framebuffer
  const t2 = new FakeTransport(64);
  handshake38(t2, 4, 3);
  const c = await RfbClient.connect({ url: 'wss://x', password: 'p', transport: t2 });
  t2.feed(fbUpdate([rectHeader(0, 0, 50_000, 50_000, Encoding.Raw)]));
  await c.closed;
  assert.equal(c.isOpen, false);

  // Portapapeles de 1 GB
  const t3 = new FakeTransport(64);
  handshake38(t3, 4, 3);
  const c3 = await RfbClient.connect({ url: 'wss://x', password: 'p', transport: t3 });
  t3.feed(Buffer.from([3, 0, 0, 0]), u32(1024 * 1024 * 1024));
  const reason = await c3.closed;
  assert.match(reason.message, /Portapapeles/);
});

test('escritorio lento: sin captura completa a tiempo pero con actualizaciones parciales, la sesión sigue', async () => {
  const t = new FakeTransport(64);
  handshake38(t, 4, 3);
  t.feed(fbUpdate([rectHeader(0, 0, 2, 1, Encoding.Raw), rawPixels(0, 0, 2, 1)]));
  const s = await DesktopSession.open({ url: 'wss://x', password: 'p', timeoutMs: 300, transport: t });
  assert.equal(s.client.isOpen, true);
  assert.ok(s.client.frameSeq >= 1);
  s.close();

  const t2 = new FakeTransport(64);
  handshake38(t2, 4, 3);
  await assert.rejects(DesktopSession.open({ url: 'wss://x', password: 'p', timeoutMs: 300, transport: t2 }), /Timeout/);
  assert.ok(t2.closed);
});
