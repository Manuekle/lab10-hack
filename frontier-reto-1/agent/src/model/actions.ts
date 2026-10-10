// Esquema de propuestas del modelo y validación local. El modelo propone; el supervisor decide.
import { parseCombo } from '../rfb/input.ts';

export const ACTION_TYPES = ['click', 'double_click', 'replace_text', 'type_text', 'key', 'scroll', 'wait', 'finish'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface RawAction {
  type: ActionType;
  x: number | null;
  y: number | null;
  text: string | null;
  key: string | null;
  direction: 'up' | 'down' | null;
  amount: number | null;
  ms: number | null;
  status: 'terminada' | 'fallida' | null;
  summary: string | null;
  answer: string | null;
}

export interface FillField {
  x: number;
  y: number;
  text: string;
}

export interface Proposal {
  frame_id: number;
  observation: string;
  notes: string;
  action: RawAction;
  fill: FillField[];
  target: string;
  reason: string;
  expected: string;
}

export type Action =
  | { type: 'click' | 'double_click'; x: number; y: number }
  | { type: 'replace_text'; x: number; y: number; text: string }
  // replace_text con campos adicionales del mismo formulario, en orden, sin inferencias intermedias.
  | { type: 'fill'; fields: FillField[] }
  | { type: 'type_text'; text: string }
  | { type: 'key'; key: string }
  | { type: 'scroll'; x: number; y: number; direction: 'up' | 'down'; amount: number }
  | { type: 'wait'; ms: number }
  | { type: 'finish'; status: 'terminada' | 'fallida'; summary: string; answer: string | null };

export interface ValidProposal extends Omit<Proposal, 'action' | 'fill'> {
  action: Action;
}

// anyOf [tipo, null]: Anthropic rechaza enum con null dentro de type: [t, 'null'].
const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ anyOf: [{ type, ...extra }, { type: 'null' }] });

// JSON Schema compatible con structured outputs estrictos: todo requerido, nulos explícitos.
export const PROPOSAL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['frame_id', 'observation', 'notes', 'action', 'fill', 'target', 'reason', 'expected'],
  properties: {
    frame_id: { type: 'integer', description: 'ID de la captura en la que se basa la propuesta' },
    observation: { type: 'string', description: 'Lo relevante que se ve en pantalla, breve' },
    notes: { type: 'string', description: 'Memoria de trabajo acumulada: hallazgos, conteos, páginas vistas' },
    action: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'x', 'y', 'text', 'key', 'direction', 'amount', 'ms', 'status', 'summary', 'answer'],
      properties: {
        type: { type: 'string', enum: [...ACTION_TYPES] },
        x: nullable('integer'),
        y: nullable('integer'),
        text: nullable('string'),
        key: nullable('string'),
        direction: nullable('string', { enum: ['up', 'down'] }),
        amount: nullable('integer'),
        ms: nullable('integer'),
        status: nullable('string', { enum: ['terminada', 'fallida'] }),
        summary: nullable('string'),
        answer: nullable('string'),
      },
    },
    fill: {
      type: 'array',
      description: 'Sólo con action replace_text: otros campos visibles del mismo formulario para llenar en orden. Vacío si no aplica.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y', 'text'],
        properties: { x: { type: 'integer' }, y: { type: 'integer' }, text: { type: 'string' } },
      },
    },
    target: { type: 'string', description: 'Elemento visible sobre el que actúa' },
    reason: { type: 'string', description: 'Por qué esta acción avanza la tarea' },
    expected: { type: 'string', description: 'Qué debe verse después si la acción funcionó' },
  },
} as const;

// Teclas permitidas. Nada que cierre el navegador kiosko, abra pestañas o diálogos del sistema.
const ALLOWED_KEYS = [
  'Return',
  'Tab',
  'Escape',
  'BackSpace',
  'Delete',
  'Home',
  'End',
  'Left',
  'Right',
  'Up',
  'Down',
  'PageUp',
  'PageDown',
  'space',
  'ctrl+a',
  'shift+Tab',
  'ctrl+Home',
  'ctrl+End',
  'shift+Home',
  'shift+End',
  'alt+Down',
  'alt+Up',
];
const ALLOWED_KEY_SIGS = new Set(ALLOWED_KEYS.map((k) => parseCombo(k).join(',')));

export function isAllowedKey(key: string): boolean {
  try {
    return ALLOWED_KEY_SIGS.has(parseCombo(key).join(','));
  } catch {
    return false;
  }
}

export const LIMITS = { maxText: 500, maxSummary: 2000, minWaitMs: 100, maxWaitMs: 5000, maxScroll: 20, maxFill: 8 } as const;

import type { CoordMode } from '../config.ts';
export type { CoordMode };

export interface ValidationContext {
  frameId: number;
  width: number;
  height: number;
  coords?: CoordMode; // por defecto 'pixel'
}

