// Proceso driver de una tarea: único dueño del socket RFB. Ejecuta sólo acciones que ordena el supervisor.
// Se recupera solo: reconecta si cae el VNC y aprende si la app repinta más lento de lo previsto.
import dns from 'node:dns/promises';
import { isPrivateHost } from './desktop-url.ts';
import { serveChild, type DriverRequest, type DriverResponse, type FramePayload } from './ipc.ts';
import type { Action } from './model/actions.ts';
import { diffRatio, encodePng, type Frame } from './rfb/framebuffer.ts';
import { DesktopSession } from './rfb/session.ts';

const NO_CHANGE = 0.001;
const SLOWDOWN_STEP_MS = 400;
const SLOWDOWN_MAX_MS = 2_500;
const MAX_RECONNECTS = 3;

let target: { url: string; password: string } | undefined;
let session: DesktopSession | undefined;
let last: Frame | undefined;
let lastAction: Action | undefined;
let lastChanged = 1;
let slowdownMs = 0;
let reconnects = 0;
let closing = false;

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function payload(frame: Frame, changed: number, extra: Partial<FramePayload> = {}): FramePayload {
  return { width: frame.width, height: frame.height, png: encodePng(frame), changed, slowdownMs, ...extra };
}

// SSRF: el hostname debe resolver a direcciones públicas, no sólo parecerlo.
async function assertPublic(url: string, allowPrivate: boolean): Promise<void> {
  if (allowPrivate) return;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const addrs = await dns.lookup(host, { all: true }).catch(() => fail('dns', 'No se pudo resolver el escritorio'));
  if (addrs.length === 0 || addrs.some((a) => isPrivateHost(a.address))) fail('private_desktop', 'El escritorio resuelve a una red privada');
}

async function open(): Promise<DesktopSession> {
  if (!target) fail('not_connected', 'Driver sin escritorio');
  // Conectar aún no actúa sobre la app: reintentar fallos de red es seguro. Una contraseña rechazada no se reintenta.
  for (let attempt = 1; ; attempt++) {
    try {
      const s = await DesktopSession.open({ url: target.url, password: target.password, timeoutMs: 15_000 });
      s.slowdownMs = slowdownMs;
      return s;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (closing || attempt >= 3 || /Autenticación VNC rechazada|no soportad/.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 1_000 * attempt));
    }
  }
}

// Devuelve una sesión viva; si la conexión cayó, reconecta (con tope) e indica que hubo reconexión.
async function ensureSession(): Promise<{ s: DesktopSession; reconnected: boolean }> {
  if (closing) fail('closing', 'Driver cerrándose');
  if (session?.client.isOpen) return { s: session, reconnected: false };
  if (reconnects >= MAX_RECONNECTS) fail('disconnected', 'Se perdió la conexión con el escritorio demasiadas veces');
  reconnects++;
  session?.close();
  session = await open();
  last = session.snapshot();
  return { s: session, reconnected: true };
}

// Si la pantalla cambió después de devolver una captura "sin cambios", la app repinta tarde: alargar la espera.
function learnLateRepaint(changedSince: number): boolean {
  const waitedOnInput = lastAction && (lastAction.type === 'click' || lastAction.type === 'double_click' || lastAction.type === 'key');
  if (waitedOnInput && lastChanged < NO_CHANGE && changedSince > NO_CHANGE && slowdownMs < SLOWDOWN_MAX_MS) {
    slowdownMs = Math.min(SLOWDOWN_MAX_MS, slowdownMs + SLOWDOWN_STEP_MS);
    if (session) session.slowdownMs = slowdownMs;
    return true;
  }
  return false;
}

function shutdown(code: number): never {
  closing = true;
  try {
    session?.close(); // libera teclas y botones si la conexión responde
  } catch {
    // nada más que hacer
  }
  process.exit(code);
}

serveChild<DriverRequest, DriverResponse>(
  async (req): Promise<DriverResponse> => {
    switch (req.type) {
      case 'connect': {
        if (target) fail('already_connected', 'Driver ya conectado');
        target = { url: req.url, password: req.password };
        slowdownMs = Math.max(0, Math.min(SLOWDOWN_MAX_MS, req.slowdownMs));
        await assertPublic(req.url, req.allowPrivate);
        session = await open();
        if (closing) shutdown(0);
        last = session.snapshot();
        return { type: 'frame', frame: payload(last, 1) };
      }
      case 'observe': {
        const { s, reconnected } = await ensureSession();
        const now = s.snapshot();
        const changed = last ? diffRatio(last, now) : 1;
        const learned = learnLateRepaint(changed);
        if (changed > NO_CHANGE || reconnected) last = now;
        lastChanged = changed;
        return { type: 'frame', frame: payload(now, changed, { reconnected, ...(learned ? { learnedSlowdown: true } : {}) }) };
      }
      case 'execute': {
        const { s, reconnected } = await ensureSession();
        if (reconnected) {
          // La pantalla pudo cambiar: no ejecutar una acción decidida sobre la captura anterior.
          lastAction = undefined;
          return { type: 'frame', frame: payload(last!, 1, { reconnected: true, skipped: true }) };
        }
        const before = last ?? s.snapshot();
        try {
          const after = await s.execute(req.action);
          last = after;
          lastAction = req.action;
          lastChanged = diffRatio(before, after);
          return { type: 'frame', frame: payload(after, lastChanged) };
        } catch (e) {
          if (!s.client.isOpen && !closing) fail('disconnected', 'La conexión con el escritorio se cayó durante la acción');
          throw e;
        }
      }
      case 'close': {
        closing = true;
        session?.close();
        setImmediate(() => process.exit(0));
        return { type: 'closed' };
      }
    }
  },
  () => shutdown(1),
);
process.on('SIGTERM', () => shutdown(0));
