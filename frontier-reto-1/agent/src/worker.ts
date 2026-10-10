// Proceso worker de una tarea: interpreta capturas y propone acciones. No tiene socket VNC ni credenciales del escritorio.
import { stepPrompt, systemPrompt } from './agent/prompt.ts';
import { TaskMemory } from './agent/memory.ts';
import { serveChild, type WorkerInit, type WorkerRequest, type WorkerResponse } from './ipc.ts';
import { OpenRouterClient, proposeAction } from './model/openrouter.ts';

let state: { init: WorkerInit; client: OpenRouterClient; memory: TaskMemory } | undefined;

serveChild<WorkerRequest, WorkerResponse>(
  async (req) => {
    if (req.type === 'init') {
      state = {
        init: req,
        client: new OpenRouterClient({
          apiKey: req.apiKey,
          model: req.model,
          ...(req.fallbackModel ? { fallbackModel: req.fallbackModel } : {}),
          timeoutMs: req.inferenceTimeoutMs,
          attempts: req.inferenceAttempts,
        }),
        memory: new TaskMemory(req.task),
      };
      return { type: 'ready' };
    }
    if (!state) throw Object.assign(new Error('Worker sin inicializar'), { code: 'not_ready' });
    const { init, client, memory } = state;
    memory.recordOutcome(req.outcome);
    const deadline = performance.now() + req.remainingMs;
    const r = await proposeAction(client, {
      system: systemPrompt(init.coords),
      text: stepPrompt({
        coords: init.coords,
        task: init.task,
        frameId: req.frameId,
        width: req.width,
        height: req.height,
        step: memory.step + 1,
        maxSteps: init.maxSteps,
        remainingSec: req.remainingMs / 1000,
        notes: memory.notes,
        history: memory.history,
        warnings: memory.warnings(),
      }),
      screenshot: { mime: 'image/png', data: Buffer.from(req.png.buffer, req.png.byteOffset, req.png.byteLength) },
      ctx: { frameId: req.frameId, width: req.width, height: req.height, coords: init.coords },
      deadline,
    });
    memory.recordProposal(r.value);
    return {
      type: 'proposal',
      proposal: r.value,
      metrics: {
        latencyMs: Math.round(r.latencyMs),
        attempts: r.attempts,
        promptTokens: r.usage.promptTokens,
        completionTokens: r.usage.completionTokens,
        cost: r.usage.cost,
        model: r.model,
      },
    };
  },
  () => process.exit(1),
);
