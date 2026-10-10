// Archivos de la UI de observación (/ui). La página no trae datos: los pide al API con el token del equipo.
// Se leen de ./ui junto a este módulo (src/ui en desarrollo, dist/ui tras `npm run build`). Si faltan, sólo /ui falla.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const ASSET = /^[a-z0-9-]{1,40}\.png$/;

let page: { html: string; csp: string } | undefined;

function hashes(html: string, tag: 'script' | 'style'): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  return [...html.matchAll(re)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]!).digest('base64')}'`).join(' ');
}

// La CSP sólo admite el script y el estilo en línea de la propia página (por hash) y llamadas al mismo origen.
export async function uiPage(): Promise<{ html: string; csp: string }> {
  if (page) return page;
  const html = await fs.readFile(new URL('./ui/index.html', import.meta.url), 'utf8');
  const csp = [
    "default-src 'none'",
    `script-src ${hashes(html, 'script')}`,
    `style-src ${hashes(html, 'style')}`,
    "img-src 'self' blob:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  page = { html, csp };
  return page;
}

export async function uiAsset(name: string): Promise<Buffer | undefined> {
  if (!ASSET.test(name)) return undefined;
  return fs.readFile(new URL(`./ui/assets/${name}`, import.meta.url)).catch(() => undefined);
}

// Datos fijos del incidente de las 15:30 (ticket, línea de tiempo, resultados E1–E5). Se lee en cada petición
// para poder corregir los números sin reiniciar.
export async function incidentData(): Promise<unknown> {
  return JSON.parse(await fs.readFile(new URL('./ui/incidente.json', import.meta.url), 'utf8')) as unknown;
}
