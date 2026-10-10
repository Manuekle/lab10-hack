// Cliente RFB sobre WebSocket. Posee el socket; sólo expone capturas y envío de entradas.
import { setTimeout as sleep } from 'node:timers/promises';
import { Framebuffer, type Frame } from './framebuffer.ts';
import {
  AGENT_PIXEL_FORMAT,
  Encoding,
  SecurityType,
  ServerMsg,
  chooseVersion,
  clientInit,
  decodePixelFormat,
  encodeVersion,
  framebufferUpdateRequest,
  keyEvent,
  parseServerVersion,
  pointerEvent,
  setEncodings,
  setPixelFormat,
  vncAuthResponse,
  type PixelFormat,
  type ProtocolVersion,
} from './protocol.ts';

export interface Transport {
  send(data: Uint8Array): void;
  close(): void;
  // El cliente registra sus manejadores una sola vez.
  start(handlers: { onData: (chunk: Uint8Array) => void; onClose: (reason: Error) => void }): void;
}

// Cola de bytes: un mensaje RFB puede llegar partido en varios frames WebSocket o juntarse con otros.
export class ByteQueue {
  private chunks: Buffer[] = [];
  private length = 0;
  private waiter: { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void } | undefined;
  private error: Error | undefined;

  get buffered(): number {
    return this.length;
  }

  push(chunk: Uint8Array): void {
    if (this.error || chunk.length === 0) return;
    const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.chunks.push(buf);
    this.length += buf.length;
    this.pump();
  }

  fail(error: Error): void {
    if (this.error) return;
    this.error = error;
    const w = this.waiter;
    this.waiter = undefined;
    w?.reject(error);
  }

  read(n: number): Promise<Buffer> {
    if (this.waiter) return Promise.reject(new Error('Lectura concurrente en ByteQueue'));
    if (this.length >= n) return Promise.resolve(this.take(n));
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      this.waiter = { n, resolve, reject };
    });
  }

  private pump(): void {
    const w = this.waiter;
    if (w && this.length >= w.n) {
      this.waiter = undefined;
      w.resolve(this.take(w.n));
    }
  }

  private take(n: number): Buffer {
    if (n === 0) return Buffer.alloc(0);
    const first = this.chunks[0];
    if (first && first.length >= n) {
      const out = first.subarray(0, n);
      if (first.length === n) this.chunks.shift();
      else this.chunks[0] = first.subarray(n);
      this.length -= n;
      return out;
    }
    const out = Buffer.allocUnsafe(n);
    let off = 0;
    while (off < n) {
      const c = this.chunks[0]!;
      const take = Math.min(c.length, n - off);
      c.copy(out, off, 0, take);
      off += take;
      if (take === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(take);
    }
    this.length -= n;
    return out;
  }
}

export function openWebSocket(url: string, opts: { timeoutMs: number; protocols?: string[] }): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opts.protocols ?? ['binary']);
    ws.binaryType = 'arraybuffer';
    let opened = false;
    let handlers: Parameters<Transport['start']>[0] | undefined;
    const early: Uint8Array[] = [];
    const timer = setTimeout(() => {
      if (!opened) {
        ws.close();
        reject(new Error(`Timeout al abrir WebSocket (${opts.timeoutMs} ms)`));
      }
    }, opts.timeoutMs);

    ws.addEventListener('open', () => {
      opened = true;
      clearTimeout(timer);
      resolve({
        send: (data) => ws.send(data),
        close: () => ws.close(),
        start: (h) => {
          handlers = h;
          for (const c of early.splice(0)) h.onData(c);
        },
      });
    });
    ws.addEventListener('message', (ev: MessageEvent) => {
      const data = ev.data;
      const chunk =
        data instanceof ArrayBuffer ? new Uint8Array(data) : typeof data === 'string' ? Buffer.from(data, 'latin1') : null;
      if (!chunk) return;
      if (handlers) handlers.onData(chunk);
      else early.push(chunk);
    });
    ws.addEventListener('error', () => {
      if (!opened) {
        clearTimeout(timer);
        reject(new Error('No se pudo abrir el WebSocket del escritorio'));
      }
    });
    ws.addEventListener('close', (ev: CloseEvent) => {
      clearTimeout(timer);
      handlers?.onClose(new Error(`WebSocket cerrado (código ${ev.code})`));
    });
  });
}

