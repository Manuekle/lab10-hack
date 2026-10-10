import {formatAmount} from '@/components/lime/ui/amount';
import type {Task} from './model';

const timeZone = 'America/Bogota';
const time = new Intl.DateTimeFormat('es-CO', {timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
const shortTime = new Intl.DateTimeFormat('es-CO', {timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
const date = new Intl.DateTimeFormat('es-CO', {timeZone, day: 'numeric', month: 'short'});
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const num = new Intl.NumberFormat('es-CO');
export const pct = new Intl.NumberFormat('es-CO', {style: 'percent', maximumFractionDigits: 1});
export const clock = (ms: number) => ms ? time.format(new Date(ms)) : '—';
export const shortClock = (ms: number) => ms ? shortTime.format(new Date(ms)) : '—';
export const day = (ms: number) => ms ? date.format(new Date(ms)) : '—';
export const taskHref = (id?: string) => id && ID.test(id) ? `#/tareas/${id}` : '#/tareas';
export const durationOf = (task: Task) => (task.finished_at ?? Date.now()) - task.created_at;
export const secs = (ms: number) => ms >= 60_000
  ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
  : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
export const formatCost = (cost: number) => formatAmount(Number(cost || 0), {currency: 'USD', currencyDisplay: 'code', fractionDigits: 4});
