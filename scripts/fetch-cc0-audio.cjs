const { createHash, randomUUID } = require('node:crypto');
const {
  constants: fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const APPROVED_CONTENT_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

const AUDIO_PACKS = Object.freeze([
  Object.freeze({
    id: 'owlish-202-more-sfx',
    title: '202 More Sound Effects',
    author: 'OwlishMedia',
    license: 'CC0-1.0',
    approximateSize: '14.9 MB',
    archiveName: 'owlish-202-more-sfx.zip',
    pageUrl: 'https://opengameart.org/content/202-more-sound-effects',
    downloadUrl: 'https://opengameart.org/sites/default/files/MoreSounds.zip',
    usefulFor: ['cloth', 'drinking', 'doors', 'kitchen', 'paper', 'office'],
  }),
  Object.freeze({
    id: 'rubberduck-100-sfx',
    title: '100 CC0 SFX',
    author: 'rubberduck',
    license: 'CC0-1.0',
    approximateSize: '2.9 MB',
    archiveName: 'rubberduck-100-sfx.zip',
    pageUrl: 'https://opengameart.org/content/100-cc0-sfx',
    downloadUrl: 'https://opengameart.org/sites/default/files/100-CC0-SFX_0.zip',
    usefulFor: ['dishes', 'doors', 'microwave', 'pots', 'toilet', 'water'],
  }),
  Object.freeze({
    id: 'rubberduck-100-sfx-2',
    title: '100 CC0 SFX #2',
    author: 'rubberduck',
    license: 'CC0-1.0',
    approximateSize: '2.4 MB',
    archiveName: 'rubberduck-100-sfx-2.zip',
    pageUrl: 'https://opengameart.org/content/100-cc0-sfx-2',
    downloadUrl: 'https://opengameart.org/sites/default/files/sfx_100_v2.zip',
    usefulFor: ['footsteps', 'doors', 'switches', 'water', 'room ambience'],
  }),
  Object.freeze({
    id: 'rubberduck-30-sfx-loops',
    title: '30 CC0 SFX Loops',
    author: 'rubberduck',
    license: 'CC0-1.0',
    approximateSize: '3.5 MB',
    archiveName: 'rubberduck-30-sfx-loops.zip',
    pageUrl: 'https://opengameart.org/content/30-cc0-sfx-loops',
    downloadUrl: 'https://opengameart.org/sites/default/files/sfx_loops.zip',
    usefulFor: ['machines', 'rain', 'boiling water', 'water pumps', 'ambience'],
  }),
]);

function parseArgs(argv) {
  const result = {
    list: false,
    ownerApproved: false,
    downloads: [],
    output: null,
  };
  const seen = new Set();
  const readValue = (flag, index) => {
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw new Error(`missing value for ${flag}`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--list') {
      rejectRepeatedFlag(seen, value);
      result.list = true;
    } else if (value === '--owner-approved-cc0-downloads') {
      rejectRepeatedFlag(seen, value);
      result.ownerApproved = true;
    } else if (value === '--download') {
      result.downloads.push(readValue(value, index++));
    } else if (value === '--output') {
      rejectRepeatedFlag(seen, value);
      result.output = readValue(value, index++);
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }

  if (result.list && (result.downloads.length > 0 || result.ownerApproved || result.output)) {
    throw new Error('--list cannot be combined with download arguments');
  }
  if (result.downloads.length === 0 && result.output) {
    throw new Error('--output requires at least one --download');
  }
  if (result.downloads.length === 0 && result.ownerApproved) {
    throw new Error('--owner-approved-cc0-downloads requires at least one --download');
  }
  const selectedIds = new Set();
  for (const id of result.downloads) {
    if (selectedIds.has(id)) throw new Error(`duplicate CC0 audio pack: ${id}`);
    selectedIds.add(id);
  }
  return result;
}

function rejectRepeatedFlag(seen, flag) {
  if (seen.has(flag)) throw new Error(`repeated argument: ${flag}`);
  seen.add(flag);
}

function listReport() {
  return {
    schema: 1,
    notice:
      'Listing is read-only. A download still requires explicit owner approval outside this script.',
    packs: AUDIO_PACKS,
  };
}

function packById(id) {
  const pack = AUDIO_PACKS.find((candidate) => candidate.id === id);
  if (pack === undefined) throw new Error(`unknown CC0 audio pack: ${id}`);
  return pack;
}

function validatePack(pack) {
  if (pack === null || typeof pack !== 'object') throw new Error('invalid pack');
  if (!AUDIO_PACKS.includes(pack)) throw new Error('pack is not from the fixed manifest');
  if (pack.license !== 'CC0-1.0') {
    throw new Error(`unsupported audio license for ${pack.id}`);
  }
  if (!/^[a-z0-9-]+\.zip$/.test(pack.archiveName)) {
    throw new Error(`unsafe archive name for ${pack.id}: ${pack.archiveName}`);
  }
  validateSourceUrl(pack.pageUrl, pack.id, 'source page');
  validateSourceUrl(pack.downloadUrl, pack.id, 'download');
}

function validateSourceUrl(rawUrl, packId, label) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`invalid ${label} URL for ${packId}`);
  }
  if (url.protocol !== 'https:' || url.hostname !== 'opengameart.org') {
    throw new Error(`unapproved ${label} host for ${packId}: ${url.href}`);
  }
  return url.href;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function createOutputDirectory(requestedOutput) {
  const repository = realpathSync.native(REPOSITORY_ROOT);
  const requested = requestedOutput
    ? path.resolve(requestedOutput)
    : path.join(tmpdir(), `terrilives-cc0-audio-intake-${randomUUID()}`);
  const parent = realpathSync.native(path.dirname(requested));
  const output = path.join(parent, path.basename(requested));

  if (isWithin(repository, output)) {
    throw new Error(`output must remain outside the repository: ${output}`);
  }
  if (existsSync(output)) {
    throw new Error(`output path must not already exist: ${output}`);
  }
  mkdirSync(output);
  return output;
}

