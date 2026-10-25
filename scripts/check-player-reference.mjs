import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = 'docs/player/generated/reference.json';
const reviewPath = 'docs/player/reviewed-sources.json';
const slash = path => path.replaceAll('\\', '/');
const normalized = bytes => bytes.toString('utf8').replaceAll('\r\n', '\n');
const hash = bytes => createHash('sha256').update(normalized(bytes)).digest('hex');

// Cover whole gameplay trees, including helpers added after the previous review.
// False positives require a review; a missed gameplay change can mislead a player.
export function sourceInventory(root = repository) {
  const files = [];
  function visit(path, accept) {
    if (!existsSync(join(root, path))) return;
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const next = slash(join(path, entry.name));
      if (next === 'web/src/wasm') continue;
      if (entry.isDirectory()) visit(next, accept);
      else if (entry.isFile() && accept(next)) files.push(next);
    }
  }
  visit('content', path => path.endsWith('.toml'));
  for (const crate of ['terri-core', 'terri-data', 'terri-sim', 'terri-wasm']) {
    visit(`crates/${crate}/src`, path => path.endsWith('.rs'));
    visit(`crates/${crate}/examples`, path => path.endsWith('.rs'));
    for (const file of ['Cargo.toml', 'build.rs']) {
      const path = `crates/${crate}/${file}`;
      if (existsSync(join(root, path))) files.push(path);
    }
  }
  // Core clock and weather state reach the browser through these sources too.
  visit('web/src', path => /\.(?:ts|tsx|css)$/.test(path));
  if (existsSync(join(root, 'web/index.html'))) files.push('web/index.html');
  for (const path of ['Cargo.toml', 'Cargo.lock']) {
    if (existsSync(join(root, path))) files.push(path);
  }
  return files.sort();
}

export function refreshReview(root = repository) {
  const reference = readFileSync(join(root, snapshotPath));
  JSON.parse(reference.toString('utf8'));
  const sources = Object.fromEntries(sourceInventory(root).map(path => [
    path, hash(readFileSync(join(root, path))),
  ]));
  const review = {
    schema_version: 1,
    policy: 'Review every changed gameplay or interface source and its guide coverage before refreshing this record. Hashes normalize CRLF to LF.',
    snapshot: { path: snapshotPath, sha256: hash(reference) },
    sources,
  };
  mkdirSync(dirname(join(root, reviewPath)), { recursive: true });
  writeFileSync(join(root, reviewPath), `${JSON.stringify(review, null, 2)}\n`);
  return review;
}

export function checkReference(root = repository) {
  const errors = [];
  if (!existsSync(join(root, reviewPath))) return ['Missing player guide source review record.'];
  let review;
  try { review = JSON.parse(readFileSync(join(root, reviewPath), 'utf8')); }
  catch { return ['Invalid player guide source review record.']; }
  if (review.schema_version !== 1 || !review.sources || typeof review.sources !== 'object'
      || Array.isArray(review.sources) || review.snapshot?.path !== snapshotPath
      || !/^[a-f0-9]{64}$/.test(review.snapshot?.sha256 ?? '')) {
    return ['Invalid player guide source review record schema.'];
  }
  const current = new Set(sourceInventory(root));
  for (const path of current) {
    if (!Object.hasOwn(review.sources, path)) errors.push(`Unreviewed source: ${path}`);
    else if (review.sources[path] !== hash(readFileSync(join(root, path)))) {
      errors.push(`Changed reviewed source: ${path}`);
    }
  }
  for (const path of Object.keys(review.sources)) {
    if (!current.has(path)) errors.push(`Missing reviewed source: ${path}`);
  }
  if (!existsSync(join(root, snapshotPath))) errors.push('Missing generated player reference.');
  else {
    const snapshot = readFileSync(join(root, snapshotPath));
    if (hash(snapshot) !== review.snapshot.sha256) errors.push('Generated reference changed without a source review.');
    try {
      const data = JSON.parse(snapshot.toString('utf8'));
      if (data.schema_version !== 1 || !Array.isArray(data.actions) || !data.needs || !data.tuning) {
        errors.push('Invalid generated player reference schema.');
      }
    } catch { errors.push('Invalid generated player reference JSON.'); }
  }
  return errors;
}

export function exportReference(root = repository) {
  const result = spawnSync('cargo', ['run', '--quiet', '-p', 'terri-data', '--example', 'player_guide'], {
    cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`Player reference exporter failed: ${result.error?.message ?? result.stderr}`);
  const output = normalized(result.stdout);
  JSON.parse(output);
  return output;
}

export function verifyExport(root = repository) {
  const current = exportReference(root);
  if (current !== normalized(readFileSync(join(root, snapshotPath)))) {
    throw new Error('Generated player reference differs from the compiled gameplay export. Regenerate it and review affected guide pages.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    for (const arg of args) {
      if (!['--check', '--refresh', '--verify-export'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    }
    if (args.includes('--refresh')) {
      const output = exportReference();
      mkdirSync(dirname(join(repository, snapshotPath)), { recursive: true });
      writeFileSync(join(repository, snapshotPath), output);
      refreshReview();
      console.log('Refreshed compiled player reference and source review record.');
    }
    const errors = checkReference();
    if (errors.length) throw new Error(`${errors.join('\n')}\nReview gameplay changes and guide coverage, then run node scripts/check-player-reference.mjs --refresh.`);
    if (args.includes('--verify-export')) verifyExport();
    console.log('Player reference and reviewed sources match.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
