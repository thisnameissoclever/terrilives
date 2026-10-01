import { afterEach, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'terrilives-audition-test-'));
  roots.push(root);
  writeFileSync(path.join(root, 'example.ogg'), 'abc');
  return { intake: root, output: path.join(root, 'review.html'), candidates: [{
    file: 'example.ogg', pack: 'fixture', author: 'Test', page: 'https://example.com',
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  }] };
}

test('builds an offline review with exact original bytes and provenance', () => {
  const { buildReview } = require('../../scripts/build-audio-audition.cjs');
  const request = fixture();
  buildReview(request);
  const html = readFileSync(request.output, 'utf8');
  expect(html).toContain('data:audio/ogg;base64,YWJj');
  expect(html).toContain(request.candidates[0].sha256);
  expect(html).toContain('https://example.com');
  expect(html).not.toContain('__CANDIDATES__');
});

test('rejects changed candidate bytes before publishing a review', () => {
  const { buildReview } = require('../../scripts/build-audio-audition.cjs');
  const request = fixture();
  writeFileSync(path.join(request.intake, 'example.ogg'), 'changed');
  expect(() => buildReview(request)).toThrow(/SHA-256 mismatch/);
  expect(existsSync(request.output)).toBe(false);
});

test('never replaces an existing review or writes into the repository', () => {
  const { buildReview } = require('../../scripts/build-audio-audition.cjs');
  const request = fixture();
  writeFileSync(request.output, 'owner notes');
  expect(() => buildReview(request)).toThrow();
  expect(readFileSync(request.output, 'utf8')).toBe('owner notes');
  const owned = mkdtempSync(path.resolve(import.meta.dirname, '../audition-test-'));
  roots.push(owned);
  request.output = path.join(owned, 'review.html');
  expect(() => buildReview(request)).toThrow(/outside the repository/);
  expect(existsSync(request.output)).toBe(false);
});

test('rejects escaped input paths and escapes script-closing text in metadata', () => {
  const { buildReview } = require('../../scripts/build-audio-audition.cjs');
  const request = fixture();
  request.candidates[0].file = `../${path.basename(request.intake)}/example.ogg`;
  expect(() => buildReview(request)).toThrow(/direct child/);
  request.candidates[0].file = 'example.ogg';
  request.candidates[0].author = '</script><script>alert(1)</script>';
  buildReview(request);
  expect(readFileSync(request.output, 'utf8')).not.toContain('</script><script>alert(1)');
});
