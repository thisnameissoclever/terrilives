// How long a stress page takes to start, and where the time goes: a CPU
// profile from navigation until the character world displays every
// housemate and filler agent, attributed by function.
//
//   node scripts/character-startup-proof.cjs --url U [--stress N] [--timeout-ms M]
//     [--sampling-us U] [--output F] [--profile F]
//
// Point --url at a production bundle built with `--minify false --sourcemap`
// so frames map back to their source modules. `readyMs` is when the stress
// handle appears; `displayedMs` is when the character world first displays
// `expected` characters, the household plus one per filler agent. Inclusive
// time counts each function once per sampled stack.
//
// The page runs with `audio=0` and Chrome's `--mute-audio`; the browser
// closes in a finally block.

const fs = require('node:fs');
const path = require('node:path');
const { launchDisplayedChrome, loadPlaywright } = require('./lib/browser-frame-gate.cjs');

function parseArgs(argv) {
  const result = { url: null, stress: 0, timeoutMs: 600_000, samplingUs: 1_000, output: null, profile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    if (flag === '--url') result.url = value;
    else if (flag === '--output') result.output = value;
    else if (flag === '--profile') result.profile = value;
    else if (flag === '--stress' || flag === '--timeout-ms' || flag === '--sampling-us') {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${flag} must be a non-negative integer`);
      result[{ '--stress': 'stress', '--timeout-ms': 'timeoutMs', '--sampling-us': 'samplingUs' }[flag]] = number;
    } else throw new Error(`unknown argument: ${flag}`);
    index += 1;
  }
  if (result.url === null) throw new Error('--url is required');
  return result;
}

/** Maps a profile frame to `source:line` through the bundle's source maps, fetched from the page's server. */
async function resolver(page, urls) {
  let consumerClass;
  try {
    ({ SourceMapConsumer: consumerClass } = require(path.join(__dirname, '..', 'web', 'node_modules', 'source-map-js')));
  } catch {
    return () => null;
  }
  const consumers = new Map();
  for (const url of urls) {
    const response = await page.request.get(`${url.replace(/\?.*$/, '')}.map`).catch(() => null);
    if (response === null || !response.ok()) continue;
    try {
      consumers.set(url, new consumerClass(JSON.parse(await response.text())));
    } catch {
      // A preview server answers a missing map with its HTML page.
    }
  }
  return (frame) => {
    const consumer = consumers.get(frame.url);
    if (consumer === undefined) return null;
    const position = consumer.originalPositionFor({ line: frame.lineNumber + 1, column: Math.max(0, frame.columnNumber) });
    return position.source === null ? null : `${position.source.replace(/^.*\/src\//, 'src/')}:${position.line}`;
  };
}

/** Self and inclusive milliseconds per function from a CPU profile. */
function attributeTime(profile, resolve) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const keys = new Map();
  const keyOf = (node) => {
    if (!keys.has(node.id)) {
      const frame = node.callFrame;
      keys.set(node.id, `${frame.functionName || '(anonymous)'} ${resolve(frame) ?? `${frame.url.replace(/^.*\//, '')}:${frame.lineNumber + 1}`}`);
    }
    return keys.get(node.id);
  };
  const self = new Map();
  const inclusive = new Map();
  const deltas = profile.timeDeltas;
  for (let index = 0; index < profile.samples.length; index += 1) {
    const ms = (deltas[index + 1] ?? 0) / 1000;
    let id = profile.samples[index];
    const seen = new Set();
    const leaf = keyOf(nodes.get(id));
    self.set(leaf, (self.get(leaf) ?? 0) + ms);
    while (id !== undefined) {
      const key = keyOf(nodes.get(id));
      if (!seen.has(key)) {
        seen.add(key);
        inclusive.set(key, (inclusive.get(key) ?? 0) + ms);
      }
      id = parents.get(id);
    }
  }
  const top = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([fn, ms]) => ({ function: fn, ms: Math.round(ms) }));
  return { self: top(self), inclusive: top(inclusive) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();
  const browser = await launchDisplayedChrome(chromium, ['--mute-audio']);
  const report = { mode: 'character-startup', generatedAt: new Date().toISOString(), args };
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: args.samplingUs });
    await cdp.send('Profiler.start');
    const url = new URL(args.url);
    url.searchParams.set('stress', String(args.stress));
    url.searchParams.set('audio', '0');
    const started = Date.now();
    await page.goto(url.toString(), { waitUntil: 'load' });
    await page.bringToFront();
    await page.waitForFunction(() => globalThis.__terriStress !== undefined, undefined, { polling: 100, timeout: args.timeoutMs });
    report.readyMs = Date.now() - started;
    report.entities = await page.evaluate(() => globalThis.__terriStress.entities);
    // Every agent with an appearance record, the household and the fillers alike, is drawn as a character.
    report.expected = await page.evaluate(() => globalThis.__terriStress.sim.characterAppearances?.().length ?? null);
    const remaining = Math.max(1, args.timeoutMs - report.readyMs);
    report.displayed = await page.evaluate(
      ({ expected, remaining }) =>
        new Promise((resolve) => {
          const probe = globalThis.__terriStress.characters?.probeFrame;
          const target = { count: 0, hasView: false, originX: 0, originY: 0, scale: 0, width: 0, height: 0, actors: [] };
          for (let slot = 0; slot < 12_000; slot += 1) target.actors.push({ entity: 0, sim: 0, clip: '', sample: 0, resourceId: 0, bodyCompactions: 0, bodyShapeChanges: 0, attachmentChanges: 0 });
          const begun = performance.now();
          const frame = () => {
            if (probe !== undefined) probe(target);
            if (probe === undefined || (expected !== null && target.count >= expected) || performance.now() - begun > remaining) {
              resolve({ count: target.count, msAfterReady: Math.round(performance.now() - begun) });
              return;
            }
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }),
      { expected: report.expected, remaining },
    );
    report.displayedMs = report.readyMs + report.displayed.msAfterReady;
    const { profile } = await cdp.send('Profiler.stop');
    if (args.profile !== null) fs.writeFileSync(args.profile, JSON.stringify(profile));
    const scripts = [...new Set(profile.nodes.map((node) => node.callFrame.url).filter((name) => /\.js(?:\?|$)/.test(name)))];
    report.time = attributeTime(profile, await resolver(page, scripts));
    report.pass = report.expected !== null && report.displayed.count >= report.expected;
    report.crashed = false;
    await context.close();
  } finally {
    await browser.close();
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output !== null) fs.writeFileSync(args.output, json, 'utf8');
  process.stdout.write(json);
  if (!report.pass) process.exitCode = 1;
}

module.exports = { attributeTime, parseArgs };

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
