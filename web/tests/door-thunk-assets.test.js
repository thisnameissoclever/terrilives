import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildDoorThunk } from '../../scripts/build-door-thunk.mjs';

const source = readFileSync(new URL('../public/audio/doors/close.wav', import.meta.url));
const output = readFileSync(new URL('../public/audio/doors/close-thunk.wav', import.meta.url));

function signal(bytes, frames) {
  let peak = 0, energy = 0, highEnergy = 0, high = 0, previous = 0;
  const decay = Math.exp(-2 * Math.PI * 2500 / 48000);
  for (let frame = 0; frame < frames; frame++) {
    const value = bytes.readInt16LE(44 + frame * 4) / 32768;
    high = decay * (high + value - previous);
    previous = value;
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
    highEnergy += high * high;
  }
  return {peak, energy, highEnergy};
}

test('closing thunk contains a shorter nonzero impact with reduced sharp energy', () => {
  expect(output.toString('ascii', 0, 4)).toBe('RIFF');
  expect(output.readUInt16LE(22)).toBe(2);
  expect(output.readUInt32LE(24)).toBe(48000);
  expect(output.readUInt16LE(34)).toBe(16);
  expect(output.readUInt32LE(40)).toBe(15360 * 4);
  expect(output.length).toBe(44 + 15360 * 4);
  const original = signal(source, 15360);
  const thunk = signal(output, 15360);
  const regenerated = signal(buildDoorThunk(source), 15360);
  expect(thunk.peak).toBeGreaterThan(0.1);
  expect(thunk.peak).toBeLessThan(original.peak * 0.6);
  expect(thunk.energy).toBeGreaterThan(original.energy * 0.3);
  expect(thunk.highEnergy).toBeLessThan(original.highEnergy * 0.02);
  expect(regenerated.highEnergy).toBeLessThan(original.highEnergy * 0.02);
  for (const channel of [0, 1]) {
    expect(output.readInt16LE(44 + channel * 2)).toBe(0);
    expect(output.readInt16LE(44 + 15359 * 4 + channel * 2)).toBe(0);
  }
});

test('closing thunk rebuilds exactly from the preserved source', () => {
  expect(buildDoorThunk(source).equals(output)).toBe(true);
  expect(createHash('sha256').update(output).digest('hex')).toBe(
    '3df7b05fe5101da61d0f06e523b52f0f038bee32c22fca2569107bf58f087cc3');
});

test('closing thunk preparation rejects a changed source', () => {
  const changed = Buffer.from(source);
  changed[100] ^= 1;
  expect(() => buildDoorThunk(changed)).toThrow('Door source hash mismatch');
});
