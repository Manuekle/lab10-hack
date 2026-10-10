// Supervisor: controla worker y driver de cada tarea, autoriza acciones, vigila el plazo y publica el resultado
// sólo después de confirmar que ambos procesos terminaron.
import { setTimeout as sleep } from 'node:timers/promises';
import { describeAction } from './agent/memory.ts';
import type { Limits, ServiceConfig } from './config.ts';
import type { Child, DriverRequest, DriverResponse, FramePayload, StepOutcome, WorkerRequest, WorkerResponse } from './ipc.ts';
import { isAllowedKey, type Action, type ValidProposal } from './model/actions.ts';
import { log as defaultLog, redact } from './redact.ts';
import type { TaskStore } from './store.ts';
import { buildResumen, failureResumen } from './summary.ts';

export interface TaskRun {
  id: string;
  tarea: string;
  desktop: { url: string; password: string }; // sólo en memoria
  receivedAt: number; // performance.now() al recibir la petición
}

export type DriverChild = Child<DriverRequest, DriverResponse>;
export type WorkerChild = Child<WorkerRequest, WorkerResponse>;

export interface SupervisorOptions {
  store: TaskStore;
  config: Pick<ServiceConfig, 'openrouterApiKey' | 'openrouterModel' | 'openrouterFallbackModel' | 'openrouterCoords'> & { limits: Limits };
  secrets: readonly string[];
  spawnDriver: () => DriverChild;
  spawnWorker: () => WorkerChild;
  log?: (event: string, data: Record<string, unknown>, secrets: readonly string[]) => void;
}

const NO_CHANGE = 0.001;
const MAX_NO_PROGRESS = 8;
const COMMIT = /guardar|grabar|crear|registrar|aceptar|confirmar|exportar|eliminar|borrar|enviar|actualizar|aplicar|save|submit|export|delete|confirm|apply/i;

class StopError extends Error {}

// Re-validación independiente de lo que propuso el worker.
export function checkAction(a: Action, width: number, height: number): string | null {
  const inside = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  switch (a.type) {
    case 'click':
    case 'double_click':
    case 'replace_text':
    case 'scroll':
      return inside(a.x, a.y) ? null : 'coordenadas fuera de pantalla';
    case 'fill':
      return a.fields.length > 0 && a.fields.every((f) => inside(f.x, f.y)) ? null : 'campo de formulario fuera de pantalla';
    case 'key':
      return isAllowedKey(a.key) ? null : 'tecla no permitida';
    default:
      return null;
  }
}

function isCommit(p: ValidProposal): boolean {
  return (p.action.type === 'click' || p.action.type === 'double_click' || p.action.type === 'key') && COMMIT.test(p.target);
}

function normTarget(t: string): string {
  return t.toLowerCase().replace(/[^a-záéíóúñü0-9]+/g, ' ').trim();
}

export class Supervisor {
  private readonly opts: SupervisorOptions;
  private readonly runs = new Map<string, { revoke: AbortController; done: Promise<void> }>();
  private readonly log: NonNullable<SupervisorOptions['log']>;

  constructor(opts: SupervisorOptions) {
    this.opts = opts;
    this.log = opts.log ?? defaultLog;
  }

  get active(): number {
    return this.runs.size;
  }

  // Arranca la tarea en segundo plano. `release` libera slot y escritorio tras la parada.
  start(run: TaskRun, release: () => void): Promise<void> {
    const revoke = new AbortController();
    const done = this.execute(run, revoke, release)
      .catch((e: unknown) => this.log('supervisor_error', { task_id: run.id, error: String(e) }, this.secretsFor(run)))
      .finally(() => this.runs.delete(run.id));
    this.runs.set(run.id, { revoke, done });
    return done;
  }

  // Parada ordenada de todo (SIGTERM): revoca, cierra procesos y publica fallida.
  async stopAll(reason: string): Promise<void> {
    for (const r of this.runs.values()) r.revoke.abort(new StopError(reason));
    await Promise.all([...this.runs.values()].map((r) => r.done));
  }