export interface ConnectOptions {
  url: string;
  password: string;
  timeoutMs?: number;
  transport?: Transport; // pruebas
  shared?: boolean;
  activityThresholdPx?: number;
}

export interface SettleOptions {
  minMs?: number; // espera mínima antes de mirar
  quietMs?: number; // silencio requerido tras el último cambio
  maxMs?: number; // tope absoluto
  changeWithinMs?: number; // si no hubo ningún cambio en este plazo, devolver sin esperar más
}

export interface RfbMetrics {
  version: ProtocolVersion;
  securityType: number;
  handshakeMs: number;
  bytesIn: number;
  updates: number;
}

export class RfbClient {
  readonly fb: Framebuffer;
  name = '';
  serverPixelFormat: PixelFormat | undefined;
  readonly metrics: RfbMetrics;
  readonly closed: Promise<Error>;

  private seq = 0;
  private lastActivityAt = performance.now();
  private isClosed = false;
  private closeReason: Error | undefined;
  private resolveClosed!: (e: Error) => void;
  private updateWaiters: Array<{ pred: (area: number) => boolean; resolve: () => void; reject: (e: Error) => void }> = [];
  private readonly activityThresholdPx: number;
  private readonly transport: Transport;
  private readonly queue: ByteQueue;

  private constructor(transport: Transport, queue: ByteQueue, metrics: RfbMetrics, width: number, height: number, activityThresholdPx: number) {
    this.transport = transport;
    this.queue = queue;
    this.metrics = metrics;
    this.fb = new Framebuffer(width, height);
    this.activityThresholdPx = activityThresholdPx;
    this.closed = new Promise((r) => (this.resolveClosed = r));
  }

  static async connect(opts: ConnectOptions): Promise<RfbClient> {
    const started = performance.now();
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const transport = opts.transport ?? (await openWebSocket(opts.url, { timeoutMs }));
    const queue = new ByteQueue();
    let bytesIn = 0;
    let client: RfbClient | undefined;
    transport.start({
      onData: (c) => {
        bytesIn += c.length;
        if (client) client.metrics.bytesIn = bytesIn;
        queue.push(c);
      },
      onClose: (e) => {
        queue.fail(e);
        client?.markClosed(e);
      },
    });

    const timer = setTimeout(() => {
      queue.fail(new Error(`Timeout de negociación RFB (${timeoutMs} ms)`));
      transport.close();
    }, timeoutMs);
    try {
      const version = chooseVersion(parseServerVersion(await queue.read(12)));
      transport.send(encodeVersion(version));
      const securityType = await negotiateSecurity(queue, transport, version, opts.password);
      transport.send(clientInit(opts.shared ?? true));
      const init = await queue.read(24);
      const width = init.readUInt16BE(0);
      const height = init.readUInt16BE(2);
      const serverPf = decodePixelFormat(init.subarray(4, 20));
      const nameLen = init.readUInt32BE(20);
      const name = (await queue.read(nameLen)).toString('utf8');
      clearTimeout(timer);

      client = new RfbClient(
        transport,
        queue,
        { version, securityType, handshakeMs: performance.now() - started, bytesIn, updates: 0 },
        width,
        height,
        opts.activityThresholdPx ?? 400,
      );
      client.name = name;
      client.serverPixelFormat = serverPf;
      transport.send(setPixelFormat(AGENT_PIXEL_FORMAT));
      transport.send(setEncodings([Encoding.CopyRect, Encoding.Raw, Encoding.DesktopSize, Encoding.LastRect]));
      transport.send(framebufferUpdateRequest(false, 0, 0, width, height));
      void client.readLoop();
      return client;
    } catch (e) {
      clearTimeout(timer);
      transport.close();
      throw e;
    }
  }

