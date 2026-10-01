import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test.each([
  ['door_open.ogg', 'open.wav', 21698, 0.8123093, 0.1147499,
    '62b42cdf0d8b25ef80c0f3bc815aa65977b78b20225481461ea134798172f59d',
    '01c05db9d4349f7da37821cc71bfaec7aa4da8486c7096406520ef8c3e1be2da'],
  ['door_close_02.ogg', 'close.wav', 41227, 0.8985110, 0.0610266,
    '3f4ce43f7a676d8907258908c90e88caecffd4526fce43e40df6726bf67ed91b',
    '5aa47dfbe01fa785de53564e24229640dfd60cdbc231f43323882fa73e7dbd92'],
])('retains %s and its unclipped stereo export %s', (sourceName, outputName, frames, peak, rms, sourceHash, outputHash) => {
  const source = readFileSync(new URL(`../../assets/audio/doors/${sourceName}`, import.meta.url));
  const output = readFileSync(new URL(`../public/audio/doors/${outputName}`, import.meta.url));
  expect(createHash('sha256').update(source).digest('hex')).toBe(sourceHash);
  expect(createHash('sha256').update(output).digest('hex')).toBe(outputHash);
  expect(output.toString('ascii', 0, 4)).toBe('RIFF');
  expect(output.toString('ascii', 8, 16)).toBe('WAVEfmt ');
  expect(output.readUInt16LE(20)).toBe(1);
  expect(output.readUInt16LE(22)).toBe(2);
  expect(output.readUInt32LE(24)).toBe(48000);
  expect(output.readUInt16LE(34)).toBe(16);
  expect(output.readUInt32LE(40)).toBe(frames * 4);
  expect(output.length).toBe(44 + frames * 4);
  let measuredPeak = 0, squareSum = 0;
  for (let offset = 44; offset < output.length; offset += 2) {
    const value = output.readInt16LE(offset) / 32768;
    measuredPeak = Math.max(measuredPeak, Math.abs(value));
    squareSum += value * value;
  }
  expect(measuredPeak).toBeCloseTo(peak, 4);
  expect(measuredPeak).toBeLessThan(1);
  expect(Math.sqrt(squareSum / (frames * 2))).toBeCloseTo(rms, 5);
});