  private secretsFor(run: TaskRun): string[] {
    return [...this.opts.secrets, run.desktop.password].filter(Boolean);
  }

  private async execute(run: TaskRun, revoke: AbortController, release: () => void): Promise<void> {
    const { store, config } = this.opts;
    const limits = config.limits;
    const secrets = this.secretsFor(run);
    const revokeAt = run.receivedAt + limits.revokeMs;
    const hardStopAt = run.receivedAt + limits.hardStopMs;
    const remaining = () => revokeAt - performance.now();
    const signal = revoke.signal;
    const timer = setTimeout(() => revoke.abort(new StopError('se agotó el tiempo de la tarea')), Math.max(0, remaining()));

    let driver: DriverChild | undefined;
    let worker: WorkerChild | undefined;
    let result: { estado: 'terminada' | 'fallida'; resumen: string } | undefined;
    let reason = '';
    let notes = '';
    let totalCost = 0;
    let steps = 0;

    try {
      store.setPhase(run.id, 'ejecutando', 'En curso: conectando al escritorio.');
      driver = this.opts.spawnDriver();
      worker = this.opts.spawnWorker();
      await worker.request(
        {
          type: 'init',
          task: run.tarea,
          coords: config.openrouterCoords,
          apiKey: config.openrouterApiKey,
          model: config.openrouterModel,
          fallbackModel: config.openrouterFallbackModel,
          inferenceTimeoutMs: limits.inferenceTimeoutMs,
          inferenceAttempts: limits.inferenceAttempts,
          maxSteps: limits.maxProposals,
        },
        { timeoutMs: 10_000, signal },
      );
      const connected = await driver.request(
        { type: 'connect', url: run.desktop.url, password: run.desktop.password },
        { timeoutMs: Math.min(30_000, remaining()), signal },
      );
      if (connected.type !== 'frame') throw new Error('El driver no devolvió captura');
      let frame: FramePayload = connected.frame;
      let frameId = 1;
      let outcome: StepOutcome | null = null;
      let noProgress = 0;
      let lastCommit: string | null = null;
      store.setPhase(run.id, 'ejecutando', 'En curso: analizando la pantalla.');
      this.log('task_connected', { task_id: run.id, width: frame.width, height: frame.height, ms: Math.round(performance.now() - run.receivedAt) }, secrets);

      for (;;) {
        if (steps >= limits.maxProposals) {
          reason = `se alcanzó el máximo de ${limits.maxProposals} propuestas sin terminar`;
          break;
        }
        if (remaining() < Math.min(3_000, limits.revokeMs / 10)) {
          reason = 'se agotó el tiempo de la tarea';
          break;
        }
        steps++;
        const res = await worker.request(
          { type: 'propose', frameId, width: frame.width, height: frame.height, png: frame.png, remainingMs: remaining() - 500, outcome },
          { timeoutMs: remaining(), signal },
        );
        if (res.type !== 'proposal') throw new Error('Respuesta inesperada del worker');
        const p = res.proposal;
        totalCost += res.metrics.cost ?? 0;
        if (p.notes.trim()) notes = p.notes;
        const event = {
          step: steps,
          action: describeAction(p.action),
          target: p.target,
          inferMs: res.metrics.latencyMs,
          attempts: res.metrics.attempts,
          cost: res.metrics.cost,
          model: res.metrics.model,
        };

        if (p.frame_id !== frameId) {
          outcome = { changed: null, note: `rechazada: la propuesta usa frame_id ${p.frame_id} y la captura vigente es ${frameId}` };
          this.record(run, 'rejected', { ...event, why: 'frame vencido' }, secrets);
          continue;
        }
        if (p.action.type === 'finish') {
          result = { estado: p.action.status, resumen: buildResumen(p.action, secrets) };
          this.record(run, 'finish', { ...event, status: p.action.status, answer: p.action.answer }, secrets);
          break;
        }
        const invalid = checkAction(p.action, frame.width, frame.height);
        if (invalid) {
          outcome = { changed: null, note: `rechazada por el supervisor: ${invalid}` };
          this.record(run, 'rejected', { ...event, why: invalid }, secrets);
          continue;
        }
        // Escritura incierta: no repetir Guardar/Crear/Exportar sin una acción de comprobación en medio.
        const commitKey = isCommit(p) ? normTarget(p.target) : null;
        if (commitKey && commitKey === lastCommit) {
          outcome = {
            changed: null,
            note: `rechazada: acabas de pulsar "${p.target}". Comprueba en pantalla (buscando el registro o leyendo el resultado) si ya tuvo efecto antes de repetirlo`,
          };
          this.record(run, 'rejected', { ...event, why: 'commit repetido sin verificar' }, secrets);
          continue;
        }

        const tAct = performance.now();
        const executed = await driver.request({ type: 'execute', action: p.action }, { timeoutMs: Math.max(1, remaining()), signal });
        if (executed.type !== 'frame') throw new Error('El driver no devolvió captura');
        frame = executed.frame;
        frameId++;
        lastCommit = commitKey;
        noProgress = frame.changed < NO_CHANGE ? noProgress + 1 : 0;
        outcome = { changed: frame.changed, note: '' };
        this.record(run, 'step', { ...event, actMs: Math.round(performance.now() - tAct), changed: Number(frame.changed.toFixed(4)) }, secrets);
        store.setPhase(run.id, 'ejecutando', `En curso: paso ${steps}.`);
        if (noProgress >= MAX_NO_PROGRESS) {
          reason = `${MAX_NO_PROGRESS} acciones seguidas sin cambio visible`;
          break;
        }
      }
    } catch (e) {
      if (signal.aborted) reason = signal.reason instanceof Error ? signal.reason.message : 'tarea revocada';
      else reason = redact(e instanceof Error ? e.message : String(e), secrets);
    } finally {
      clearTimeout(timer);
      store.setPhase(run.id, 'cerrando');
      const stop = await this.stopChildren(driver, worker, hardStopAt);
      // Liberar después del cierre y antes de publicar: el evaluador puede enviar la siguiente tarea apenas vea el terminal.
      release();
      const final = result ?? { estado: 'fallida' as const, resumen: failureResumen(reason || 'error desconocido', notes, secrets) };
      store.finish(run.id, final.estado, final.resumen);
      this.log(
        'task_finished',
        {
          task_id: run.id,
          estado: final.estado,
          reason: result ? undefined : reason,
          steps,
          cost: Number(totalCost.toFixed(5)),
          totalMs: Math.round(performance.now() - run.receivedAt),
          driverKilled: stop.driverKilled,
        },
        secrets,
      );
    }
  }

