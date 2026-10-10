import assert from 'node:assert/strict';
import { test } from 'node:test';
import { charToKeysym, InputController, Keysym, keyNameToKeysym, parseCombo, type InputSink } from '../src/rfb/input.ts';

type Ev = { t: number; kind: 'ptr'; mask: number; x: number; y: number } | { t: number; kind: 'key'; down: boolean; sym: number };

function recorder(width = 1280, height = 800) {
  let clock = 0;
  const events: Ev[] = [];
  const sink: InputSink = {
    width,
    height,
    sendPointer: (mask, x, y) => events.push({ t: clock, kind: 'ptr', mask, x, y }),
    sendKey: (down, sym) => events.push({ t: clock, kind: 'key', down, sym }),
  };
  const wait = async (ms: number) => {
    clock += ms;
  };
  return { sink, events, wait };
}

test('keysyms: ASCII, acentos, símbolos y Unicode', () => {
  assert.equal(charToKeysym('a'), 0x61);
  assert.equal(charToKeysym('#'), 0x23);
  assert.equal(charToKeysym('é'), 0xe9);
  assert.equal(charToKeysym('ñ'), 0xf1);
  assert.equal(charToKeysym('Í'), 0xcd);
  assert.equal(charToKeysym('€'), 0x010020ac);
  assert.equal(charToKeysym('\n'), Keysym.Return);
  assert.throws(() => charToKeysym('\u0007'));
  assert.equal(keyNameToKeysym('Enter'), Keysym.Return);
  assert.equal(keyNameToKeysym('pagedown'), Keysym.PageDown);
  assert.equal(keyNameToKeysym('f5'), Keysym.F5);
});

test('combinaciones: modificadores primero, sólo ctrl/shift/alt', () => {
  assert.deepEqual(parseCombo('ctrl+a'), [Keysym.Control_L, 0x61]);
  assert.deepEqual(parseCombo('shift+Tab'), [Keysym.Shift_L, Keysym.Tab]);
  assert.deepEqual(parseCombo('ctrl++'), [Keysym.Control_L, 0x2b]);
  assert.deepEqual(parseCombo('+'), [0x2b]);
  assert.throws(() => parseCombo('a+b'));
  assert.throws(() => parseCombo('ctrl+'));
});

test('clic: mueve, presiona y mantiene 160 ms antes de soltar', async () => {
  const { sink, events, wait } = recorder();
  const input = new InputController(sink, undefined, wait);
  await input.click(100.4, 200.6);
  const ptr = events.filter((e) => e.kind === 'ptr');
  assert.deepEqual(ptr.map((e) => [e.mask, e.x, e.y]), [
    [0, 100, 201],
    [1, 100, 201],
    [0, 100, 201],
  ]);
  assert.equal(ptr[2]!.t - ptr[1]!.t, 160);
});

test('coordenadas acotadas al framebuffer', async () => {
  const { sink, events, wait } = recorder(1280, 800);
  const input = new InputController(sink, undefined, wait);
  await input.click(5000, -20);
  const e = events[0] as Extract<Ev, { kind: 'ptr' }>;
  assert.equal(e.x, 1279);
  assert.equal(e.y, 0);
  assert.throws(() => input.move(Number.NaN, 1));
});

test('reemplazo de texto: clic, ctrl+a, borrar y escribir cada carácter liberando teclas', async () => {
  const { sink, events, wait } = recorder();
  const input = new InputController(sink, undefined, wait);
  await input.replaceText(10, 10, 'Calle 80 # 24-15 Pereira é');
  const keys = events.filter((e): e is Extract<Ev, { kind: 'key' }> => e.kind === 'key');
  assert.deepEqual(
    keys.slice(0, 6).map((k) => [k.down, k.sym]),
    [
      [true, Keysym.Control_L],
      [true, 0x61],
      [false, 0x61],
      [false, Keysym.Control_L],
      [true, Keysym.BackSpace],
      [false, Keysym.BackSpace],
    ],
  );
  const typed = keys.slice(6).filter((k) => k.down).map((k) => String.fromCodePoint(k.sym));
  assert.equal(typed.join(''), 'Calle 80 # 24-15 Pereira é');
  // Cada tecla bajada se suelta.
  assert.equal(keys.filter((k) => k.down).length, keys.filter((k) => !k.down).length);
});

test('releaseAll suelta lo que quedó presionado', async () => {
  const { sink, events } = recorder();
  let release: () => void = () => {};
  const blocked = (ms: number) => (ms === 160 ? new Promise<void>((r) => (release = r)) : Promise.resolve());
  const input = new InputController(sink, undefined, blocked);
  const clicking = input.click(50, 50);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((events.at(-1) as Extract<Ev, { kind: 'ptr' }>).mask, 1);
  input.releaseAll();
  assert.equal((events.at(-1) as Extract<Ev, { kind: 'ptr' }>).mask, 0);
  release();
  await clicking;
});
