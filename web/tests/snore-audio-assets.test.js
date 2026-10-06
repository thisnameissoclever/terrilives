import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('retains the CC0 snore recording the clips were cut from', () => {
  const source = readFileSync(new URL('../../assets/audio/snore/sirplus-snore-20545-preview.mp3', import.meta.url));
  expect(source.length).toBe(725943);
  expect(sha256(source)).toBe('f394b7034bf0d07530bee1e7c69e5b627dade788fde09cca3024f2fd5262f50f');
});

test.each([
  [1, 196800, '49c24c8e009a6112ae8bdba0fe8aae904b184d6d25965c0a50f723e5d36aec21'],
  [2, 201600, 'c1e282e637ae2533a46f4a7c765037ad3cf2f292a3094a73e409b4ef567f69e8'],
  [3, 211200, 'f5d4c484313b793ceb09aa67a2c69eddc7d41d39b9b1143e3966c51d8033fe5b'],
  [4, 249600, '0567cb1b6f85454ff424ae54386c3366bee76f6bb793b95b3cba1f8c2cf12ccc'],
  [5, 177600, '0a219ce26a5d1f0686898d95aa85e8696a6c6566fd797d311f6845ac4a664a6c'],
])('snore %i is an unclipped mono 48 kHz clip the game can load', (index, frames, hash) => {
  const clip = readFileSync(new URL(`../public/audio/sleep/snore-${index}.wav`, import.meta.url));
  expect(sha256(clip)).toBe(hash);
  expect(clip.toString('ascii', 0, 4)).toBe('RIFF');
  expect(clip.toString('ascii', 8, 16)).toBe('WAVEfmt ');
  expect(clip.readUInt16LE(20)).toBe(1);
  expect(clip.readUInt16LE(22)).toBe(1);
  expect(clip.readUInt32LE(24)).toBe(48000);
  expect(clip.readUInt16LE(34)).toBe(16);
  expect(clip.readUInt32LE(40)).toBe(frames * 2);
  expect(clip.length).toBe(44 + frames * 2);
  let peak = 0;
  for (let offset = 44; offset < clip.length; offset += 2) {
    peak = Math.max(peak, Math.abs(clip.readInt16LE(offset) / 32768));
  }
  expect(peak).toBeGreaterThan(0.25);
  expect(peak).toBeLessThan(0.5);
  // The game playing them must stay under the player's length limit.
  expect(frames / 48000).toBeLessThan(8);
});
