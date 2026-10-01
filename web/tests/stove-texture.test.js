import { expect, test } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStoveTexture } from '../../scripts/build-stove-texture.mjs';

test('builds a repeatable four-second mono cooking texture with restrained levels', () => {
  const wav = buildStoveTexture();
  expect(wav.equals(buildStoveTexture())).toBe(true);
  expect(wav.length).toBe(384044);
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ');
  expect(wav.readUInt16LE(22)).toBe(1);
  expect(wav.readUInt32LE(24)).toBe(48000);
  expect(wav.readUInt16LE(34)).toBe(16);
  expect(wav.readUInt32LE(40)).toBe(384000);
  let peak = 0, sum = 0, square = 0, differences = 0;
  let previous = wav.readInt16LE(wav.length - 2) / 32768;
  for (let offset = 44; offset < wav.length; offset += 2) {
    const value = wav.readInt16LE(offset) / 32768;
    peak = Math.max(peak, Math.abs(value));
    sum += value; square += value * value;
    differences += (value - previous) ** 2;
    previous = value;
  }
  expect(peak).toBeGreaterThan(0.01);
  expect(peak).toBeLessThan(0.06);
  expect(Math.sqrt(square / 192000)).toBeGreaterThan(0.002);
  expect(Math.sqrt(square / 192000)).toBeLessThan(0.015);
  expect(Math.abs(sum / 192000)).toBeLessThan(0.0001);
  // Reject a low sustained tone or silence in place of the broadband texture.
  expect(differences / square).toBeGreaterThan(0.1);
  const seam = Math.abs(wav.readInt16LE(44) - wav.readInt16LE(wav.length - 2)) / 32768;
  expect(seam).toBeLessThan(0.01);
});

test('ships the reproducible texture bytes', () => {
  const shipped = readFileSync(new URL('../public/audio/objects/stove-cooking.wav', import.meta.url));
  expect(shipped.equals(buildStoveTexture())).toBe(true);
  expect(createHash('sha256').update(shipped).digest('hex')).toBe('c126462490ce29618b9d285ffeb0d3c05883e0723d230cbca80ce3fc7b2b07a8');
});

test('the CLI creates, accepts identical output and refuses changed output without overwriting it', () => {
  const root = mkdtempSync(join(tmpdir(), 'terrilives-stove-generator-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'web/proofs'), {recursive:true});
    mkdirSync(join(root, 'web/public/audio/objects'), {recursive:true});
    const script = join(root, 'scripts/build-stove-texture.mjs');
    const destination = join(root, 'web/public/audio/objects/stove-cooking.wav');
    copyFileSync(new URL('../../scripts/build-stove-texture.mjs', import.meta.url), script);
    copyFileSync(new URL('../proofs/prepare-water-loop.js', import.meta.url), join(root, 'web/proofs/prepare-water-loop.js'));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    const run = () => spawnSync(process.execPath, [script], {encoding:'utf8'});
    expect(run().status).toBe(0);
    expect(readFileSync(destination).equals(buildStoveTexture())).toBe(true);
    expect(run().stdout).toContain('already matches');
    const changed = Buffer.from('keep this distinct file');
    writeFileSync(destination, changed);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing overwrite');
    expect(readFileSync(destination).equals(changed)).toBe(true);
  } finally {
    // Only this test's newly created directory is removed.
    rmSync(root, {recursive:true, force:true});
  }
});
