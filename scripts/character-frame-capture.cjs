// Captures the same game frames from a build, so two builds' drawings can be
// compared pixel for pixel.
//
//   node scripts/character-frame-capture.cjs --url U --out DIR [--stress N] [--frames A,B,C]
//
// The page's clock and entropy are replaced before any script runs:
// `performance.now` and `requestAnimationFrame` follow a fabricated time that
// stays still while the page loads and then advances 1000/60 ms per pumped
// frame, and `crypto.getRandomValues` returns a fixed sequence, so the new
// game starts from the same seed. The simulation is deterministic for a given
// seed and tick sequence, so two builds pumped the same frames draw the same
// world at the same animation phases. Each listed frame
// count is saved as `frame-<count>.png`, a 1400 by 900 page screenshot.
//
// The page runs with `audio=0` and Chrome's `--mute-audio`; the browser
// closes in a finally block.

const fs = require('node:fs');
const path = require('node:path');
const { launchDisplayedChrome, loadPlaywright } = require('./lib/browser-frame-gate.cjs');

const FRAME_MS = 1000 / 60;

function parseArgs(argv) {
  const result = { url: null, out: null, stress: 0, frames: [120, 360, 720] };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    if (flag === '--url') result.url = value;
    else if (flag === '--out') result.out = value;
    else if (flag === '--stress') result.stress = Number(value);
    else if (flag === '--frames') result.frames = value.split(',').map(Number);
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (result.url === null || result.out === null) throw new Error('--url and --out are required');
  if (!result.frames.every((frame, index) => Number.isSafeInteger(frame) && frame > 0 && (index === 0 || frame > result.frames[index - 1]))) {
    throw new Error('--frames must be increasing positive integers');
  }
  return result;
}

/** Installed before the page's scripts: a clock that moves only when the harness pumps a frame, and fixed entropy. */
function installClock() {
  let now = 0;
  let entropy = 305;
  crypto.getRandomValues = (array) => {
    for (let index = 0; index < array.length; index += 1) {
      entropy = (Math.imul(entropy, 1664525) + 1013904223) >>> 0;
      array[index] = entropy;
    }
    return array;
  };
  let queue = [];
  let ids = 0;
  performance.now = () => now;
  window.requestAnimationFrame = (callback) => {
    queue.push(callback);
    return ++ids;
  };
  window.cancelAnimationFrame = () => {};
  globalThis.__pumpFrames = (count, stepMs) => {
    for (let frame = 0; frame < count; frame += 1) {
      now += stepMs;
      const callbacks = queue;
      queue = [];
      for (const callback of callbacks) callback(now);
    }
    return now;
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await launchDisplayedChrome(chromium, ['--mute-audio']);
  const report = { url: args.url, stress: args.stress, frames: [] };
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await context.addInitScript(installClock);
    const page = await context.newPage();
    const url = new URL(args.url);
    url.searchParams.set('stress', String(args.stress));
    url.searchParams.set('audio', '0');
    await page.goto(url.toString(), { waitUntil: 'load' });
    // Startup frames run at a standing clock until the game loop exists.
    const started = Date.now();
    while (!(await page.evaluate(() => globalThis.__pumpFrames(1, 0) >= 0 && globalThis.__terriStress !== undefined))) {
      if (Date.now() - started > 300_000) throw new Error('the stress handle did not appear');
      await page.waitForTimeout(20);
    }
    const close = page.locator('#close-help');
    if (await close.isVisible().catch(() => false)) await close.click();
    let pumped = 0;
    for (const target of args.frames) {
      while (pumped < target) {
        const count = Math.min(30, target - pumped);
        await page.evaluate(([frames, stepMs]) => globalThis.__pumpFrames(frames, stepMs), [count, FRAME_MS]);
        pumped += count;
      }
      const tick = await page.evaluate(() => globalThis.__terriStress.sim.clockTick());
      const file = path.join(args.out, `frame-${target}.png`);
      await page.screenshot({ path: file });
      report.frames.push({ frame: target, tick, file });
    }
    report.scripts = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /index-[^/]*\.js$/.test(name)));
    await context.close();
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(args.out, 'capture.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
