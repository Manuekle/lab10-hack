// Framebuffer local en formato B,G,R,X (AGENT_PIXEL_FORMAT) y codificación PNG.
import zlib from 'node:zlib';

const BPP = 4;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Frame {
  id: number;
  width: number;
  height: number;
  data: Buffer; // copia B,G,R,X
  capturedAt: number; // performance.now()
}

export class Framebuffer {
  width: number;
  height: number;
  data: Buffer;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * BPP);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * BPP);
  }

  private check(r: Rect): void {
    if (r.x < 0 || r.y < 0 || r.w < 0 || r.h < 0 || r.x + r.w > this.width || r.y + r.h > this.height) {
      throw new Error(`Rectángulo fuera del framebuffer: ${r.x},${r.y} ${r.w}x${r.h} en ${this.width}x${this.height}`);
    }
  }

  // Pixeles Raw de un rectángulo, fila por fila.
  putRaw(r: Rect, pixels: Buffer): void {
    this.check(r);
    const rowBytes = r.w * BPP;
    if (pixels.length !== rowBytes * r.h) throw new Error('Datos Raw de longitud inválida');
    for (let row = 0; row < r.h; row++) {
      pixels.copy(this.data, ((r.y + row) * this.width + r.x) * BPP, row * rowBytes, (row + 1) * rowBytes);
    }
  }

  copyRect(dst: Rect, srcX: number, srcY: number): void {
    this.check(dst);
    this.check({ x: srcX, y: srcY, w: dst.w, h: dst.h });
    const rowBytes = dst.w * BPP;
    const tmp = Buffer.alloc(rowBytes * dst.h);
    for (let row = 0; row < dst.h; row++) {
      const start = ((srcY + row) * this.width + srcX) * BPP;
      this.data.copy(tmp, row * rowBytes, start, start + rowBytes);
    }
    this.putRaw(dst, tmp);
  }

  snapshot(id: number): Frame {
    return { id, width: this.width, height: this.height, data: Buffer.from(this.data), capturedAt: performance.now() };
  }
}

export interface PngOptions {
  crop?: Rect;
  scale?: number; // entero >= 1, vecino más cercano (zoom para leer texto pequeño)
}

let crcTable: Uint32Array | undefined;
function crc32(buf: Buffer): number {
  const z = zlib as unknown as { crc32?: (b: Buffer) => number };
  if (z.crc32) return z.crc32(buf) >>> 0;
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

export function encodePng(frame: Pick<Frame, 'width' | 'height' | 'data'>, opts: PngOptions = {}): Buffer {
  const crop = opts.crop ?? { x: 0, y: 0, w: frame.width, h: frame.height };
  const scale = Math.max(1, Math.floor(opts.scale ?? 1));
  if (crop.x < 0 || crop.y < 0 || crop.w <= 0 || crop.h <= 0 || crop.x + crop.w > frame.width || crop.y + crop.h > frame.height) {
    throw new Error('Recorte fuera de la captura');
  }
  const outW = crop.w * scale;
  const outH = crop.h * scale;
  const stride = 1 + outW * 3;
  const raw = Buffer.alloc(stride * outH);
  for (let oy = 0; oy < outH; oy++) {
    const sy = crop.y + Math.floor(oy / scale);
    let o = oy * stride;
    raw[o++] = 0; // filtro None
    for (let ox = 0; ox < outW; ox++) {
      const sx = crop.x + Math.floor(ox / scale);
      const i = (sy * frame.width + sx) * BPP;
      raw[o++] = frame.data[i + 2] ?? 0; // R
      raw[o++] = frame.data[i + 1] ?? 0; // G
      raw[o++] = frame.data[i] ?? 0; // B
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(outW, 0);
  ihdr.writeUInt32BE(outH, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Fracción de pixeles distintos entre dos capturas del mismo tamaño (0..1).
export function diffRatio(a: Frame, b: Frame, region?: Rect): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const r = region ?? { x: 0, y: 0, w: a.width, h: a.height };
  let changed = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * a.width + x) * BPP;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) changed++;
    }
  }
  return changed / Math.max(1, r.w * r.h);
}
