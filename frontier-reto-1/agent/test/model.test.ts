import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractJson, isAllowedKey, validateProposal } from '../src/model/actions.ts';
import { InferenceError, OpenRouterClient, proposeAction } from '../src/model/openrouter.ts';

const ctx = { frameId: 7, width: 1280, height: 800 };
const nulls = { x: null, y: null, text: null, key: null, direction: null, amount: null, ms: null, status: null, summary: null, answer: null };
const proposal = (action: Record<string, unknown>, frame_id = 7) => ({
  frame_id,
  observation: 'Listado de clientes',
  notes: '',
  action: { ...nulls, ...action },
  fill: [] as unknown[],
  target: 'Botón Buscar',
  reason: 'Filtrar',
  expected: 'Tabla filtrada',
});

test('validación: acciones válidas', () => {
  for (const a of [
    { type: 'click', x: 10, y: 20 },
    { type: 'replace_text', x: 10, y: 20, text: '' },
    { type: 'type_text', text: 'Pereira' },
    { type: 'key', key: 'Enter' },
    { type: 'key', key: 'ctrl+a' },
    { type: 'scroll', x: 640, y: 400, direction: 'down' },
    { type: 'wait', ms: 500 },
    { type: 'finish', status: 'terminada', summary: 'Listo', answer: '45' },
  ]) {
    const r = validateProposal(proposal(a), ctx);
    assert.ok(r.ok, `${a.type}: ${JSON.stringify(r)}`);
  }
  const s = validateProposal(proposal({ type: 'scroll', x: 1, y: 1, direction: 'up' }), ctx);
  assert.ok(s.ok && s.proposal.action.type === 'scroll' && s.proposal.action.amount === 3);
});

test('validación: rechaza frame vencido, coordenadas, teclas peligrosas y control', () => {
  const bad: Array<[unknown, RegExp]> = [
    [proposal({ type: 'click', x: 1, y: 1 }, 6), /no es la captura vigente/],
    [proposal({ type: 'click', x: 1280, y: 1 }), /fuera de pantalla/],
    [proposal({ type: 'click', x: 1.5, y: 1 }), /enteros/],
    [proposal({ type: 'key', key: 'alt+F4' }), /no permitida/],
    [proposal({ type: 'key', key: 'ctrl+w' }), /no permitida/],
    [proposal({ type: 'key', key: 'F5' }), /no permitida/],
    [proposal({ type: 'type_text', text: 'a\u0007' }), /control/],
    [proposal({ type: 'type_text', text: '' }), /no vacío/],
    [proposal({ type: 'wait', ms: 60_000 }), /wait.ms/],
    [proposal({ type: 'finish', status: 'ok', summary: 'x' }), /status/],
    [proposal({ type: 'shell', text: 'rm -rf /' }), /action.type inválido/],
    ['texto', /no es un objeto/],
  ];
  for (const [input, re] of bad) {
    const r = validateProposal(input, ctx);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.join('; '), re);
  }
  assert.equal(isAllowedKey('shift+Tab'), true);
  assert.equal(isAllowedKey('ctrl+shift+i'), false);
});

test('extractJson tolera bloques de código y texto alrededor', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Aquí va: {"a":2} fin'), { a: 2 });
  assert.throws(() => extractJson('nada'));
});

type FetchCall = { url: string; body: Record<string, unknown> };
function fakeFetch(responses: Array<(signal: AbortSignal) => Promise<Response> | Response>) {
  const calls: FetchCall[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const next = responses.shift();
    if (!next) throw new Error('sin respuesta');
    return next(init!.signal!);
  }) as typeof fetch;
  return { fn, calls };
}
const ok = (content: string, cost = 0.001) =>
  new Response(JSON.stringify({ model: 'vendor/model', provider: 'P', choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 50, cost } }));
const png = { mime: 'image/png' as const, data: Buffer.from('fakepng') };

