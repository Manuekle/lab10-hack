import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadModelConfig, loadPracticeConfig, loadServiceConfig, secretValues } from '../src/config.ts';

const base = {
  TEAM_TOKEN: 'team-token-0123456789',
  OPENROUTER_API_KEY: 'sk-or-v1-abcdefghijklmnop',
  OPENROUTER_MODEL: 'vendor/model',
};

test('servicio: valores válidos y límites por defecto', () => {
  const c = loadServiceConfig(base);
  assert.equal(c.port, 8080);
  assert.equal(c.limits.revokeMs, 270_000);
  assert.equal(c.limits.hardStopMs, 280_000);
  assert.equal(c.openrouterModel, 'vendor/model');
});

test('servicio: faltantes e inválidos se reportan sin valores', () => {
  const env = { TEAM_TOKEN: 'corto', PORT: 'abc', TASK_REVOKE_MS: '290000', TASK_HARD_STOP_MS: '285000' };
  assert.throws(
    () => loadServiceConfig(env),
    (e: unknown) => {
      assert.ok(e instanceof ConfigError);
      const msg = e.message;
      assert.match(msg, /TEAM_TOKEN debe tener al menos 16/);
      assert.match(msg, /OPENROUTER_API_KEY es obligatoria/);
      assert.match(msg, /OPENROUTER_MODEL es obligatoria/);
      assert.match(msg, /PORT debe ser un entero/);
      assert.match(msg, /TASK_HARD_STOP_MS debe ser mayor/);
      assert.doesNotMatch(msg, /corto|abc/);
      return true;
    },
  );
});

test('modelo: no exige variables del servicio', () => {
  const c = loadModelConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' });
  assert.equal(c.inferenceAttempts, 2);
});

test('práctica: separada del servicio y URL validada', () => {
  assert.throws(() => loadPracticeConfig({ PRACTICE_DESKTOP_URL: 'https://x/websockify', PRACTICE_DESKTOP_PASSWORD: 'p' }), /ws:\/\/ o wss:\/\//);
  const p = loadPracticeConfig({ PRACTICE_DESKTOP_URL: 'wss://x.example/websockify', PRACTICE_DESKTOP_PASSWORD: 'secreto1' });
  assert.equal(p.desktopToken, undefined);
  assert.throws(() => loadServiceConfig({ PRACTICE_DESKTOP_URL: 'wss://x', PRACTICE_DESKTOP_PASSWORD: 'p' }), ConfigError);
  assert.deepEqual(secretValues(p, loadServiceConfig(base)), ['secreto1', base.TEAM_TOKEN, base.OPENROUTER_API_KEY]);
});
