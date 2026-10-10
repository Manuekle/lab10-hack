// Adaptador de OpenRouter: imagen + texto -> JSON validado localmente, con timeout limitado por el plazo de la tarea.
import { redact } from '../redact.ts';
import { PROPOSAL_JSON_SCHEMA, extractJson, validateProposal, type ValidProposal, type ValidationContext } from './actions.ts';

export type StructuredMode = 'json_schema' | 'json_object' | 'prompt';

export interface ImageInput {
  mime: 'image/png' | 'image/jpeg';
  data: Buffer;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  cost: number | null; // USD informado por OpenRouter
}

export interface InferenceResult<T> {
  value: T;
  content: string;
  usage: Usage;
  latencyMs: number;
  attempts: number;
  model: string;
  provider: string | null;
}

export class InferenceError extends Error {
  readonly retryable: boolean;
  readonly code: string;
  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'InferenceError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  // Tras un fallo de red, timeout o 5xx, el siguiente intento usa este modelo.
  fallbackModel?: string;
  timeoutMs: number;
  attempts: number;
  structured?: StructuredMode;
  reasoningEffort?: 'low' | 'medium' | 'high';
  // Claude 5.5 y GPT-6 no aceptan temperature: con require_parameters la petición falla (404).
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
  fetch?: typeof fetch;
  // Valores que nunca deben salir hacia el modelo (contraseña del escritorio, tokens).
  forbidden?: readonly string[];
}

export interface CompleteRequest<T> {
  system: string;
  text: string;
  images: ImageInput[];
  schema?: { name: string; schema: object };
  parse: (json: unknown) => { ok: true; value: T } | { ok: false; errors: string[] };
  deadline: number; // performance.now() en ms
  signal?: AbortSignal;
}

const MIN_USEFUL_MS = 1_500;

