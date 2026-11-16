// The character renderer's allocation per frame, measured with the [V11]
// procedure of docs/gpu-verification.md: a sampling heap profile with both
// garbage-collection inclusion flags, a 6-second warm-up and a 20-second
// window, attributed by function.
//
//   node scripts/character-allocation-proof.cjs --url U [--stress N] [--speed S]
//     [--sampling-interval B] [--warmup-ms M] [--window-ms M] [--windows W]
//     [--ready-timeout-ms M] [--budget-bytes-per-frame B] [--output F]
//     [--profile-dir D]
//
// Point --url at a production bundle built with `--minify false --sourcemap`
// so function names survive and frames map back to their source modules. A
// minified bundle still measures the totals; its attribution names minified
// functions.
//
// Frames are counted with the page's own requestAnimationFrame, a platform
// global ([L20] rule 1). The character world's frame probe, when the build
// has one, records which clips were displayed, because a pose clip that is
// absent from the window cannot be charged with anything.
//
// With --budget-bytes-per-frame, the run fails when the bytes sampled in
// character modules (`src/render/character/`) exceed that budget per frame
// in any window. The check needs the source map; without one it fails
// rather than passing an unattributed profile.
//
// Every page runs with `audio=0` and Chrome's `--mute-audio`, so a proof
// never plays sound. The browser closes in a finally block.

const fs = require('node:fs');
const path = require('node:path');
const { launchDisplayedChrome, loadPlaywright } = require('./lib/browser-frame-gate.cjs');

const DEFAULTS = {
  url: null,
  stress: 0,
  speed: 3,
  samplingInterval: 32_768,
  warmupMs: 6_000,
  windowMs: 20_000,
  windows: 1,
  readyTimeoutMs: 300_000,
  budgetBytesPerFrame: null,
  output: null,
  profileDir: null,
};

const CHARACTER_SOURCE = /(?:^|\/)src\/render\/character\//;

function parseArgs(argv) {
  const result = { ...DEFAULTS };
  const readValue = (flag, index) => {
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw new Error(`missing value for ${flag}`);
    }
    return value;
  };
  const readCount = (flag, index, minimum) => {
    const value = Number(readValue(flag, index));
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`${flag} must be an integer of at least ${minimum}`);
    }
    return value;
  };
  const counts = {
    '--stress': ['stress', 0],
    '--speed': ['speed', 0],
    '--sampling-interval': ['samplingInterval', 1],
    '--warmup-ms': ['warmupMs', 0],
    '--window-ms': ['windowMs', 1],
    '--windows': ['windows', 1],
    '--ready-timeout-ms': ['readyTimeoutMs', 1],
    '--budget-bytes-per-frame': ['budgetBytesPerFrame', 0],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--url') result.url = readValue(flag, index++);
    else if (flag === '--output') result.output = readValue(flag, index++);
    else if (flag === '--profile-dir') result.profileDir = readValue(flag, index++);
    else if (Object.hasOwn(counts, flag)) {
      const [key, minimum] = counts[flag];
      result[key] = readCount(flag, index++, minimum);
    } else throw new Error(`unknown argument: ${flag}`);
  }
  if (result.url === null) throw new Error('--url is required');
  if (![0, 1, 2, 3].includes(result.speed)) throw new Error('--speed must be 0, 1, 2 or 3');
  return result;
}

function withQuery(baseUrl, stress) {
  const url = new URL(baseUrl);
  url.searchParams.set('stress', String(stress));
  url.searchParams.set('audio', '0');
  return url.toString();
}

/**
 * Maps a profile frame to its source position. `resolve(url, line, column)`
 * returns `{ source, line }` or null; line and column are the profile's
 * zero-based values.
 */
