import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { conditionWaterLoop, encodeWaterWave } from '../web/proofs/prepare-water-loop.js';

/** First-party filtered air texture. No discrete events or runtime randomness. */
export function buildRoomAmbience() {
  const rate = 48000, overlap = 4800;
  const source = new Float32Array(rate * 8 + overlap);
  let seed = 0x19a17;
  const highPass = Math.exp(-2 * Math.PI * 180 / rate);
  const lowPass = 1 - Math.exp(-2 * Math.PI * 1800 / rate);
  let previous = 0, high = 0, band = 0;
  for (let i = 0; i < source.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const noise = (seed >>> 0) / 2147483648 - 1;
    high = highPass * (high + noise - previous);
    previous = noise;
    band += lowPass * (high - band);
    source[i] = band * 0.22;
  }
  const [loop] = conditionWaterLoop([source], overlap);
  // The overlap removes the discontinuity; match the adjacent endpoint exactly.
  loop[0] = loop[loop.length - 1];
  let sum = 0;
  for (const sample of loop) sum += sample;
  const mean = sum / loop.length;
  for (let i = 0; i < loop.length; i++) loop[i] -= mean;
  return Buffer.from(encodeWaterWave([loop]));
}

export function publishRoomAmbience(destination) {
  const bytes = buildRoomAmbience();
  let existing;
  try { existing = readFileSync(destination); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (!existing.equals(bytes)) throw new Error('Existing room ambience differs; refusing overwrite');
  } else writeFileSync(destination, bytes, {flag: 'wx'});
  return bytes;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(new URL('../web/public/audio/ambience/', import.meta.url), {recursive: true});
  const bytes = publishRoomAmbience(new URL('../web/public/audio/ambience/indoor-air.wav', import.meta.url));
  console.log(`Room ambience matches ${bytes.length} bytes`);
}
