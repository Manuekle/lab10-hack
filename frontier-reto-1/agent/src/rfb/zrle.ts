// ZRLE (RFC 6143 §7.7.6): tiles de 64x64 comprimidos con un único flujo zlib por conexión.
// Reduce mucho los bytes frente a Raw en interfaces planas. Asume AGENT_PIXEL_FORMAT (32 bpp, profundidad 24):
// cada CPIXEL son 3 bytes B, G, R.
import zlib from 'node:zlib';

const TILE = 64;

// Inflador con estado: el servidor usa un solo flujo zlib para todos los rectángulos ZRLE de la conexión.
export class ZrleInflater {
  private readonly z = zlib.createInflate();
  private chunks: Buffer[] = [];
  private size = 0;
  private limit = 0;
  private error: Error | undefined;

  constructor() {
    this.z.on('data', (c: Buffer) => {
      this.size += c.length;
      if (this.size > this.limit) this.error ??= new Error('ZRLE: datos descomprimidos de más');
      else this.chunks.push(c);
    });
    this.z.on('error', (e: Error) => {
      this.error ??= e;
    });
  }

  // `maxOut` acota la salida para que un servidor hostil no infle gigas.
  inflate(data: Buffer, maxOut: number): Promise<Buffer> {
    this.chunks = [];
    this.size = 0;
    this.limit = maxOut;
    return new Promise((resolve, reject) => {
      if (this.error) return reject(this.error);
      this.z.write(data);
      this.z.flush(zlib.constants.Z_SYNC_FLUSH, () => {
        if (this.error) reject(this.error);
        else resolve(Buffer.concat(this.chunks, this.size));
      });
    });
  }

  close(): void {
    this.z.close();
  }
}

// Decodifica los tiles de un rectángulo w x h a pixeles B,G,R,X fila por fila.
export function decodeZrle(data: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h * 4);
  let off = 0;
  const need = (n: number) => {
    if (off + n > data.length) throw new Error('ZRLE: datos truncados');
  };
  const cpixel = (): number => {
    need(3);
    const v = data[off]! | (data[off + 1]! << 8) | (data[off + 2]! << 16);
    off += 3;
    return v;
  };
  const runLength = (max: number): number => {
    let len = 1;
    let b: number;
    do {
      need(1);
      b = data[off++]!;
      len += b;
    } while (b === 255);
    if (len > max) throw new Error('ZRLE: corrida más larga que el tile');
    return len;
  };

  for (let ty = 0; ty < h; ty += TILE) {
    const th = Math.min(TILE, h - ty);
    for (let tx = 0; tx < w; tx += TILE) {
      const tw = Math.min(TILE, w - tx);
      const n = tw * th;
      const put = (i: number, v: number) => {
        const o = ((ty + Math.floor(i / tw)) * w + tx + (i % tw)) * 4;
        out[o] = v & 0xff;
        out[o + 1] = (v >> 8) & 0xff;
        out[o + 2] = (v >> 16) & 0xff;
      };
      need(1);
      const sub = data[off++]!;
      if (sub === 0) {
        for (let i = 0; i < n; i++) put(i, cpixel());
      } else if (sub === 1) {
        const v = cpixel();
        for (let i = 0; i < n; i++) put(i, v);
      } else if (sub <= 16) {
        const palette = Array.from({ length: sub }, cpixel);
        const bits = sub === 2 ? 1 : sub <= 4 ? 2 : 4;
        const mask = (1 << bits) - 1;
        for (let y = 0; y < th; y++) {
          let byte = 0;
          let left = 0;
          for (let x = 0; x < tw; x++) {
            if (left === 0) {
              need(1);
              byte = data[off++]!;
              left = 8;
            }
            left -= bits;
            const idx = (byte >> left) & mask;
            if (idx >= palette.length) throw new Error('ZRLE: índice de paleta inválido');
            put(y * tw + x, palette[idx]!);
          }
        }
      } else if (sub === 128) {
        for (let i = 0; i < n; ) {
          const v = cpixel();
          const len = runLength(n - i);
          for (let k = 0; k < len; k++) put(i++, v);
        }
      } else if (sub >= 130) {
        const palette = Array.from({ length: sub - 128 }, cpixel);
        for (let i = 0; i < n; ) {
          need(1);
          const b = data[off++]!;
          const v = palette[b & 0x7f];
          if (v === undefined) throw new Error('ZRLE: índice de paleta inválido');
          const len = b & 0x80 ? runLength(n - i) : 1;
          for (let k = 0; k < len; k++) put(i++, v);
        }
      } else {
        throw new Error(`ZRLE: subcodificación no soportada ${sub}`);
      }
    }
  }
  return out;
}
