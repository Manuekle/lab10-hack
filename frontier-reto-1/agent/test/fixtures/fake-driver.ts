// Driver falso: capturas sintéticas. FAKE_DRIVER: normal | hang-execute | ignore-close. FAKE_LOG: archivo de acciones.
import fs from 'node:fs';
import { serveChild, type DriverRequest, type DriverResponse } from '../../src/ipc.ts';
import { encodePng, Framebuffer } from '../../src/rfb/framebuffer.ts';

const mode = process.env.FAKE_DRIVER ?? 'normal';
const logFile = process.env.FAKE_LOG;
const png = encodePng(new Framebuffer(64, 40).snapshot(0));
const note = (line: string) => logFile && fs.appendFileSync(logFile, `${Date.now()} ${line}\n`);

if (mode === 'ignore-close') process.on('SIGTERM', () => note('sigterm-ignored'));

serveChild<DriverRequest, DriverResponse>(
  async (req) => {
    if (req.type === 'connect') {
      note(`connect ${req.url}`);
      return { type: 'frame', frame: { width: 64, height: 40, png, changed: 1 } };
    }
    if (req.type === 'execute') {
      note(`execute ${req.action.type}`);
      if (mode === 'hang-execute' || mode === 'ignore-close') return new Promise<never>(() => {});
      return { type: 'frame', frame: { width: 64, height: 40, png, changed: 0.2 } };
    }
    note('close');
    if (mode === 'ignore-close') return new Promise<never>(() => {});
    setImmediate(() => process.exit(0));
    return { type: 'closed' };
  },
  () => process.exit(1),
);
