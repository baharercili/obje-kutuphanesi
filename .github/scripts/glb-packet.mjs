import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const PACKET_MAGIC = Buffer.from('GLBPKT1\n');
export const DEFAULT_MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_HEADER_BYTES = 8 * 1024 * 1024;
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

async function importSelfContainedModule(filename) {
  // The official .module.js files contain embedded WASM and no relative imports.
  // A data: ESM URL also works on Node versions that do not auto-detect ESM in
  // meshoptimizer@0.25.0's package (which has no "type": "module" field).
  const code = await fs.readFile(filename);
  return import('data:text/javascript;base64,' + code.toString('base64'));
}

async function packageDirectory(moduleRoot) {
  if (!moduleRoot) throw Error('moduleRoot is required (node_modules or the meshoptimizer package directory).');
  const root = path.resolve(moduleRoot);
  for (const candidate of [path.join(root, 'meshoptimizer'), root]) {
    try {
      const p = JSON.parse(await fs.readFile(path.join(candidate, 'package.json'), 'utf8'));
      if (p.name !== 'meshoptimizer') continue;
      if (p.version !== '0.25.0') throw Error(`meshoptimizer@0.25.0 required; found ${p.version}`);
      return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  throw Error('Cannot find meshoptimizer@0.25.0 in moduleRoot.');
}

export async function createGlbPacketDecoder({ moduleRoot, maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES } = {}) {
  const directory = await packageDirectory(moduleRoot);
  const { MeshoptDecoder } = await importSelfContainedModule(path.join(directory, 'meshopt_decoder.module.js'));
  await MeshoptDecoder.ready;

  function parse(packet, expectedSha256) {
    if (!expectedSha256 || !hex(expectedSha256)) throw Error('An independently supplied expectedSha256 is required.');
    if (packet.length < 12 || !packet.subarray(0, 8).equals(PACKET_MAGIC)) throw Error('Invalid GLBPKT1 packet magic.');
    const length = packet.readUInt32LE(8);
    if (!positiveInteger(length) || length > MAX_HEADER_BYTES || 12 + length > packet.length) throw Error('Invalid packet header length.');
    const header = JSON.parse(packet.subarray(12, 12 + length).toString('utf8'));
    if (header.format !== 'glb-lossless-packet' || header.version !== 1 || header.predictor !== 'meshoptimizer@0.25.0') throw Error('Unsupported packet format/version/predictor.');
    if (!positiveInteger(header.sourceBytes) || header.sourceBytes > maxSourceBytes || !hex(header.sourceSha256)) throw Error('Invalid original size/hash.');
    if (header.sourceSha256 !== expectedSha256) throw Error('Packet original SHA does not match expected master SHA.');
    if (!Array.isArray(header.fragments) || !header.fragments.length || header.fragments.length > 100000) throw Error('Invalid fragment list.');
    let rawBytes = 0, encodedBytes = 0;
    for (const fragment of header.fragments) {
      if (!positiveInteger(fragment.rawBytes) || !positiveInteger(fragment.encodedBytes) || fragment.rawBytes > header.sourceBytes || !hex(fragment.rawSha256) || !hex(fragment.encodedSha256)) throw Error('Invalid fragment size/hash.');
      if (fragment.codec !== 'gzip' && fragment.codec !== 'meshopt-vertex-gzip') throw Error('Unsupported fragment codec.');
      if (fragment.codec === 'meshopt-vertex-gzip') {
        if (!positiveInteger(fragment.count) || !positiveInteger(fragment.stride) || fragment.stride < 4 || fragment.stride > 256 || fragment.stride % 4 || fragment.count * fragment.stride !== fragment.rawBytes || !positiveInteger(fragment.predictorBytes) || fragment.predictorBytes > fragment.rawBytes * 2 + 1024 * 1024) throw Error('Invalid lossless predictor parameters.');
      }
      rawBytes += fragment.rawBytes; encodedBytes += fragment.encodedBytes;
    }
    if (rawBytes !== header.sourceBytes || 12 + length + encodedBytes !== packet.length) throw Error('Packet fragment totals/trailing bytes mismatch.');
    return { header, payloadOffset: 12 + length };
  }

  async function decodeTo(input, write, { expectedSha256 } = {}) {
    const packet = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const { header, payloadOffset } = parse(packet, expectedSha256);
    const hash = crypto.createHash('sha256');
    let offset = payloadOffset, outputBytes = 0, first = true;
    for (const fragment of header.fragments) {
      const encoded = packet.subarray(offset, offset + fragment.encodedBytes); offset += fragment.encodedBytes;
      if (sha(encoded) !== fragment.encodedSha256) throw Error('Encoded fragment SHA mismatch.');
      let raw;
      if (fragment.codec === 'gzip') raw = zlib.gunzipSync(encoded, { maxOutputLength: fragment.rawBytes });
      else {
        const predicted = zlib.gunzipSync(encoded, { maxOutputLength: fragment.predictorBytes });
        if (predicted.length !== fragment.predictorBytes) throw Error('Predictor byte length mismatch.');
        raw = Buffer.allocUnsafe(fragment.rawBytes);
        MeshoptDecoder.decodeVertexBuffer(raw, fragment.count, fragment.stride, predicted);
      }
      if (raw.length !== fragment.rawBytes || sha(raw) !== fragment.rawSha256) throw Error('Decoded fragment length/SHA mismatch.');
      if (first) {
        if (raw.length < 12 || raw.toString('ascii', 0, 4) !== 'glTF' || raw.readUInt32LE(4) !== 2 || raw.readUInt32LE(8) !== header.sourceBytes) throw Error('Reconstructed GLB header mismatch.');
        first = false;
      }
      hash.update(raw); outputBytes += raw.length;
      await write(raw);
    }
    const sourceSha256 = hash.digest('hex');
    if (outputBytes !== header.sourceBytes || sourceSha256 !== expectedSha256) throw Error('Reconstructed original master SHA/length mismatch.');
    return { sourceSha256, sourceBytes: outputBytes, packetBytes: packet.length, fragments: header.fragments.length };
  }

  async function decode(input, options) {
    const chunks = [];
    const stats = await decodeTo(input, chunk => { chunks.push(chunk); }, options);
    return { bytes: Buffer.concat(chunks, stats.sourceBytes), stats };
  }
  return { decode, decodeTo, decoderModulePath: path.join(directory, 'meshopt_decoder.module.js') };
}

function sourceParts(bytes) {
  if (bytes.length < 28 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw Error('Input must be an intact GLB2 master.');
  const jsonBytes = bytes.readUInt32LE(12), jsonEnd = 20 + jsonBytes;
  if (jsonEnd > bytes.length) throw Error('Truncated original GLB JSON.');
  const gltf = JSON.parse(bytes.subarray(20, jsonEnd).toString('utf8'));
  let binStart = null, binEnd = null;
  for (let cursor = jsonEnd; cursor + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(cursor), type = bytes.readUInt32LE(cursor + 4), end = cursor + 8 + length;
    if (end > bytes.length) throw Error('Truncated original GLB chunk.');
    if (type === 0x004e4942 && binStart === null) { binStart = cursor + 8; binEnd = end; }
    cursor = end;
  }
  if (binStart === null) return [{ bytes, stride: null }];
  const images = new Set((gltf.images || []).map(image => image.bufferView));
  const boundaries = new Set([0, binStart, bytes.length]), geometry = new Map();
  for (let index = 0; index < (gltf.bufferViews || []).length; index++) {
    const view = gltf.bufferViews[index];
    if ((view.buffer || 0) !== 0) continue;
    const a = binStart + (view.byteOffset || 0), b = a + view.byteLength;
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < binStart || b > binEnd || b <= a) throw Error('Original bufferView is outside its BIN chunk.');
    boundaries.add(a); boundaries.add(b);
    if (images.has(index)) continue;
    const accessor = (gltf.accessors || []).find(a => a.bufferView === index);
    const stride = view.byteStride || (accessor ? COMPONENT_BYTES[accessor.componentType] * COMPONENTS[accessor.type] : 4);
    if (positiveInteger(stride) && stride >= 4 && stride <= 256 && stride % 4 === 0 && view.byteLength % stride === 0) geometry.set(a, { end: b, stride });
  }
  const sorted = [...boundaries].sort((a, b) => a - b), parts = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1], candidate = geometry.get(a);
    if (b > a) parts.push({ bytes: bytes.subarray(a, b), stride: candidate?.end === b ? candidate.stride : null });
  }
  return parts;
}

