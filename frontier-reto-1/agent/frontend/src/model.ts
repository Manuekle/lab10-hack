import {useSyncExternalStore} from 'react';
import type incidentData from '../../src/ui/incidente.json';
import {clock} from './format';

export type View = 'tareas' | 'aprendido' | 'incidente';

export interface Task {
  id: string;
  estado: string;
  fase: string;
  tarea: string;
  resumen: string | null;
  created_at: number;
  finished_at: number | null;
  cost: number;
  steps: number;
}

export interface Event {
  task_id?: string;
  id?: string | number;
  seq?: number;
  at: number;
  stage: string;
  data: Record<string, unknown>;
}

export interface TaskDetail {task: Task; events: Event[]}

export interface Knowledge {
  apps: {app: string; tasks: number; slowdown_ms: number; updated_at: number; lessons: string[]}[];
  history: Event[];
}

export type Incident = typeof incidentData;

export interface Frame {
  taskId: string | null;
  at: number;
  url: string | null;
  w: number;
  h: number;
  points: [number, number][];
  action: string;
}

export interface ObservatorySnapshot {
  token: string | null;
  view: View;
  taskId: string | null;
  tasks: Task[];
  detail: TaskDetail | null;
  frame: Frame;
  knowledge: Knowledge | null;
  incident: Incident | null;
  assets: Map<string, string>;
  incEvents: Map<string, TaskDetail & {final: boolean}>;
  live: string;
  warn: boolean;
  error: string;
  detailError: string;
  loading: boolean;
}

const TOKEN_KEY = 'observatorio.token';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const listeners = new Set<() => void>();
const last = {list: 0, know: 0, inc: 0};
let generation = 0;
let busy = false;
let again = false;
let timer: ReturnType<typeof setInterval> | undefined;
let started = false;

function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function writeToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* The session still works in memory when storage is unavailable. */ }
}

function emptyFrame(): Frame {
  return {taskId: null, at: 0, url: null, w: 0, h: 0, points: [], action: ''};
}

function hashRoute() {
  const match = /^#\/(tareas|aprendido|incidente)(?:\/([A-Za-z0-9_-]{1,64}))?$/.exec(location.hash);
  return {view: (match?.[1] || 'tareas') as View, taskId: match?.[1] === 'tareas' ? match[2] || null : null};
}

const initialRoute = hashRoute();
let snapshot: ObservatorySnapshot = {
  token: readToken(), ...initialRoute, tasks: [], detail: null, frame: emptyFrame(),
  knowledge: null, incident: null, assets: new Map(), incEvents: new Map(),
  live: '', warn: false, error: '', detailError: '', loading: false,
};

function publish(change: Partial<ObservatorySnapshot>) {
  snapshot = {...snapshot, ...change};
  for (const listener of listeners) listener();
}

class Stop extends Error {}

function checkGeneration(expected: number) {
  if (generation !== expected) throw new Stop();
}

export function signOut(message = '') {
  generation++;
  again = false;
  writeToken(null);
  for (const url of snapshot.assets.values()) URL.revokeObjectURL(url);
  if (snapshot.frame.url) URL.revokeObjectURL(snapshot.frame.url);
  last.list = 0;
  last.know = 0;
  last.inc = 0;
  publish({
    token: null, tasks: [], detail: null, frame: emptyFrame(), knowledge: null,
    assets: new Map(), incEvents: new Map(), live: '', warn: false, error: message,
    detailError: '', loading: false,
  });
}

