import { once } from 'node:events';
import { createGlbPacketDecoder, DEFAULT_MAX_SOURCE_BYTES } from './glb-packet.mjs';
function argument(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
try {
  const expectedSha256 = argument('--expected-sha256');
  if (!expectedSha256) throw Error('--expected-sha256 is required.');
  const decoder = await createGlbPacketDecoder({ moduleRoot: argument('--module-root') });
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) { size += chunk.length; if (size > DEFAULT_MAX_SOURCE_BYTES + 16 * 1024 * 1024) throw Error('Packet exceeds input limit.'); chunks.push(chunk); }
  const stats = await decoder.decodeTo(Buffer.concat(chunks, size), async chunk => { if (!process.stdout.write(chunk)) await once(process.stdout, 'drain'); }, { expectedSha256 });
  process.stderr.write(JSON.stringify({ ...stats, maximumRssKiB: process.resourceUsage().maxRSS }) + '\n');
} catch (error) { process.stderr.write('decode-packet: ' + error.message + '\n'); process.exitCode = 1; }
