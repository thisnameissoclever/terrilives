import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { conditionWaterLoop, encodeWaterWave } from '../proofs/prepare-water-loop.js';

test('crossfades the tail into the head without boosting or changing source samples', () => {
  const source = Float32Array.from([0.2, 0.4, 0.6, 0.8, 0.7, 0.6, 0.3, -0.2]);
  const [loop] = conditionWaterLoop([source], 3);
  expect(loop.length).toBe(5);
  [0.6, 0.35, 0.6, 0.8, 0.7].forEach((value, index) => expect(loop[index]).toBeCloseTo(value, 6));
  expect(Array.from(source)).toEqual(Array.from(Float32Array.from([0.2, 0.4, 0.6, 0.8, 0.7, 0.6, 0.3, -0.2])));
  // The wrap is now the source's adjacent samples 4 -> 5, not 7 -> 0.
  expect(loop[0]).toBe(source[5]);
  expect(loop.at(-1)).toBe(source[4]);
});

test('ships the retained source and measured stereo export without clipping or upward normalization', () => {
  const source = readFileSync(new URL('../../assets/audio/shower-water/water_flowing.ogg', import.meta.url));
  const wav = readFileSync(new URL('../public/audio/objects/shower-water.wav', import.meta.url));
  expect(createHash('sha256').update(source).digest('hex')).toBe('1a431f77d61661becdc87a5b1832d47f83a12a5c0b001077e41a202e739797a7');
  expect(createHash('sha256').update(wav).digest('hex')).toBe('0dcbeceb5338db019627829c0b4227fb6de7232e3881df2aa622a7180476e315');
  expect(wav.readUInt16LE(22)).toBe(2);
  expect(wav.readUInt32LE(24)).toBe(48000);
  expect(wav.readUInt32LE(40)).toBe(85594 * 4);
  expect(wav.length).toBe(85594 * 4 + 44);
  let peak = 0, energy = 0;
  for (let offset = 44; offset < wav.length; offset += 2) {
    const value = wav.readInt16LE(offset) / 32768;
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
  }
  expect(peak).toBeGreaterThan(0.06);
  expect(peak).toBeLessThanOrEqual(0.06417626887559891 + 1 / 32768);
  expect(Math.sqrt(energy / (85594 * 2))).toBeCloseTo(0.013891, 5);
});

test('encodes stereo PCM16 with correct header, channel order and bounded rounding', () => {
  const bytes = encodeWaterWave([Float32Array.of(-1, 0, 1), Float32Array.of(0.5, -0.5, 0.25)]);
  const data = new DataView(bytes.buffer);
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
  expect(new TextDecoder().decode(bytes.slice(8, 16))).toBe('WAVEfmt ');
  expect(data.getUint32(4, true)).toBe(48);
  expect(data.getUint16(22, true)).toBe(2);
  expect(data.getUint32(24, true)).toBe(48000);
  expect(data.getUint32(28, true)).toBe(192000);
  expect(data.getUint32(40, true)).toBe(12);
  expect(Array.from({length:6}, (_,i) => data.getInt16(44+i*2,true))).toEqual([-32768, 16384, 0, -16384, 32767, 8192]);
});

test('rejects invalid or mismatched channels and invalid overlaps before editing', () => {
  for (const channels of [[], [new Float32Array(0)], [Float32Array.of(NaN, 0, 0, 0, 0)],
    [Float32Array.of(0, 0, 2, 0, 0)], [new Float32Array(8), new Float32Array(7)]]) {
    expect(() => conditionWaterLoop(channels, 2)).toThrow(/Invalid/);
  }
  for (const overlap of [0, 1, 1.5, 4, NaN]) {
    expect(() => conditionWaterLoop([new Float32Array(8)], overlap)).toThrow(/Invalid/);
  }
});
