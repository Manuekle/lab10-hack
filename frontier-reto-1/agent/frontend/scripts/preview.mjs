import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const host = '127.0.0.1';
const port = 18093;
const backend = 'http://127.0.0.1:18094';
const headers = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
};
const allowed = /^(?:\/tasks(?:\/[A-Za-z0-9_-]{1,64}\/(?:events|frame\.png))?|\/knowledge|\/ui\/incidente\.json|\/ui\/assets\/[a-z0-9-]{1,40}\.png)$/;

function hashes(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))]
    .map(([, value]) => `'sha256-${createHash('sha256').update(value).digest('base64')}'`).join(' ');
}

function csp(html) {
  return [
    "default-src 'none'", `script-src ${hashes(html, 'script')}`, `style-src ${hashes(html, 'style')}`,
    "img-src 'self' blob:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; ');
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET') {
    response.writeHead(405, {...headers, Allow: 'GET'});
    response.end('Method not allowed');
    return;
  }
  const url = new URL(request.url || '/', `http://${host}:${port}`);
  try {
    if (['/', '/ui', '/ui/'].includes(url.pathname)) {
      const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
      response.writeHead(200, {...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp(html)});
      response.end(html);
      return;
    }
    if (!allowed.test(url.pathname)) {
      response.writeHead(404, {...headers, 'Content-Type': 'text/plain; charset=utf-8'});
      response.end('Not found');
      return;
    }
    const forwarded = {};
    if (request.headers.authorization) forwarded.Authorization = request.headers.authorization;
    if (request.headers.accept) forwarded.Accept = request.headers.accept;
    const upstream = await fetch(`${backend}${url.pathname}${url.search}`, {headers: forwarded, redirect: 'manual'});
    const upstreamHeaders = {...headers};
    for (const name of ['content-type', 'x-frame-at', 'x-frame-size', 'x-frame-points', 'x-frame-action']) {
      const value = upstream.headers.get(name);
      if (value) upstreamHeaders[name] = value;
    }
    response.writeHead(upstream.status, upstreamHeaders);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    response.writeHead(502, {...headers, 'Content-Type': 'application/json; charset=utf-8'});
    response.end(JSON.stringify({error: {message: 'No se pudo consultar el servicio.'}}));
  }
});

server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => { console.log(`Observatorio UI: http://${host}:${port}/`); });
