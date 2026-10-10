// T04: mide modelos de OpenRouter sobre una captura: validez del JSON, lectura, coordenadas, latencia y costo.
// Uso:
//   npm run benchmark -- --image .artifacts/capture-*.png --models a/b,c/d [--task "..."] [--runs 2] [--read]
//   npm run benchmark -- --live --models a/b
import fs from 'node:fs';
import path from 'node:path';
import { loadModelConfig, loadPracticeConfig, secretValues, type PracticeConfig } from '../src/config.ts';
import { stepPrompt, systemPrompt } from '../src/agent/prompt.ts';
import type { CoordMode } from '../src/model/actions.ts';
import { OpenRouterClient, proposeAction, type ImageInput, type StructuredMode } from '../src/model/openrouter.ts';
import { redact } from '../src/redact.ts';
import { RfbClient } from '../src/rfb/client.ts';
import { encodePng, type Frame } from '../src/rfb/framebuffer.ts';
import { arg, artifactPath, decodeOwnPng, drawMarker, flag, stamp } from './lib.ts';

const model = loadModelConfig({ ...process.env, OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'unset' });
const models = (arg('models') || process.env.OPENROUTER_MODEL || '').split(',').map((m) => m.trim()).filter(Boolean);
if (models.length === 0) throw new Error('Indica --models o OPENROUTER_MODEL');
const task = arg('task') || 'Abre el listado de clientes sin modificar ningún dato.';
const runs = Math.max(1, Number(arg('runs') || 1));
const structured = (arg('structured') || 'json_schema') as StructuredMode;
const doRead = flag('read');
const coordModes = (arg('coords') || 'pixel').split(',') as CoordMode[];
// Caja esperada del objetivo "x,y,w,h" en píxeles: mide si el clic propuesto acierta.
const expect = arg('expect')?.split(',').map(Number);

let practice: PracticeConfig | undefined;
let frame: Frame | undefined;
let image: ImageInput;
let width = 1280;
let height = 800;
let source: string;

if (flag('live')) {
  practice = loadPracticeConfig();
  const c = await RfbClient.connect({ url: practice.desktopUrl, password: practice.desktopPassword, timeoutMs: 20_000 });
  try {
    frame = await c.refresh(20_000);
  } finally {
    c.close();
  }
  image = { mime: 'image/png', data: encodePng(frame) };
  fs.writeFileSync(artifactPath(`bench-source-${stamp()}.png`), image.data);
  source = 'live';
} else {
  const file = arg('image');
  if (!file) throw new Error('Indica --image <png|jpg> o --live');
  const data = fs.readFileSync(file);
  const isPng = data.readUInt32BE(0) === 0x89504e47;
  image = { mime: isPng ? 'image/png' : 'image/jpeg', data };
  source = path.basename(file);
  if (isPng) {
    try {
      frame = decodeOwnPng(data);
    } catch {
      frame = undefined;
    }
  }
  if (isPng) {
    width = data.readUInt32BE(16);
    height = data.readUInt32BE(20);
  }
}
if (frame) {
  width = frame.width;
  height = frame.height;
}

const secrets = secretValues(model, ...(practice ? [practice] : []));
const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fecha_app', 'titulo', 'menus', 'botones', 'campos', 'columnas_tabla', 'filas_visibles', 'texto_pequeno'],
  properties: {
    fecha_app: { type: ['string', 'null'] },
    titulo: { type: 'string' },
    menus: { type: 'array', items: { type: 'string' } },
    botones: { type: 'array', items: { type: 'string' } },
    campos: { type: 'array', items: { type: 'string' } },
    columnas_tabla: { type: 'array', items: { type: 'string' } },
    filas_visibles: { type: 'integer' },
    texto_pequeno: { type: 'string', description: 'Transcribe literalmente el texto más pequeño legible' },
  },
};

const results: Array<Record<string, unknown>> = [];
for (const m of models) for (const coords of coordModes) {
  const client = new OpenRouterClient({
    apiKey: model.openrouterApiKey,
    model: m,
    timeoutMs: model.inferenceTimeoutMs,
    attempts: model.inferenceAttempts,
    structured,
    forbidden: secrets,
  });
  for (let run = 1; run <= runs; run++) {
    const row: Record<string, unknown> = { model: m, run, source, structured, coords };
    try {
      const r = await proposeAction(client, {
        system: systemPrompt(coords),
        text: stepPrompt({ coords, task, frameId: 1, width, height, step: 1, maxSteps: 40, remainingSec: 260, notes: '', history: [] }),
        screenshot: image,
        ctx: { frameId: 1, width, height, coords },
        deadline: performance.now() + model.inferenceTimeoutMs * model.inferenceAttempts + 1_000,
      });
      const a = r.value.action;
      Object.assign(row, {
        ok: true,
        latencyMs: Math.round(r.latencyMs),
        attempts: r.attempts,
        promptTokens: r.usage.promptTokens,
        completionTokens: r.usage.completionTokens,
        costUsd: r.usage.cost,
        provider: r.provider,
        action: a,
        target: r.value.target,
        observation: r.value.observation,
      });
      if (expect?.length === 4 && 'x' in a) {
        const [ex, ey, ew, eh] = expect as [number, number, number, number];
        row.hit = a.x >= ex && a.x <= ex + ew && a.y >= ey && a.y <= ey + eh;
      }
      if (frame && 'x' in a) {
        const marked = artifactPath(`bench-${m.replace(/[^a-z0-9]+/gi, '_')}-${coords}-${run}.png`);
        fs.writeFileSync(marked, encodePng(drawMarker(frame, a.x, a.y)));
        row.marker = marked;
      }
    } catch (e) {
      Object.assign(row, { ok: false, error: redact(e instanceof Error ? `${e.name}: ${e.message}` : String(e), secrets) });
    }
    if (doRead) {
      try {
        const r = await client.complete({
          system: 'Lees capturas de pantalla de aplicaciones. Transcribe exactamente lo que ves; no inventes. Responde sólo JSON.',
          text: 'Describe esta pantalla según el esquema.',
          images: [image],
          schema: { name: 'lectura', schema: READ_SCHEMA },
          parse: (json) => ({ ok: true, value: json }),
          deadline: performance.now() + model.inferenceTimeoutMs * model.inferenceAttempts + 1_000,
        });
        row.read = { latencyMs: Math.round(r.latencyMs), costUsd: r.usage.cost, value: r.value };
      } catch (e) {
        row.read = { error: redact(e instanceof Error ? e.message : String(e), secrets) };
      }
    }
    results.push(row);
    const a = row.action as { type?: string; x?: number; y?: number } | undefined;
    console.log(
      `${m} [${coords}] #${run}: ${row.ok ? `${row.hit === undefined ? '' : row.hit ? 'ACIERTA ' : 'FALLA '}${row.latencyMs} ms, ${row.promptTokens}+${row.completionTokens} tok, $${row.costUsd ?? '?'}, ${a?.type}${a?.x !== undefined ? ` (${a.x},${a.y})` : ''}${(a as { answer?: string } | undefined)?.answer ? ` answer=${(a as { answer?: string }).answer}` : ''} -> ${row.target}` : `ERROR ${row.error}`}`,
    );
  }
}
const out = artifactPath(`bench-${stamp()}.json`);
fs.writeFileSync(out, JSON.stringify({ task, width, height, results }, null, 2));
console.log(`resultados: ${out}`);
