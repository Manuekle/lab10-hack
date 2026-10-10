// Observatorio de sólo lectura. Guarda en memoria la última captura que vio el supervisor en cada tarea y persiste
// como eventos lo que el supervisor sólo escribe en el log (app reconocida, lecciones aprendidas u olvidadas).
// Se engancha desde main.ts, sin tocar el bucle del supervisor; nunca puede interrumpir una tarea.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Child, DriverRequest, DriverResponse } from './ipc.ts';
import type { Action } from './model/actions.ts';
import { redactValue } from './redact.ts';
import type { TaskStore } from './store.ts';

export interface FrameSnapshot {
  png: Uint8Array;
  width: number;
  height: number;
  at: number;
  action: string; // tipo de la última acción ejecutada ('' si la captura no viene de una acción)
  points: Array<[number, number]>; // dónde actuó esa acción, en pixeles de la captura
}

// Pocas tareas a la vez: cada captura PNG pesa decenas de KB.
const MAX_FRAMES = 6;

// Logs del supervisor que se guardan como eventos de la tarea (nombre del log -> stage).
export const OBSERVED_LOGS: Readonly<Record<string, string>> = {
  task_connected: 'connected',
  task_app: 'app',
  knowledge_updated: 'knowledge_updated',
  knowledge_reset: 'knowledge_reset',
  knowledge_error: 'knowledge_error',
};

function pointsOf(a: Action): Array<[number, number]> {
  switch (a.type) {
    case 'click':
    case 'double_click':
    case 'replace_text':
    case 'scroll':
      return [[a.x, a.y]];
    case 'fill':
      return a.fields.map((f) => [f.x, f.y]);
    default:
      return [];
  }
}

export class Observatory {
  private readonly store: TaskStore;
  private readonly frames = new Map<string, FrameSnapshot>();
  private readonly current = new AsyncLocalStorage<string>();
  private readonly now: () => number;

  constructor(store: TaskStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  // Ejecuta fn (el arranque de una tarea) recordando a qué tarea pertenecen los drivers que cree.
  track<T>(taskId: string, fn: () => T): T {
    return this.current.run(taskId, fn);
  }

  // Envuelve el driver de la tarea en curso: cada captura que devuelve queda como la última vista.
  // Sólo guarda referencias (sin copiar ni recodificar), así no frena al supervisor.
  watchDriver(child: Child<DriverRequest, DriverResponse>): Child<DriverRequest, DriverResponse> {
    const taskId = this.current.getStore();
    if (!taskId) return child;
    const request = child.request.bind(child);
    child.request = async (msg, opts) => {
      const res = await request(msg, opts);
      if (res.type === 'frame') {
        const prev = this.frames.get(taskId);
        const acted = msg.type === 'execute' && !res.frame.skipped;
        // Una observación posterior sigue mostrando dónde fue la última acción.
        const keep = msg.type === 'observe' && prev;
        this.keepFrame(taskId, {
          png: res.frame.png,
          width: res.frame.width,
          height: res.frame.height,
          at: this.now(),
          action: acted ? msg.action.type : keep ? keep.action : '',
          points: acted ? pointsOf(msg.action) : keep ? keep.points : [],
        });
      }
      return res;
    };
    return child;
  }

  frame(taskId: string): FrameSnapshot | undefined {
    return this.frames.get(taskId);
  }

  // Recibe los logs del supervisor (ya llevan task_id). Los secretos se redactan otra vez antes de guardar.
  onLog(event: string, data: Record<string, unknown>, secrets: readonly string[]): void {
    const stage = OBSERVED_LOGS[event];
    const taskId = data.task_id;
    if (!stage || typeof taskId !== 'string') return;
    const { task_id: _, ...rest } = data;
    try {
      this.store.addEvent(taskId, stage, redactValue(rest, secrets) as Record<string, unknown>);
    } catch {
      // El observatorio nunca interrumpe una tarea.
    }
  }

  private keepFrame(taskId: string, snap: FrameSnapshot): void {
    this.frames.delete(taskId);
    this.frames.set(taskId, snap);
    while (this.frames.size > MAX_FRAMES) this.frames.delete(this.frames.keys().next().value!);
  }
}
