// T02: captura real del escritorio de práctica. No envía ninguna entrada.
// Uso: npm run capture [-- --observe 5]
import fs from 'node:fs';
import { loadPracticeConfig, secretValues } from '../src/config.ts';
import { redact } from '../src/redact.ts';
import { RfbClient } from '../src/rfb/client.ts';
import { encodePng } from '../src/rfb/framebuffer.ts';
import { arg, artifactPath, stamp } from './lib.ts';

const practice = loadPracticeConfig();
const secrets = secretValues(practice);
const t0 = performance.now();
let client: RfbClient | undefined;
try {
  client = await RfbClient.connect({ url: practice.desktopUrl, password: practice.desktopPassword, timeoutMs: 20_000 });
  const tHandshake = performance.now();
  const frame = await client.refresh(20_000);
  const tFrame = performance.now();
  const png = encodePng(frame);
  const tPng = performance.now();
  const file = artifactPath(`capture-${stamp()}.png`);
  fs.writeFileSync(file, png);

  const observeSec = Number(arg('observe') ?? 0);
  let observed: Record<string, number> | undefined;
  if (observeSec > 0) {
    const u0 = client.metrics.updates;
    const b0 = client.metrics.bytesIn;
    await new Promise((r) => setTimeout(r, observeSec * 1000));
    observed = { seconds: observeSec, updates: client.metrics.updates - u0, bytes: client.metrics.bytesIn - b0 };
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        version: client.metrics.version,
        securityType: client.metrics.securityType,
        serverName: client.name,
        width: frame.width,
        height: frame.height,
        serverPixelFormat: client.serverPixelFormat,
        handshakeMs: Math.round(tHandshake - t0),
        fullFrameMs: Math.round(tFrame - tHandshake),
        bytesIn: client.metrics.bytesIn,
        pngBytes: png.length,
        pngEncodeMs: Math.round(tPng - tFrame),
        observed,
        file,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(redact(`captura fallida: ${e instanceof Error ? e.message : String(e)}`, secrets));
  process.exitCode = 1;
} finally {
  client?.close();
}