function sourceKey(callFrame, resolve) {
  const name = callFrame.functionName || '(anonymous)';
  const mapped = resolve === null ? null : resolve(callFrame.url, callFrame.lineNumber, callFrame.columnNumber);
  if (mapped !== null) return { key: `${name} ${mapped.source}:${mapped.line}`, source: mapped.source };
  const short = callFrame.url.replace(/^.*\/(assets|src|node_modules)\//, '$1/');
  return { key: `${name} ${short}:${callFrame.lineNumber + 1}`, source: null };
}

/**
 * Sums the sampled bytes per function, and the bytes whose frame maps to a
 * character renderer module. `mapped` counts the bytes whose frame had a
 * source position, so a profile without a source map is recognisable.
 */
function attributeAllocation(profile, resolve = null) {
  const byFunction = new Map();
  let total = 0;
  let character = 0;
  let mapped = 0;
  const visit = (node) => {
    if (node.selfSize > 0) {
      const { key, source } = sourceKey(node.callFrame, resolve);
      total += node.selfSize;
      if (source !== null) mapped += node.selfSize;
      const isCharacter = source !== null && CHARACTER_SOURCE.test(source);
      if (isCharacter) character += node.selfSize;
      const entry = byFunction.get(key) ?? { function: key, bytes: 0, character: isCharacter };
      entry.bytes += node.selfSize;
      byFunction.set(key, entry);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(profile.head);
  const functions = [...byFunction.values()].sort((left, right) => right.bytes - left.bytes);
  return {
    totalBytes: total,
    characterBytes: character,
    mappedBytes: mapped,
    topFunctions: functions.slice(0, 25),
  };
}

/** Per-frame figures for one window, and the budget verdict when one is set. */
function analyseWindow(window, budgetBytesPerFrame) {
  const frames = window.frames;
  const perFrame = (bytes) => (frames > 0 ? bytes / frames : null);
  const analysis = {
    totalBytesPerFrame: perFrame(window.totalBytes),
    characterBytesPerFrame: perFrame(window.characterBytes),
    checks: {
      framesRan: frames > 0 && window.visibility === 'visible',
    },
  };
  if (budgetBytesPerFrame !== null) {
    analysis.checks.attributed = window.totalBytes === 0 || window.mappedBytes > 0;
    analysis.checks.characterWithinBudget =
      analysis.characterBytesPerFrame !== null && analysis.characterBytesPerFrame <= budgetBytesPerFrame;
  }
  analysis.pass = Object.values(analysis.checks).every(Boolean);
  return analysis;
}

/** Reads the bundle's source maps through the server that serves them. */
async function sourceMapResolver(page) {
  let consumerClass;
  try {
    ({ SourceMapConsumer: consumerClass } = require(path.join(__dirname, '..', 'web', 'node_modules', 'source-map-js')));
  } catch {
    return null;
  }
  const scripts = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /\.js(?:\?|$)/.test(name)),
  );
  const consumers = new Map();
  for (const script of new Set(scripts)) {
    const response = await page.request.get(`${script.replace(/\?.*$/, '')}.map`).catch(() => null);
    if (response === null || !response.ok()) continue;
    // A preview server answers a missing map with its HTML page.
    let map;
    try {
      map = JSON.parse(await response.text());
    } catch {
      continue;
    }
    consumers.set(script, new consumerClass(map));
  }
  if (consumers.size === 0) return null;
  return (url, line, column) => {
    const consumer = consumers.get(url);
    if (consumer === undefined) return null;
    const position = consumer.originalPositionFor({ line: line + 1, column: Math.max(0, column) });
    if (position.source === null) return null;
    return { source: position.source.replace(/^(\.\.\/)+/, '').replace(/^web\//, ''), line: position.line };
  };
}

/** Counts frames and samples the displayed clips once a second, in the page. */
function startPageCounters() {
  const stress = globalThis.__terriStress;
  const counts = { frames: 0, clips: {}, maxCharacters: 0, probeError: null };
  let running = true;
  let lastProbe = -Infinity;
  const probe = stress?.characters?.probeFrame;
  // The probe fills preallocated slots and refuses a target with too few.
  const target = { count: 0, hasView: false, originX: 0, originY: 0, scale: 0, width: 0, height: 0, actors: [] };
  for (let slot = 0; slot < 2048; slot += 1) {
    target.actors.push({ entity: 0, sim: 0, clip: '', sample: 0, resourceId: 0, bodyCompactions: 0, bodyShapeChanges: 0, attachmentChanges: 0 });
  }
  const frame = (timestamp) => {
    if (!running) return;
    counts.frames += 1;
    requestAnimationFrame(frame);
    if (probe === undefined || counts.probeError !== null || timestamp - lastProbe < 1_000) return;
    lastProbe = timestamp;
    try {
      probe(target);
    } catch (error) {
      counts.probeError = String(error);
      return;
    }
    counts.maxCharacters = Math.max(counts.maxCharacters, target.count);
    for (let index = 0; index < target.count; index += 1) {
      const clip = target.actors[index].clip;
      counts.clips[clip] = (counts.clips[clip] ?? 0) + 1;
    }
  };
  requestAnimationFrame(frame);
  globalThis.__characterAllocation = {
    stop() {
      running = false;
      return counts;
    },
  };
}

async function sampleWindow(page, cdp, args, resolve, index) {
  await page.evaluate(startPageCounters);
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: args.samplingInterval,
    includeObjectsCollectedByMinorGC: true,
    includeObjectsCollectedByMajorGC: true,
  });
  const startTick = await page.evaluate(() => globalThis.__terriStress.sim.clockTick());
  await page.waitForTimeout(args.windowMs);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const counts = await page.evaluate(() => globalThis.__characterAllocation.stop());
  const endTick = await page.evaluate(() => globalThis.__terriStress.sim.clockTick());
  const visibility = await page.evaluate(() => document.visibilityState);
  const heap = await cdp.send('Runtime.getHeapUsage');
  if (args.profileDir !== null) {
    // The raw profile, for inclusive attribution by caller.
    fs.mkdirSync(args.profileDir, { recursive: true });
    fs.writeFileSync(path.join(args.profileDir, `window-${index}.heapprofile`), JSON.stringify(profile));
  }
  const window = {
    visibility,
    ticks: endTick - startTick,
    ...counts,
    jsUsedBytesAfter: heap.usedSize,
    ...attributeAllocation(profile, resolve),
  };
  return { ...window, analysis: analyseWindow(window, args.budgetBytesPerFrame) };
}

async function closeHelpAndSetSpeed(page, speed) {
  const close = page.locator('#close-help');
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.evaluate((multiplier) => {
    const input = document.querySelector(`#speed-${multiplier}`);
    if (!(input instanceof HTMLInputElement)) throw new Error(`missing #speed-${multiplier} input`);
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, speed);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();
  const browser = await launchDisplayedChrome(chromium, ['--mute-audio']);
  const report = { mode: 'character-allocation', generatedAt: new Date().toISOString(), args, windows: [] };
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const startedMs = Date.now();
    await page.goto(withQuery(args.url, args.stress), { waitUntil: 'load' });
    await page.bringToFront();
    await page.waitForFunction(() => globalThis.__terriStress !== undefined, undefined, {
      polling: 500,
      timeout: args.readyTimeoutMs,
    });
    report.readyMs = Date.now() - startedMs;
    report.entities = await page.evaluate(() => globalThis.__terriStress.entities);
    report.scripts = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /\.js(?:\?|$)/.test(name)),
    );
    await closeHelpAndSetSpeed(page, args.speed);
    const resolve = await sourceMapResolver(page);
    report.sourceMapped = resolve !== null;
    const cdp = await context.newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    await page.waitForTimeout(args.warmupMs);
    for (let index = 0; index < args.windows; index += 1) {
      report.windows.push(await sampleWindow(page, cdp, args, resolve, index));
    }
    await context.close();
  } finally {
    await browser.close();
  }
  report.pass = report.windows.every((window) => window.analysis.pass);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output !== null) fs.writeFileSync(args.output, json, 'utf8');
  process.stdout.write(json);
  if (!report.pass) process.exitCode = 1;
}

module.exports = { analyseWindow, attributeAllocation, parseArgs, sourceKey, withQuery };

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
