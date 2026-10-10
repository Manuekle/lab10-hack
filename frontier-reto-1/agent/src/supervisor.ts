// Supervisor: controla worker y driver de cada tarea, autoriza acciones, vigila el plazo y publica el resultado
// sólo después de confirmar que ambos procesos terminaron. Se recupera de fallos sin repetir escrituras a ciegas
// y, al final, aprende de la experiencia de la tarea.
import { setTimeout as sleep } from 'node:timers/promises';
import { appKey as toAppKey, extractLessons } from './agent/learning.ts';
import { describeAction } from './agent/memory.ts';
import type { Limits, ServiceConfig } from './config.ts';
import type { Child, DriverRequest, DriverResponse, FramePayload, StepOutcome, WorkerRequest, WorkerResponse } from './ipc.ts';
import { isAllowedKey, type Action, type ValidProposal } from './model/actions.ts';
import type { OpenRouterClient } from './model/openrouter.ts';
import { log as defaultLog, redact } from './redact.ts';
import type { AppKnowledge, TaskStore } from './store.ts';
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
  allowPrivateDesktops?: boolean;
  learner?: OpenRouterClient; // sin learner no se extraen lecciones (pruebas)
  log?: (event: string, data: Record<string, unknown>, secrets: readonly string[]) => void;
}

const NO_CHANGE = 0.001;
const MAX_NO_PROGRESS = 8;
const MAX_FINISH_REJECTIONS = 3;
const MIN_EVIDENCE = 8;

// Acciones que confirman cambios en la app.
const COMMIT =
  /guardar|grabar|crear|registrar|aceptar|confirmar|exportar|eliminar|borrar|anular|enviar|actualizar|aplicar|descargar|save|submit|export|delete|confirm|apply|download/i;
const DELETE_ACTION = /eliminar|borrar|anular|suprimir|quitar|delete|remove/i;
const EXPORT_ACTION = /exportar|export|descargar|download/i;
// Intención en la TAREA (no en la pantalla). "Borrador" o "anuladas" no son órdenes.
const DELETE_INTENT = /\b(elim[ií]n|b[oó]rr[aeáo](?!d)|anul[aeáo](?!d)|quit[aeáo]|remuev|suprim|de baja|delete|remove)/i;
const EXPORT_INTENT = /\b(export|report|descarg|download|csv|excel)/i;

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

