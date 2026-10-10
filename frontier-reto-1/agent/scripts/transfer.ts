// Transferencia: las mismas clases de tarea sobre una app que el agente nunca vio (INVENTRA, test/fixtures/alt-desktop).
// El estado se comprueba por /state del contenedor (sólo harness); el agente sólo ve la pantalla.
// Uso: npm run transfer -- [--base http://localhost:18080]   (servicio con ALLOW_PRIVATE_DESKTOPS=true)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { evaluateSummary } from './evaluate-summary.ts';
import { arg } from './lib.ts';

const base = arg('base') || 'http://localhost:18080';
const token = process.env.TEAM_TOKEN!;
const NAME = 'reto1-altdesktop';
const WS = 'ws://localhost:16081/websockify';
const STATE = 'http://localhost:18000';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const docker = (...a: string[]) => execFileSync('docker', a, { encoding: 'utf8' });

type Prov = { id: string; nombre: string; rut: string; ciudad: string; contacto: string };
type State = { proveedores: Prov[]; eventos: Array<{ accion: string; id: string; campos?: string[] }> };
const state = async () => (await (await fetch(`${STATE}/state`)).json()) as State;

const cases: Array<{ id: string; tarea: string; estado: 'terminada' | 'fallida'; respuesta?: string; claves?: string[]; check: (s: State) => string | null }> = [
  {
    id: 'T1-crear',
    tarea: 'Registra al proveedor Papelería Los Andes, NIT 901234567, ciudad Pereira, teléfono 3157654321.',
    estado: 'terminada',
    check: (s) => {
      const nuevos = s.proveedores.filter((p) => p.nombre === 'Papelería Los Andes');
      if (nuevos.length !== 1) return `${nuevos.length} registros creados`;
      const p = nuevos[0]!;
      if (p.rut !== '901234567' || p.ciudad !== 'Pereira' || p.contacto !== '3157654321') return `valores: ${JSON.stringify(p)}`;
      return s.eventos.length === 1 ? null : `eventos de más: ${JSON.stringify(s.eventos)}`;
    },
  },
  {
    id: 'T2-editar',
    tarea: 'Corrige la ciudad del proveedor Ferrotodo: ahora es Manizales.',
    estado: 'terminada',
    check: (s) => {
      const p = s.proveedores.find((x) => x.nombre === 'Ferrotodo')!;
      if (p.ciudad !== 'Manizales') return `ciudad ${p.ciudad}`;
      const ok = s.eventos.length === 1 && s.eventos[0]!.id === p.id && p.rut === '890555666' && p.contacto === '6063332211';
      return ok ? null : `cambios ajenos: ${JSON.stringify(s.eventos)}`;
    },
  },
  {
    id: 'T3-ambiguo',
    tarea: 'Cambia el teléfono de Herrajes Torres a 3014445566.',
    estado: 'fallida',
    claves: ['860999000', '901888777'],
    check: (s) => (s.eventos.length === 0 ? null : `modificó datos: ${JSON.stringify(s.eventos)}`),
  },
  {
    id: 'T4-contar',
    tarea: '¿Cuántos proveedores tienen ciudad Cali?',
    estado: 'terminada',
    respuesta: '3',
    check: (s) => (s.eventos.length === 0 ? null : `modificó datos: ${JSON.stringify(s.eventos)}`),
  },
];

docker('build', '-q', '-t', NAME, path.resolve(import.meta.dirname, '..', 'test', 'fixtures', 'alt-desktop'));
try {
  docker('rm', '-f', NAME);
} catch {
  // no existía
}
docker('run', '-d', '--name', NAME, '-p', '16081:6080', '-p', '18000:8000', '-e', 'VNC_PASSWORD=testpass', NAME);
await sleep(6_000);
let passed = 0;
try {
  for (const c of cases) {
    await fetch(`${STATE}/reset`, { method: 'POST', body: '{}' });
    docker('exec', NAME, '/app/restart-browser.sh');
    await sleep(5_000);
    const t0 = performance.now();
    const r = await fetch(`${base}/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tarea: c.tarea, escritorio: { url: WS, password: 'testpass' } }),
    });
    const { task_id } = (await r.json()) as { task_id: string };
    let s: { estado: string; resumen: string };
    for (;;) {
      await sleep(5_000);
      s = (await (await fetch(`${base}/tasks/${task_id}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as typeof s;
      if (s.estado !== 'en_curso') break;
    }
    const appProblem = c.check(await state());
    const summary = evaluateSummary(
      { id: c.id, instruccion: c.tarea, estado_esperado: c.estado, ...(c.respuesta ? { respuesta_esperada: c.respuesta } : {}), ...(c.claves ? { claves_razon: c.claves } : {}) },
      s.estado,
      s.resumen,
      ['testpass', token],
    );
    const ok = !appProblem && summary.ok;
    if (ok) passed++;
    console.log(`${ok ? 'PASA' : 'FALLA'} ${c.id} (${((performance.now() - t0) / 1000).toFixed(1)} s) ${[appProblem, ...summary.reasons].filter(Boolean).join('; ') || 'ok'}`);
    console.log(`  ${s.estado}: ${s.resumen.replace(/\n/g, ' | ').slice(0, 260)}`);
  }
} finally {
  docker('rm', '-f', NAME);
}
console.log(`\n${passed}/${cases.length} en la app no vista (INVENTRA), sin cambios en el agente.`);
