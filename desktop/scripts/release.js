#!/usr/bin/env node
'use strict';

/**
 * Builds the Windows installer on the owner's PC and attaches it, with the
 * update files electron-updater reads, to a draft GitHub release. The Mac
 * app is not built here: publishing the release starts
 * .github/workflows/desktop-mac.yml, which builds them on GitHub's macOS
 * runners, signs and notarizes it, and uploads its disk images, update zips
 * and latest-mac.yml to the same release.
 *
 *   node desktop/scripts/release.js [--dry-run] [--replace]
 *   node desktop/scripts/release.js --publish
 *
 * --dry-run builds and checksums, then stops before touching GitHub releases.
 * --replace lets an existing draft's Windows files be replaced.
 * --publish builds nothing: it checks that the draft has the Windows files,
 * then publishes it as the latest release.
 *
 * Commands run with argument arrays and no shell. Helpers are exported for
 * tests, which inject `exec` so no real git, gh or build runs.
 */

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const DESKTOP = path.join(REPO_ROOT, 'desktop');
const DIST = path.join(DESKTOP, 'dist');
const MINIMUM_NODE = [22, 12, 0];
const PUBLIC_CHANGELOG = 'https://natural-causes.life/changelog/';
const README_INSTALL = 'https://github.com/thisnameissoclever/terrilives#local-install';

class ReleaseError extends Error {}

function parseArgs(argv, platform = process.platform) {
  const options = { platform: 'win', dryRun: false, publish: false, replace: false };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--publish') options.publish = true;
    else if (arg === '--replace') options.replace = true;
    else throw new ReleaseError(`Unknown option: ${arg}`);
  }
  if (options.publish && (options.dryRun || options.replace)) {
    throw new ReleaseError('--publish builds nothing, so it takes no other option.');
  }
  if (platform !== 'win32' && !options.publish) {
    throw new ReleaseError('Build the Windows installer on Windows. The signed Mac app comes from the desktop-mac workflow when the release is published.');
  }
  return options;
}

/** The installers for one platform, in the order they are uploaded. */
function installerNames(version, platform) {
  if (platform === 'win') return [`Natural-Causes-Setup-${version}-x64.exe`];
  if (platform === 'mac') return [`Natural-Causes-${version}-arm64.dmg`, `Natural-Causes-${version}-x64.dmg`];
  throw new ReleaseError(`Unknown platform: ${platform}`);
}

function checksumName(platform) {
  return platform === 'win' ? 'SHA256SUMS-windows.txt' : 'SHA256SUMS-macos.txt';
}

/** The files electron-updater reads to find and download an update on each platform. */
function updateFileNames(version, platform = 'win') {
  if (platform === 'mac') {
    return ['arm64', 'x64'].flatMap((arch) => [`Natural-Causes-${version}-${arch}-mac.zip`, `Natural-Causes-${version}-${arch}-mac.zip.blockmap`])
      .concat('latest-mac.yml');
  }
  return [`Natural-Causes-Setup-${version}-x64.exe.blockmap`, 'latest.yml'];
}

/**
 * Every asset one platform contributes to the release. Windows assets come
 * from this script; the Mac assets come from the desktop-mac workflow.
 */
function expectedAssets(version, platform) {
  return [...installerNames(version, platform), ...updateFileNames(version, platform), checksumName(platform)];
}

/**
 * Checks that latest.yml describes this version and this installer. With
 * `installer` ({ sha512 base64, size }), it also checks the file's hash and
 * size, which every player's update download is verified against.
 */
function updateInfoProblems(text, version, installer = null) {
  const problems = [];
  const lines = text.split('\n').map((line) => line.trim());
  if (!lines.includes(`version: ${version}`)) problems.push(`latest.yml does not name version ${version}.`);
  if (!text.includes(`Natural-Causes-Setup-${version}-x64.exe`)) problems.push('latest.yml does not name the installer.');
  if (installer !== null) {
    if (!lines.includes(`sha512: ${installer.sha512}`)) problems.push('latest.yml has a different SHA-512 from the installer.');
    if (!lines.includes(`size: ${installer.size}`)) problems.push('latest.yml has a different size from the installer.');
  }
  return problems;
}

function compareVersions(left, right) {
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text ?? '');
  return match ? match.slice(1, 4).map(Number) : null;
}