  get width(): number {
    return this.fb.width;
  }
  get height(): number {
    return this.fb.height;
  }
  get frameSeq(): number {
    return this.seq;
  }
  get isOpen(): boolean {
    return !this.isClosed;
  }

  snapshot(): Frame {
    return this.fb.snapshot(this.seq);
  }

  // Pide el framebuffer completo y espera una actualización que lo cubra.
  async refresh(timeoutMs = 10_000): Promise<Frame> {
    this.ensureOpen();
    const full = this.width * this.height;
    const wait = this.waitForUpdate((area) => area >= full * 0.98, timeoutMs);
    this.transport.send(framebufferUpdateRequest(false, 0, 0, this.width, this.height));
    await wait;
    return this.snapshot();
  }

  // Espera el repintado tras una acción: cambio y luego silencio, o ningún cambio dentro del plazo.
  // El tiempo sólo acota; no prueba éxito. La postcondición la juzga quien mira la captura.
  async settle(opts: SettleOptions = {}): Promise<Frame> {
    const start = performance.now();
    const minMs = opts.minMs ?? 100;
    const quietMs = opts.quietMs ?? 400;
    const changeWithinMs = opts.changeWithinMs ?? 1_500;
    const maxMs = Math.max(minMs, opts.maxMs ?? 4_000);
    await this.sleepOpen(minMs);
    while (performance.now() - start < maxMs) {
      const now = performance.now();
      const changed = this.lastActivityAt > start;
      if (changed && now - this.lastActivityAt >= quietMs) break;
      if (!changed && now - start >= changeWithinMs) break;
      await this.sleepOpen(40);
    }
    return this.snapshot();
  }

  sendPointer(buttonMask: number, x: number, y: number): void {
    this.ensureOpen();
    this.transport.send(pointerEvent(buttonMask, x, y));
  }

  sendKey(down: boolean, keysym: number): void {
    this.ensureOpen();
    this.transport.send(keyEvent(down, keysym));
  }

  close(): void {
    if (this.isClosed) return;
    this.transport.close();
    this.markClosed(new Error('Cerrado por el cliente'));
  }

  private ensureOpen(): void {
    if (this.isClosed) throw this.closeReason ?? new Error('Conexión RFB cerrada');
  }

  private async sleepOpen(ms: number): Promise<void> {
    this.ensureOpen();
    await Promise.race([sleep(ms), this.closed.then((e) => Promise.reject(e))]);
  }

