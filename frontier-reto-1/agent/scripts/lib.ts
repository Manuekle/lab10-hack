// Utilidades del harness local. No forman parte del agente desplegado.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Frame } from '../src/rfb/framebuffer.ts';

export const ARTIFACTS = path.resolve(import.meta.dirname, '..', '.artifacts');

export function artifactPath(name: string): string {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  return path.join(ARTIFACTS, name);
}

export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// Decodifica los PNG RGB sin filtros que produce encodePng (no es un decodificador general).
export function decodeOwnPng(buf: Buffer): Frame {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('No es PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 2) throw new Error('Sólo PNG RGB de 8 bits generados por capture');
    } else if (type === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const data = Buffer.alloc(width * height * 4);
  const stride = 1 + width * 3;
  for (let y = 0; y < height; y++) {
    if (raw[y * stride] !== 0) throw new Error('PNG con filtros no soportado');
    for (let x = 0; x < width; x++) {
      const s = y * stride + 1 + x * 3;
      const d = (y * width + x) * 4;
      data[d] = raw[s + 2]!;
      data[d + 1] = raw[s + 1]!;
      data[d + 2] = raw[s]!;
    }
  }
  return { id: 0, width, height, data, capturedAt: performance.now() };
}

// Cruz roja sobre una copia de la captura para revisar a ojo dónde apunta el modelo.
export function drawMarker(frame: Frame, x: number, y: number): Frame {
  const out = { ...frame, data: Buffer.from(frame.data) };
  const put = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) return;
    const i = (py * frame.width + px) * 4;
    out.data[i] = 0;
    out.data[i + 1] = 0;
    out.data[i + 2] = 255;
  };
  for (let d = -14; d <= 14; d++) {
    for (let t = -1; t <= 1; t++) {
      put(x + d, y + t);
      put(x + t, y + d);
    }
  }
  return out;
}
