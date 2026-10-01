import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { conditionWaterLoop, encodeWaterWave } from '../web/proofs/prepare-water-loop.js';

// First-party synthetic cooking texture, not a field recording. Offline only.
// Fixed seed, filtered noise and soft microbursts; no tonal oscillator or bass hit.
export function buildStoveTexture() {
  const rate = 48000;
  const overlap = 4800;
  const samples = new Float32Array(rate * 4 + overlap);
  let seed = 0x51a77e;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const highPass = Math.exp(-2 * Math.PI * 450 / rate);
  const lowPass = 1 - Math.exp(-2 * Math.PI * 4200 / rate);
  let previous = 0, high = 0, band = 0;
  let burstAge = 0, burstLength = 1, burstLevel = 0;
  for (let i = 0; i < samples.length; i++) {
    const noise = random() * 2 - 1;
    high = highPass * (high + noise - previous);
    previous = noise;
    band += lowPass * (high - band);
    if (random() < 24 / rate) {
      burstAge = 0;
      burstLength = Math.round(rate * (0.005 + random() * 0.01));
      burstLevel = 0.02 + random() * 0.01;
    }
    const burst = burstAge < burstLength
      ? burstLevel * Math.sin(Math.PI * burstAge++ / burstLength) ** 2 : 0;
    const movement = 0.88 + 0.12 * Math.cos(2 * Math.PI * i / (rate * 2));
    samples[i] = band * (0.03 * movement + burst);
  }
  return Buffer.from(encodeWaterWave(conditionWaterLoop([samples], overlap)));
}

// Rebuilding identical bytes is safe. A changed output requires explicit review.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const destination = new URL('../web/public/audio/objects/stove-cooking.wav', import.meta.url);
  const bytes = buildStoveTexture();
  let existing;
  try { existing = readFileSync(destination); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (!existing.equals(bytes)) throw new Error('Existing stove texture differs; refusing overwrite');
    console.log('Stove texture already matches');
  } else {
    writeFileSync(destination, bytes, { flag: 'wx' });
    console.log(`Created ${bytes.length} bytes`);
  }
}
