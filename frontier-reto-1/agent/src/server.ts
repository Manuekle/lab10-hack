// Contrato HTTP del evaluador. Todas las rutas exigen Authorization: Bearer <token del equipo>,
// salvo la página vacía de /ui, que pide el token y lo usa en cada llamada.
import crypto from 'node:crypto';
import type http from 'node:http';
import type { Admission } from './admission.ts';
import { parseDesktopUrl } from './desktop-url.ts';
import type { FrameSnapshot } from './observatory.ts';
import { redact, redactValue } from './redact.ts';
import type { TaskOverview, TaskStore } from './store.ts';
import type { TaskRun } from './supervisor.ts';
import { incidentData, uiAsset, uiPage } from './ui.ts';

export interface AppDeps {
  teamToken: string;
  store: TaskStore;
  admission: Admission;
  supervisor: { start(run: TaskRun, release: () => void): Promise<void> };
  isReady: () => boolean;
  allowPrivateDesktops: boolean;
  log: (event: string, data: Record<string, unknown>) => void;
  newId?: () => string;
  // Observatorio de sólo lectura (opcional): última captura por tarea y secretos a redactar en sus respuestas.
  frames?: { frame(taskId: string): FrameSnapshot | undefined };
  secrets?: readonly string[];
}

const MAX_BODY = 64 * 1024;
// Freno a la fuerza bruta del token: demasiados fallos desde una IP en un minuto dan 429.
const AUTH_WINDOW_MS = 60_000;
const AUTH_MAX_FAILURES = 30;
const authFailures = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: http.IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'desconocida';
}

function throttled(ip: string, now: number): boolean {
  const f = authFailures.get(ip);
  return Boolean(f && f.resetAt > now && f.count >= AUTH_MAX_FAILURES);
}

function noteFailure(ip: string, now: number): void {
  if (authFailures.size > 10_000) authFailures.clear();
  const f = authFailures.get(ip);
  if (!f || f.resetAt <= now) authFailures.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
  else f.count++;
}
const TASK_PATH = /^\/tasks\/([A-Za-z0-9_-]{1,64})$/;
const TASK_VIEW_PATH = /^\/tasks\/([A-Za-z0-9_-]{1,64})\/(events|frame\.png)$/;
const UI_ASSET_PATH = /^\/ui\/assets\/([^/]+)$/;
const RECENT_TASKS = 50;
const KNOWLEDGE_STAGES = ['knowledge_updated', 'knowledge_reset', 'knowledge_error'];
// Cabeceras de las rutas del observatorio: sin caché, sin sniffing y sin incrustarse en otros sitios.
const VIEW_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' };

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
  res.end(data);
}

function fail(res: http.ServerResponse, status: number, code: string, message: string): void {
  send(res, status, { error: { code, message } });
}

function sendView(res: http.ServerResponse, contentType: string, body: string | Uint8Array, extra: Record<string, string> = {}): void {
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body), ...VIEW_HEADERS, ...extra });
  res.end(body);
}

