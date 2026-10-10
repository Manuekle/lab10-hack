// Proceso driver de una tarea: único dueño del socket RFB. Ejecuta sólo acciones que ordena el supervisor.
import { serveChild, type DriverRequest, type DriverResponse, type FramePayload } from './ipc.ts';
import { diffRatio, encodePng, type Frame } from './rfb/framebuffer.ts';
import { DesktopSession } from './rfb/session.ts';

let session: DesktopSession | undefined;
let last: Frame | undefined;
let closing = false;

function payload(frame: Frame, changed: number): FramePayload {
  return { width: frame.width, height: frame.height, png: encodePng(frame), changed };
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
  async (req) => {
    switch (req.type) {
      case 'connect': {
        if (session) throw Object.assign(new Error('Driver ya conectado'), { code: 'already_connected' });
        // Conectar aún no actúa sobre la app: reintentar fallos de red es seguro. Una contraseña rechazada no se reintenta.
        for (let attempt = 1; ; attempt++) {
          try {
            session = await DesktopSession.open({ url: req.url, password: req.password, timeoutMs: 15_000 });
            break;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (closing || attempt >= 3 || /Autenticación VNC rechazada|no soportad/.test(msg)) throw e;
            await new Promise((r) => setTimeout(r, 1_000 * attempt));
          }
        }
        if (closing) shutdown(0);
        last = session.snapshot();
        return { type: 'frame', frame: payload(last, 1) };
      }
      case 'execute': {
        if (!session || closing) throw Object.assign(new Error('Driver no disponible'), { code: 'not_connected' });
        const before = last ?? session.snapshot();
        const after = await session.execute(req.action);
        last = after;
        return { type: 'frame', frame: payload(after, diffRatio(before, after)) };
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
