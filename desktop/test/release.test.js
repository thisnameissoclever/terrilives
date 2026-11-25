'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const release = require('../scripts/release.js');

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const DESKTOP_DIST = path.join(__dirname, '..', 'dist');
const passedReport = { checked_revision: HEAD, state: 'passed', complete: true };
const TYPOGRAPHIC_DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

function facts(overrides = {}) {
  return {
    platform: 'win', ghAuthenticated: true, status: '', head: HEAD, originMain: HEAD, version: '1.1.0',
    wasmPackVersion: 'wasm-pack 0.15.1', pinnedWasmPack: '0.15.0', nodeVersion: 'v24.0.0', localCiReport: passedReport,
    ...overrides,
  };
}

test('a clean checkout of origin/main with passing local CI may release', () => {
  assert.deepEqual(release.preflightProblems(facts()), []);
  assert.deepEqual(release.preflightProblems(facts({ platform: 'mac', localCiReport: null })), []);
});

test('refuses a dirty tree, a HEAD that is not origin/main, and a missing sign-in', () => {
  const problems = release.preflightProblems(facts({ status: '?? notes.txt', originMain: OTHER, ghAuthenticated: false }));
  assert.equal(problems.length, 3);
  assert.match(problems.join('\n'), /uncommitted or untracked/);
  assert.match(problems.join('\n'), /is not origin\/main/);
  assert.match(problems.join('\n'), /gh is not signed in/);
});

test('refuses the wrong tools', () => {
  assert.match(release.preflightProblems(facts({ wasmPackVersion: 'wasm-pack 0.14.9' })).join(), /wasm-pack 0\.15\.0/);
  assert.match(release.preflightProblems(facts({ wasmPackVersion: '' })).join(), /wasm-pack/);
  assert.match(release.preflightProblems(facts({ nodeVersion: 'v22.11.0' })).join(), /Node 22\.12\.0/);
  assert.match(release.preflightProblems(facts({ version: '1.1' })).join(), /major\.minor\.patch/);
});

test('Windows needs a complete passing local CI report for HEAD', () => {
  assert.match(release.preflightProblems(facts({ localCiReport: null })).join(), /report\.json is missing/);
  assert.match(release.preflightProblems(facts({ localCiReport: { ...passedReport, checked_revision: OTHER } })).join(), /not HEAD/);
  assert.match(release.preflightProblems(facts({ localCiReport: { ...passedReport, state: 'failed' } })).join(), /failed, not passed/);
  assert.match(release.preflightProblems(facts({ localCiReport: { ...passedReport, complete: false } })).join(), /every group/);
});

test('reads the wasm-pack pin from the Pages workflow', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '../../.github/workflows/pages.yml'), 'utf8');
  assert.match(release.pinnedWasmPack(yaml), /^\d+\.\d+\.\d+$/);
});

test('refuses a published release and a draft at another commit', () => {
  const base = { head: HEAD, platform: 'win', version: '1.1.0', replace: false };
  assert.deepEqual(release.releaseProblems(null, base), []);
  assert.match(release.releaseProblems({ isDraft: false, targetCommitish: HEAD, assets: [] }, base).join(), /already published/);
  assert.match(release.releaseProblems({ isDraft: true, targetCommitish: OTHER, assets: [] }, base).join(), /targets b+, not HEAD/);
  const otherPlatform = { isDraft: true, targetCommitish: HEAD, assets: [{ name: 'Natural-Causes-1.1.0-arm64.dmg' }] };
  assert.deepEqual(release.releaseProblems(otherPlatform, base), []);
});

test('refuses to replace the Windows files without --replace', () => {
  const draft = { isDraft: true, targetCommitish: HEAD, assets: [{ name: 'Natural-Causes-Setup-1.1.0-x64.exe' }] };
  const base = { head: HEAD, platform: 'win', version: '1.1.0' };
  assert.match(release.releaseProblems(draft, { ...base, replace: false }).join(), /--replace/);
  assert.deepEqual(release.releaseProblems(draft, { ...base, replace: true }), []);
});

