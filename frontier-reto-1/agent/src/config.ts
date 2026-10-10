// Configuración validada. Los mensajes de error nombran variables, nunca valores.

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Configuración inválida: ${problems.join('; ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

export interface Limits {
  revokeMs: number;
  hardStopMs: number;
  inferenceTimeoutMs: number;
  inferenceAttempts: number;
  maxProposals: number;
  maxActiveTasks: number;
}

export type CoordMode = 'pixel' | 'norm1000';

export interface ServiceConfig {
  teamToken: string;
  openrouterApiKey: string;
  openrouterModel: string;
  openrouterFallbackModel: string | undefined;
  openrouterCoords: CoordMode;
  port: number;
  databasePath: string;
  limits: Limits;
}

export interface ModelConfig {
  openrouterApiKey: string;
  openrouterModel: string;
  openrouterFallbackModel: string | undefined;
  openrouterCoords: CoordMode;
  inferenceTimeoutMs: number;
  inferenceAttempts: number;
}

export interface PracticeConfig {
  desktopUrl: string;
  desktopPassword: string;
  desktopToken: string | undefined;
}

class Reader {
  readonly problems: string[] = [];
  private readonly env: Env;
  constructor(env: Env) {
    this.env = env;
  }

  secret(name: string, minLength = 1): string {
    const value = this.env[name]?.trim();
    if (!value) {
      this.problems.push(`${name} es obligatoria`);
      return '';
    }
    if (value.length < minLength) this.problems.push(`${name} debe tener al menos ${minLength} caracteres`);
    return value;
  }

  text(name: string, fallback?: string): string {
    const value = this.env[name]?.trim() || fallback;
    if (!value) {
      this.problems.push(`${name} es obligatoria`);
      return '';
    }
    return value;
  }

  int(name: string, fallback: number, min: number, max: number): number {
    const raw = this.env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      this.problems.push(`${name} debe ser un entero entre ${min} y ${max}`);
      return fallback;
    }
    return value;
  }

  coords(name: string): CoordMode {
    const raw = this.env[name]?.trim() || 'pixel';
    if (raw !== 'pixel' && raw !== 'norm1000') {
      this.problems.push(`${name} debe ser pixel o norm1000`);
      return 'pixel';
    }
    return raw;
  }

  optional(name: string): string | undefined {
    return this.env[name]?.trim() || undefined;
  }

  desktopUrl(name: string): string {
    const value = this.text(name);
    if (!value) return value;
    try {
      const url = new URL(value);
      if (url.protocol !== 'wss:' && url.protocol !== 'ws:') this.problems.push(`${name} debe usar ws:// o wss://`);
    } catch {
      this.problems.push(`${name} no es una URL válida`);
    }
    return value;
  }

  done(): void {
    if (this.problems.length > 0) throw new ConfigError(this.problems);
  }
}

function readLimits(r: Reader): Limits {
  const limits: Limits = {
    revokeMs: r.int('TASK_REVOKE_MS', 270_000, 1_000, 295_000),
    hardStopMs: r.int('TASK_HARD_STOP_MS', 280_000, 1_000, 299_000),
    inferenceTimeoutMs: r.int('INFERENCE_TIMEOUT_MS', 20_000, 1_000, 120_000),
    inferenceAttempts: r.int('INFERENCE_ATTEMPTS', 2, 1, 5),
    maxProposals: r.int('MAX_PROPOSALS', 40, 1, 500),
    maxActiveTasks: r.int('MAX_ACTIVE_TASKS', 2, 1, 8),
  };
  if (limits.hardStopMs <= limits.revokeMs) r.problems.push('TASK_HARD_STOP_MS debe ser mayor que TASK_REVOKE_MS');
  return limits;
}

export function loadServiceConfig(env: Env = process.env): ServiceConfig {
  const r = new Reader(env);
  const config: ServiceConfig = {
    teamToken: r.secret('TEAM_TOKEN', 16),
    openrouterApiKey: r.secret('OPENROUTER_API_KEY'),
    openrouterModel: r.text('OPENROUTER_MODEL'),
    openrouterFallbackModel: r.optional('OPENROUTER_FALLBACK_MODEL'),
    openrouterCoords: r.coords('OPENROUTER_COORDS'),
    port: r.int('PORT', 8080, 1, 65_535),
    databasePath: r.text('DATABASE_PATH', './.data/agent.db'),
    limits: readLimits(r),
  };
  r.done();
  return config;
}

export function loadModelConfig(env: Env = process.env): ModelConfig {
  const r = new Reader(env);
  const config: ModelConfig = {
    openrouterApiKey: r.secret('OPENROUTER_API_KEY'),
    openrouterModel: r.text('OPENROUTER_MODEL'),
    openrouterFallbackModel: r.optional('OPENROUTER_FALLBACK_MODEL'),
    openrouterCoords: r.coords('OPENROUTER_COORDS'),
    inferenceTimeoutMs: r.int('INFERENCE_TIMEOUT_MS', 20_000, 1_000, 120_000),
    inferenceAttempts: r.int('INFERENCE_ATTEMPTS', 2, 1, 5),
  };
  r.done();
  return config;
}

// Sólo para harness y scripts. El servicio nunca lee variables PRACTICE_*.
export function loadPracticeConfig(env: Env = process.env): PracticeConfig {
  const r = new Reader(env);
  const config: PracticeConfig = {
    desktopUrl: r.desktopUrl('PRACTICE_DESKTOP_URL'),
    desktopPassword: r.secret('PRACTICE_DESKTOP_PASSWORD'),
    desktopToken: env.PRACTICE_DESKTOP_TOKEN?.trim() || undefined,
  };
  r.done();
  return config;
}

// Valores que nunca deben aparecer en logs, resúmenes ni prompts.
export function secretValues(...configs: object[]): string[] {
  const keys = ['teamToken', 'openrouterApiKey', 'desktopPassword', 'desktopToken'];
  const out: string[] = [];
  for (const c of configs) {
    for (const k of keys) {
      const v = (c as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.length > 0) out.push(v);
    }
  }
  return out;
}
