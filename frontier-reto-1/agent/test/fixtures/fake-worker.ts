// Worker falso: devuelve propuestas de FAKE_SCRIPT (JSON) en orden. FAKE_WORKER=hang nunca propone.
import { serveChild, type WorkerRequest, type WorkerResponse } from '../../src/ipc.ts';
import type { Action } from '../../src/model/actions.ts';

type Step = { action: Action; target?: string; frame_id?: number };
const script: Step[] = JSON.parse(process.env.FAKE_SCRIPT ?? '[]');
const hang = process.env.FAKE_WORKER === 'hang';
let i = 0;

serveChild<WorkerRequest, WorkerResponse>(
  async (req) => {
    if (req.type === 'init') return { type: 'ready' };
    if (hang) return new Promise<never>(() => {});
    const s = script[Math.min(i++, script.length - 1)]!;
    return {
      type: 'proposal',
      proposal: {
        frame_id: s.frame_id ?? req.frameId,
        observation: 'obs',
        notes: `paso ${i}; outcome=${req.outcome?.note ?? ''}`,
        action: s.action,
        target: s.target ?? 'objetivo',
        reason: 'r',
        expected: 'e',
      },
      metrics: { latencyMs: 1, attempts: 1, promptTokens: 1, completionTokens: 1, cost: 0.001, model: 'fake' },
    };
  },
  () => process.exit(1),
);
