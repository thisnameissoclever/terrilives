import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('retains the selected flush and exports all stereo frames without clipping', () => {
  const source = readFileSync(new URL('../../assets/audio/toilet/toilet_02.ogg', import.meta.url));
  const output = readFileSync(new URL('../public/audio/toilet/flush.wav', import.meta.url));
  expect(createHash('sha256').update(source).digest('hex')).toBe(
    '9e4a1824ac584bb65ba32406155d37861df7e11b95ef62493246dd2da17f8dbc');
  expect(createHash('sha256').update(output).digest('hex')).toBe(
    'b0e3384721432cb34733619b6e415c1de78f06f4b5f11bb0486f863088d4fbb5');
  expect(output.toString('ascii', 0, 4)).toBe('RIFF');
  expect(output.toString('ascii', 8, 16)).toBe('WAVEfmt ');
  expect(output.readUInt16LE(20)).toBe(1);
  expect(output.readUInt16LE(22)).toBe(2);
  expect(output.readUInt32LE(24)).toBe(48000);
  expect(output.readUInt16LE(34)).toBe(16);
  expect(output.readUInt32LE(40)).toBe(197986 * 4);
  expect(output.length).toBe(791988);
  let peak = 0, squares = 0;
  for (let offset = 44; offset < output.length; offset += 2) {
    const sample = output.readInt16LE(offset) / 32768;
    peak = Math.max(peak, Math.abs(sample));
    squares += sample * sample;
  }
  expect(peak).toBeCloseTo(0.7560942, 4);
  expect(peak).toBeLessThan(1);
  expect(Math.sqrt(squares / (197986 * 2))).toBeCloseTo(0.05450888, 5);
});
