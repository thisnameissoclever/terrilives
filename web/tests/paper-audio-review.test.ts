import { afterEach, expect, test } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const repository = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'terrilives-paper-review-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  mkdirSync(path.join(repo, 'web/public'), { recursive: true });
  for (const file of ['build-audio-audition.cjs', 'audio-audition.html', 'publish-paper-audio-review.cjs']) {
    const source = path.join(repository, 'scripts', file);
    cpSync(source, path.join(repo, 'scripts', file));
  }
  cpSync(path.join(repository, 'assets/audio/review/paper'), path.join(repo, 'assets/audio/review/paper'), { recursive: true });
  return { root, repo, output: path.join(repo, 'web/public/audio-review.html') };
}

function publish(repo: string, ...args: string[]) {
  return spawnSync(process.execPath, [path.join(repo, 'scripts/publish-paper-audio-review.cjs'), ...args],
    { cwd: repo, encoding: 'utf8' });
}

test('publishes exactly four ordered paper originals with paper-specific unreviewed guidance', () => {
  const { repo, output } = fixture();
  const result = publish(repo);
  expect(result.status, result.stderr).toBe(0);
  const html = readFileSync(output, 'utf8');
  const records = JSON.parse(html.match(/const candidates = (.*);/)![1]);
  expect(records.map((record: { file: string }) => record.file))
    .toEqual(['paper_01.ogg', 'paper_02.ogg', 'paper_03.ogg', 'paper_04.ogg']);
  expect(records.map((record: { bytes: number }) => record.bytes)).toEqual([25529, 27205, 29838, 32322]);
  expect(records.map((record: { sha256: string }) => record.sha256)).toEqual([
    'b2b2b55e44761c7a45283bce0196f41f72207180fb08c970d7dcf93b705d280c',
    '4d0c68b367bd3fbdf9817e764908e5524b2cad6536eb0911fc74f6ab4f60c50a',
    '90147dde68b9e2082404f439165bbcb6f7c2364e88e9373d1cd1f7446a37f7b2',
    'afae7236bce275fad555922cc8578882eb0c0b5d822be0a9180c9efdadf4a770',
  ]);
  for (const record of records) {
    expect(Buffer.from(record.data.split(',')[1], 'base64'))
      .toEqual(readFileSync(path.join(repo, 'assets/audio/review/paper', record.file)));
  }
  expect(records.every((record: { author: string; license: string; pack: string; page: string }) =>
    record.author === 'rubberduck' && record.license === 'CC0-1.0' && record.pack === 'rubberduck-100-sfx' &&
    record.page === 'https://opengameart.org/content/100-cc0-sfx')).toBe(true);
  expect(html).toContain('<title>Paper sound review</title>');
  expect(html).toContain('Four unedited, unreviewed recordings');
  expect(html).toContain('page turn');
  expect(html).toContain('tear, crumple');
  expect(html).toContain('Closing or reloading loses notes unless you download them.');
  expect(html).not.toMatch(/water character|Boiling water|Five unedited/);
});

test('identical regeneration does not write again and preserves a changed existing artifact', () => {
  const { repo, output } = fixture();
  expect(publish(repo).status).toBe(0);
  const original = readFileSync(output);
  const before = statSync(output).mtimeMs;
  expect(publish(repo).status).toBe(0);
  expect(readFileSync(output)).toEqual(original);
  expect(statSync(output).mtimeMs).toBe(before);
  writeFileSync(output, 'Owner notes, do not replace');
  const rejected = publish(repo);
  expect(rejected.status).toBe(1);
  expect(rejected.stderr).toMatch(/existing.*differs/i);
  expect(readFileSync(output, 'utf8')).toBe('Owner notes, do not replace');
});

test.each(['assets/audio/review/paper', 'web/public'])('refuses redirected fixed directory %s', (relative) => {
  const { root, repo, output } = fixture();
  const redirected = path.join(root, 'redirected');
  const original = path.join(repo, relative);
  renameSync(original, redirected);
  symlinkSync(redirected, original, process.platform === 'win32' ? 'junction' : 'dir');
  const result = publish(repo);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toMatch(/fixed.*directory/i);
  expect(existsSync(output)).toBe(false);
  expect(existsSync(path.join(redirected, 'audio-review.html'))).toBe(false);
});

test('checked-in artifact equals a fresh fixed-manifest publication', () => {
  const { repo, output } = fixture();
  expect(publish(repo).status).toBe(0);
  const artifact = path.join(repository, 'web/public/audio-review.html');
  expect(existsSync(artifact)).toBe(true);
  const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  expect(digest(artifact)).toBe(digest(output));
});

test.each(['hash', 'size'])('rejects changed paper original %s before creating output', kind => {
  const { repo, output } = fixture();
  const source = path.join(repo, 'assets/audio/review/paper/paper_01.ogg');
  const bytes = readFileSync(source);
  if (kind === 'hash') bytes[10] ^= 1;
  writeFileSync(source, kind === 'hash' ? bytes : Buffer.concat([bytes, Buffer.from([0])]));
  const result = publish(repo);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(kind === 'hash' ? /SHA-256 mismatch/ : /size mismatch/);
  expect(existsSync(output)).toBe(false);
});

test('rejects source-file and destination-file symlinks escaping their fixed locations', ({ skip }) => {
  const { root, repo, output } = fixture();
  const source = path.join(repo, 'assets/audio/review/paper/paper_01.ogg');
  const outside = path.join(root, 'paper_01.ogg');
  renameSync(source, outside);
  try { symlinkSync(outside, source, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      skip('File symlink privilege is unavailable');
      return;
    }
    throw error;
  }
  const escapedSource = publish(repo);
  expect(escapedSource.status).toBe(1);
  expect(escapedSource.stderr).toMatch(/direct child/);
  expect(existsSync(output)).toBe(false);
  rmSync(source);
  renameSync(outside, source);
  expect(publish(repo).status).toBe(0);
  const saved = readFileSync(output);
  renameSync(output, outside);
  symlinkSync(outside, output, 'file');
  const escapedOutput = publish(repo);
  expect(escapedOutput.status).toBe(1);
  expect(escapedOutput.stderr).toMatch(/fixed destination/);
  expect(readFileSync(outside)).toEqual(saved);
});

test('accepts no destination or candidate overrides', () => {
  const { root, repo, output } = fixture();
  const other = path.join(root, 'other.html');
  expect(publish(repo, other).status).toBe(1);
  const { publishPaperReview } = require(path.join(repo, 'scripts/publish-paper-audio-review.cjs'));
  expect(() => publishPaperReview({ output: other })).toThrow(/does not accept/);
  expect(existsSync(output)).toBe(false);
  expect(existsSync(other)).toBe(false);
});
