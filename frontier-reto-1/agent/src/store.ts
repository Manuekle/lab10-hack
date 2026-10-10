// Registro persistente de tareas en SQLite. Nunca guarda contraseñas ni tokens.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Estado = 'en_curso' | 'terminada' | 'fallida';
export type Fase = 'admitida' | 'ejecutando' | 'verificando' | 'cerrando' | 'terminal';

export interface TaskRow {
  id: string;
  tarea: string;
  desktopKey: string;
  estado: Estado;
  fase: Fase;
  resumen: string;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export const RESTART_SUMMARY = 'La tarea se interrumpió por un reinicio del servicio y no se reanudó.';

// Migraciones por PRAGMA user_version. Sólo se agregan; nunca se editan las existentes.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    tarea TEXT NOT NULL,
    desktop_key TEXT NOT NULL,
    estado TEXT NOT NULL CHECK (estado IN ('en_curso', 'terminada', 'fallida')),
    fase TEXT NOT NULL CHECK (fase IN ('admitida', 'ejecutando', 'verificando', 'cerrando', 'terminal')),
    resumen TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX tasks_estado ON tasks (estado);
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks (id),
    at INTEGER NOT NULL,
    stage TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX events_task ON events (task_id, id);
  CREATE TRIGGER tasks_terminal_immutable BEFORE UPDATE ON tasks
  WHEN OLD.estado <> 'en_curso'
  BEGIN
    SELECT RAISE(ABORT, 'tarea terminal inmutable');
  END;
  `,
  // 2: conocimiento aprendido por aplicación (lecciones de UI y tiempos). Nunca datos de registros.
  `
  CREATE TABLE app_knowledge (
    app TEXT PRIMARY KEY,
    lessons TEXT NOT NULL DEFAULT '',
    slowdown_ms INTEGER NOT NULL DEFAULT 0,
    tasks INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  `,
];

export interface AppKnowledge {
  app: string;
  lessons: string;
  slowdownMs: number;
  tasks: number;
  updatedAt: number;
}

interface DbRow {
  id: string;
  tarea: string;
  desktop_key: string;
  estado: Estado;
  fase: Fase;
  resumen: string;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
}

function toTask(r: DbRow): TaskRow {
  return {
    id: r.id,
    tarea: r.tarea,
    desktopKey: r.desktop_key,
    estado: r.estado,
    fase: r.fase,
    resumen: r.resumen,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    finishedAt: r.finished_at,
  };
}

export class TaskStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  private constructor(db: DatabaseSync, now: () => number) {
    this.db = db;
    this.now = now;
  }

  static open(file: string, now: () => number = Date.now): TaskStore {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
    const store = new TaskStore(db, now);
    store.migrate();
    return store;
  }

  private migrate(): void {
    const { user_version: current } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // Al arrancar y antes de admitir: lo no terminal pasa a fallida, sin replay.
  recoverInterrupted(): number {
    const t = this.now();
    const r = this.db
      .prepare(`UPDATE tasks SET estado = 'fallida', fase = 'terminal', resumen = ?, updated_at = ?, finished_at = ? WHERE estado = 'en_curso'`)
      .run(RESTART_SUMMARY, t, t);
    return Number(r.changes);
  }

  insertTask(input: { id: string; tarea: string; desktopKey: string }): TaskRow {
    const t = this.now();
    this.db
      .prepare(`INSERT INTO tasks (id, tarea, desktop_key, estado, fase, resumen, created_at, updated_at) VALUES (?, ?, ?, 'en_curso', 'admitida', '', ?, ?)`)
      .run(input.id, input.tarea, input.desktopKey, t, t);
    return this.get(input.id)!;
  }

  get(id: string): TaskRow | undefined {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow | undefined;
    return r ? toTask(r) : undefined;
  }

  listOpen(): TaskRow[] {
    return (this.db.prepare(`SELECT * FROM tasks WHERE estado = 'en_curso' ORDER BY created_at`).all() as unknown as DbRow[]).map(toTask);
  }

  // Cambia la fase interna mientras la tarea sigue en curso. Devuelve false si ya es terminal.
  setPhase(id: string, fase: Exclude<Fase, 'terminal'>, resumen?: string): boolean {
    const t = this.now();
    const r =
      resumen === undefined
        ? this.db.prepare(`UPDATE tasks SET fase = ?, updated_at = ? WHERE id = ? AND estado = 'en_curso'`).run(fase, t, id)
        : this.db.prepare(`UPDATE tasks SET fase = ?, resumen = ?, updated_at = ? WHERE id = ? AND estado = 'en_curso'`).run(fase, resumen, t, id);
    return Number(r.changes) === 1;
  }

  // Publica el resultado terminal una sola vez. El trigger impide modificarlo después.
  finish(id: string, estado: Exclude<Estado, 'en_curso'>, resumen: string): boolean {
    const t = this.now();
    const r = this.db
      .prepare(`UPDATE tasks SET estado = ?, fase = 'terminal', resumen = ?, updated_at = ?, finished_at = ? WHERE id = ? AND estado = 'en_curso'`)
      .run(estado, resumen, t, t, id);
    return Number(r.changes) === 1;
  }

  addEvent(taskId: string, stage: string, data: Record<string, unknown> = {}): void {
    this.db.prepare('INSERT INTO events (task_id, at, stage, data) VALUES (?, ?, ?, ?)').run(taskId, this.now(), stage, JSON.stringify(data));
  }

  events(taskId: string): Array<{ at: number; stage: string; data: Record<string, unknown> }> {
    const rows = this.db.prepare('SELECT at, stage, data FROM events WHERE task_id = ? ORDER BY id').all(taskId) as Array<{
      at: number;
      stage: string;
      data: string;
    }>;
    return rows.map((r) => ({ at: r.at, stage: r.stage, data: JSON.parse(r.data) as Record<string, unknown> }));
  }

  getKnowledge(app: string): AppKnowledge | undefined {
    const r = this.db.prepare('SELECT app, lessons, slowdown_ms, tasks, updated_at FROM app_knowledge WHERE app = ?').get(app) as
      | { app: string; lessons: string; slowdown_ms: number; tasks: number; updated_at: number }
      | undefined;
    return r ? { app: r.app, lessons: r.lessons, slowdownMs: r.slowdown_ms, tasks: r.tasks, updatedAt: r.updated_at } : undefined;
  }

  saveKnowledge(app: string, update: { lessons?: string; slowdownMs?: number }): void {
    const t = this.now();
    const prev = this.getKnowledge(app);
    this.db
      .prepare(
        `INSERT INTO app_knowledge (app, lessons, slowdown_ms, tasks, updated_at) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(app) DO UPDATE SET lessons = excluded.lessons, slowdown_ms = excluded.slowdown_ms, tasks = app_knowledge.tasks + 1, updated_at = excluded.updated_at`,
      )
      .run(app, update.lessons ?? prev?.lessons ?? '', update.slowdownMs ?? prev?.slowdownMs ?? 0, t);
  }

  ping(): boolean {
    return (this.db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
  }

  close(): void {
    this.db.close();
  }
}
