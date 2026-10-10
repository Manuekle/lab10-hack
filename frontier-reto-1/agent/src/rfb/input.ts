// Mouse y teclado sobre RFB: clic mantenido, combinaciones, escritura por carácter y liberación total.
import { setTimeout as sleep } from 'node:timers/promises';

export const Keysym: Record<string, number> = {
  BackSpace: 0xff08,
  Tab: 0xff09,
  Return: 0xff0d,
  Escape: 0xff1b,
  Delete: 0xffff,
  Home: 0xff50,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  End: 0xff57,
  Insert: 0xff63,
  Shift_L: 0xffe1,
  Control_L: 0xffe3,
  Alt_L: 0xffe9,
  space: 0x0020,
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,
};

const ALIASES: Record<string, string> = {
  enter: 'Return',
  return: 'Return',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  backspace: 'BackSpace',
  delete: 'Delete',
  del: 'Delete',
  home: 'Home',
  end: 'End',
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  insert: 'Insert',
  space: 'space',
  ctrl: 'Control_L',
  control: 'Control_L',
  shift: 'Shift_L',
  alt: 'Alt_L',
};

const MODIFIERS = new Set(['Control_L', 'Shift_L', 'Alt_L']);

// Keysym de un carácter: Latin-1 directo; resto de Unicode con el prefijo 0x01000000.
export function charToKeysym(ch: string): number {
  const cp = ch.codePointAt(0);
  if (cp === undefined) throw new Error('Carácter vacío');
  if (ch === '\n') return Keysym.Return!;
  if (ch === '\t') return Keysym.Tab!;
  if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) return cp;
  if (cp < 0x20 || cp === 0x7f) throw new Error(`Carácter de control no permitido: U+${cp.toString(16)}`);
  return 0x01000000 | cp;
}

export function keyNameToKeysym(name: string): number {
  const canonical = Keysym[name] !== undefined ? name : ALIASES[name.toLowerCase()];
  if (canonical && Keysym[canonical] !== undefined) return Keysym[canonical]!;
  if (/^f([1-9]|1[0-2])$/i.test(name)) return Keysym[name.toUpperCase()]!;
  if ([...name].length === 1) return charToKeysym(name);
  throw new Error(`Tecla desconocida: ${name}`);
}

// "ctrl+a" -> [Control_L, a]. Los modificadores van primero.
export function parseCombo(combo: string): number[] {
  const trimmed = combo.trim();
  // "+" y "ctrl++" usan la tecla '+'.
  const raw = trimmed === '+' ? ['+'] : trimmed.endsWith('++') ? [...trimmed.slice(0, -2).split('+'), '+'] : trimmed.split('+');
  const parts = raw.map((p) => (p === '+' ? p : p.trim()));
  if (parts.length === 0 || parts.some((p) => p.length === 0)) throw new Error(`Combinación inválida: ${combo}`);
  const modNames = parts.slice(0, -1).map((p) => (Keysym[p] !== undefined ? p : ALIASES[p.toLowerCase()]));
  if (modNames.some((m) => !m || !MODIFIERS.has(m))) throw new Error(`Sólo ctrl, shift o alt pueden combinarse: ${combo}`);
  return [...modNames.map((m) => Keysym[m!]!), keyNameToKeysym(parts[parts.length - 1]!)];
}

export interface InputSink {
  readonly width: number;
  readonly height: number;
  sendPointer(buttonMask: number, x: number, y: number): void;
  sendKey(down: boolean, keysym: number): void;
}

export interface InputTiming {
  clickHoldMs: number; // README: <100 ms se ignora
  doubleClickGapMs: number;
  keyHoldMs: number;
  interKeyMs: number;
}

export const DEFAULT_TIMING: InputTiming = {
  clickHoldMs: 160,
  doubleClickGapMs: 120,
  keyHoldMs: 12,
  interKeyMs: 25,
};

export const Button = { Left: 1, Middle: 2, Right: 4, WheelUp: 8, WheelDown: 16 } as const;