/** The wasm-pack version the Pages build installs, from pages.yml. */
function pinnedWasmPack(pagesYaml) {
  const match = /wasm-pack-action@[^\n]*\n\s*with:\s*\n\s*version:\s*'v?(\d+\.\d+\.\d+)'/.exec(pagesYaml);
  if (!match) throw new ReleaseError('Could not find the wasm-pack version pinned in .github/workflows/pages.yml.');
  return match[1];
}

/**
 * Problems that stop a release before anything is built. Every check runs,
 * so one attempt names all of them.
 */
function preflightProblems(facts) {
  const problems = [];
  if (!facts.ghAuthenticated) problems.push('gh is not signed in. Run `gh auth login`.');
  if (facts.status.trim() !== '') problems.push('The working tree has uncommitted or untracked files.');
  if (facts.head !== facts.originMain) problems.push(`HEAD ${facts.head} is not origin/main ${facts.originMain}.`);
  if (!/^\d+\.\d+\.\d+$/.test(facts.version ?? '')) problems.push('web/package.json has no major.minor.patch version.');
  const wasmPack = parseVersion(facts.wasmPackVersion);
  const pinned = parseVersion(facts.pinnedWasmPack);
  if (!wasmPack || !pinned || wasmPack[0] !== pinned[0] || wasmPack[1] !== pinned[1]) {
    problems.push(`wasm-pack ${facts.pinnedWasmPack} or a later patch is required; found ${facts.wasmPackVersion || 'none'}.`);
  }
  const node = parseVersion(facts.nodeVersion);
  if (!node || compareVersions(node, MINIMUM_NODE) < 0) problems.push(`Node ${MINIMUM_NODE.join('.')} or later is required; found ${facts.nodeVersion}.`);
  if (facts.platform === 'win') problems.push(...localCiProblems(facts.localCiReport, facts.head));
  return problems;
}

/** The Windows release needs a complete passing local CI report for the exact commit. */
function localCiProblems(report, head) {
  if (report === null || report === undefined) {
    return ['.local-build/local-ci/report.json is missing. Run `py -3 -B scripts/check-local-ci.py run --report .local-build/local-ci/report.json`.'];
  }
  const problems = [];
  if (report.checked_revision !== head) problems.push(`The local CI report checked ${report.checked_revision}, not HEAD ${head}.`);
  if (report.state !== 'passed') problems.push(`The local CI report state is ${report.state}, not passed.`);
  if (report.complete !== true) problems.push('The local CI report did not run every group.');
  return problems;
}

/**
 * Whether this platform may add its installers to the release.
 * `view` is `gh release view` JSON, or null when there is no release yet.
 */
function releaseProblems(view, { head, platform, version, replace }) {
  if (view === null) return [];
  const problems = [];
  if (view.isDraft !== true) problems.push(`Release v${version} is already published. Raise the version for a new release.`);
  if (view.targetCommitish !== head) problems.push(`Draft v${version} targets ${view.targetCommitish}, not HEAD ${head}.`);
  const present = new Set((view.assets ?? []).map((asset) => asset.name));
  const clash = expectedAssets(version, platform).filter((name) => present.has(name));
  if (clash.length > 0 && !replace) problems.push(`Draft v${version} already has ${clash.join(', ')}. Use --replace to replace them.`);
  return problems;
}

