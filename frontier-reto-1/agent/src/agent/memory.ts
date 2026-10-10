// Memoria temporal de una tarea: historial con resultados observados, notas del modelo y detección de falta de progreso.
import type { StepOutcome } from '../ipc.ts';
import type { Action, ValidProposal } from '../model/actions.ts';
import type { HistoryEntry } from './prompt.ts';

const CHANGE_EPSILON = 0.001;

export function describeAction(a: Action): string {
  switch (a.type) {
    case 'click':
    case 'double_click':
      return `${a.type} (${a.x},${a.y})`;
    case 'replace_text':
      return `replace_text (${a.x},${a.y}) "${a.text}"`;
    case 'fill':
      return `fill ${a.fields.map((f) => `(${f.x},${f.y}) "${f.text}"`).join(', ')}`;
    case 'type_text':
      return `type_text "${a.text}"`;
    case 'key':
      return `key ${a.key}`;
    case 'scroll':
      return `scroll ${a.direction} x${a.amount} en (${a.x},${a.y})`;
    case 'wait':
      return `wait ${a.ms} ms`;
    case 'finish':
      return `finish ${a.status}`;
  }
}

// Misma acción: mismo tipo y texto, y puntos a 12 px o menos.
function similar(a: Action, b: Action | undefined): boolean {
  if (!b || a.type !== b.type) return false;
  if ('x' in a && 'x' in b) return Math.abs(a.x - b.x) <= 12 && Math.abs(a.y - b.y) <= 12 && ('text' in a ? a.text : '') === ('text' in b ? b.text : '');
  return describeAction(a) === describeAction(b);
}

export class TaskMemory {
  readonly task: string;
  knowledge = '';
  notes = '';
  step = 0;
  readonly history: HistoryEntry[] = [];
  noChangeStreak = 0;
  repeatStreak = 0;
  private pending: { entry: Omit<HistoryEntry, 'outcome'>; action: Action } | undefined;
  private lastAction: Action | undefined;

  constructor(task: string) {
    this.task = task;
  }

  recordProposal(p: ValidProposal): void {
    this.step++;
    if (p.notes.trim()) this.notes = p.notes.trim().slice(0, 4000);
    this.pending = {
      entry: { step: this.step, action: describeAction(p.action), target: p.target, expected: p.expected },
      action: p.action,
    };
  }

  recordOutcome(outcome: StepOutcome | null): void {
    const pending = this.pending;
    if (!pending || !outcome) return;
    this.pending = undefined;
    let text: string;
    if (outcome.changed === null) {
      text = outcome.note || 'no se ejecutó';
    } else if (outcome.changed > CHANGE_EPSILON) {
      text = `la pantalla cambió (${(outcome.changed * 100).toFixed(1)}% de píxeles)${outcome.note ? `; ${outcome.note}` : ''}`;
      this.noChangeStreak = 0;
    } else {
      text = `la pantalla NO cambió${outcome.note ? `; ${outcome.note}` : ''}`;
      this.noChangeStreak++;
    }
    this.repeatStreak = similar(pending.action, this.lastAction) ? this.repeatStreak + 1 : 0;
    this.lastAction = pending.action;
    this.history.push({ ...pending.entry, outcome: text });
  }

  warnings(): string[] {
    const w: string[] = [];
    if (this.noChangeStreak >= 2) {
      w.push(`Llevas ${this.noChangeStreak} acciones seguidas sin cambio visible. No repitas lo mismo: revisa coordenadas, cierra lo que tape la vista, espera o usa otro camino.`);
    }
    if (this.knowledge && this.noChangeStreak >= 2) {
      w.push('Las pistas aprendidas de tareas anteriores pueden estar desactualizadas (la app pudo cambiar de versión o de tema): ignóralas y explora la pantalla actual.');
    }
    if (this.repeatStreak >= 1) {
      w.push('Repetiste la misma acción. Si no produjo lo esperado, cambia de estrategia.');
    }
    return w;
  }
}
