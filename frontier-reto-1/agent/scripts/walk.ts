// C1: captura -> propuesta validada -> acción reversible -> captura posterior, sobre el escritorio de práctica.
// Modo seguro: rechaza objetivos que parezcan guardar, borrar, crear o exportar. Por defecto no escribe texto.
// Uso: npm run walk -- --task "Abre el listado de clientes sin modificar nada" [--steps 3] [--allow-typing]
import fs from 'node:fs';
import { loadModelConfig, loadPracticeConfig, secretValues } from '../src/config.ts';
import { stepPrompt, systemPrompt, type HistoryEntry } from '../src/agent/prompt.ts';
import type { CoordMode } from '../src/model/actions.ts';
import { OpenRouterClient, proposeAction } from '../src/model/openrouter.ts';
import { redact } from '../src/redact.ts';
import { diffRatio, encodePng } from '../src/rfb/framebuffer.ts';
import { DesktopSession } from '../src/rfb/session.ts';
import { arg, artifactPath, drawMarker, flag, stamp } from './lib.ts';

const practice = loadPracticeConfig();
const model = loadModelConfig();
const secrets = secretValues(practice, model);
const task = arg('task') || 'Abre el listado de clientes sin modificar ningún dato. Termina cuando lo veas.';
const maxSteps = Math.max(1, Number(arg('steps') || 3));
const allowTyping = flag('allow-typing');
const coords = (arg('coords') || model.openrouterCoords) as CoordMode;
const UNSAFE = /guardar|grabar|eliminar|borrar|crear|nuevo|exportar|confirmar|aceptar|enviar|save|delete|remove|export|submit|confirm/i;

const runId = stamp();
const started = performance.now();
const deadline = started + 270_000;
const client = new OpenRouterClient({
  apiKey: model.openrouterApiKey,
  model: model.openrouterModel,
  ...(model.openrouterFallbackModel ? { fallbackModel: model.openrouterFallbackModel } : {}),
  timeoutMs: model.inferenceTimeoutMs,
  attempts: model.inferenceAttempts,
  forbidden: secrets,
});

const session = await DesktopSession.open({ url: practice.desktopUrl, password: practice.desktopPassword });
const history: HistoryEntry[] = [];
const metrics: Array<Record<string, unknown>> = [];
let notes = '';
let totalCost = 0;
try {
  let frame = session.snapshot();
  for (let step = 1; step <= maxSteps; step++) {
    fs.writeFileSync(artifactPath(`walk-${runId}-${step}-before.png`), encodePng(frame));
    const tInfer = performance.now();
    const r = await proposeAction(client, {
      system: systemPrompt(coords),
      text: stepPrompt({
        coords,
        task,
        frameId: frame.id,
        width: frame.width,
        height: frame.height,
        step,
        maxSteps,
        remainingSec: (deadline - performance.now()) / 1000,
        notes,
        history,
      }),
      screenshot: { mime: 'image/png', data: encodePng(frame) },
      ctx: { frameId: frame.id, width: frame.width, height: frame.height, coords },
      deadline,
    });
    totalCost += r.usage.cost ?? 0;
    const p = r.value;
    notes = p.notes;
    const a = p.action;
    const row: Record<string, unknown> = {
      step,
      inferMs: Math.round(performance.now() - tInfer),
      attempts: r.attempts,
      tokens: `${r.usage.promptTokens}+${r.usage.completionTokens}`,
      cost: r.usage.cost,
      action: a,
      target: p.target,
      expected: p.expected,
    };
    if ('x' in a) fs.writeFileSync(artifactPath(`walk-${runId}-${step}-target.png`), encodePng(drawMarker(frame, a.x, a.y)));

    if (a.type === 'finish') {
      row.finish = { status: a.status, summary: redact(a.summary, secrets), answer: a.answer };
      metrics.push(row);
      console.log(JSON.stringify(row));
      break;
    }
    const refused =
      UNSAFE.test(`${p.target} ${p.reason}`) ? 'objetivo con apariencia de escritura' : !allowTyping && (a.type === 'replace_text' || a.type === 'type_text') ? 'escritura deshabilitada (--allow-typing)' : '';
    if (refused) {
      row.refused = refused;
      metrics.push(row);
      console.log(JSON.stringify(row));
      history.push({ step, action: a.type, target: p.target, expected: p.expected, outcome: `rechazada por el supervisor: ${refused}` });
      frame = session.snapshot();
      continue;
    }

    const tAct = performance.now();
    const after = await session.execute(a);
    const changed = diffRatio(frame, after);
    row.actMs = Math.round(performance.now() - tAct);
    row.screenChanged = Number(changed.toFixed(4));
    fs.writeFileSync(artifactPath(`walk-${runId}-${step}-after.png`), encodePng(after));
    history.push({
      step,
      action: `${a.type}${'x' in a ? ` (${a.x},${a.y})` : ''}${'text' in a ? ` "${a.text}"` : ''}${'key' in a ? ` ${a.key}` : ''}`,
      target: p.target,
      expected: p.expected,
      outcome: changed > 0.001 ? `la pantalla cambió (${(changed * 100).toFixed(1)}% de píxeles)` : 'la pantalla no cambió',
    });
    metrics.push(row);
    console.log(JSON.stringify(row));
    frame = after;
  }
} catch (e) {
  console.error(redact(`walk falló: ${e instanceof Error ? e.message : String(e)}`, secrets));
  process.exitCode = 1;
} finally {
  session.close();
}
const summary = { runId, task, model: model.openrouterModel, steps: metrics.length, totalMs: Math.round(performance.now() - started), totalCostUsd: totalCost, metrics };
fs.writeFileSync(artifactPath(`walk-${runId}.json`), JSON.stringify(summary, null, 2));
console.log(`total ${summary.totalMs} ms, $${totalCost.toFixed(4)}; evidencia en .artifacts/walk-${runId}-*`);