function overviewJson(t: TaskOverview, secrets: readonly string[]): Record<string, unknown> {
  return {
    id: t.id,
    estado: t.estado,
    fase: t.fase,
    tarea: redact(t.tarea, secrets),
    resumen: redact(t.resumen, secrets),
    created_at: t.createdAt,
    finished_at: t.finishedAt,
    cost: Number(t.cost.toFixed(5)),
    steps: t.steps,
  };
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1]!.trim()).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(Object.assign(new Error('cuerpo demasiado lento'), { status: 408 })), 1_000);
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        clearTimeout(timer);
        reject(Object.assign(new Error('cuerpo demasiado grande'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

type Parsed = { ok: true; tarea: string; url: string; key: string; password: string } | { ok: false; message: string };

export function parseTaskBody(raw: string, allowPrivate: boolean): Parsed {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'el cuerpo no es JSON válido' };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, message: 'el cuerpo debe ser un objeto' };
  const b = body as Record<string, unknown>;
  const problems: string[] = [];
  const tarea = typeof b.tarea === 'string' ? b.tarea.trim() : '';
  if (!tarea || tarea.length > 4000) problems.push('tarea debe ser texto de 1 a 4000 caracteres');
  const esc = b.escritorio;
  let url = '';
  let key = '';
  let password = '';
  if (typeof esc !== 'object' || esc === null || Array.isArray(esc)) {
    problems.push('escritorio debe ser un objeto con url y password');
  } else {
    const e = esc as Record<string, unknown>;
    const parsed = parseDesktopUrl(e.url, allowPrivate);
    if (parsed.ok) {
      url = parsed.url;
      key = parsed.key;
    } else problems.push(parsed.message);
    if (typeof e.password !== 'string' || e.password.length > 512) problems.push('escritorio.password debe ser texto de hasta 512 caracteres');
    else password = e.password;
  }
  if (problems.length) return { ok: false, message: problems.join('; ') };
  return { ok: true, tarea, url, key, password };
}

export function createHandler(deps: AppDeps): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const secrets = [deps.teamToken, ...(deps.secrets ?? [])];
  return (req, res) => {
    const receivedAt = performance.now();
    const path = (req.url ?? '/').split('?')[0]!;
    // La página de /ui no contiene datos: es pública y no cuenta como intento de autenticación.
    if (path === '/ui' || path === '/ui/') {
      if (req.method !== 'GET') return fail(res, 405, 'metodo', 'Usa GET');
      uiPage().then(
        (p) => sendView(res, 'text/html; charset=utf-8', p.html, { 'Content-Security-Policy': p.csp }),
        () => fail(res, 404, 'no_existe', 'La UI no está disponible en este despliegue'),
      );
      return;
    }
    const ip = clientIp(req);
    const now = Date.now();
    if (throttled(ip, now)) {
      fail(res, 429, 'demasiados_intentos', 'Demasiados intentos fallidos; espera un minuto');
      return;
    }
    if (!tokenMatches(req.headers.authorization, deps.teamToken)) {
      noteFailure(ip, now);
      fail(res, 401, 'no_autorizado', 'Falta o es inválido Authorization: Bearer <token>');
      return;
    }

    if (path === '/health') {
      if (req.method !== 'GET') return fail(res, 405, 'metodo', 'Usa GET');
      let ok = false;
      try {
        ok = deps.isReady() && deps.store.ping();
      } catch {
        ok = false;
      }
      return ok ? send(res, 200, { ok: true }) : fail(res, 503, 'no_listo', 'El agente no está listo');
    }

    if (path === '/tasks' && req.method === 'GET') {
      return send(res, 200, { tasks: deps.store.recentTasks(RECENT_TASKS).map((t) => overviewJson(t, secrets)) });
    }

    if (path === '/tasks') {
      if (req.method !== 'POST') return fail(res, 405, 'metodo', 'Usa GET o POST');
      if (!deps.isReady()) return fail(res, 503, 'no_listo', 'El agente no está listo');
      readBody(req).then(
        (raw) => {
          const parsed = parseTaskBody(raw, deps.allowPrivateDesktops);
          if (!parsed.ok) return fail(res, 422, 'cuerpo_invalido', parsed.message);
          const id = newId();
          const admitted = deps.admission.acquire(id, parsed.key);
          if (admitted === 'desktop_busy') return fail(res, 409, 'escritorio_ocupado', 'Ya hay una tarea activa en ese escritorio');
          if (admitted === 'capacity') return fail(res, 503, 'sin_capacidad', 'No hay capacidad para otra tarea ahora');
          try {
            deps.store.insertTask({ id, tarea: parsed.tarea, desktopKey: parsed.key });
          } catch {
            deps.admission.release(id);
            return fail(res, 500, 'registro', 'No se pudo registrar la tarea');
          }
          send(res, 200, { task_id: id });
          deps.log('task_admitted', { task_id: id, admitMs: Math.round(performance.now() - receivedAt) });
          setImmediate(() => {
            void deps.supervisor.start(
              { id, tarea: parsed.tarea, desktop: { url: parsed.url, password: parsed.password }, receivedAt },
              () => deps.admission.release(id),
            );
          });
        },
        (e: { status?: number; message?: string }) => fail(res, e.status ?? 400, 'cuerpo_invalido', redact(String(e.message ?? 'cuerpo inválido'), [])),
      );
      return;
    }

    const m = TASK_PATH.exec(path);
    if (m) {
      if (req.method !== 'GET') return fail(res, 405, 'metodo', 'Usa GET');
      const task = deps.store.get(m[1]!);
      if (!task) return fail(res, 404, 'no_existe', 'No existe esa tarea');
      return send(res, 200, { estado: task.estado, resumen: task.resumen });
    }

    // Observatorio: rutas de sólo lectura con el mismo token y el mismo freno a la fuerza bruta.
    const view = TASK_VIEW_PATH.exec(path);
    if (view) {
      if (req.method !== 'GET') return fail(res, 405, 'metodo', 'Usa GET');
      const task = deps.store.taskOverview(view[1]!);
      if (!task) return fail(res, 404, 'no_existe', 'No existe esa tarea');
      if (view[2] === 'events') {
        const events = deps.store.events(task.id).map((e) => ({ at: e.at, stage: e.stage, data: redactValue(e.data, secrets) }));
        return send(res, 200, { task: overviewJson(task, secrets), events });
      }
      const f = deps.frames?.frame(task.id);
      if (!f) return fail(res, 404, 'sin_captura', 'No hay captura en memoria para esa tarea');
      return sendView(res, 'image/png', f.png, {
        'X-Frame-At': String(f.at),
        'X-Frame-Size': `${f.width}x${f.height}`,
        'X-Frame-Action': f.action,
        'X-Frame-Points': f.points.map(([x, y]) => `${x},${y}`).join(';'),
      });
    }

    if (path === '/knowledge') {
      if (req.method !== 'GET') return fail(res, 405, 'metodo', 'Usa GET');
      const apps = deps.store.listKnowledge().map((k) => ({
        app: k.app,
        lessons: k.lessons
          .split('\n')
          .map((l) => redact(l.trim(), secrets))
          .filter(Boolean),
        slowdown_ms: k.slowdownMs,
        tasks: k.tasks,
        updated_at: k.updatedAt,
      }));
      const history = deps.store
        .eventsByStage(KNOWLEDGE_STAGES, 100)
        .map((e) => ({ task_id: e.taskId, at: e.at, stage: e.stage, data: redactValue(e.data, secrets) }));
      return send(res, 200, { apps, history });
    }

    if (path === '/ui/incidente.json') {
      if (req.method !== 'GET') return fail(res, 405, 'metodo', 'Usa GET');
      incidentData().then(
        (d) => send(res, 200, d),
        () => fail(res, 404, 'no_existe', 'No hay datos del incidente en este despliegue'),
      );
      return;
    }

    const asset = UI_ASSET_PATH.exec(path);
    if (asset) {
      if (req.method !== 'GET') return fail(res, 405, 'metodo', 'Usa GET');
      uiAsset(asset[1]!).then(
        (b) => (b ? sendView(res, 'image/png', b) : fail(res, 404, 'no_existe', 'No existe ese archivo')),
        () => fail(res, 404, 'no_existe', 'No existe ese archivo'),
      );
      return;
    }

    fail(res, 404, 'no_existe', 'Ruta desconocida');
  };
}
