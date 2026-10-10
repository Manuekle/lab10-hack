// Resumen final publicado al evaluador. Una línea `respuesta:` sólo en preguntas terminadas; nunca secretos.
import { redact } from './redact.ts';

const ANSWER_LINE = /^\s*respuesta\s*:.*$/gim;

function clean(text: string): string {
  return text.replace(ANSWER_LINE, '').replace(/\n{3,}/g, '\n\n').trim();
}

export function buildResumen(
  input: { status: 'terminada' | 'fallida'; summary: string; answer: string | null },
  secrets: readonly string[],
): string {
  const lines: string[] = [];
  const answer = input.answer?.replace(/\s+/g, ' ').trim();
  if (input.status === 'terminada' && answer) lines.push(`respuesta: ${answer}`);
  const body = clean(input.summary);
  if (body) lines.push(body);
  return redact(lines.join('\n'), secrets).slice(0, 4000);
}

export function failureResumen(reason: string, notes: string, secrets: readonly string[]): string {
  const parts = [`No se completó la tarea: ${reason}`];
  const n = clean(notes);
  if (n) parts.push(`Avance observado: ${n.slice(0, 1200)}`);
  return redact(parts.join('\n'), secrets);
}