  private record(run: TaskRun, stage: string, data: Record<string, unknown>, secrets: readonly string[]): void {
    const safe = JSON.parse(redact(JSON.stringify(data), secrets)) as Record<string, unknown>;
    this.opts.store.addEvent(run.id, stage, safe);
    this.log(`task_${stage}`, { task_id: run.id, ...safe }, secrets);
  }

  // Worker: se mata enseguida (no actúa sobre el escritorio). Driver: cierre ordenado con plazo y luego SIGKILL.
  private async stopChildren(driver: DriverChild | undefined, worker: WorkerChild | undefined, hardStopAt: number): Promise<{ driverKilled: boolean }> {
    worker?.kill('SIGKILL');
    let driverKilled = false;
    if (driver?.alive) {
      const closeBudget = Math.max(0, Math.min(2_500, hardStopAt - performance.now() - 2_000));
      if (closeBudget > 0) {
        try {
          await driver.request({ type: 'close' }, { timeoutMs: closeBudget });
        } catch {
          // no respondió; se mata abajo
        }
      }
      const exitBudget = Math.max(0, Math.min(1_000, hardStopAt - performance.now() - 1_000));
      const exited = await Promise.race([driver.exited.then(() => true), sleep(exitBudget).then(() => false)]);
      if (!exited) {
        driver.kill('SIGKILL');
        driverKilled = true;
      }
      await driver.exited;
    }
    if (worker) await worker.exited;
    return { driverKilled };
  }
}
