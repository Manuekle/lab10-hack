import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { RfbClient } from '../src/rfb/client.ts';
import { Encoding } from '../src/rfb/protocol.ts';
import { decodeZrle } from '../src/rfb/zrle.ts';
import { FakeTransport, fbUpdate, rectHeader, serverInit, u32, waitFor } from './helpers/fake-transport.ts';

const px = (b: number, g: number, r: number) => [b, g, r];
const at = (buf: Buffer, w: number, x: number, y: number) => [...buf.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];

test('ZRLE: subcodificaciones raw, sólida, paleta empaquetada, RLE y RLE con paleta', () => {
  const A = px(1, 2, 3);
  const B = px(9, 8, 7);
  // 5 tiles de 2x2 en un rectángulo de 2x10 (h=10 < 64 => un tile por fila de 64; usamos ancho 2 y alto 2 por caso)
  const cases: Array<[string, number[], (b: Buffer) => void]> = [
    ['raw', [0, ...A, ...B, ...B, ...A], (b) => assert.deepEqual([at(b, 2, 0, 0), at(b, 2, 1, 0), at(b, 2, 0, 1), at(b, 2, 1, 1)], [A, B, B, A])],
    ['sólida', [1, ...B], (b) => assert.deepEqual([at(b, 2, 0, 0), at(b, 2, 1, 1)], [B, B])],
    // paleta de 2, 1 bit por pixel, filas rellenas a byte: fila0 = 01, fila1 = 10
    ['paleta', [2, ...A, ...B, 0b01000000, 0b10000000], (b) => assert.deepEqual([at(b, 2, 0, 0), at(b, 2, 1, 0), at(b, 2, 0, 1), at(b, 2, 1, 1)], [A, B, B, A])],
    // RLE plano: A x3, B x1 (longitud = 1 + byte)
    ['rle', [128, ...A, 2, ...B, 0], (b) => assert.deepEqual([at(b, 2, 1, 0), at(b, 2, 0, 1), at(b, 2, 1, 1)], [A, A, B])],
    // RLE con paleta de 2: índice 1 con corrida de 2, luego índice 0 suelto dos veces
    ['rle-paleta', [130, ...A, ...B, 0x81, 1, 0, 0], (b) => assert.deepEqual([at(b, 2, 0, 0), at(b, 2, 1, 0), at(b, 2, 0, 1), at(b, 2, 1, 1)], [B, B, A, A])],
  ];
  for (const [name, bytes, check] of cases) {
    const out = decodeZrle(Buffer.from(bytes), 2, 2);
    check(out);
    assert.ok(name);
  }
  assert.throws(() => decodeZrle(Buffer.from([0, 1, 2]), 2, 2), /truncados/);
  assert.throws(() => decodeZrle(Buffer.from([128, ...A, 9]), 2, 2), /corrida/);
  assert.throws(() => decodeZrle(Buffer.from([50]), 2, 2), /subcodificación/);
});

test('ZRLE de punta a punta: flujo zlib persistente entre rectángulos y tiles de 64', async () => {
  const t = new FakeTransport(9);
  t.feed(Buffer.from('RFB 003.008\n'), Buffer.from([1, 1]), u32(0), serverInit(70, 2, 'x'));
  const c = await RfbClient.connect({ url: 'wss://x', password: '', transport: t });
  // El cliente pidió ZRLE primero.
  const encs = t.sent.find((m) => m[0] === 2)!;
  assert.equal(encs.readInt32BE(4), Encoding.ZRLE);

  const z = zlib.createDeflate();
  const chunks: Buffer[] = [];
  z.on('data', (d: Buffer) => chunks.push(d));
  const compress = (data: Buffer) =>
    new Promise<Buffer>((resolve) => {
      chunks.length = 0;
      z.write(data);
      z.flush(zlib.constants.Z_SYNC_FLUSH, () => resolve(Buffer.concat(chunks)));
    });
  // Rect 70x2 = dos tiles (64x2 y 6x2): sólido rojo y sólido verde.
  const r1 = await compress(Buffer.from([1, 0, 0, 255, 1, 0, 255, 0]));
  t.feed(fbUpdate([rectHeader(0, 0, 70, 2, Encoding.ZRLE), Buffer.concat([u32(r1.length), r1])]));
  await waitFor(() => c.frameSeq >= 1);
  let f = c.snapshot();
  assert.deepEqual(at(f.data, 70, 63, 1), [0, 0, 255]);
  assert.deepEqual(at(f.data, 70, 64, 0), [0, 255, 0]);
  // Segundo rectángulo con el mismo flujo zlib (diccionario compartido).
  const r2 = await compress(Buffer.from([1, 255, 0, 0]));
  t.feed(fbUpdate([rectHeader(10, 0, 5, 2, Encoding.ZRLE), Buffer.concat([u32(r2.length), r2])]));
  await waitFor(() => c.frameSeq >= 2);
  f = c.snapshot();
  assert.deepEqual(at(f.data, 70, 12, 1), [255, 0, 0]);
  assert.deepEqual(at(f.data, 70, 9, 1), [0, 0, 255]);
  assert.equal(c.metrics.rects[Encoding.ZRLE], 2);
  c.close();
  z.close();
});
