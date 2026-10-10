// Validación y normalización del endpoint VNC recibido. La contraseña nunca forma parte de la identidad.
import net from 'node:net';

export type DesktopParse = { ok: true; key: string; url: string } | { ok: false; message: string };

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(h)) return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:');
  return false;
}

export function parseDesktopUrl(raw: unknown, allowPrivate: boolean): DesktopParse {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return { ok: false, message: 'escritorio.url debe ser texto de 1 a 2048 caracteres' };
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, message: 'escritorio.url no es una URL válida' };
  }
  if (u.protocol !== 'wss:' && u.protocol !== 'ws:') return { ok: false, message: 'escritorio.url debe usar wss:// o ws://' };
  if (u.username || u.password) return { ok: false, message: 'escritorio.url no debe incluir credenciales' };
  if (!allowPrivate && isPrivateHost(u.hostname)) return { ok: false, message: 'escritorio.url apunta a una red privada' };
  const port = u.port || (u.protocol === 'wss:' ? '443' : '80');
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return { ok: true, url: u.toString(), key: `${u.protocol}//${u.hostname.toLowerCase()}:${port}${path}${u.search}` };
}
