import { expect, it } from 'vitest';
import { buildRoomAmbience, publishRoomAmbience } from '../../scripts/build-room-ambience.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
it('produces repeatable eight-second mono PCM with positive bounded signal and a continuous seam', () => {
  const bytes = buildRoomAmbience();
  expect(bytes.equals(buildRoomAmbience())).toBe(true);
  expect(bytes.length).toBe(768044);
  expect(bytes.readUInt16LE(22)).toBe(1);
  expect(bytes.readUInt32LE(24)).toBe(48000);
  let squares = 0, sum = 0, peak = 0;
  for (let i = 44; i < bytes.length; i += 2) {
    const sample = bytes.readInt16LE(i) / 32768;
    squares += sample * sample; sum += sample; peak = Math.max(peak, Math.abs(sample));
  }
  expect(Math.sqrt(squares / 384000)).toBeGreaterThan(0.03);
  expect(Math.sqrt(squares / 384000)).toBeLessThan(0.07);
  expect(peak).toBeLessThan(0.3);
  expect(Math.abs(sum / 384000)).toBeLessThan(0.0001);
  expect(Math.abs(bytes.readInt16LE(44) - bytes.readInt16LE(bytes.length - 2)) / 32768).toBeLessThan(0.002);
});
it('ships the exact reproducible source identity', () => {
  const bytes = readFileSync(new URL('../public/audio/ambience/indoor-air.wav', import.meta.url));
  expect(bytes.equals(buildRoomAmbience())).toBe(true);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('714374c981c63e1ac3a96e493687dfc4cca176aaeb12b14a984c00caed0dc42b');
});
it('publishes new or identical bytes but refuses to replace different content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'room-ambience-'));
  const target = join(directory, 'test.wav');
  try {
    expect(publishRoomAmbience(target).equals(readFileSync(target))).toBe(true);
    expect(publishRoomAmbience(target).equals(buildRoomAmbience())).toBe(true);
    const sentinel = Buffer.from('Keep this content'); writeFileSync(target, sentinel);
    expect(() => publishRoomAmbience(target)).toThrow('refusing overwrite');
    expect(readFileSync(target).equals(sentinel)).toBe(true);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
