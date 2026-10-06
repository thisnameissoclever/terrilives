import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Sounds kept on purpose for systems that are not built yet. Nothing loads
// them, so an "unused asset" cleanup would otherwise delete them. See
// ASSETS.md, "Future assets kept for unbuilt systems".
test('keeps the cat purr chosen for the future pets work', () => {
  const purr = readFileSync(new URL('../../assets/audio/future/cat-purr/cat-purr-candidate.wav', import.meta.url));
  expect(createHash('sha256').update(purr).digest('hex'))
    .toBe('7025a85b832e12e498a854d9edee454a67531f46c31e7b4ccd6717ecedf4d860');
  expect(purr.toString('ascii', 0, 4)).toBe('RIFF');
  expect(purr.readUInt16LE(22)).toBe(1);
  expect(purr.readUInt32LE(24)).toBe(48000);
  expect(purr.readUInt16LE(34)).toBe(16);
});
