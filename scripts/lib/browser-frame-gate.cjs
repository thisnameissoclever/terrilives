// Shared helpers for the release frame-time gate in docs/ARCHITECTURE.md:
// a displayed production build, a calibrated display, `?stress=N`, a fixed
// tick window with warm-up ticks discarded, and per-frame work samples read
// from the page's `__terriStress` handle. Used by
// scripts/audio-browser-proof.cjs and scripts/activity-log-proof.cjs.

const fs = require('node:fs');
const path = require('node:path');

/** Ticks one measurement runs, and the leading ticks it discards. */
const FIXED_TICKS = 600;
const WARMUP_TICKS = 60;

/** The calibrated display the gate requires: 118 to 122 Hz, median interval 8.0 to 8.7 ms. */
const CALIBRATION = { minHz: 118, maxHz: 122, minMedianMs: 8.0, maxMedianMs: 8.7 };

/** Every application-work frame must fit one 60 Hz frame. */
const FRAME_BUDGET_MS = 16.6;

function loadPlaywright() {
  const configured = process.env.TERRILIVES_PLAYWRIGHT_CORE;
  const globalRoot = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules');
  const candidates = [
    configured,
    path.join(globalRoot, '@playwright', 'cli', 'node_modules', 'playwright-core'),
    path.join(globalRoot, 'playwright-core'),
  ].filter(Boolean);
  const found = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'package.json')),
  );
  if (found === undefined) {
    throw new Error(
      'Playwright Core was not found. Install the existing Codex Playwright CLI or set TERRILIVES_PLAYWRIGHT_CORE.',
    );
  }
  return require(found);
}

/**
 * A displayed Chrome window at the gate's 1400 by 900 size. `extraArgs`
 * appends switches, such as `--mute-audio`, after the shared ones.
 */
function launchDisplayedChrome(chromium, extraArgs = []) {
  return chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--window-position=0,0',
      '--window-size=1400,900',
      '--enable-blink-features=ForceEagerMeasureMemory',
      ...extraArgs,
    ],
  });
}

async function waitForStress(page, entities = 1037) {
  await page.waitForFunction(
    (expected) => globalThis.__terriStress?.entities === expected,
    entities,
    { polling: 100, timeout: 60_000 },
  );
}

async function closeHelpAndSetThreeTimes(page) {
  const close = page.locator('#close-help');
  if (await close.isVisible()) await close.click();
  // Always deliver a real gesture, even when first-run Help is already closed.
  await page.locator('#options-toggle').click();
  await page.locator('#options-close').click();
  await setSpeed(page, 3);
  await page.waitForTimeout(250);
}

async function setSpeed(page, multiplier) {
  await page.evaluate((multiplier) => {
    const speed = document.querySelector(`#speed-${multiplier}`);
    if (!(speed instanceof HTMLInputElement)) {
      throw new Error(`missing #speed-${multiplier} input`);
    }
    speed.checked = true;
    speed.dispatchEvent(new Event('change', { bubbles: true }));
  }, multiplier);
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function stats(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Five seconds of animation-frame intervals, before the game is unpaused. */
async function calibrateRefresh(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const intervals = [];
        let first = null;
        let previous = null;
        function frame(timestamp) {
          if (first === null) first = timestamp;
          if (previous !== null) intervals.push(timestamp - previous);
          previous = timestamp;
          if (timestamp - first >= 5_000) {
            resolve({ durationMs: timestamp - first, intervals });
            return;
          }
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }),
  );
}

/** The calibration's achieved rate and interval statistics. */
function summarizeCalibration(raw) {
  return {
    achievedHz: (raw.intervals.length * 1_000) / raw.durationMs,
    ...stats(raw.intervals),
  };
}

/** True when the calibration meets the gate's rate and median interval. */
function calibrationPasses(calibration) {
  return (
    calibration.achievedHz >= CALIBRATION.minHz &&
    calibration.achievedHz <= CALIBRATION.maxHz &&
    calibration.p50 >= CALIBRATION.minMedianMs &&
    calibration.p50 <= CALIBRATION.maxMedianMs
  );
}