function client(fetchFn: typeof fetch, extra: Partial<ConstructorParameters<typeof OpenRouterClient>[0]> = {}) {
  return new OpenRouterClient({ apiKey: 'sk-or-v1-secretkey123', model: 'vendor/model', timeoutMs: 2000, attempts: 2, fetch: fetchFn, ...extra });
}

test('OpenRouter: envía imagen + esquema y devuelve propuesta validada con uso', async () => {
  const { fn, calls } = fakeFetch([() => ok(JSON.stringify(proposal({ type: 'click', x: 5, y: 6 })))]);
  const r = await proposeAction(client(fn), { system: 's', text: 't', screenshot: png, ctx, deadline: performance.now() + 10_000 });
  assert.equal(r.value.action.type, 'click');
  assert.equal(r.attempts, 1);
  assert.equal(r.usage.promptTokens, 1000);
  assert.equal(r.usage.cost, 0.001);
  const body = calls[0]!.body;
  assert.equal(calls[0]!.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal((body.response_format as { type: string }).type, 'json_schema');
  assert.deepEqual(body.provider, { require_parameters: true });
  const content = (body.messages as Array<{ content: unknown }>)[1]!.content as Array<{ type: string; image_url?: { url: string } }>;
  assert.ok(content[1]!.image_url!.url.startsWith('data:image/png;base64,'));
});

test('OpenRouter: JSON inválido se reintenta con retroalimentación', async () => {
  const { fn, calls } = fakeFetch([() => ok('no es json'), () => ok(JSON.stringify(proposal({ type: 'wait', ms: 300 })))]);
  const r = await proposeAction(client(fn), { system: 's', text: 't', screenshot: png, ctx, deadline: performance.now() + 10_000 });
  assert.equal(r.attempts, 2);
  assert.equal(r.usage.cost, 0.002);
  const text = ((calls[1]!.body.messages as Array<{ content: Array<{ text?: string }> }>)[1]!.content[0]!.text)!;
  assert.match(text, /no era JSON válido/);
});

test('OpenRouter: propuesta fuera de esquema agota intentos y falla', async () => {
  const bad = () => ok(JSON.stringify(proposal({ type: 'click', x: 99999, y: 1 })));
  const { fn } = fakeFetch([bad, bad]);
  await assert.rejects(
    proposeAction(client(fn), { system: 's', text: 't', screenshot: png, ctx, deadline: performance.now() + 10_000 }),
    (e: InferenceError) => e.code === 'invalid_schema',
  );
});

test('OpenRouter: timeout limitado por el plazo restante', async () => {
  const hang = (signal: AbortSignal) =>
    new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const { fn } = fakeFetch([hang, hang]);
  const started = performance.now();
  await assert.rejects(
    proposeAction(client(fn, { timeoutMs: 60_000, attempts: 1 }), { system: 's', text: 't', screenshot: png, ctx, deadline: performance.now() + 1_700 }),
    (e: InferenceError) => e.code === 'timeout',
  );
  assert.ok(performance.now() - started < 3_000);
});

test('OpenRouter: sin tiempo restante no llama al modelo', async () => {
  const { fn, calls } = fakeFetch([]);
  await assert.rejects(
    proposeAction(client(fn), { system: 's', text: 't', screenshot: png, ctx, deadline: performance.now() + 500 }),
    (e: InferenceError) => e.code === 'deadline',
  );
  assert.equal(calls.length, 0);
});

test('OpenRouter: cancelación externa', async () => {
  const ac = new AbortController();
  const hang = (signal: AbortSignal) => new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const { fn } = fakeFetch([hang]);
  const p = proposeAction(client(fn), { system: 's', text: 't', screenshot: png, ctx, deadline: performance.now() + 10_000, signal: ac.signal });
  ac.abort();
  await assert.rejects(p, (e: InferenceError) => e.code === 'aborted');
});

test('OpenRouter: nunca envía secretos y 4xx no se reintenta ni filtra la clave', async () => {
  const { fn, calls } = fakeFetch([]);
  await assert.rejects(
    proposeAction(client(fn, { forbidden: ['clave-escritorio'] }), {
      system: 's',
      text: 'la clave es clave-escritorio',
      screenshot: png,
      ctx,
      deadline: performance.now() + 10_000,
    }),
    (e: InferenceError) => e.code === 'secret_leak',
  );
  assert.equal(calls.length, 0);

  const err = fakeFetch([() => new Response(JSON.stringify({ error: { message: 'bad key sk-or-v1-secretkey123' } }), { status: 401 })]);
  await assert.rejects(
    proposeAction(client(err.fn), { system: 's', text: 't', screenshot: png, ctx, deadline: performance.now() + 10_000 }),
    (e: InferenceError) => {
      assert.equal(e.code, 'http_401');
      assert.doesNotMatch(e.message, /secretkey123/);
      return true;
    },
  );
  assert.equal(err.calls.length, 1);
});

test('coordenadas normalizadas 0-1000 se convierten a píxeles nativos', () => {
  const r = validateProposal(proposal({ type: 'click', x: 76, y: 164 }), { ...ctx, coords: 'norm1000' });
  assert.ok(r.ok && r.proposal.action.type === 'click');
  if (r.ok && r.proposal.action.type === 'click') assert.deepEqual([r.proposal.action.x, r.proposal.action.y], [97, 131]);
  const edge = validateProposal(proposal({ type: 'click', x: 1000, y: 1000 }), { ...ctx, coords: 'norm1000' });
  assert.ok(edge.ok && edge.proposal.action.type === 'click' && edge.proposal.action.x === 1279 && edge.proposal.action.y === 799);
  assert.equal(validateProposal(proposal({ type: 'click', x: 1001, y: 5 }), { ...ctx, coords: 'norm1000' }).ok, false);
});

test('esquema portable: nulos con anyOf, sin enum con null', async () => {
  const { PROPOSAL_JSON_SCHEMA } = await import('../src/model/actions.ts');
  const text = JSON.stringify(PROPOSAL_JSON_SCHEMA);
  assert.doesNotMatch(text, /"type":\["/);
  assert.doesNotMatch(text, /null\]/);
});

test('OpenRouter: tras timeout el segundo intento usa el modelo de respaldo', async () => {
  const hang = (signal: AbortSignal) => new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const { fn, calls } = fakeFetch([hang, () => ok(JSON.stringify(proposal({ type: 'wait', ms: 300 })))]);
  const r = await proposeAction(client(fn, { timeoutMs: 1_000, fallbackModel: 'vendor/backup' }), {
    system: 's',
    text: 't',
    screenshot: png,
    ctx,
    deadline: performance.now() + 10_000,
  });
  assert.equal(r.attempts, 2);
  assert.deepEqual(calls.map((c) => c.body.model), ['vendor/model', 'vendor/backup']);
  assert.equal(calls[0]!.body.temperature, undefined);
});

test('fill: varios campos del formulario en una propuesta, sólo con replace_text', () => {
  const p = { ...proposal({ type: 'replace_text', x: 10, y: 10, text: 'Papelería Los Andes' }), fill: [{ x: 10, y: 40, text: '901234567' }, { x: 10, y: 70, text: 'Pereira' }] };
  const r = validateProposal(p, ctx);
  assert.ok(r.ok && r.proposal.action.type === 'fill');
  if (r.ok && r.proposal.action.type === 'fill') assert.deepEqual(r.proposal.action.fields.map((f) => f.text), ['Papelería Los Andes', '901234567', 'Pereira']);
  const bad = validateProposal({ ...proposal({ type: 'click', x: 1, y: 1 }), fill: [{ x: 1, y: 1, text: 'x' }] }, ctx);
  assert.equal(bad.ok, false);
  const out = validateProposal({ ...p, fill: [{ x: 5000, y: 1, text: 'x' }] }, ctx);
  assert.equal(out.ok, false);
  const plain = validateProposal({ ...p, fill: [] }, ctx);
  assert.ok(plain.ok && plain.proposal.action.type === 'replace_text');
});