test('names the assets: Windows files with their update files here, Mac files from the workflow', () => {
  assert.deepEqual(release.expectedAssets('1.1.0', 'win'), [
    'Natural-Causes-Setup-1.1.0-x64.exe', 'Natural-Causes-Setup-1.1.0-x64.exe.blockmap', 'latest.yml', 'SHA256SUMS-windows.txt',
  ]);
  assert.deepEqual(release.expectedAssets('1.1.0', 'mac'), [
    'Natural-Causes-1.1.0-arm64.dmg', 'Natural-Causes-1.1.0-x64.dmg', 'SHA256SUMS-macos.txt',
  ]);
  const view = { assets: release.expectedAssets('1.1.0', 'win').map((name) => ({ name })) };
  // The Mac files arrive after publishing, so they do not block it.
  assert.deepEqual(release.missingForPublish(view, '1.1.0'), []);
  assert.deepEqual(release.missingForPublish({ assets: [{ name: 'Natural-Causes-Setup-1.1.0-x64.exe' }] }, '1.1.0'),
    ['Natural-Causes-Setup-1.1.0-x64.exe.blockmap', 'latest.yml', 'SHA256SUMS-windows.txt']);
});

test('checks that latest.yml describes this version and installer', () => {
  const good = 'version: 1.1.0\nfiles:\n  - url: Natural-Causes-Setup-1.1.0-x64.exe\npath: Natural-Causes-Setup-1.1.0-x64.exe\n';
  assert.deepEqual(release.updateInfoProblems(good, '1.1.0'), []);
  assert.equal(release.updateInfoProblems(good.replace('version: 1.1.0', 'version: 1.0.0'), '1.1.0').length, 1);
  assert.equal(release.updateInfoProblems('version: 1.1.0\npath: other.exe\n', '1.1.0').length, 1);
});

test('parses options, builds only on Windows, and refuses unknown ones', () => {
  assert.deepEqual(release.parseArgs([], 'win32'), { platform: 'win', dryRun: false, publish: false, replace: false });
  assert.throws(() => release.parseArgs([], 'darwin'), /desktop-mac workflow/);
  assert.equal(release.parseArgs(['--publish'], 'darwin').publish, true);
  assert.equal(release.parseArgs(['--dry-run'], 'win32').dryRun, true);
  assert.throws(() => release.parseArgs(['--mac'], 'win32'), /Unknown option/);
  assert.throws(() => release.parseArgs(['--force'], 'win32'), /Unknown option/);
  assert.throws(() => release.parseArgs(['--publish', '--replace'], 'win32'), /takes no other option/);
});

