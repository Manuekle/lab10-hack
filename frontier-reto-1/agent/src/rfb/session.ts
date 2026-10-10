// Sesión de escritorio: conexión RFB + entradas. Ejecuta sólo acciones ya validadas.
import type { Action } from '../model/actions.ts';
import { RfbClient, type SettleOptions } from './client.ts';
import type { Frame } from './framebuffer.ts';
import { InputController, keyNameToKeysym, parseCombo } from './input.ts';

export interface SessionOptions {
  url: string;
  password: string;
  timeoutMs?: number;
  settle?: SettleOptions;
}

// Espera por tipo de acción. La app repinta hasta 1 s después de un clic (README); capturar antes trae la pantalla vieja
// y el modelo gasta un paso entero en esperar. La escritura se ve mientras ocurre: basta un piso corto.
const SETTLE_BY_ACTION: Record<string, SettleOptions> = {
  click: { minMs: 1_000, quietMs: 300, changeWithinMs: 1_600 },
  double_click: { minMs: 1_000, quietMs: 300, changeWithinMs: 1_600 },
  key: { minMs: 1_000, quietMs: 300, changeWithinMs: 1_600 },
  replace_text: { minMs: 400, quietMs: 300, changeWithinMs: 1_000 },
  fill: { minMs: 400, quietMs: 300, changeWithinMs: 1_000 },
  type_text: { minMs: 400, quietMs: 300, changeWithinMs: 1_000 },
  scroll: { minMs: 500, quietMs: 300, changeWithinMs: 1_200 },
};

export class DesktopSession {
  readonly client: RfbClient;
  readonly input: InputController;
  private readonly settleOpts: SettleOptions;
  // Espera extra aprendida en esta sesión cuando la app repinta más tarde de lo previsto.
  slowdownMs = 0;

  private constructor(client: RfbClient, settle: SettleOptions) {
    this.client = client;
    this.input = new InputController(client);
    this.settleOpts = settle;
  }

  static async open(opts: SessionOptions): Promise<DesktopSession> {
    const client = await RfbClient.connect({ url: opts.url, password: opts.password, timeoutMs: opts.timeoutMs ?? 15_000 });
    const session = new DesktopSession(client, opts.settle ?? {});
    await client.refresh(opts.timeoutMs ?? 15_000);
    return session;
  }

  get width(): number {
    return this.client.width;
  }
  get height(): number {
    return this.client.height;
  }

  snapshot(): Frame {
    return this.client.snapshot();
  }

  // Ejecuta una acción y devuelve la captura posterior al repintado. 'finish' no toca la pantalla.
  async execute(action: Action, settle: SettleOptions = {}): Promise<Frame> {
    const base = SETTLE_BY_ACTION[action.type] ?? {};
    const slow = action.type === 'click' || action.type === 'double_click' || action.type === 'key' ? this.slowdownMs : 0;
    const s = {
      ...base,
      ...(slow ? { minMs: (base.minMs ?? 0) + slow, changeWithinMs: (base.changeWithinMs ?? 1_500) + slow } : {}),
      ...this.settleOpts,
      ...settle,
    };
    switch (action.type) {
      case 'click':
        await this.input.click(action.x, action.y);
        break;
      case 'double_click':
        await this.input.doubleClick(action.x, action.y);
        break;
      case 'replace_text':
        await this.input.replaceText(action.x, action.y, action.text);
        break;
      case 'fill':
        for (const f of action.fields) {
          await this.input.replaceText(f.x, f.y, f.text);
          await new Promise((r) => setTimeout(r, 80));
        }
        break;
      case 'type_text':
        await this.input.typeText(action.text);
        break;
      case 'key': {
        const syms = parseCombo(action.key);
        if (syms.length === 1) await this.input.tap(keyNameToKeysym(action.key));
        else await this.input.combo(action.key);
        break;
      }
      case 'scroll':
        await this.input.scroll(action.x, action.y, action.direction, action.amount);
        break;
      case 'wait':
        return this.client.settle({ minMs: action.ms, quietMs: s.quietMs ?? 400, changeWithinMs: action.ms, maxMs: action.ms + 2_000 });
      case 'finish':
        return this.snapshot();
    }
    return this.client.settle(s);
  }

  // Libera entradas si la conexión responde y cierra el socket.
  close(): void {
    try {
      if (this.client.isOpen) this.input.releaseAll();
    } catch {
      // La conexión ya no responde; cerrar igual.
    }
    this.client.close();
  }
}
