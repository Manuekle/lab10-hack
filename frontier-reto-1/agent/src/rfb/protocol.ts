// Mensajes RFB (RFC 6143) que usa el driver. Codificación pura, sin E/S.
import crypto from 'node:crypto';

export const SecurityType = { None: 1, VncAuth: 2 } as const;

export const Encoding = {
  Raw: 0,
  CopyRect: 1,
  LastRect: -224,
  DesktopSize: -223,
} as const;

export const ClientMsg = {
  SetPixelFormat: 0,
  SetEncodings: 2,
  FramebufferUpdateRequest: 3,
  KeyEvent: 4,
  PointerEvent: 5,
} as const;

export const ServerMsg = {
  FramebufferUpdate: 0,
  SetColourMapEntries: 1,
  Bell: 2,
  ServerCutText: 3,
} as const;

export interface PixelFormat {
  bitsPerPixel: number;
  depth: number;
  bigEndian: boolean;
  trueColor: boolean;
  redMax: number;
  greenMax: number;
  blueMax: number;
  redShift: number;
  greenShift: number;
  blueShift: number;
}

// 32 bpp little-endian con rojo en el byte 2: en memoria queda B, G, R, X.
export const AGENT_PIXEL_FORMAT: PixelFormat = {
  bitsPerPixel: 32,
  depth: 24,
  bigEndian: false,
  trueColor: true,
  redMax: 255,
  greenMax: 255,
  blueMax: 255,
  redShift: 16,
  greenShift: 8,
  blueShift: 0,
};

export type ProtocolVersion = '3.3' | '3.7' | '3.8';

export function parseServerVersion(banner: Buffer): { major: number; minor: number } {
  const text = banner.toString('latin1');
  const m = /^RFB (\d{3})\.(\d{3})\n$/.exec(text);
  if (!m) throw new Error('Saludo RFB inválido');
  return { major: Number(m[1]), minor: Number(m[2]) };
}

export function chooseVersion(server: { major: number; minor: number }): ProtocolVersion {
  if (server.major < 3) throw new Error('Versión RFB no soportada');
  if (server.major > 3 || server.minor >= 8) return '3.8';
  if (server.minor === 7) return '3.7';
  return '3.3';
}

export function encodeVersion(v: ProtocolVersion): Buffer {
  return Buffer.from(v === '3.3' ? 'RFB 003.003\n' : v === '3.7' ? 'RFB 003.007\n' : 'RFB 003.008\n', 'latin1');
}

function reverseBits(b: number): number {
  let r = 0;
  for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i);
  return r;
}

// Autenticación VNC: DES-ECB del reto con la contraseña (8 bytes, bits invertidos).
// DES simple = 3DES-EDE con las tres claves iguales; evita depender del proveedor legacy de OpenSSL.
export function vncAuthResponse(challenge: Buffer, password: string): Buffer {
  if (challenge.length !== 16) throw new Error('Reto VNC de longitud inválida');
  const key = Buffer.alloc(8);
  const pw = Buffer.from(password, 'latin1');
  for (let i = 0; i < 8; i++) key[i] = reverseBits(pw[i] ?? 0);
  const cipher = crypto.createCipheriv('des-ede3', Buffer.concat([key, key, key]), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(challenge), cipher.final()]);
}

export function encodePixelFormat(pf: PixelFormat): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt8(pf.bitsPerPixel, 0);
  b.writeUInt8(pf.depth, 1);
  b.writeUInt8(pf.bigEndian ? 1 : 0, 2);
  b.writeUInt8(pf.trueColor ? 1 : 0, 3);
  b.writeUInt16BE(pf.redMax, 4);
  b.writeUInt16BE(pf.greenMax, 6);
  b.writeUInt16BE(pf.blueMax, 8);
  b.writeUInt8(pf.redShift, 10);
  b.writeUInt8(pf.greenShift, 11);
  b.writeUInt8(pf.blueShift, 12);
  return b;
}

export function decodePixelFormat(b: Buffer): PixelFormat {
  return {
    bitsPerPixel: b.readUInt8(0),
    depth: b.readUInt8(1),
    bigEndian: b.readUInt8(2) !== 0,
    trueColor: b.readUInt8(3) !== 0,
    redMax: b.readUInt16BE(4),
    greenMax: b.readUInt16BE(6),
    blueMax: b.readUInt16BE(8),
    redShift: b.readUInt8(10),
    greenShift: b.readUInt8(11),
    blueShift: b.readUInt8(12),
  };
}

export function setPixelFormat(pf: PixelFormat): Buffer {
  const b = Buffer.alloc(20);
  b.writeUInt8(ClientMsg.SetPixelFormat, 0);
  encodePixelFormat(pf).copy(b, 4);
  return b;
}

export function setEncodings(encodings: readonly number[]): Buffer {
  const b = Buffer.alloc(4 + 4 * encodings.length);
  b.writeUInt8(ClientMsg.SetEncodings, 0);
  b.writeUInt16BE(encodings.length, 2);
  encodings.forEach((e, i) => b.writeInt32BE(e, 4 + 4 * i));
  return b;
}

export function framebufferUpdateRequest(incremental: boolean, x: number, y: number, w: number, h: number): Buffer {
  const b = Buffer.alloc(10);
  b.writeUInt8(ClientMsg.FramebufferUpdateRequest, 0);
  b.writeUInt8(incremental ? 1 : 0, 1);
  b.writeUInt16BE(x, 2);
  b.writeUInt16BE(y, 4);
  b.writeUInt16BE(w, 6);
  b.writeUInt16BE(h, 8);
  return b;
}

export function keyEvent(down: boolean, keysym: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeUInt8(ClientMsg.KeyEvent, 0);
  b.writeUInt8(down ? 1 : 0, 1);
  b.writeUInt32BE(keysym >>> 0, 4);
  return b;
}

export function pointerEvent(buttonMask: number, x: number, y: number): Buffer {
  const b = Buffer.alloc(6);
  b.writeUInt8(ClientMsg.PointerEvent, 0);
  b.writeUInt8(buttonMask & 0xff, 1);
  b.writeUInt16BE(x, 2);
  b.writeUInt16BE(y, 4);
  return b;
}

export function clientInit(shared: boolean): Buffer {
  return Buffer.from([shared ? 1 : 0]);
}