  private markClosed(reason: Error): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.closeReason = reason;
    this.queue.fail(reason);
    for (const w of this.updateWaiters.splice(0)) w.reject(reason);
    this.resolveClosed(reason);
  }

  private waitForUpdate(pred: (area: number) => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.updateWaiters = this.updateWaiters.filter((w) => w !== waiter);
        reject(new Error(`Timeout esperando actualización de pantalla (${timeoutMs} ms)`));
      }, timeoutMs);
      const waiter = {
        pred,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.updateWaiters.push(waiter);
    });
  }

  private async readLoop(): Promise<void> {
    try {
      while (!this.isClosed) {
        const type = (await this.queue.read(1))[0];
        switch (type) {
          case ServerMsg.FramebufferUpdate:
            await this.readFramebufferUpdate();
            break;
          case ServerMsg.SetColourMapEntries: {
            const h = await this.queue.read(5);
            await this.queue.read(h.readUInt16BE(3) * 6);
            break;
          }
          case ServerMsg.Bell:
            break;
          case ServerMsg.ServerCutText: {
            const h = await this.queue.read(7);
            await this.queue.read(h.readUInt32BE(3));
            break;
          }
          default:
            throw new Error(`Mensaje RFB del servidor no soportado: ${type}`);
        }
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (!this.isClosed) {
        this.transport.close();
        this.markClosed(err);
      }
    }
  }

  private async readFramebufferUpdate(): Promise<void> {
    const h = await this.queue.read(3);
    const count = h.readUInt16BE(1);
    let area = 0;
    let resized = false;
    for (let i = 0; i < count; i++) {
      const r = await this.queue.read(12);
      const x = r.readUInt16BE(0);
      const y = r.readUInt16BE(2);
      const w = r.readUInt16BE(4);
      const hgt = r.readUInt16BE(6);
      const enc = r.readInt32BE(8);
      if (enc === Encoding.LastRect) break;
      if (enc === Encoding.Raw) {
        this.fb.putRaw({ x, y, w, h: hgt }, await this.queue.read(w * hgt * 4));
        area += w * hgt;
      } else if (enc === Encoding.CopyRect) {
        const src = await this.queue.read(4);
        this.fb.copyRect({ x, y, w, h: hgt }, src.readUInt16BE(0), src.readUInt16BE(2));
        area += w * hgt;
      } else if (enc === Encoding.DesktopSize) {
        this.fb.resize(w, hgt);
        resized = true;
      } else {
        throw new Error(`Encoding RFB no soportado: ${enc}`);
      }
    }
    this.seq++;
    this.metrics.updates++;
    if (area >= this.activityThresholdPx || resized) this.lastActivityAt = performance.now();
    for (const w of [...this.updateWaiters]) {
      if (w.pred(area)) {
        this.updateWaiters = this.updateWaiters.filter((x) => x !== w);
        w.resolve();
      }
    }
    if (this.isClosed) return;
    if (resized) {
      this.transport.send(framebufferUpdateRequest(false, 0, 0, this.width, this.height));
    } else {
      // Actualizaciones continuas; si el servidor respondió vacío, no entrar en ping-pong.
      if (count === 0) await sleep(100);
      if (!this.isClosed) this.transport.send(framebufferUpdateRequest(true, 0, 0, this.width, this.height));
    }
  }
}

async function negotiateSecurity(
  queue: ByteQueue,
  transport: Transport,
  version: ProtocolVersion,
  password: string,
): Promise<number> {
  const readReason = async (): Promise<string> => {
    const len = (await queue.read(4)).readUInt32BE(0);
    return (await queue.read(Math.min(len, 4096))).toString('utf8');
  };

  let chosen: number;
  if (version === '3.3') {
    chosen = (await queue.read(4)).readUInt32BE(0);
    if (chosen === 0) throw new Error(`El servidor VNC rechazó la conexión: ${await readReason()}`);
  } else {
    const n = (await queue.read(1))[0]!;
    if (n === 0) throw new Error(`El servidor VNC rechazó la conexión: ${await readReason()}`);
    const offered = [...(await queue.read(n))];
    if (offered.includes(SecurityType.VncAuth) && password) chosen = SecurityType.VncAuth;
    else if (offered.includes(SecurityType.None)) chosen = SecurityType.None;
    else if (offered.includes(SecurityType.VncAuth)) chosen = SecurityType.VncAuth;
    else throw new Error(`Tipos de seguridad VNC no soportados: ${offered.join(',')}`);
    transport.send(Buffer.from([chosen]));
  }

  if (chosen === SecurityType.VncAuth) {
    const challenge = await queue.read(16);
    transport.send(vncAuthResponse(challenge, password));
  } else if (chosen !== SecurityType.None) {
    throw new Error(`Tipo de seguridad VNC no soportado: ${chosen}`);
  }

  if (chosen === SecurityType.VncAuth || version === '3.8') {
    const result = (await queue.read(4)).readUInt32BE(0);
    if (result !== 0) {
      const reason = version === '3.8' ? await readReason().catch(() => '') : '';
      throw new Error(`Autenticación VNC rechazada${reason ? `: ${reason}` : ''}`);
    }
  }
  return chosen;
}