/** Windows assets missing before the draft may be published. The Mac ones follow publication. */
function missingForPublish(view, version) {
  const present = new Set((view.assets ?? []).map((asset) => asset.name));
  return expectedAssets(version, 'win').filter((name) => !present.has(name));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function checksumText(entries) {
  return entries.map(({ name, hash }) => `${hash}  ${name}`).join('\n') + '\n';
}

function releaseNotes(version) {
  const lines = [
    `Natural Causes ${version} for Windows and Mac. The Mac downloads are added a few minutes after this release appears.`,
    '',
    `- Windows: download \`Natural-Causes-Setup-${version}-x64.exe\`.`,
    `- Mac with Apple silicon: download \`Natural-Causes-${version}-arm64.dmg\`.`,
    `- Mac with an Intel processor: download \`Natural-Causes-${version}-x64.dmg\`.`,
    '',
    `What changed: ${PUBLIC_CHANGELOG}`,
    '',
    `How to install, and what to do about the security warnings: ${README_INSTALL}`,
    '',
    'The installed game updates itself on Windows and Mac.',
    '',
    'SHA-256 checksums are in the SHA256SUMS files attached below.',
  ];
  return lines.join('\n') + '\n';
}

function npmCli(name) {
  return path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', `${name}-cli.js`);
}

/**
 * Runs a command without a shell. On Windows, npm is a batch file that cannot
 * run without one, so npm's own script runs through Node instead. Elsewhere
 * npm is an ordinary executable.
 */
function realExec(command, args, { cwd = REPO_ROOT, capture = false } = {}) {
  let file = command;
  let argv = args;
  if (command === 'npm' && process.platform === 'win32') {
    file = process.execPath;
    argv = [npmCli('npm'), ...args];
  }
  const result = spawnSync(file, argv, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function makeTools(exec) {
  const capture = (command, args, options = {}) => exec(command, args, { ...options, capture: true });
  const must = (command, args, options = {}) => {
    const result = exec(command, args, options);
    if (result.status !== 0) throw new ReleaseError(`Command failed (${result.status}): ${command} ${args.join(' ')}`);
    return result;
  };
  const read = (command, args, options = {}) => {
    const result = capture(command, args, options);
    if (result.status !== 0) throw new ReleaseError(`Command failed (${result.status}): ${command} ${args.join(' ')}\n${result.stderr}`);
    return result.stdout.trim();
  };
  return { capture, must, read };
}

function viewRelease(tools, tag) {
  const result = tools.capture('gh', ['release', 'view', tag, '--json', 'isDraft,targetCommitish,assets']);
  if (result.status !== 0) {
    if (/release not found/i.test(result.stderr)) return null;
    throw new ReleaseError(`Could not read release ${tag}: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

function gatherFacts(tools, options, files) {
  tools.must('git', ['fetch', 'origin', 'main']);
  const reportPath = path.join(REPO_ROOT, '.local-build', 'local-ci', 'report.json');
  return {
    platform: options.platform,
    ghAuthenticated: tools.capture('gh', ['auth', 'status']).status === 0,
    status: tools.read('git', ['status', '--porcelain']),
    head: tools.read('git', ['rev-parse', 'HEAD']),
    originMain: tools.read('git', ['rev-parse', 'origin/main']),
    version: JSON.parse(files.readText(path.join(REPO_ROOT, 'web', 'package.json'))).version,
    wasmPackVersion: tools.read('wasm-pack', ['--version']),
    pinnedWasmPack: pinnedWasmPack(files.readText(path.join(REPO_ROOT, '.github', 'workflows', 'pages.yml'))),
    nodeVersion: process.version,
    localCiReport: files.exists(reportPath) ? JSON.parse(files.readText(reportPath)) : null,
  };
}

function build(tools, options, files) {
  tools.must('wasm-pack', ['build', 'crates/terri-wasm', '--target', 'web', '--out-dir', '../../web/src/wasm']);
  tools.must('npm', ['ci'], { cwd: path.join(REPO_ROOT, 'web') });
  tools.must('npm', ['run', 'build'], { cwd: path.join(REPO_ROOT, 'web') });
  const dist = path.join(REPO_ROOT, 'web', 'dist');
  for (const page of ['index.html', 'changelog/index.html', 'guide/index.html', 'guide/ui-elements/index.html']) {
    if (!files.exists(path.join(dist, page))) throw new ReleaseError(`The web build has no ${page}.`);
  }
  if (!files.list(dist).some((name) => name.endsWith('.wasm'))) throw new ReleaseError('The web build has no .wasm file.');
  tools.must('npm', ['ci'], { cwd: DESKTOP });
  tools.must(process.execPath, [
    path.join(DESKTOP, 'node_modules', 'electron-builder', 'cli.js'),
    '--win',
    '--config', 'electron-builder.config.js', '--publish', 'never',
  ], { cwd: DESKTOP });
}

/** Checksums the installers, writes the platform's SHA256SUMS file and returns the upload list. */
function collectAssets(version, platform, files, log) {
  const entries = installerNames(version, platform).map((name) => {
    const file = path.join(DIST, name);
    if (!files.exists(file)) throw new ReleaseError(`electron-builder did not produce ${name}.`);
    return { name, file, hash: files.sha256(file), bytes: files.size(file) };
  });
  const sums = checksumText(entries);
  const sumsFile = path.join(DIST, checksumName(platform));
  files.writeText(sumsFile, sums);
  for (const entry of entries) log(`${entry.name}: ${entry.bytes} bytes, sha256 ${entry.hash}`);
  const updates = updateFileNames(version).map((name) => {
    const file = path.join(DIST, name);
    if (!files.exists(file)) throw new ReleaseError(`electron-builder did not produce ${name}, which updates need.`);
    return file;
  });
  const installer = entries[0];
  const problems = updateInfoProblems(files.readText(path.join(DIST, 'latest.yml')), version,
    { sha512: files.sha512Base64(installer.file), size: installer.bytes });
  if (problems.length > 0) throw new ReleaseError(problems.join(' '));
  const uploads = [...entries.map((entry) => entry.file), ...updates, sumsFile];
  const expected = expectedAssets(version, platform);
  if (uploads.map((file) => path.basename(file)).join('|') !== expected.join('|')) throw new ReleaseError('The upload list does not match the expected assets.');
  return { uploads, sums };
}

const realFiles = {
  exists: (file) => fs.existsSync(file),
  readText: (file) => fs.readFileSync(file, 'utf8'),
  writeText: (file, text) => fs.writeFileSync(file, text),
  list: (dir) => fs.readdirSync(dir, { recursive: true }).map(String),
  sha256,
  sha512Base64: (file) => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64'),
  size: (file) => fs.statSync(file).size,
};

function release(argv, { exec = realExec, files = realFiles, log = console.log, platform = process.platform } = {}) {
  const options = parseArgs(argv, platform);
  const tools = makeTools(exec);
  if (options.publish) {
    const version = JSON.parse(files.readText(path.join(REPO_ROOT, 'web', 'package.json'))).version;
    const tag = `v${version}`;
    const view = viewRelease(tools, tag);
    if (view === null) throw new ReleaseError(`There is no draft ${tag} to publish.`);
    if (view.isDraft !== true) throw new ReleaseError(`${tag} is already published.`);
    const missing = missingForPublish(view, version);
    if (missing.length > 0) throw new ReleaseError(`${tag} is missing ${missing.join(', ')}.`);
    tools.must('gh', ['release', 'edit', tag, '--draft=false', '--latest']);
    log(`Published ${tag}. The desktop-mac workflow now builds, signs and notarizes the Mac app and adds it to ${tag}.`);
    return { published: tag };
  }
  const facts = gatherFacts(tools, options, files);
  const problems = preflightProblems(facts);
  if (problems.length > 0) throw new ReleaseError(`Release refused:\n- ${problems.join('\n- ')}`);
  const tag = `v${facts.version}`;
  const before = viewRelease(tools, tag);
  const refusals = releaseProblems(before, { head: facts.head, platform: options.platform, version: facts.version, replace: options.replace });
  if (refusals.length > 0) throw new ReleaseError(`Release refused:\n- ${refusals.join('\n- ')}`);
  build(tools, options, files);
  const { uploads, sums } = collectAssets(facts.version, options.platform, files, log);
  if (options.dryRun) {
    log('Dry run: stopped before creating or changing the GitHub release.');
    return { uploads, dryRun: true };
  }
  if (before === null) {
    const notes = path.join(DIST, `release-notes-${tag}.md`);
    files.writeText(notes, releaseNotes(facts.version));
    tools.must('gh', ['release', 'create', tag, '--draft', '--target', facts.head, '--title', `Natural Causes ${facts.version}`, '--notes-file', notes]);
  }
  tools.must('gh', ['release', 'upload', tag, ...uploads, ...(options.replace ? ['--clobber'] : [])]);
  log(sums);
  log(`Uploaded to draft ${tag}. Publish with: node desktop/scripts/release.js --publish`);
  return { uploads, tag };
}

module.exports = {
  ReleaseError,
  checksumName,
  checksumText,
  expectedAssets,
  installerNames,
  localCiProblems,
  missingForPublish,
  parseArgs,
  pinnedWasmPack,
  preflightProblems,
  release,
  releaseNotes,
  releaseProblems,
  updateFileNames,
  updateInfoProblems,
};

if (require.main === module) {
  try {
    release(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof ReleaseError ? error.message : error);
    process.exit(1);
  }
}
