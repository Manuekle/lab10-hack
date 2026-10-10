// Canario de incidentes: vigila el escritorio de práctica sin tocarlo (sólo lectura) y detecta cambios del sistema:
// caída, cambio de tamaño, cambio de cabecera/versión de la app y degradación de tiempos. Con --verify, ante un cambio
// corre una prueba de lectura contra el agente para comprobar que sigue funcionando.
// Uso: npm run canary -- [--interval 60] [--minutes 45] [--verify E3] [--base http://localhost:18080]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { loadPracticeConfig } from '../src/config.ts';
import { redact } from '../src/redact.ts';
import { RfbClient } from '../src/rfb/client.ts';
import { diffRatio, encodePng, type Frame } from '../src/rfb/framebuffer.ts';
import { arg, artifactPath, decodeOwnPng, stamp } from './lib.ts';

const practice = loadPracticeConfig();
const secrets = [practice.desktopPassword, practice.desktopToken ?? ''];
const intervalMs = Number(arg('interval') || 60) * 1000;
const until = Date.now() + Number(arg('minutes') || 45) * 60_000;
const verify = arg('verify');
const base = arg('base') || 'http://localhost:18080';
const desk = practice.desktopUrl.replace(/^ws/, 'http').replace(/\/websockify\/?$/, '');
const baselineFile = artifactPath('canary-baseline.png');
// Sólo la barra de título (nombre, versión, fecha). La barra de menús cambia con el uso normal del agente (menús abiertos).
const HEADER_H = 32;

interface Sample {
  ok: boolean;
  healthMs: number;
  connectMs: number;
  frameMs: number;
  frame?: Frame;
  error?: string;
}

async function sample(): Promise<Sample> {
  const t0 = performance.now();
  const h = await fetch(`${desk}/health`).then((r) => r.ok).catch(() => false);
  const healthMs = Math.round(performance.now() - t0);
  if (!h) return { ok: false, healthMs, connectMs: 0, frameMs: 0, error: 'health del escritorio no responde' };
  let c: RfbClient | undefined;
  try {
    const t1 = performance.now();
    c = await RfbClient.connect({ url: practice.desktopUrl, password: practice.desktopPassword, timeoutMs: 20_000 });
    const connectMs = Math.round(performance.now() - t1);
    const t2 = performance.now();
    const frame = await c.refresh(20_000);
    return { ok: true, healthMs, connectMs, frameMs: Math.round(performance.now() - t2), frame };
  } catch (e) {
    return { ok: false, healthMs, connectMs: 0, frameMs: 0, error: redact(e instanceof Error ? e.message : String(e), secrets) };
  } finally {
    c?.close();
  }
}

// Pantalla casi uniforme (navegador reiniciándose tras un reset): no es un cambio de la app.
function isBlank(f: Frame): boolean {
  let same = 0;
  const n = f.width * f.height;
  for (let i = 0; i < n * 4; i += 4 * 97) if (f.data[i] === f.data[0] && f.data[i + 1] === f.data[1] && f.data[i + 2] === f.data[2]) same++;
  return same / Math.ceil(n / 97) > 0.98;
}

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));

let baseline: Frame | undefined = fs.existsSync(baselineFile) ? decodeOwnPng(fs.readFileSync(baselineFile)) : undefined;
let slowStreak = 0;
let blankStreak = 0;
let lastAlert = '';
while (Date.now() < until) {
  const s = await sample();
  const alerts: string[] = [];
  if (!s.ok) alerts.push(`escritorio caído o inaccesible: ${s.error}`);
  if (s.frame && isBlank(s.frame)) {
    blankStreak++;
    if (blankStreak >= 3) alerts.push(`pantalla en blanco durante ${blankStreak} muestras seguidas`);
  } else if (s.frame) {
    blankStreak = 0;
    if (!baseline) {
      baseline = s.frame;
      fs.writeFileSync(baselineFile, encodePng(s.frame));
      log('canary_baseline', { width: s.frame.width, height: s.frame.height });
    } else if (s.frame.width !== baseline.width || s.frame.height !== baseline.height) {
      alerts.push(`cambió el tamaño del escritorio: ${baseline.width}x${baseline.height} -> ${s.frame.width}x${s.frame.height}`);
    } else {
      const header = diffRatio(baseline, s.frame, { x: 0, y: 0, w: s.frame.width, h: HEADER_H });
      if (header > 0.02) alerts.push(`cambió la barra de título de la app (${(header * 100).toFixed(1)}% de píxeles)`);
    }
    slowStreak = s.connectMs + s.frameMs > 8_000 ? slowStreak + 1 : 0;
    if (slowStreak >= 2) alerts.push(`el escritorio está lento: conexión ${s.connectMs} ms, captura ${s.frameMs} ms`);
  }
  log('canary_sample', { ok: s.ok, healthMs: s.healthMs, connectMs: s.connectMs, frameMs: s.frameMs, alerts: alerts.length });
  const key = alerts.join('|');
  if (alerts.length && key !== lastAlert) {
    lastAlert = key;
    const file = s.frame ? artifactPath(`canary-change-${stamp()}.png`) : undefined;
    if (file && s.frame) fs.writeFileSync(file, encodePng(s.frame));
    log('canary_ALERT', { alerts, evidence: file });
    if (verify) {
      // Comprobar que el agente se adapta: una prueba real desde reset contra el servicio.
      try {
        const out = execFileSync(process.execPath, ['--env-file-if-exists=.env', 'scripts/practice.ts', verify, '--base', base], { encoding: 'utf8', timeout: 360_000 });
        log('canary_verify', { test: verify, result: redact(out.trim().split('\n').slice(-1)[0] ?? '', secrets) });
      } catch (e) {
        const out = (e as { stdout?: string }).stdout ?? '';
        log('canary_verify', { test: verify, result: 'falló', detail: redact(out.trim().split('\n').slice(-3).join(' / '), secrets) });
      }
    }
    if (s.frame && !isBlank(s.frame)) {
      baseline = s.frame; // nueva normalidad: alertar sólo ante el próximo cambio
      fs.writeFileSync(baselineFile, encodePng(s.frame));
    }
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}