export type ValidationResult = { ok: true; proposal: ValidProposal } | { ok: false; errors: string[] };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateProposal(input: unknown, ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['La propuesta no es un objeto JSON'] };
  const str = (k: string, max = 2000): string => {
    const v = input[k];
    if (typeof v !== 'string') {
      errors.push(`${k} debe ser texto`);
      return '';
    }
    return v.slice(0, max);
  };
  const frameId = input.frame_id;
  if (!Number.isInteger(frameId)) errors.push('frame_id debe ser entero');
  else if (frameId !== ctx.frameId) errors.push(`frame_id ${frameId} no es la captura vigente (${ctx.frameId})`);
  const observation = str('observation');
  const notes = str('notes', 4000);
  const target = str('target', 500);
  const reason = str('reason', 1000);
  const expected = str('expected', 1000);

  const a = input.action;
  if (!isObj(a)) {
    errors.push('action debe ser un objeto');
    return { ok: false, errors };
  }
  const type = a.type;
  if (typeof type !== 'string' || !(ACTION_TYPES as readonly string[]).includes(type)) {
    errors.push(`action.type inválido: ${String(type)}`);
    return { ok: false, errors };
  }

  const point = (src: Record<string, unknown> = a): { x: number; y: number } | undefined => {
    const { x, y } = src;
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      errors.push(`${type} requiere x,y enteros`);
      return undefined;
    }
    if (ctx.coords === 'norm1000') {
      if ((x as number) < 0 || (y as number) < 0 || (x as number) > 1000 || (y as number) > 1000) {
        errors.push(`Coordenadas fuera de rango 0-1000: ${x},${y}`);
        return undefined;
      }
      return {
        x: Math.min(ctx.width - 1, Math.round(((x as number) / 1000) * ctx.width)),
        y: Math.min(ctx.height - 1, Math.round(((y as number) / 1000) * ctx.height)),
      };
    }
    if ((x as number) < 0 || (y as number) < 0 || (x as number) >= ctx.width || (y as number) >= ctx.height) {
      errors.push(`Coordenadas fuera de pantalla: ${x},${y} en ${ctx.width}x${ctx.height}`);
      return undefined;
    }
    return { x: x as number, y: y as number };
  };
  const text = (allowEmpty: boolean, src: Record<string, unknown> = a): string | undefined => {
    const t = src.text;
    if (typeof t !== 'string') {
      errors.push(`${type} requiere text`);
      return undefined;
    }
    if (!allowEmpty && t.length === 0) errors.push(`${type} requiere text no vacío`);
    if (t.length > LIMITS.maxText) errors.push(`text supera ${LIMITS.maxText} caracteres`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(t)) errors.push('text contiene caracteres de control');
    return t;
  };

  let action: Action | undefined;
  switch (type as ActionType) {
    case 'click':
    case 'double_click': {
      const p = point();
      if (p) action = { type: type as 'click' | 'double_click', ...p };
      break;
    }
    case 'replace_text': {
      const p = point();
      const t = text(true);
      if (p && t !== undefined) action = { type: 'replace_text', ...p, text: t };
      break;
    }
    case 'type_text': {
      const t = text(false);
      if (t !== undefined) action = { type: 'type_text', text: t };
      break;
    }
    case 'key': {
      const k = a.key;
      if (typeof k !== 'string' || !isAllowedKey(k)) errors.push(`Tecla no permitida: ${String(k)}`);
      else action = { type: 'key', key: k };
      break;
    }
    case 'scroll': {
      const p = point();
      const dir = a.direction;
      if (dir !== 'up' && dir !== 'down') errors.push('scroll requiere direction up|down');
      const amount = a.amount === null || a.amount === undefined ? 3 : a.amount;
      if (!Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > LIMITS.maxScroll) {
        errors.push(`amount debe estar entre 1 y ${LIMITS.maxScroll}`);
      }
      if (p && (dir === 'up' || dir === 'down') && errors.length === 0) {
        action = { type: 'scroll', ...p, direction: dir, amount: amount as number };
      }
      break;
    }
    case 'wait': {
      const ms = a.ms;
      if (!Number.isInteger(ms) || (ms as number) < LIMITS.minWaitMs || (ms as number) > LIMITS.maxWaitMs) {
        errors.push(`wait.ms debe estar entre ${LIMITS.minWaitMs} y ${LIMITS.maxWaitMs}`);
      } else action = { type: 'wait', ms: ms as number };
      break;
    }
    case 'finish': {
      const status = a.status;
      const summary = a.summary;
      const answer = a.answer;
      if (status !== 'terminada' && status !== 'fallida') errors.push('finish requiere status terminada|fallida');
      if (typeof summary !== 'string' || summary.trim().length === 0) errors.push('finish requiere summary');
      if (answer !== null && answer !== undefined && typeof answer !== 'string') errors.push('answer debe ser texto o null');
      if (errors.length === 0) {
        action = {
          type: 'finish',
          status: status as 'terminada' | 'fallida',
          summary: (summary as string).slice(0, LIMITS.maxSummary),
          answer: typeof answer === 'string' && answer.trim() ? answer.trim() : null,
        };
      }
      break;
    }
  }

  const rawFill = input.fill === undefined || input.fill === null ? [] : input.fill;
  if (!Array.isArray(rawFill)) errors.push('fill debe ser una lista');
  else if (rawFill.length > 0) {
    if (type !== 'replace_text') errors.push('fill sólo se permite con action replace_text');
    if (rawFill.length > LIMITS.maxFill) errors.push(`fill admite como máximo ${LIMITS.maxFill} campos`);
    const fields: FillField[] = [];
    for (const f of rawFill) {
      if (!isObj(f)) {
        errors.push('cada campo de fill debe ser un objeto');
        continue;
      }
      const p = point(f);
      const t = text(true, f);
      if (p && t !== undefined) fields.push({ ...p, text: t });
    }
    if (action?.type === 'replace_text' && errors.length === 0) {
      action = { type: 'fill', fields: [{ x: action.x, y: action.y, text: action.text }, ...fields] };
    }
  }

  if (errors.length > 0 || !action) return { ok: false, errors: errors.length ? errors : ['Acción inválida'] };
  return { ok: true, proposal: { frame_id: frameId as number, observation, notes, action, target, reason, expected } };
}

// Extrae JSON aunque el modelo lo envuelva en ```json ... ``` o agregue texto alrededor.
export function extractJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fenced?.[1]) return JSON.parse(fenced[1]);
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('La respuesta del modelo no contiene JSON');
  }
}