test('notes are for players: platforms, changelog, install help and checksums', () => {
  const notes = release.releaseNotes('1.1.0');
  assert.match(notes, /Windows/);
  assert.match(notes, /Apple silicon/);
  assert.match(notes, /https:\/\/natural-causes\.life\/changelog\//);
  assert.match(notes, /#local-install/);
  assert.match(notes, /SHA-256/);
  assert.match(notes, /updates itself/);
  assert.doesNotMatch(notes, TYPOGRAPHIC_DASHES);
});

/** A full Windows run against fake commands and files. */
function fakeRun({ view = null, report = passedReport, dist = ['Natural-Causes-Setup-1.1.0-x64.exe', 'latest.yml', 'Natural-Causes-Setup-1.1.0-x64.exe.blockmap', 'builder-debug.yml'], latest = 'version: 1.1.0\npath: Natural-Causes-Setup-1.1.0-x64.exe\n' } = {}) {
  const commands = [];
  const written = new Map();
  const exec = (command, args) => {
    commands.push([path.basename(command), ...args.map((arg) => (path.isAbsolute(arg) ? path.basename(arg) : arg))]);
    const out = (stdout, status = 0, stderr = '') => ({ status, stdout, stderr });
    if (command === 'git' && args[0] === 'status') return out('');
    if (command === 'git' && args[0] === 'rev-parse') return out(HEAD);
    if (command === 'wasm-pack' && args[0] === '--version') return out('wasm-pack 0.15.1');
    if (command === 'gh' && args[0] === 'release' && args[1] === 'view') {
      return view === null ? out('', 1, 'release not found') : out(JSON.stringify(view));
    }
    return out('');
  };
  const files = {
    exists: (file) => {
      const name = path.basename(file);
      if (name === 'report.json') return report !== null;
      if (file.startsWith(DESKTOP_DIST + path.sep)) return dist.includes(name);
      return true;
    },
    readText: (file) => {
      if (file.endsWith('package.json')) return JSON.stringify({ version: '1.1.0' });
      if (file.endsWith('pages.yml')) return "uses: jetli/wasm-pack-action@v0.4.0\n        with:\n          version: 'v0.15.0'\n";
      if (file.endsWith('report.json')) return JSON.stringify(report);
      if (file.endsWith('latest.yml')) return latest;
      throw new Error(`unexpected read ${file}`);
    },
    writeText: (file, text) => written.set(path.basename(file), text),
    list: () => ['index.html', 'game.wasm'],
    sha256: () => 'c'.repeat(64),
    size: () => 123,
  };
  return { commands, written, exec, files };
}

test('a first Windows run creates a draft at HEAD and uploads the installer, its update files and checksums', () => {
  const fake = fakeRun();
  const result = release.release([], { exec: fake.exec, files: fake.files, log: () => {}, platform: 'win32' });
  assert.deepEqual(result.uploads.map((file) => path.basename(file)), release.expectedAssets('1.1.0', 'win'));
  const create = fake.commands.find((command) => command[0] === 'gh' && command[2] === 'create');
  assert.deepEqual(create.slice(0, 6), ['gh', 'release', 'create', 'v1.1.0', '--draft', '--target']);
  assert.equal(create[6], HEAD);
  const upload = fake.commands.find((command) => command[0] === 'gh' && command[2] === 'upload');
  assert.deepEqual(upload, ['gh', 'release', 'upload', 'v1.1.0', ...release.expectedAssets('1.1.0', 'win')]);
  const build = fake.commands.find((command) => command.includes('cli.js'));
  assert.ok(build.includes('--win') && build.includes('never'));
  assert.equal(fake.written.get('SHA256SUMS-windows.txt'), `${'c'.repeat(64)}  Natural-Causes-Setup-1.1.0-x64.exe\n`);
  // Nothing is built before the release checks pass.
  const view = fake.commands.findIndex((command) => command[0] === 'gh' && command[2] === 'view');
  const wasm = fake.commands.findIndex((command) => command[0] === 'wasm-pack' && command[1] === 'build');
  assert.ok(view < wasm);
});

test('a dry run builds but never touches the release', () => {
  const fake = fakeRun();
  const result = release.release(['--dry-run'], { exec: fake.exec, files: fake.files, log: () => {}, platform: 'win32' });
  assert.equal(result.dryRun, true);
  assert.ok(!fake.commands.some((command) => command[0] === 'gh' && ['create', 'upload', 'edit'].includes(command[2])));
});

test('a refused release builds nothing', () => {
  const fake = fakeRun({ view: { isDraft: false, targetCommitish: HEAD, assets: [] } });
  assert.throws(() => release.release([], { exec: fake.exec, files: fake.files, log: () => {}, platform: 'win32' }), /already published/);
  assert.ok(!fake.commands.some((command) => command[0] === 'wasm-pack' && command[1] === 'build'));
});

test('a run without the update files or with a stale latest.yml uploads nothing', () => {
  const missing = fakeRun({ dist: ['Natural-Causes-Setup-1.1.0-x64.exe'] });
  assert.throws(() => release.release([], { exec: missing.exec, files: missing.files, log: () => {}, platform: 'win32' }), /which updates need/);
  const stale = fakeRun({ latest: 'version: 1.0.0\npath: Natural-Causes-Setup-1.0.0-x64.exe\n' });
  assert.throws(() => release.release([], { exec: stale.exec, files: stale.files, log: () => {}, platform: 'win32' }), /latest\.yml does not name/);
  for (const fake of [missing, stale]) assert.ok(!fake.commands.some((command) => command[0] === 'gh' && ['create', 'upload'].includes(command[2])));
});

test('publishing needs the Windows files on the draft; the Mac files follow', () => {
  const partial = fakeRun({ view: { isDraft: true, targetCommitish: HEAD, assets: [{ name: 'Natural-Causes-Setup-1.1.0-x64.exe' }] } });
  assert.throws(() => release.release(['--publish'], { exec: partial.exec, files: partial.files, log: () => {}, platform: 'win32' }), /missing .*latest\.yml/);
  const all = release.expectedAssets('1.1.0', 'win').map((name) => ({ name }));
  const complete = fakeRun({ view: { isDraft: true, targetCommitish: HEAD, assets: all } });
  release.release(['--publish'], { exec: complete.exec, files: complete.files, log: () => {}, platform: 'win32' });
  assert.deepEqual(complete.commands.at(-1), ['gh', 'release', 'edit', 'v1.1.0', '--draft=false', '--latest']);
});