export class OpenRouterClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly opts: OpenRouterOptions;

  constructor(opts: OpenRouterOptions) {
    this.opts = opts;
    this.fetchFn = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? 'https://openrouter.ai/api/v1';
  }

  get model(): string {
    return this.opts.model;
  }

  async complete<T>(req: CompleteRequest<T>): Promise<InferenceResult<T>> {
    const mode = this.opts.structured ?? 'json_schema';
    const started = performance.now();
    const usage: Usage = { promptTokens: 0, completionTokens: 0, cost: null };
    let lastError: InferenceError | undefined;
    let feedback = '';
    let model = this.opts.model;

    for (let attempt = 1; attempt <= this.opts.attempts; attempt++) {
      const remaining = req.deadline - performance.now();
      if (remaining < MIN_USEFUL_MS) throw new InferenceError('deadline', 'Sin tiempo restante para inferir', false);
      if (req.signal?.aborted) throw new InferenceError('aborted', 'Inferencia cancelada', false);
      const timeout = Math.floor(Math.min(this.opts.timeoutMs, remaining));

      const body = this.buildBody(req, mode, feedback, model);
      const serialized = JSON.stringify(body);
      this.assertNoSecrets(serialized);

      const signals = [AbortSignal.timeout(timeout)];
      if (req.signal) signals.push(req.signal);
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.opts.apiKey}`,
            'Content-Type': 'application/json',
            'X-Title': 'frontier-reto1-agent',
          },
          body: serialized,
          signal: AbortSignal.any(signals),
        });
      } catch (e) {
        if (req.signal?.aborted) throw new InferenceError('aborted', 'Inferencia cancelada', false);
        const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        lastError = new InferenceError(timedOut ? 'timeout' : 'network', timedOut ? `Timeout de inferencia (${Math.round(timeout)} ms)` : 'Fallo de red hacia OpenRouter', true);
        model = this.opts.fallbackModel ?? model;
        continue;
      }

      let payload: Record<string, unknown>;
      try {
        payload = (await res.json()) as Record<string, unknown>;
      } catch {
        lastError = new InferenceError('bad_response', `Respuesta no JSON de OpenRouter (HTTP ${res.status})`, true);
        continue;
      }

      if (!res.ok || payload.error) {
        const err = (payload.error ?? {}) as { message?: string; code?: number };
        const msg = this.clean(`HTTP ${res.status}: ${err.message ?? 'error'}`);
        const retryable = res.status === 408 || res.status === 429 || res.status >= 500 || err.code === 502;
        lastError = new InferenceError(`http_${res.status}`, msg, retryable);
        if (!retryable) throw lastError;
        if (res.status >= 500 || res.status === 429) model = this.opts.fallbackModel ?? model;
        continue;
      }

      const u = (payload.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      usage.promptTokens += u.prompt_tokens ?? 0;
      usage.completionTokens += u.completion_tokens ?? 0;
      if (typeof u.cost === 'number') usage.cost = (usage.cost ?? 0) + u.cost;

      const choices = payload.choices as Array<{ message?: { content?: unknown }; finish_reason?: string }> | undefined;
      const content = choices?.[0]?.message?.content;
      const finish = choices?.[0]?.finish_reason ?? 'desconocido';
      if (typeof content !== 'string' || content.trim() === '') {
        lastError = new InferenceError('empty', 'El modelo no devolvió contenido', true);
        continue;
      }

      let json: unknown;
      try {
        json = extractJson(content);
      } catch {
        lastError = new InferenceError('invalid_json', this.clean(`El modelo devolvió JSON inválido (finish_reason ${finish}): ${content.slice(0, 160)}`), true);
        feedback = 'Tu respuesta anterior no era JSON válido. Responde sólo con el objeto JSON.';
        continue;
      }
      const parsed = req.parse(json);
      if (!parsed.ok) {
        lastError = new InferenceError('invalid_schema', `Propuesta inválida: ${parsed.errors.join('; ')}`, true);
        feedback = `Tu propuesta anterior fue rechazada: ${parsed.errors.join('; ')}. Corrígela.`;
        continue;
      }
      return {
        value: parsed.value,
        content,
        usage,
        latencyMs: performance.now() - started,
        attempts: attempt,
        model: typeof payload.model === 'string' ? payload.model : model,
        provider: typeof payload.provider === 'string' ? payload.provider : null,
      };
    }
    throw lastError ?? new InferenceError('unknown', 'Inferencia fallida', false);
  }

  private buildBody<T>(req: CompleteRequest<T>, mode: StructuredMode, feedback: string, model: string): Record<string, unknown> {
    const text = feedback ? `${req.text}\n\n${feedback}` : req.text;
    const content: unknown[] = [{ type: 'text', text }];
    for (const img of req.images) {
      content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data.toString('base64')}` } });
    }
    const body: Record<string, unknown> = {
      model,
      messages: [
        // Caché del prompt de sistema en Anthropic: menos latencia y costo desde el segundo paso.
        model.startsWith('anthropic/')
          ? { role: 'system', content: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }] }
          : { role: 'system', content: req.system },
        { role: 'user', content },
      ],
      max_tokens: this.opts.maxTokens ?? 1500,
      usage: { include: true },
    };
    if (this.opts.temperature !== undefined) body.temperature = this.opts.temperature;
    if (this.opts.reasoningEffort) body.reasoning = { effort: this.opts.reasoningEffort };
    if (mode === 'json_schema' && req.schema) {
      body.response_format = { type: 'json_schema', json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema } };
      body.provider = { require_parameters: true };
    } else if (mode === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    return body;
  }

  private assertNoSecrets(serialized: string): void {
    for (const s of this.opts.forbidden ?? []) {
      if (s.length >= 4 && serialized.includes(s)) {
        throw new InferenceError('secret_leak', 'La petición al modelo contenía un secreto; no se envió', false);
      }
    }
  }

  private clean(text: string): string {
    return redact(text, [this.opts.apiKey, ...(this.opts.forbidden ?? [])]).slice(0, 300);
  }
}

export interface ProposeInput {
  system: string;
  text: string;
  screenshot: ImageInput;
  extraImages?: ImageInput[];
  ctx: ValidationContext;
  deadline: number;
  signal?: AbortSignal;
}

export function proposeAction(client: OpenRouterClient, input: ProposeInput): Promise<InferenceResult<ValidProposal>> {
  return client.complete({
    system: input.system,
    text: input.text,
    images: [input.screenshot, ...(input.extraImages ?? [])],
    schema: { name: 'proposal', schema: PROPOSAL_JSON_SCHEMA },
    parse: (json) => {
      const r = validateProposal(json, input.ctx);
      return r.ok ? { ok: true, value: r.proposal } : r;
    },
    deadline: input.deadline,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}