// Guardrail determinista contra inyección: borrar o exportar sólo si la tarea lo pide.
export function intentViolation(task: string, p: ValidProposal): string | null {
  if (!isCommit(p)) return null;
  if (DELETE_ACTION.test(p.target) && !DELETE_INTENT.test(task)) return 'la tarea no pide eliminar ni anular nada; el texto que aparece en la app no autoriza acciones';
  if (EXPORT_ACTION.test(p.target) && !EXPORT_INTENT.test(task)) return 'la tarea no pide exportar ni descargar nada';
  return null;
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
    const minStepMs = Math.min(3_000, limits.revokeMs / 10);
    const remaining = () => revokeAt - performance.now();
    const signal = revoke.signal;
    const timer = setTimeout(() => revoke.abort(new StopError('se agotó el tiempo de la tarea')), Math.max(0, remaining()));

    let driver: DriverChild | undefined;
    const workers: WorkerChild[] = [];
    let result: { estado: 'terminada' | 'fallida'; resumen: string } | undefined;
    let reason = '';
    let notes = '';
    let totalCost = 0;
    let steps = 0;
    let app = '';
    let knowledge: AppKnowledge | undefined;
    let slowdownMs = 0;
    const trail: string[] = [];

    const init: WorkerRequest = {
      type: 'init',
      task: run.tarea,
      coords: config.openrouterCoords,
      apiKey: config.openrouterApiKey,
      model: config.openrouterModel,
      fallbackModel: config.openrouterFallbackModel,
      inferenceTimeoutMs: limits.inferenceTimeoutMs,
      inferenceAttempts: limits.inferenceAttempts,
      maxSteps: limits.maxProposals,
    };
    const spawnWorker = async (): Promise<WorkerChild> => {
      const w = this.opts.spawnWorker();
      workers.push(w);
      await w.request(init, { timeoutMs: 10_000, signal });
      return w;
    };

    try {
      store.setPhase(run.id, 'ejecutando', 'En curso: conectando al escritorio.');
      driver = this.opts.spawnDriver();
      let worker = await spawnWorker();
      const connected = await driver.request(
        { type: 'connect', url: run.desktop.url, password: run.desktop.password, allowPrivate: this.opts.allowPrivateDesktops ?? false, slowdownMs: 0 },
        { timeoutMs: Math.min(30_000, remaining()), signal },
      );
      if (connected.type !== 'frame') throw new Error('El driver no devolvió captura');
      store.setPhase(run.id, 'ejecutando', 'En curso: analizando la pantalla.');
      let frame: FramePayload = connected.frame;
      let frameId = 1;
      let outcome: StepOutcome | null = null;
      let noProgress = 0;
      let needObserve = false;
      let finishRejections = 0;
      let knowledgeToSend = '';
      let pendingWrite: { target: string; uncertain: boolean } | null = null;
      this.log('task_connected', { task_id: run.id, width: frame.width, height: frame.height, ms: Math.round(performance.now() - run.receivedAt) }, secrets);

      for (;;) {
        if (steps >= limits.maxProposals) {
          reason = `se alcanzó el máximo de ${limits.maxProposals} propuestas sin terminar`;
          break;
        }
        if (remaining() < minStepMs) {
          reason = 'se agotó el tiempo de la tarea';
          break;
        }

        // La captura anterior no mostró cambios: mirar otra vez por si la app repintó tarde o cayó la conexión.
        if (needObserve) {
          needObserve = false;
          const o = await driver.request({ type: 'observe' }, { timeoutMs: Math.max(1, Math.min(25_000, remaining())), signal });
          if (o.type === 'frame') {
            slowdownMs = o.frame.slowdownMs;
            if (o.frame.changed > NO_CHANGE || o.frame.reconnected) {
              frame = o.frame;
              frameId++;
              const extra: string[] = [];
              if (o.frame.learnedSlowdown) {
                extra.push(`la pantalla terminó de cambiar después de la captura: la app repinta lento; ahora espero ${slowdownMs} ms más`);
                this.record(run, 'adapt', { slowdownMs }, secrets);
              }
              if (o.frame.reconnected) extra.push('se recuperó la conexión con el escritorio; revisa el estado actual antes de actuar');
              const prev = outcome as StepOutcome | null; // el closure reject() también lo asigna
              outcome = { changed: prev?.changed ?? o.frame.changed, note: [prev?.note, ...extra].filter(Boolean).join('; ') };
            }
          }
        }

        steps++;
        const req: WorkerRequest = {
          type: 'propose',
          frameId,
          width: frame.width,
          height: frame.height,
          png: frame.png,
          remainingMs: remaining() - 500,
          outcome,
          ...(knowledgeToSend ? { knowledge: knowledgeToSend } : {}),
        };
        // Inferir no toca el escritorio: reintentar o relanzar el worker es seguro.
        let res: WorkerResponse | undefined;
        for (let attempt = 0; ; attempt++) {
          try {
            res = await worker.request(req, { timeoutMs: Math.max(1, remaining()), signal });
            break;
          } catch (e) {
            if (signal.aborted || attempt >= 2 || remaining() < minStepMs * 2) throw e;
            this.record(run, 'recover', { what: worker.alive ? 'inferencia' : 'worker', error: e instanceof Error ? e.message : String(e) }, secrets);
            if (!worker.alive) {
              worker = await spawnWorker();
              if (knowledge?.lessons) req.knowledge = knowledge.lessons; // el worker nuevo no tiene memoria
            }
            await sleep(500);
          }
        }
        if (res.type !== 'proposal') throw new Error('Respuesta inesperada del worker');
        knowledgeToSend = '';
        const p = res.proposal;
        totalCost += res.metrics.cost ?? 0;
        if (p.notes.trim()) notes = p.notes;

        // Primera vez que se ve la app: cargar lo aprendido en tareas anteriores.
        if (!app && p.app.trim()) {
          app = toAppKey(p.app);
          knowledge = app ? store.getKnowledge(app) : undefined;
          if (knowledge?.lessons) knowledgeToSend = knowledge.lessons;
          if (knowledge && knowledge.slowdownMs > slowdownMs) needObserve = true;
          this.log('task_app', { task_id: run.id, app, knownLessons: knowledge?.lessons ? knowledge.lessons.split('\n').length : 0 }, secrets);
        }

        const event = {
          step: steps,
          action: describeAction(p.action),
          target: p.target,
          inferMs: res.metrics.latencyMs,
          attempts: res.metrics.attempts,
          cost: res.metrics.cost,
          model: res.metrics.model,
        };
        const reject = (why: string, note: string) => {
          outcome = { changed: null, note: `rechazada por el supervisor: ${note}` };
          this.record(run, 'rejected', { ...event, why }, secrets);
          trail.push(`${event.action} sobre "${p.target}" -> rechazada: ${why}`);
        };

        if (p.frame_id !== frameId) {
          reject('frame vencido', `la propuesta usa frame_id ${p.frame_id} y la captura vigente es ${frameId}`);
          continue;
        }
        // Evidencia sobre la captura posterior a una escritura: libera la escritura pendiente.
        if (pendingWrite && p.evidence.trim().length >= MIN_EVIDENCE) {
          this.record(run, 'verified', { step: steps, target: pendingWrite.target, evidence: p.evidence.slice(0, 300) }, secrets);
          pendingWrite = null;
        }
        if (p.action.type === 'finish') {
          if (p.action.status === 'terminada' && pendingWrite) {
            finishRejections++;
            if (finishRejections >= MAX_FINISH_REJECTIONS) {
              reason = `no se pudo demostrar en pantalla el efecto de "${pendingWrite.target}"`;
              break;
            }
            reject('terminada sin evidencia', `antes de terminar, comprueba en pantalla el efecto de "${pendingWrite.target}" y descríbelo en evidence`);
            continue;
          }
          result = { estado: p.action.status, resumen: buildResumen(p.action, secrets) };
          this.record(run, 'finish', { ...event, status: p.action.status, answer: p.action.answer }, secrets);
          trail.push(`finish ${p.action.status}`);
          break;
        }
        const invalid = checkAction(p.action, frame.width, frame.height);
        if (invalid) {
          reject(invalid, invalid);
          continue;
        }
        const notAllowed = intentViolation(run.tarea, p);
        if (notAllowed) {
          reject('fuera de la tarea', notAllowed);
          continue;
        }
        if (pendingWrite && (isCommit(p) || (p.action.type === 'key' && p.action.key.toUpperCase() === 'F5'))) {
          reject(
            'escritura pendiente sin verificar',
            `${pendingWrite.uncertain ? 'la conexión se cayó durante' : 'acabas de ejecutar'} "${pendingWrite.target}". Comprueba en pantalla si tuvo efecto y descríbelo en evidence antes de otra escritura o recarga`,
          );
          continue;
        }

        const tAct = performance.now();
        let executed: DriverResponse;
        try {
          executed = await driver.request({ type: 'execute', action: p.action }, { timeoutMs: Math.max(1, remaining()), signal });
        } catch (e) {
          if (!signal.aborted && (e as { code?: string }).code === 'disconnected') {
            if (isCommit(p)) pendingWrite = { target: p.target, uncertain: true };
            outcome = { changed: null, note: 'la conexión con el escritorio se cayó durante la acción; su efecto es incierto. Mira la pantalla antes de repetir nada' };
            this.record(run, 'disconnected', { ...event }, secrets);
            trail.push(`${event.action} sobre "${p.target}" -> conexión caída`);
            needObserve = true;
            continue;
          }
          throw e;
        }
        if (executed.type !== 'frame') throw new Error('El driver no devolvió captura');
        frame = executed.frame;
        frameId++;
        slowdownMs = frame.slowdownMs;
        if (frame.skipped) {
          outcome = { changed: null, note: 'no se ejecutó: se recuperó la conexión y la pantalla puede haber cambiado; vuelve a mirar' };
          this.record(run, 'reconnected', { ...event }, secrets);
          continue;
        }
        if (isCommit(p)) pendingWrite = { target: p.target, uncertain: false };
        noProgress = frame.changed < NO_CHANGE ? noProgress + 1 : 0;
        needObserve = frame.changed < NO_CHANGE;
        outcome = { changed: frame.changed, note: pendingWrite ? 'escritura pendiente de verificar: describe en evidence lo que prueba su efecto' : '' };
        this.record(run, 'step', { ...event, actMs: Math.round(performance.now() - tAct), changed: Number(frame.changed.toFixed(4)) }, secrets);
        trail.push(`${event.action} sobre "${p.target}" -> ${frame.changed < NO_CHANGE ? 'sin cambio visible' : 'la pantalla cambió'}`);
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
      const stop = await this.stopChildren(driver, workers, hardStopAt);
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
          app,
          slowdownMs,
        },
        secrets,
      );
      if (app) void this.learn(run, app, knowledge, trail, notes, final.estado, Boolean(result), slowdownMs, secrets);
    }
  }

  // Después de publicar: actualizar lo aprendido de la app. Nunca bloquea ni cambia el resultado de la tarea.
  private async learn(
    run: TaskRun,
    app: string,
    prev: AppKnowledge | undefined,
    trail: readonly string[],
    notes: string,
    estado: string,
    deliberate: boolean,
    slowdownMs: number,
    secrets: readonly string[],
  ): Promise<void> {
    const slow = Math.max(slowdownMs, Math.floor((prev?.slowdownMs ?? 0) / 2));
    try {
      // Sólo aprender de tareas que terminaron por decisión del agente (no por tiempo o error).
      const lessons =
        deliberate && this.opts.learner && trail.length > 0
          ? await extractLessons(this.opts.learner, { app, previous: prev?.lessons ?? '', trail, notes, estado }, secrets)
          : '';
      this.opts.store.saveKnowledge(app, { lessons: lessons || prev?.lessons || '', slowdownMs: slow });
      this.log('knowledge_updated', { task_id: run.id, app, lessons: lessons ? lessons.split('\n').length : 0, slowdownMs: slow }, secrets);
    } catch (e) {
      this.log('knowledge_error', { task_id: run.id, app, error: e instanceof Error ? e.message : String(e) }, secrets);
    }
  }

  private record(run: TaskRun, stage: string, data: Record<string, unknown>, secrets: readonly string[]): void {
    const safe = JSON.parse(redact(JSON.stringify(data), secrets)) as Record<string, unknown>;
    this.opts.store.addEvent(run.id, stage, safe);
    this.log(`task_${stage}`, { task_id: run.id, ...safe }, secrets);
  }

  // Workers: se matan enseguida (no actúan sobre el escritorio). Driver: cierre ordenado con plazo y luego SIGKILL.
  private async stopChildren(driver: DriverChild | undefined, workers: WorkerChild[], hardStopAt: number): Promise<{ driverKilled: boolean }> {
    for (const w of workers) w.kill('SIGKILL');
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
    await Promise.all(workers.map((w) => w.exited));
    return { driverKilled };
  }
}