function frame(header, payloads) {
  const metadata = Buffer.from(JSON.stringify(header)), fixed = Buffer.allocUnsafe(12);
  if (metadata.length > MAX_HEADER_BYTES) throw Error('Packet metadata exceeds limit.');
  PACKET_MAGIC.copy(fixed); fixed.writeUInt32LE(metadata.length, 8);
  return Buffer.concat([fixed, metadata, ...payloads]);
}

export async function createGlbPacketEncoder({ moduleRoot, gzipLevel = 6, maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES } = {}) {
  if (!Number.isInteger(gzipLevel) || gzipLevel < 1 || gzipLevel > 9) throw Error('gzipLevel must be 1–9.');
  const directory = await packageDirectory(moduleRoot);
  const { MeshoptEncoder } = await importSelfContainedModule(path.join(directory, 'meshopt_encoder.module.js'));
  const { MeshoptDecoder } = await importSelfContainedModule(path.join(directory, 'meshopt_decoder.module.js'));
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);

  async function encode(input, { expectedSha256, sourceFilename } = {}) {
    const start = performance.now(), bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (!bytes.length || bytes.length > maxSourceBytes) throw Error('Original exceeds configured size limit.');
    const sourceSha256 = sha(bytes);
    if (expectedSha256 && sourceSha256 !== expectedSha256) throw Error('Input does not match expected original master SHA.');
    const parts = sourceParts(bytes), payloads = [], fragments = [];
    let predicted = 0, verifiedPredictorChunks = 0;
    for (const part of parts) {
      const raw = part.bytes, direct = zlib.gzipSync(raw, { level: gzipLevel });
      let payload = direct, descriptor = { codec: 'gzip' };
      if (part.stride) {
        const count = raw.length / part.stride, encoded = MeshoptEncoder.encodeVertexBuffer(raw, count, part.stride), decoded = Buffer.allocUnsafe(raw.length);
        MeshoptDecoder.decodeVertexBuffer(decoded, count, part.stride, encoded);
        if (!decoded.equals(raw)) throw Error('Lossless predictor roundtrip mismatch.');
        verifiedPredictorChunks++;
        const compressed = zlib.gzipSync(encoded, { level: gzipLevel });
        if (compressed.length < direct.length) { payload = compressed; descriptor = { codec: 'meshopt-vertex-gzip', count, stride: part.stride, predictorBytes: encoded.length }; predicted++; }
      }
      payloads.push(payload);
      fragments.push({ ...descriptor, rawBytes: raw.length, encodedBytes: payload.length, rawSha256: sha(raw), encodedSha256: sha(payload) });
    }
    const base = { format: 'glb-lossless-packet', version: 1, predictor: 'meshoptimizer@0.25.0', sourceBytes: bytes.length, sourceSha256, ...(sourceFilename ? { sourceFilename: path.basename(sourceFilename) } : {}) };
    let packet = frame({ ...base, strategy: 'fragment-predictor-gzip', fragments }, payloads), strategy = 'fragment-predictor-gzip';
    const baseline = zlib.gzipSync(bytes, { level: gzipLevel });
    const single = frame({ ...base, strategy: 'single-gzip', fragments: [{ codec: 'gzip', rawBytes: bytes.length, encodedBytes: baseline.length, rawSha256: sourceSha256, encodedSha256: sha(baseline) }] }, [baseline]);
    if (single.length < packet.length) { packet = single; strategy = 'single-gzip'; predicted = 0; }
    return { bytes: packet, stats: { sourceSha256, sourceBytes: bytes.length, packetSha256: sha(packet), packetBytes: packet.length, gzipLevel, gzipBaselineBytes: baseline.length, strategy, predictedFragments: predicted, verifiedPredictorChunks, fragments: strategy === 'single-gzip' ? 1 : fragments.length, milliseconds: performance.now() - start } };
  }
  return { encode, encoderModulePath: path.join(directory, 'meshopt_encoder.module.js') };
}
