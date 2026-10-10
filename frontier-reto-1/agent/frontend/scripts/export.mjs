import {readFile, writeFile} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
let html = await readFile(resolve(dist, 'index.html'), 'utf8');

async function builtAsset(path) {
  const absolute = resolve(dist, path.replace(/^\//, ''));
  if (!absolute.startsWith(`${dist}${sep}`) || !path.startsWith('/assets/')) throw new Error(`Unexpected built asset path: ${path}`);
  return readFile(absolute, 'utf8');
}

let inlineScript = '';
for (const [tag, path] of [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
  const script = await builtAsset(path);
  if (/<\/script/i.test(script) || /\.innerHTML\s*=|insertAdjacentHTML\s*\(/.test(script)) throw new Error('The exported UI must contain only text-safe JavaScript.');
  // Replacement function: the bundle may contain `$&`/`$'` sequences (e.g. React's
  // `replace(xe,"$&/")`) that String.replace would expand into the matched tag.
  // Bare <script> (no attributes): src/ui.ts hashes exactly `<script>…</script>`
  // for the CSP, and ui.ts is backend code this migration must not touch.
  inlineScript += `<script>${script}</script>`;
  html = html.replace(tag, () => `<!--observatory-script-->`);
}
for (const [tag, path] of [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]) {
  // Keep the existing strict CSP: the token's system font fallback works
  // without requesting a remote Google Fonts stylesheet.
  const style = (await builtAsset(path)).replace(/@import\s*(?:url\(\s*)?["']https:\/\/fonts\.googleapis\.com\/[^"']+["']\s*\)?\s*;/g, '');
  if (/<\/style/i.test(style)) throw new Error('The exported stylesheet contains an HTML closing tag.');
  html = html.replace(tag, () => `<style>${style}</style>`);
}
if (/<script\b[^>]*src=|<link\b[^>]*rel="stylesheet"|@import[^;]*https:/i.test(html)) throw new Error('The exported UI must be self-contained.');
// The bundle runs at the end of <body>, after #root is parsed: a classic
// inline script in <head> would execute before <body> exists.
html = html.replace('</body>', () => `${inlineScript}</body>`);
await writeFile(resolve(dist, 'index.html'), html);
await writeFile(new URL('../../src/ui/index.html', import.meta.url), html);
