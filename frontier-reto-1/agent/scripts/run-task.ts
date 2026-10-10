// Cliente del contrato: envía una tarea a un servicio en marcha y consulta el estado cada 2 s, como el evaluador.
// Uso: npm run task -- --base http://localhost:18080 --task "..." [--local] [--desktop wss://...]
// Sin --desktop usa PRACTICE_DESKTOP_URL/PASSWORD; --local usa el escritorio Docker (ws://localhost:16080, testpass).
import { loadPracticeConfig, secretValues } from '../src/config.ts';
import { redact } from '../src/redact.ts';
import { arg, flag } from './lib.ts';

const base = arg('base') || 'http://localhost:18080';
const task = arg('task');
if (!task) throw new Error('Falta --task');
const token = process.env.TEAM_TOKEN;
if (!token) throw new Error('Falta TEAM_TOKEN');
let url: string;
let password: string;
if (flag('local')) {
  url = 'ws://localhost:16080/websockify';
  password = 'testpass';
} else {
  const p = loadPracticeConfig();
  url = arg('desktop') || p.desktopUrl;
  password = p.desktopPassword;
}
const secrets = [token, password, ...secretValues(loadPracticeConfigSafe())];
function loadPracticeConfigSafe() {
  try {
    return loadPracticeConfig();
  } catch {
    return {};
  }
}

const t0 = performance.now();
const res = await fetch(`${base}/tasks`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ tarea: task, escritorio: { url, password } }),
});
const admitMs = Math.round(performance.now() - t0);
const body = (await res.json()) as { task_id?: string };
console.log(`POST /tasks -> ${res.status} en ${admitMs} ms`, redact(JSON.stringify(body), secrets));
if (!body.task_id) process.exit(1);

for (;;) {
  await new Promise((r) => setTimeout(r, 2_000));
  const g = await fetch(`${base}/tasks/${body.task_id}`, { headers: { Authorization: `Bearer ${token}` } });
  const s = (await g.json()) as { estado: string; resumen: string };
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  if (s.estado !== 'en_curso') {
    console.log(`\n[${secs} s] ${s.estado}\n${redact(s.resumen, secrets)}`);
    const leaked = [password, token].some((x) => x && s.resumen.includes(x));
    console.log(leaked ? 'ALERTA: el resumen contiene un secreto' : 'resumen sin secretos');
    break;
  }
  process.stdout.write(`[${secs} s] ${s.resumen || s.estado}\n`);
  if (performance.now() - t0 > 300_000) {
    console.log('El evaluador dejaría de consultar aquí (5 min).');
    break;
  }
}