/**
 * Lets `warmupTicks` pass, then records every frame until `retainedTicks`
 * more have run: the animation-frame interval, the application work the
 * page's `timer` samples, `simIdOf` calls, and every sample of each
 * `recorded` sampler. A recorded entry may name a `counter`, a dotted path
 * on the stress handle read beside each sample. Each `rings` sampler's own
 * rolling statistics are read at the end.
 */
async function measureFixedTicks(page, { warmupTicks, retainedTicks, recorded = [], rings = [] }) {
  return page.evaluate(
    async ({ warmupTicks, retainedTicks, recorded, rings }) => {
      const stress = globalThis.__terriStress;
      if (stress === undefined) throw new Error('stress handle disappeared');

      const warmupStart = stress.sim.clockTick();
      await new Promise((resolve) => {
        const check = () => {
          if (stress.sim.clockTick() - warmupStart >= warmupTicks) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });

      const work = [];
      const intervals = [];
      const timer = stress.timer;
      const originalSample = timer.sample.bind(timer);
      timer.sample = (elapsedMs) => {
        work.push(elapsedMs);
        originalSample(elapsedMs);
      };
      let simIdOfCalls = 0;
      const originalSimIdOf = stress.sim.simIdOf.bind(stress.sim);
      stress.sim.simIdOf = (...args) => {
        simIdOfCalls += 1;
        return originalSimIdOf(...args);
      };
      const read = (dotted) => dotted.split('.').reduce((value, key) => value[key], stress);
      const recordedSamples = {};
      const restores = [];
      for (const { name, counter } of recorded) {
        const sampler = stress[name];
        if (sampler === undefined) throw new Error(`missing stress sampler ${name}`);
        const original = sampler.sample.bind(sampler);
        const samples = { values: [], counters: counter === undefined ? null : [] };
        recordedSamples[name] = samples;
        sampler.sample = (elapsedMs) => {
          samples.values.push(elapsedMs);
          if (samples.counters !== null) samples.counters.push(read(counter));
          original(elapsedMs);
        };
        restores.push(() => {
          sampler.sample = original;
        });
      }

      const startTick = stress.sim.clockTick();
      let firstTimestamp = null;
      let previousTimestamp = null;
      try {
        await new Promise((resolve) => {
          const collect = (timestamp) => {
            if (firstTimestamp === null) firstTimestamp = timestamp;
            if (previousTimestamp !== null) {
              intervals.push(timestamp - previousTimestamp);
            }
            previousTimestamp = timestamp;
            if (stress.sim.clockTick() - startTick >= retainedTicks) resolve();
            else requestAnimationFrame(collect);
          };
          requestAnimationFrame(collect);
        });
      } finally {
        timer.sample = originalSample;
        stress.sim.simIdOf = originalSimIdOf;
        for (const restore of restores) restore();
      }

      const ringStats = {};
      for (const name of rings) {
        const ring = stress[name];
        ringStats[name] = {
          frames: ring.frames,
          window: ring.windowSize,
          mean: ring.mean,
          p95: ring.p95,
          max: ring.max,
        };
      }
      return {
        entities: stress.entities,
        fixedTicks: stress.sim.clockTick() - startTick,
        durationMs: previousTimestamp - firstTimestamp,
        intervals,
        work,
        simIdOfCalls,
        recorded: recordedSamples,
        rings: ringStats,
      };
    },
    { warmupTicks, retainedTicks, recorded, rings },
  );
}

/** Frame cadence and application work over one measured window. */
function summarizeWindow(result) {
  return {
    entities: result.entities,
    fixedTicks: result.fixedTicks,
    achievedHz: (result.intervals.length * 1_000) / result.durationMs,
    intervals: stats(result.intervals),
    framesOver16_6Ms: result.intervals.filter((value) => value > FRAME_BUDGET_MS).length,
    work: stats(result.work),
    workFramesOver16_6Ms: result.work.filter((value) => value > FRAME_BUDGET_MS).length,
    simIdOfCalls: result.simIdOfCalls,
  };
}

module.exports = {
  CALIBRATION,
  FIXED_TICKS,
  FRAME_BUDGET_MS,
  WARMUP_TICKS,
  calibrateRefresh,
  calibrationPasses,
  closeHelpAndSetThreeTimes,
  launchDisplayedChrome,
  loadPlaywright,
  measureFixedTicks,
  median,
  percentile,
  setSpeed,
  stats,
  summarizeCalibration,
  summarizeWindow,
  waitForStress,
};
