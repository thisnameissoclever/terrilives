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
  expect(html).toContain('<title>Household sound review</title>');
  expect(html).toContain('Five unedited candidates, not approved game sounds.');
  expect(html).toContain('Compare water character, background voices or music');
});

test('renders escaped review metadata without interpreting placeholder-like input', () => {
  const { buildReview } = require('../../scripts/build-audio-audition.cjs');
  const request = fixture();
  buildReview({ ...request, metadata: {
    title: 'Paper <sounds> & "notes"',
    introduction: "A 'quote' and </p><script>bad()</script>",
    instructions: 'Keep __CANDIDATES__ literal; compare page turns.',
  } });
  const html = readFileSync(request.output, 'utf8');
  expect(html).toContain('<title>Paper &lt;sounds&gt; &amp; &quot;notes&quot;</title>');
  expect(html).toContain('A &#39;quote&#39; and &lt;/p&gt;&lt;script&gt;bad()&lt;/script&gt;');
  expect(html).toContain('Keep __CANDIDATES__ literal; compare page turns.');
  expect(html).not.toContain('Compare water character');
});

test('rejects changed candidate bytes before publishing a review', () => {
  const { buildReview } = require('../../scripts/build-audio-audition.cjs');
  const request = fixture();
  writeFileSync(path.join(request.intake, 'example.ogg'), 'changed');
  expect(() => buildReview(request)).toThrow(/SHA-256 mismatch/);
  expect(existsSync(request.output)).toBe(false);
});

test('checks an exact declared original size even when its hash matches', () => {
  const { buildReview } = require('../../scripts/build-audio-audition.cjs');
  const request = fixture();
  expect(() => buildReview({ ...request, candidates: [{ ...request.candidates[0], bytes: 4 }] }))
    .toThrow(/size mismatch/);
  expect(existsSync(request.output)).toBe(false);
});

test('shared renderer retains the original size and hash validation', () => {
  const { renderReview } = require('../../scripts/build-audio-audition.cjs');
  const request = fixture();
  writeFileSync(path.join(request.intake, 'example.ogg'), Buffer.alloc(5 * 1024 * 1024 + 1));
  expect(() => renderReview(request)).toThrow(/no larger than 5 MiB/);
  writeFileSync(path.join(request.intake, 'example.ogg'), 'bad');
  expect(() => renderReview(request)).toThrow(/SHA-256 mismatch/);
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
