// IPC entre supervisor, worker y driver. Cada proceso hijo atiende peticiones correlacionadas por id.
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Action, CoordMode, ValidProposal } from './model/actions.ts';

export interface FramePayload {
  width: number;
  height: number;
  png: Uint8Array;
  changed: number; // fracción de pixeles distintos respecto a la captura anterior
  reconnected?: boolean; // el driver recuperó la conexión antes de esta captura
  skipped?: boolean; // la acción no se ejecutó porque hubo que reconectar
  slowdownMs: number; // espera extra aprendida: la app repinta más lento de lo previsto
  learnedSlowdown?: boolean; // esta captura reveló un repintado tardío
}

export type DriverRequest =
  | { type: 'connect'; url: string; password: string; allowPrivate: boolean; slowdownMs: number }
  | { type: 'execute'; action: Action }
  | { type: 'observe' }
  | { type: 'close' };

export type DriverResponse = { type: 'frame'; frame: FramePayload } | { type: 'closed' };

export interface WorkerInit {
  type: 'init';
  task: string;
  coords: CoordMode;
  apiKey: string;
  model: string;
  fallbackModel: string | undefined;
  inferenceTimeoutMs: number;
  inferenceAttempts: number;
  maxSteps: number;
}

export interface StepOutcome {
  changed: number | null; // null: la acción no se ejecutó
  note: string; // lo que observó el supervisor: rechazo, error, cambio
}

export type WorkerRequest =
  | WorkerInit
  | {
      type: 'propose';
      frameId: number;
      width: number;
      height: number;
      png: Uint8Array;
      remainingMs: number;
      outcome: StepOutcome | null;
      knowledge?: string; // lecciones aprendidas de esta app en tareas anteriores
    };

export interface InferenceMetrics {
  latencyMs: number;
  attempts: number;
  promptTokens: number;
  completionTokens: number;
  cost: number | null;
  model: string;
}

export type WorkerResponse = { type: 'ready' } | { type: 'proposal'; proposal: ValidProposal; metrics: InferenceMetrics };

interface Envelope<T> {
  id: number;
  msg: T;
}
interface Reply<T> {
  id: number;
  ok: boolean;
  res?: T;
  error?: { code: string; message: string };
}

export class ChildError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ChildError';
    this.code = code;
  }
}

export class Child<Req, Res> {
  readonly proc: ChildProcess;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: Res) => void; reject: (e: Error) => void }>();
  private hasExited = false;

  constructor(proc: ChildProcess) {
    this.proc = proc;
    this.exited = new Promise((resolve) => {
      proc.once('exit', (code, signal) => {
        this.hasExited = true;
        for (const p of this.pending.values()) p.reject(new ChildError('child_exit', `El proceso terminó (${signal ?? code})`));
        this.pending.clear();
        resolve({ code, signal });
      });
    });
    proc.on('message', (raw: Reply<Res>) => {
      const p = this.pending.get(raw.id);
      if (!p) return; // respuesta tardía de una petición ya abandonada
      this.pending.delete(raw.id);
      if (raw.ok) p.resolve(raw.res as Res);
      else p.reject(new ChildError(raw.error?.code ?? 'child_error', raw.error?.message ?? 'Error en proceso hijo'));
    });
    proc.on('error', () => {
      // 'exit' resuelve las pendientes; evitar excepción no capturada.
    });
  }

  static spawn<Req, Res>(modulePath: string, opts: { env?: NodeJS.ProcessEnv } = {}): Child<Req, Res> {
    const proc = fork(modulePath, [], {
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: opts.env ?? process.env,
    });
    return new Child<Req, Res>(proc);
  }

  get alive(): boolean {
    return !this.hasExited;
  }

  request(msg: Req, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<Res> {
    if (this.hasExited) return Promise.reject(new ChildError('child_exit', 'El proceso ya terminó'));
    if (opts.signal?.aborted) return Promise.reject(new ChildError('aborted', 'Petición cancelada'));
    const id = this.nextId++;
    return new Promise<Res>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        this.pending.delete(id);
      };
      const onAbort = () => {
        cleanup();
        reject(new ChildError('aborted', 'Petición cancelada'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new ChildError('timeout', `Sin respuesta del proceso en ${opts.timeoutMs} ms`));
      }, Math.max(1, Math.floor(opts.timeoutMs)));
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (r) => {
          cleanup();
          resolve(r);
        },
        reject: (e) => {
          cleanup();
          reject(e);
        },
      });
      try {
        this.proc.send({ id, msg } satisfies Envelope<Req>);
      } catch (e) {
        cleanup();
        reject(new ChildError('send_failed', e instanceof Error ? e.message : String(e)));
      }
    });
  }

  kill(signal: NodeJS.Signals = 'SIGKILL'): void {
    if (!this.hasExited) this.proc.kill(signal);
  }
}

// Lado hijo: atiende peticiones y termina si el padre desaparece.
export function serveChild<Req, Res>(handler: (msg: Req) => Promise<Res>, onParentGone: () => void): void {
  if (!process.send) throw new Error('Este módulo debe ejecutarse como proceso hijo con IPC');
  process.on('message', (raw: Envelope<Req>) => {
    handler(raw.msg).then(
      (res) => process.connected && process.send!({ id: raw.id, ok: true, res } satisfies Reply<Res>),
      (e: unknown) => {
        const err = e as { code?: unknown; message?: unknown };
        const error = { code: typeof err?.code === 'string' ? err.code : 'error', message: String(err?.message ?? e).slice(0, 500) };
        if (process.connected) process.send!({ id: raw.id, ok: false, error } satisfies Reply<Res>);
      },
    );
  });
  process.on('disconnect', onParentGone);
}

// Ruta de un módulo hermano con la misma extensión que el que llama (.ts en desarrollo, .js en dist).
export function siblingModule(fromUrl: string, name: string): string {
  const ext = fromUrl.endsWith('.ts') ? '.ts' : '.js';
  return fileURLToPath(new URL(`./${name}${ext}`, fromUrl));
}