export class InputController {
  private heldKeys = new Set<number>();
  private buttonMask = 0;
  private x = 0;
  private y = 0;
  private readonly sink: InputSink;
  private readonly timing: InputTiming;
  private readonly wait: (ms: number) => Promise<unknown>;

  constructor(sink: InputSink, timing: InputTiming = DEFAULT_TIMING, wait: (ms: number) => Promise<unknown> = sleep) {
    this.sink = sink;
    this.timing = timing;
    this.wait = wait;
  }

  clamp(x: number, y: number): { x: number; y: number } {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Coordenadas no numéricas');
    return {
      x: Math.min(this.sink.width - 1, Math.max(0, Math.round(x))),
      y: Math.min(this.sink.height - 1, Math.max(0, Math.round(y))),
    };
  }

  move(x: number, y: number): void {
    const p = this.clamp(x, y);
    this.x = p.x;
    this.y = p.y;
    this.sink.sendPointer(this.buttonMask, p.x, p.y);
  }

  async click(x: number, y: number, button: number = Button.Left): Promise<void> {
    this.move(x, y);
    await this.wait(30);
    this.buttonMask |= button;
    this.sink.sendPointer(this.buttonMask, this.x, this.y);
    try {
      await this.wait(this.timing.clickHoldMs);
    } finally {
      this.buttonMask &= ~button;
      this.sink.sendPointer(this.buttonMask, this.x, this.y);
    }
  }

  async doubleClick(x: number, y: number): Promise<void> {
    await this.click(x, y);
    await this.wait(this.timing.doubleClickGapMs);
    await this.click(x, y);
  }

  async scroll(x: number, y: number, direction: 'up' | 'down', ticks: number): Promise<void> {
    this.move(x, y);
    const b = direction === 'up' ? Button.WheelUp : Button.WheelDown;
    const n = Math.min(20, Math.max(1, Math.round(ticks)));
    for (let i = 0; i < n; i++) {
      this.sink.sendPointer(this.buttonMask | b, this.x, this.y);
      this.sink.sendPointer(this.buttonMask, this.x, this.y);
      await this.wait(40);
    }
  }

  private down(keysym: number): void {
    this.heldKeys.add(keysym);
    this.sink.sendKey(true, keysym);
  }

  private up(keysym: number): void {
    this.heldKeys.delete(keysym);
    this.sink.sendKey(false, keysym);
  }

  async tap(keysym: number): Promise<void> {
    this.down(keysym);
    try {
      await this.wait(this.timing.keyHoldMs);
    } finally {
      this.up(keysym);
    }
  }

  async combo(combo: string): Promise<void> {
    const syms = parseCombo(combo);
    const mods = syms.slice(0, -1);
    const key = syms[syms.length - 1]!;
    try {
      for (const m of mods) {
        this.down(m);
        await this.wait(this.timing.keyHoldMs);
      }
      await this.tap(key);
    } finally {
      for (const m of mods.reverse()) this.up(m);
    }
  }

  // Un carácter a la vez: enviar la cadena de golpe dejó texto incompleto en la auditoría.
  async typeText(text: string): Promise<void> {
    for (const ch of text) {
      await this.tap(charToKeysym(ch));
      await this.wait(this.timing.interKeyMs);
    }
  }

  // Selecciona todo y escribe encima. La lectura posterior del campo confirma el valor.
  async replaceText(x: number, y: number, text: string): Promise<void> {
    await this.click(x, y);
    await this.wait(120);
    await this.combo('ctrl+a');
    await this.wait(60);
    await this.tap(Keysym.BackSpace!);
    await this.wait(60);
    await this.typeText(text);
  }

  // Suelta teclas y botones que hayan quedado presionados. Se llama siempre antes de cerrar.
  releaseAll(): void {
    for (const k of [...this.heldKeys]) this.up(k);
    if (this.buttonMask !== 0) {
      this.buttonMask = 0;
      this.sink.sendPointer(0, this.x, this.y);
    }
  }
}
