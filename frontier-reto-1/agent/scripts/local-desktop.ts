// Prueba de punta a punta del driver contra el escritorio VNC local (test/fixtures/vnc).
// Valida: WebSocket real, auth VncAuth, Raw 1280x800, clic mantenido y texto completo con acentos.
// Uso: npm run test:local-desktop   (necesita Docker)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { encodePng } from '../src/rfb/framebuffer.ts';
import { DesktopSession } from '../src/rfb/session.ts';
import { artifactPath } from './lib.ts';

const NAME = 'reto1-testdesktop';
const PORT = 16080;
const PASSWORD = 'testpass';
const TEXT = 'Calle 80 # 24-15, Papelería Ñandú áéíóú ¿ok?';
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' });

docker('build', '-q', '-t', NAME, path.resolve(import.meta.dirname, '..', 'test', 'fixtures', 'vnc'));
try {
  docker('rm', '-f', NAME);
} catch {
  // no existía
}
docker('run', '-d', '--name', NAME, '-p', `${PORT}:6080`, '-e', `VNC_PASSWORD=${PASSWORD}`, NAME);

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failures.push(msg);
};

try {
  await sleep(2_500);
  const t0 = performance.now();
  const s = await DesktopSession.open({ url: `ws://localhost:${PORT}/websockify`, password: PASSWORD });
  const tOpen = performance.now() - t0;
  const frame = s.snapshot();
  check(frame.width === 1280 && frame.height === 800, `framebuffer ${frame.width}x${frame.height} en ${Math.round(tOpen)} ms (${s.client.metrics.bytesIn} bytes)`);
  // Pixel del fondo (#2b4a6f) en formato B,G,R.
  const i = (790 * 1280 + 10) * 4;
  check(frame.data[i] === 0x6f && frame.data[i + 1] === 0x4a && frame.data[i + 2] === 0x2b, 'color de fondo compuesto correctamente');
  fs.writeFileSync(artifactPath('local-desktop-before.png'), encodePng(frame));

  // Campo de texto (xterm) y clic de registro (xev).
  await s.execute({ type: 'click', x: 200, y: 90 }, { minMs: 300 });
  await s.execute({ type: 'type_text', text: TEXT }, { minMs: 200 });
  await s.execute({ type: 'key', key: 'Return' }, { minMs: 500 });
  await s.execute({ type: 'click', x: 960, y: 210 }, { minMs: 500 });
  const after = s.snapshot();
  fs.writeFileSync(artifactPath('local-desktop-after.png'), encodePng(after));
  s.close();

  await sleep(300);
  const typed = docker('exec', NAME, 'sh', '-c', 'cat /tmp/typed.txt 2>/dev/null || true').replace(/\n$/, '');
  check(typed === TEXT, `texto completo con acentos: ${JSON.stringify(typed)}`);

  const xev = docker('exec', NAME, 'cat', '/tmp/xev.log');
  const times = [...xev.matchAll(/(ButtonPress|ButtonRelease) event[\s\S]*?time (\d+)/g)].map((m) => ({ kind: m[1], t: Number(m[2]) }));
  const press = times.find((e) => e.kind === 'ButtonPress');
  const release = times.find((e) => e.kind === 'ButtonRelease');
  const held = press && release ? release.t - press.t : -1;
  check(held >= 100, `clic mantenido ${held} ms (umbral de la app: 100 ms)`);
} catch (e) {
  failures.push(e instanceof Error ? e.message : String(e));
  console.error(e);
} finally {
  docker('rm', '-f', NAME);
}
process.exitCode = failures.length ? 1 : 0;
