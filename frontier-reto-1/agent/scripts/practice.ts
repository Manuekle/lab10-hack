// Harness de práctica: reset, tarea con sólo `instruccion`, consulta como el evaluador, /__check y evaluación del resumen.
// Uso: npm run practice -- [E1 E2 … | all] [--base http://localhost:18080] [--rounds 1]
import fs from 'node:fs';
import path from 'node:path';
import { loadPracticeConfig } from '../src/config.ts';
import { redact } from '../src/redact.ts';
import { evaluateSummary, type PracticeTest } from './evaluate-summary.ts';
import { arg } from './lib.ts';

const practice = loadPracticeConfig();
if (!practice.desktopToken) throw new Error('Falta PRACTICE_DESKTOP_TOKEN');
const teamToken = process.env.TEAM_TOKEN;
if (!teamToken) throw new Error('Falta TEAM_TOKEN');
const base = arg('base') || 'http://localhost:18080';
const rounds = Math.max(1, Number(arg('rounds') || 1));
const secrets = [practice.desktopPassword, practice.desktopToken, teamToken];
const desk = practice.desktopUrl.replace(/^ws/, 'http').replace(/\/websockify\/?$/, '');

const dir = path.resolve(import.meta.dirname, '..', '..', 'pruebas');
const all = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as PracticeTest & Record<string, unknown>);
const wanted = process.argv.slice(2).filter((a) => /^E\d+$/i.test(a)).map((a) => a.toUpperCase());
const tests = wanted.length ? all.filter((t) => wanted.includes(t.id)) : all;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const deskAuth = { Authorization: `Bearer ${practice.desktopToken}`, 'Content-Type': 'application/json' };

async function reset(): Promise<number> {
  const t0 = Date.now();
  const r = await fetch(`${desk}/__reset`, { method: 'POST', headers: deskAuth });
  if (!r.ok) throw new Error(`__reset respondió ${r.status}`);
  for (let i = 0; i < 30; i++) {
    const h = await fetch(`${desk}/health`).catch(() => null);
    if (h?.ok) break;
    await sleep(1_000);
  }
  await sleep(5_000); // el navegador kiosko recarga la app
  return Date.now() - t0;
}

async function check(test: unknown): Promise<{ pass: boolean; checks: Array<{ nombre: string; ok: boolean }> }> {
  const r = await fetch(`${desk}/__check`, { method: 'POST', headers: deskAuth, body: JSON.stringify(test) });
  if (!r.ok) throw new Error(`__check respondió ${r.status}`);
  return (await r.json()) as { pass: boolean; checks: Array<{ nombre: string; ok: boolean }> };
}

async function runTask(instruccion: string): Promise<{ estado: string; resumen: string; ms: number; admitMs: number }> {
  const t0 = performance.now();
  const r = await fetch(`${base}/tasks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${teamToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tarea: instruccion, escritorio: { url: practice.desktopUrl, password: practice.desktopPassword } }),
  });
  const admitMs = Math.round(performance.now() - t0);
  const body = (await r.json()) as { task_id?: string; error?: { code: string } };
  if (!body.task_id) throw new Error(`POST /tasks ${r.status} ${body.error?.code ?? ''}`);
  for (;;) {
    await sleep(5_000);
    const g = await fetch(`${base}/tasks/${body.task_id}`, { headers: { Authorization: `Bearer ${teamToken}` } });
    const s = (await g.json()) as { estado: string; resumen: string };
    if (s.estado !== 'en_curso') return { ...s, ms: Math.round(performance.now() - t0), admitMs };
    if (performance.now() - t0 > 300_000) return { estado: 'sin_terminal_a_los_300s', resumen: s.resumen, ms: 300_000, admitMs };
  }
}

const report = path.resolve(import.meta.dirname, '..', '..', 'output', 'audit', 'ejecucion.md');
if (!fs.existsSync(report)) {
  fs.writeFileSync(
    report,
    '# Ejecución de las pruebas de práctica\n\nCada fila es una tarea desde `/__reset`, enviada al servicio con sólo `instruccion` y comprobada con `/__check` (estado de la app) y con el evaluador de resúmenes (estado y resumen). Generado por `npm run practice`.\n\n| Hora (UTC) | Servicio | Ronda | Prueba | App (`/__check`) | Resumen | Estado | Duración | Admisión | Detalle |\n| --- | --- | ---: | --- | --- | --- | --- | ---: | ---: | --- |\n',
  );
}

let passed = 0;
let total = 0;
for (let round = 1; round <= rounds; round++) {
  for (const test of tests) {
    total++;
    const resetMs = await reset();
    const run = await runTask(test.instruccion);
    const app = await check(test);
    const summary = evaluateSummary(test, run.estado, run.resumen, secrets);
    const ok = app.pass && summary.ok;
    if (ok) passed++;
    const failedChecks = app.checks.filter((c) => !c.ok).map((c) => c.nombre);
    const detail = [...failedChecks.map((c) => `check: ${c}`), ...summary.reasons].join('; ') || 'ok';
    const service = base.includes('localhost') ? 'local' : new URL(base).host;
    fs.appendFileSync(
      report,
      `| ${new Date().toISOString().slice(0, 19)} | ${service} | ${round} | ${test.id} | ${app.pass ? 'pasa' : 'falla'} | ${summary.ok ? 'ok' : 'falla'} | ${run.estado} | ${(run.ms / 1000).toFixed(1)} s | ${run.admitMs} ms | ${redact(detail, secrets).replace(/\|/g, '/')} |\n`,
    );
    console.log(`${ok ? 'PASA' : 'FALLA'} ronda ${round} ${test.id} (${(run.ms / 1000).toFixed(1)} s, reset ${Math.round(resetMs / 1000)} s) ${detail}`);
    console.log(redact(`  ${run.estado}: ${run.resumen.replace(/\n/g, ' | ').slice(0, 300)}`, secrets));
  }
}
console.log(`\n${passed}/${total} aceptadas. Registro: ${path.relative(process.cwd(), report)}`);
process.exitCode = passed === total ? 0 : 1;