function manifestPathFor(output) {
  return path.join(output, 'intake-manifest.json');
}

function writeManifest(output, manifest, create = false) {
  writeFileSync(manifestPathFor(output), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: create ? 'wx' : 'w',
  });
}

async function readBodyWithLimit(response, packId) {
  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader !== null) {
    const declaredLength = Number(lengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new Error(`invalid Content-Length for ${packId}: ${lengthHeader}`);
    }
    if (declaredLength > MAX_ARCHIVE_BYTES) {
      throw new Error(`archive exceeds ${MAX_ARCHIVE_BYTES} byte limit for ${packId}`);
    }
  }

  if (response.body === null) throw new Error(`download was empty for ${packId}`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > MAX_ARCHIVE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`archive exceeds ${MAX_ARCHIVE_BYTES} byte limit for ${packId}`);
    }
    chunks.push(chunk);
  }
  if (total === 0) throw new Error(`download was empty for ${packId}`);
  return Buffer.concat(chunks, total);
}

function validateZipSignature(bytes, packId) {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`download is not a ZIP archive for ${packId}`);
  }
  const signature = (bytes[2] << 8) | bytes[3];
  if (signature !== 0x0304 && signature !== 0x0506 && signature !== 0x0708) {
    throw new Error(`download has an unsupported ZIP signature for ${packId}`);
  }
}

async function downloadPack(pack, output, fetcher) {
  validatePack(pack);
  const archivePath = path.join(output, pack.archiveName);
  const partPath = `${archivePath}.part`;
  if (existsSync(archivePath)) {
    throw new Error(`refusing to overwrite existing archive: ${archivePath}`);
  }
  if (existsSync(partPath)) {
    throw new Error(`refusing to overwrite existing partial archive: ${partPath}`);
  }

  try {
    const response = await fetcher(pack.downloadUrl, { redirect: 'follow' });
    if (!response || typeof response !== 'object' || !response.headers) {
      throw new Error(`invalid download response for ${pack.id}`);
    }
    if (!response.ok) {
      throw new Error(`download failed for ${pack.id}: HTTP ${response.status}`);
    }
    const responseUrl = validateSourceUrl(response.url, pack.id, 'download response');
    const contentType = (response.headers.get('content-type') ?? '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (!APPROVED_CONTENT_TYPES.has(contentType)) {
      throw new Error(`unexpected Content-Type for ${pack.id}: ${contentType || '(missing)'}`);
    }

    const bytes = await readBodyWithLimit(response, pack.id);
    validateZipSignature(bytes, pack.id);
    writeFileSync(partPath, bytes, { flag: 'wx' });
    copyFileSync(partPath, archivePath, fsConstants.COPYFILE_EXCL);
    rmSync(partPath, { force: true });
    return {
      ...pack,
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      retrievedAt: new Date().toISOString(),
      responseUrl,
    };
  } catch (error) {
    if (existsSync(partPath)) rmSync(partPath, { force: true });
    throw error;
  }
}

async function runCli(argv, dependencies = {}) {
  const args = parseArgs(argv);
  if (args.list || args.downloads.length === 0) return listReport();

  const selected = args.downloads.map(packById);
  if (!args.ownerApproved) {
    throw new Error('downloads require --owner-approved-cc0-downloads');
  }
  if (typeof dependencies.fetcher !== 'function') {
    throw new Error('a fetch dependency is required for approved downloads');
  }

  const output = createOutputDirectory(args.output);
  const manifest = {
    schema: 1,
    status: 'downloading',
    generatedAt: new Date().toISOString(),
    outputDirectory: output,
    requestedPackIds: selected.map((pack) => pack.id),
    records: [],
  };
  writeManifest(output, manifest, true);

  let activePackId = null;
  try {
    for (const pack of selected) {
      activePackId = pack.id;
      manifest.records.push(await downloadPack(pack, output, dependencies.fetcher));
      writeManifest(output, manifest);
    }
    manifest.status = 'complete';
    manifest.completedAt = new Date().toISOString();
    activePackId = null;
    writeManifest(output, manifest);
    return {
      output,
      manifestPath: manifestPathFor(output),
      records: manifest.records,
    };
  } catch (error) {
    manifest.status = 'failed';
    manifest.failedAt = new Date().toISOString();
    manifest.failure = {
      packId: activePackId,
      message: error instanceof Error ? error.message : String(error),
    };
    writeManifest(output, manifest);
    throw error;
  }
}

async function main() {
  const report = await runCli(process.argv.slice(2), { fetcher: fetch });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { AUDIO_PACKS, listReport, parseArgs, runCli };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