async function api<T>(path: string, expected: number, as?: 'json', token?: string): Promise<T>;
async function api(path: string, expected: number, as: 'raw', token?: string): Promise<Response>;
async function api(path: string, expected: number, as: 'blob', token?: string): Promise<Blob>;
async function api<T>(path: string, expected: number, as: 'json' | 'raw' | 'blob' = 'json', token = snapshot.token): Promise<T | Response | Blob> {
  if (!token) throw new Stop();
  checkGeneration(expected);
  const response = await fetch(path, {
    headers: {Authorization: `Bearer ${token}`}, cache: 'no-store', credentials: 'omit',
  });
  checkGeneration(expected);
  if (response.status === 401) {
    signOut('El servicio rechazó el token. Escríbelo de nuevo.');
    throw new Stop();
  }
  if (response.status === 429) {
    const message = 'Demasiados intentos fallidos desde esta red: espera un minuto.';
    publish({live: message, warn: true, ...(!snapshot.token ? {error: message} : {})});
    throw new Stop();
  }
  if (as === 'raw') return response;
  if (!response.ok) {
    let message = `El servicio respondió ${response.status}`;
    try {
      const body = await response.json() as {error?: {message?: string}};
      message = body.error?.message || message;
    } catch { /* An error response may not contain JSON. */ }
    checkGeneration(expected);
    throw new Error(message);
  }
  const result = as === 'blob' ? await response.blob() : await response.json() as T;
  checkGeneration(expected);
  return result;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function signIn(rawToken: string) {
  const token = rawToken.trim();
  if (!token) {
    publish({error: 'Escribe el token del equipo.'});
    return;
  }
  const expected = ++generation;
  publish({error: '', warn: false, live: ''});
  try {
    await api<{tasks: Task[]}>('/tasks', expected, 'json', token);
    checkGeneration(expected);
    writeToken(token);
    publish({token, error: ''});
    await loadIncidentData(expected).catch(() => {});
    checkGeneration(expected);
    await refresh(true);
  } catch (error) {
    if (!(error instanceof Stop) && generation === expected) {
      publish({token: null, error: `No se pudo conectar: ${messageOf(error)}`});
    }
  }
}

async function asset(name: string, expected: number) {
  const cached = snapshot.assets.get(name);
  if (cached) return cached;
  const blob = await api(`/ui/assets/${encodeURIComponent(name)}`, expected, 'blob');
  checkGeneration(expected);
  const url = URL.createObjectURL(blob);
  const duplicate = snapshot.assets.get(name);
  if (duplicate) {
    URL.revokeObjectURL(url);
    return duplicate;
  }
  const assets = new Map(snapshot.assets);
  assets.set(name, url);
  publish({assets});
  return url;
}

function route() {
  const next = hashRoute();
  const changed = next.view !== snapshot.view;
  const taskId = next.view === 'tareas' && next.taskId ? next.taskId : snapshot.taskId;
  publish({view: next.view, taskId});
  if (changed) window.scrollTo(0, 0);
  void refresh(true);
}

export function navigate(view: View, taskId?: string) {
  const hash = view === 'tareas' && taskId && ID.test(taskId) ? `#/${view}/${taskId}` : `#/${view}`;
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function loadList(expected: number) {
  const {tasks} = await api<{tasks: Task[]}>('/tasks', expected);
  last.list = Date.now();
  publish({tasks, taskId: snapshot.taskId || tasks[0]?.id || null});
}

async function loadDetail(expected: number) {
  const id = snapshot.taskId;
  if (!id || !ID.test(id)) return;
  let detail: TaskDetail;
  try {
    detail = await api<TaskDetail>(`/tasks/${id}/events`, expected);
  } catch (error) {
    if (error instanceof Stop) throw error;
    if (id === snapshot.taskId) publish({detailError: `No se pudo abrir la tarea: ${messageOf(error)}`});
    return;
  }
  if (id !== snapshot.taskId) return;
  const wasRunning = snapshot.detail?.task.id === id && snapshot.detail.task.estado === 'en_curso';
  publish({detail, detailError: ''});
  await loadFrame(id, wasRunning || detail.task.estado === 'en_curso', expected);
}

async function loadFrame(id: string, live: boolean, expected: number) {
  const frame = snapshot.frame;
  if (frame.taskId === id && !live) return;
  const response = await api(`/tasks/${id}/frame.png`, expected, 'raw');
  if (id !== snapshot.taskId) return;
  if (response.status === 404) {
    if (frame.url) URL.revokeObjectURL(frame.url);
    publish({frame: {...emptyFrame(), taskId: id}});
    return;
  }
  if (!response.ok) throw new Error(`captura: ${response.status}`);
  const at = Number(response.headers.get('X-Frame-At')) || 0;
  if (frame.taskId === id && frame.at === at && frame.url) return;
  const [w, h] = (response.headers.get('X-Frame-Size') || '0x0').split('x').map(Number);
  const points = (response.headers.get('X-Frame-Points') || '')
    .split(';').filter(Boolean).map(point => point.split(',').map(Number))
    .filter(point => point.length === 2 && point.every(Number.isFinite)) as [number, number][];
  const blob = await response.blob();
  checkGeneration(expected);
  if (id !== snapshot.taskId) return;
  const url = URL.createObjectURL(blob);
  if (frame.url) URL.revokeObjectURL(frame.url);
  publish({frame: {taskId: id, at, url, w, h, points, action: response.headers.get('X-Frame-Action') || ''}});
}

async function loadKnowledge(expected: number) {
  if (!snapshot.incident) await loadIncidentData(expected).catch(() => {});
  const knowledge = await api<Knowledge>('/knowledge', expected);
  last.know = Date.now();
  publish({knowledge});
}

async function loadIncidentData(expected: number) {
  const incident = await api<Incident>('/ui/incidente.json', expected);
  publish({incident});
  return incident;
}

async function loadIncident(expected: number) {
  const incident = snapshot.incident || await loadIncidentData(expected);
  await Promise.all([asset(incident.deteccion.antes.imagen, expected), asset(incident.deteccion.despues.imagen, expected)]);
  const since = Date.parse(incident.desde);
  if (Date.now() - last.list > 4_000) await loadList(expected);
  const tasks = snapshot.tasks.filter(task => task.created_at >= since);
  const now = Date.now();
  const pending = tasks.filter(task => !snapshot.incEvents.get(task.id)?.final);
  for (let index = 0; index < pending.length; index += 4) {
    const results = await Promise.all(pending.slice(index, index + 4).map(async task => {
      const detail = await api<TaskDetail>(`/tasks/${task.id}/events`, expected);
      return [task.id, {...detail, final: detail.task.estado !== 'en_curso' && now - (detail.task.finished_at || now) > 60_000}] as const;
    }));
    checkGeneration(expected);
    const incEvents = new Map(snapshot.incEvents);
    for (const [id, detail] of results) incEvents.set(id, detail);
    publish({incEvents});
  }
  const knowledge = await api<Knowledge>('/knowledge', expected);
  last.inc = Date.now();
  publish({knowledge});
}

export async function refresh(force = false) {
  if (!snapshot.token) return;
  if (busy) { again = again || force; return; }
  busy = true;
  const expected = generation;
  publish({loading: true});
  try {
    const now = Date.now();
    const running = snapshot.tasks.some(task => task.estado === 'en_curso');
    if (snapshot.view === 'tareas') {
      if (force || now - last.list > (running ? 4_000 : 15_000)) await loadList(expected);
      const detail = snapshot.detail;
      if (snapshot.taskId && (force || !detail || detail.task.id !== snapshot.taskId || detail.task.estado === 'en_curso')) await loadDetail(expected);
    } else if (snapshot.view === 'aprendido') {
      if (force || now - last.know > 10_000) await loadKnowledge(expected);
    } else if (force || now - last.inc > 6_000) {
      await loadIncident(expected);
    }
    checkGeneration(expected);
    publish({live: `${running || snapshot.detail?.task.estado === 'en_curso' ? 'En vivo' : 'Al día'} · ${clock(Date.now())}`, warn: false});
  } catch (error) {
    if (!(error instanceof Stop) && generation === expected) publish({live: `Sin datos: ${messageOf(error)}`, warn: true});
  } finally {
    busy = false;
    if (generation === expected) publish({loading: false});
    if (again && snapshot.token) { again = false; void refresh(true); }
  }
}

function visible() {
  if (!document.hidden) void refresh();
}

function start() {
  if (started) return;
  started = true;
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', visible);
  timer = setInterval(visible, 2_000);
  if (snapshot.token) {
    const expected = generation;
    void loadIncidentData(expected).catch(() => {}).finally(() => {
      if (generation === expected) route();
    });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      window.removeEventListener('hashchange', route);
      document.removeEventListener('visibilitychange', visible);
      started = false;
    }
  };
}

function getSnapshot() { return snapshot; }

export function useObservatory() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
