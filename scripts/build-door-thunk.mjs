import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { encodeWaterWave } from '../web/proofs/prepare-water-loop.js';

const SOURCE_HASH = '5aa47dfbe01fa785de53564e24229640dfd60cdbc231f43323882fa73e7dbd92';
const RATE = 48000;
const FRAMES = 15360;
const EDGE_FRAMES = 480;

/** Keep the closing impact and its decay; discard the later hinge/latch noise. */
export function buildDoorThunk(source) {
  if (createHash('sha256').update(source).digest('hex') !== SOURCE_HASH) {
    throw new Error('Door source hash mismatch');
  }
  if (source.toString('ascii', 0, 4) !== 'RIFF' ||
      source.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
      source.readUInt16LE(20) !== 1 || source.readUInt16LE(22) !== 2 ||
      source.readUInt32LE(24) !== RATE || source.readUInt16LE(34) !== 16 ||
      source.toString('ascii', 36, 40) !== 'data' || source.length < 44 + FRAMES * 4) {
    throw new Error('Expected stereo PCM16 door source at 48 kHz');
  }
  const alpha = 1 - Math.exp(-2 * Math.PI * 1000 / RATE);
  const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
  for (let channel = 0; channel < 2; channel++) {
    let first = 0, second = 0;
    for (let frame = 0; frame < FRAMES; frame++) {
      const sample = source.readInt16LE(44 + frame * 4 + channel * 2) / 32768;
      first += alpha * (sample - first);
      second += alpha * (first - second);
      const envelope = Math.min(1, frame / EDGE_FRAMES, (FRAMES - 1 - frame) / EDGE_FRAMES);
      channels[channel][frame] = second * envelope;
    }
  }
  return Buffer.from(encodeWaterWave(channels));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = readFileSync(new URL('../web/public/audio/doors/close.wav', import.meta.url));
  const bytes = buildDoorThunk(source);
  const destination = new URL('../web/public/audio/doors/close-thunk.wav', import.meta.url);
  let existing;
  try { existing = readFileSync(destination); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (!existing.equals(bytes)) throw new Error('Existing door thunk differs; refusing overwrite');
  } else {
    writeFileSync(destination, bytes, { flag: 'wx' });
  }
  console.log(JSON.stringify({frames: FRAMES, rate: RATE, duration: FRAMES / RATE,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}));
}
