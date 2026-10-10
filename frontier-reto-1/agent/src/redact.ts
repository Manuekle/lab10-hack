// Redacción de secretos para logs, evidencia y resúmenes.

const MASK = '[redactado]';

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  // Los secretos más largos primero, por si uno contiene a otro.
  for (const s of [...secrets].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length)) {
    out = out.split(s).join(MASK);
  }
  // Credenciales embebidas en URLs y cabeceras Bearer.
  out = out.replace(/(wss?|https?):\/\/[^\s/@:]+:[^\s/@]+@/gi, '$1://[redactado]@');
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, `Bearer ${MASK}`);
  out = out.replace(/sk-or-[A-Za-z0-9_-]{8,}/g, MASK);
  out = out.replace(/ftr_[A-Za-z0-9_-]{8,}/g, MASK);
  return out;
}

// Redacta cada texto dentro de un valor JSON (objetos, listas) sin tocar su estructura.
export function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return redact(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, secrets)]));
  return value;
}

export function log(event: string, data: Record<string, unknown> = {}, secrets: readonly string[] = []): void {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...data });
  process.stdout.write(`${redact(line, secrets)}\n`);
}
