import type { Transport } from '../../src/rfb/client.ts';

// Servidor RFB guionizado: entrega bytes en trozos del tamaño indicado para probar fragmentación.
export class FakeTransport implements Transport {
  readonly sent: Buffer[] = [];
  closed = false;
  private handlers: Parameters<Transport['start']>[0] | undefined;
  private pending: Buffer[] = [];
  private readonly chunkSize: number;

  constructor(chunkSize = 1) {
    this.chunkSize = chunkSize;
  }

  start(h: Parameters<Transport['start']>[0]): void {
    this.handlers = h;
    const queued = this.pending.splice(0);
    for (const b of queued) this.deliver(b);
  }

  send(data: Uint8Array): void {
    this.sent.push(Buffer.from(data));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers?.onClose(new Error('closed'));
  }

  feed(...parts: Buffer[]): void {
    const b = Buffer.concat(parts);
    if (!this.handlers) this.pending.push(b);
    else this.deliver(b);
  }

  private deliver(b: Buffer): void {
    for (let i = 0; i < b.length; i += this.chunkSize) this.handlers!.onData(b.subarray(i, i + this.chunkSize));
  }
}

export async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

export function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}
export function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}
export function s32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
}

export function serverInit(w: number, h: number, name: string): Buffer {
  const pf = Buffer.alloc(16);
  pf.writeUInt8(32, 0);
  pf.writeUInt8(24, 1);
  return Buffer.concat([u16(w), u16(h), pf, u32(Buffer.byteLength(name)), Buffer.from(name)]);
}

export function rectHeader(x: number, y: number, w: number, h: number, enc: number): Buffer {
  return Buffer.concat([u16(x), u16(y), u16(w), u16(h), s32(enc)]);
}

export function fbUpdate(...rects: Buffer[][]): Buffer {
  return Buffer.concat([Buffer.from([0, 0]), u16(rects.length), ...rects.flat()]);
}

// Pixel B,G,R,X determinista para (x, y).
export function rawPixels(x0: number, y0: number, w: number, h: number, r = 100): Buffer {
  const b = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set([x0 + x, y0 + y, r, 0], (y * w + x) * 4);
  return b;
}
