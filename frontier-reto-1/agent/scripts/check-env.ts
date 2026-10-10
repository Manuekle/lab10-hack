// Comprueba presencia de variables sin mostrar valores.
import { ConfigError, loadModelConfig, loadPracticeConfig, loadServiceConfig } from '../src/config.ts';

const checks: Array<[string, () => unknown]> = [
  ['servicio', () => loadServiceConfig()],
  ['modelo', () => loadModelConfig()],
  ['práctica', () => loadPracticeConfig()],
];
let failed = false;
for (const [name, load] of checks) {
  try {
    load();
    console.log(`ok     ${name}`);
  } catch (e) {
    failed = true;
    console.log(`falta  ${name}: ${e instanceof ConfigError ? e.problems.join('; ') : String(e)}`);
  }
}
for (const name of ['PRACTICE_DESKTOP_TOKEN']) console.log(`${process.env[name] ? 'ok    ' : 'vacía '} ${name}`);
process.exitCode = failed ? 1 : 0;
