const fs = require('node:fs');
const path = require('node:path');

const FIXED_TICKS = 600;
const WARMUP_TICKS = 60;
const MEMORY_STEP_TICKS = 60;
const AUDIO_RETAINED_ALLOWANCE_BYTES = 64 * 1024;

function parseArgs(argv) {
  const result = {
    mode: 'performance',
    url: 'http://127.0.0.1:4173/',
    output: null,
  };
  const readValue = (flag, index) => {
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw new Error(`missing value for ${flag}`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === 'performance' || value === 'memory' || value === 'scheduler') {
      result.mode = value;
    } else if (value === '--url') {
      result.url = readValue(value, index++);
    } else if (value === '--output') {
      result.output = readValue(value, index++);
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return result;
}

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

function withQuery(baseUrl, audioEnabled) {
  const url = new URL(baseUrl);
  url.searchParams.set('stress', '1000');
  if (!audioEnabled) url.searchParams.set('audio', '0');
  return url.toString();
}

async function waitForStress(page) {
  await page.waitForFunction(
    () => globalThis.__terriStress?.entities === 1037,
    undefined,
    { polling: 100, timeout: 60_000 },
  );
}

async function closeHelpAndSetThreeTimes(page) {
  const close = page.locator('#close-help');
  if (await close.isVisible()) await close.click();
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

async function runPerformance(browser, baseUrl, audioEnabled) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(withQuery(baseUrl, audioEnabled), { waitUntil: 'networkidle' });
    await page.bringToFront();
    await waitForStress(page);

    const calibrationRaw = await calibrateRefresh(page);
    const calibration = stats(calibrationRaw.intervals);
    const calibrationHz =
      (calibrationRaw.intervals.length * 1_000) / calibrationRaw.durationMs;

    await closeHelpAndSetThreeTimes(page);
    const result = await page.evaluate(
      async ({ warmupTicks, retainedTicks }) => {
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
        }

        return {
          entities: stress.entities,
          fixedTicks: stress.sim.clockTick() - startTick,
          durationMs: previousTimestamp - firstTimestamp,
          intervals,
          work,
          simIdOfCalls,
          sampler: {
            frames: stress.footstepSampler.frames,
            window: stress.footstepSampler.windowSize,
            mean: stress.footstepSampler.mean,
            p95: stress.footstepSampler.p95,
            max: stress.footstepSampler.max,
          },
        };
      },
      { warmupTicks: WARMUP_TICKS, retainedTicks: FIXED_TICKS - WARMUP_TICKS },
    );

    const intervals = stats(result.intervals);
    const work = stats(result.work);
    return {
      audioEnabled,
      calibration: { achievedHz: calibrationHz, ...calibration },
      active: {
        entities: result.entities,
        fixedTicks: result.fixedTicks,
        achievedHz: (result.intervals.length * 1_000) / result.durationMs,
        intervals,
        framesOver16_6Ms: result.intervals.filter((value) => value > 16.6).length,
        work,
        workFramesOver16_6Ms: result.work.filter((value) => value > 16.6).length,
        simIdOfCalls: result.simIdOfCalls,
        sampler: result.sampler,
      },
    };
  } finally {
    await context.close();
  }
}

async function collectMemorySample(page, cdp, includePageMemory) {
  await cdp.send('HeapProfiler.collectGarbage');
  const pageMemory = await page.evaluate(async ({ enabled, timeoutMs }) => {
      if (!enabled || typeof performance.measureUserAgentSpecificMemory !== 'function') {
        return null;
      }
      return Promise.race([
        performance.measureUserAgentSpecificMemory().then((measurement) => ({
          bytes: measurement.bytes,
          timedOut: false,
        })),
        new Promise((resolve) => {
          setTimeout(() => resolve({ bytes: null, timedOut: true }), timeoutMs);
        }),
      ]);
    }, { enabled: includePageMemory, timeoutMs: 10_000 });
  // The broad page measurement can briefly create diagnostic objects of its
  // own. Collect once more before reading the retained structural counters so
  // the harness does not fail because its thermometer is still in the room.
  await cdp.send('HeapProfiler.collectGarbage');
  const [heap, dom, diagnostics] = await Promise.all([
    cdp.send('Runtime.getHeapUsage'),
    cdp.send('Memory.getDOMCounters'),
    page.evaluate(() => {
      const stress = globalThis.__terriStress;
      if (stress === undefined) throw new Error('stress handle disappeared');
      return {
        tick: stress.sim.clockTick(),
        entities: stress.entities,
        wasmMemoryBytes: stress.wasmMemoryBytes,
        activeVoices: stress.audio.activeVoices,
        footstepTracks: stress.audio.footstepTracks,
        footstepCapacity: stress.audio.footstepCapacity,
      };
    }),
  ]);
  return {
    ...diagnostics,
    jsUsedBytes: heap.usedSize,
    jsEmbedderBytes: heap.embedderHeapUsedSize,
    backingStorageBytes: heap.backingStorageSize,
    pageMemoryBytes: pageMemory?.bytes ?? null,
    pageMemoryTimedOut: pageMemory?.timedOut ?? false,
    domDocuments: dom.documents,
    domNodes: dom.nodes,
    eventListeners: dom.jsEventListeners,
  };
}

async function runMemory(browser, baseUrl, audioEnabled, repetition) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  try {
    await page.goto(withQuery(baseUrl, audioEnabled), { waitUntil: 'networkidle' });
    await page.bringToFront();
    await waitForStress(page);
    await closeHelpAndSetThreeTimes(page);

    const startTick = await page.evaluate(() => globalThis.__terriStress.sim.clockTick());
    await page.waitForFunction(
      (start) => globalThis.__terriStress.sim.clockTick() - start >= 60,
      startTick,
      { polling: 100, timeout: 30_000 },
    );

    const samples = [];
    await setSpeed(page, 0);
    await page.waitForTimeout(250);
    samples.push(await collectMemorySample(page, cdp, true));
    const baselineTick = samples[0].tick;
    await setSpeed(page, 3);
    await page.waitForTimeout(250);
    for (
      let target = MEMORY_STEP_TICKS;
      target < FIXED_TICKS - WARMUP_TICKS;
      target += MEMORY_STEP_TICKS
    ) {
      await page.waitForFunction(
        ({ baseline, delta }) => globalThis.__terriStress.sim.clockTick() - baseline >= delta,
        { baseline: baselineTick, delta: target },
        { polling: 100, timeout: 30_000 },
      );
      samples.push(await collectMemorySample(page, cdp, false));
    }
    await page.waitForFunction(
      ({ baseline, delta }) => globalThis.__terriStress.sim.clockTick() - baseline >= delta,
      { baseline: baselineTick, delta: FIXED_TICKS - WARMUP_TICKS },
      { polling: 100, timeout: 30_000 },
    );
    await setSpeed(page, 0);
    await page.waitForTimeout(250);
    samples.push(await collectMemorySample(page, cdp, true));

    return { repetition, audioEnabled, samples };
  } finally {
    await context.close();
  }
}

function growth(run, field) {
  const first = run.samples[0][field];
  const last = run.samples.at(-1)[field];
  return first === null || last === null ? null : last - first;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function analyseMemory(runs) {
  const pairs = [0, 1, 2].map((repetition) => {
    const enabled = runs.find((run) => run.repetition === repetition && run.audioEnabled);
    const disabled = runs.find((run) => run.repetition === repetition && !run.audioEnabled);
    const enabledJs = growth(enabled, 'jsUsedBytes');
    const disabledJs = growth(disabled, 'jsUsedBytes');
    return {
      repetition,
      enabledJsGrowthBytes: enabledJs,
      disabledJsGrowthBytes: disabledJs,
      audioSpecificJsGrowthBytes: enabledJs - disabledJs,
      enabledPageGrowthBytes: growth(enabled, 'pageMemoryBytes'),
      disabledPageGrowthBytes: growth(disabled, 'pageMemoryBytes'),
      enabledWasmGrowthBytes: growth(enabled, 'wasmMemoryBytes'),
      disabledWasmGrowthBytes: growth(disabled, 'wasmMemoryBytes'),
    };
  });
  const medianAudioSpecificJsGrowthBytes = median(
    pairs.map((pair) => pair.audioSpecificJsGrowthBytes),
  );
  const structuralPass = runs.every((run) => {
    const baseline = run.samples[0];
    const final = run.samples.at(-1);
    const boundedLiveState = run.samples.every(
      (sample) =>
        sample.entities === 1037 &&
        sample.wasmMemoryBytes >= 65_536 &&
        sample.footstepCapacity === baseline.footstepCapacity &&
        sample.footstepTracks <= 3 &&
        sample.activeVoices <= 8,
    );
    return (
      boundedLiveState &&
      baseline.activeVoices === 0 &&
      final.activeVoices === 0 &&
      final.domDocuments === baseline.domDocuments &&
      final.domNodes === baseline.domNodes &&
      final.eventListeners === baseline.eventListeners
    );
  });
  return {
    allowanceBytes: AUDIO_RETAINED_ALLOWANCE_BYTES,
    pairs,
    medianAudioSpecificJsGrowthBytes,
    retainedAudioPass:
      medianAudioSpecificJsGrowthBytes <= AUDIO_RETAINED_ALLOWANCE_BYTES,
    structuralPass,
  };
}

async function runScheduler(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(withQuery(baseUrl, true), { waitUntil: 'networkidle' });
    await waitForStress(page);
    return page.evaluate(() => globalThis.__terriStress.runFootstepSchedulerProbe(40, 600));
  } finally {
    await context.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--window-position=0,0',
      '--window-size=1400,900',
      '--enable-blink-features=ForceEagerMeasureMemory',
    ],
  });
  let report;
  try {
    if (args.mode === 'performance') {
      const enabled = await runPerformance(browser, args.url, true);
      const disabled = await runPerformance(browser, args.url, false);
      report = {
        mode: args.mode,
        generatedAt: new Date().toISOString(),
        enabled,
        disabled,
        p95RegressionMs: enabled.active.work.p95 - disabled.active.work.p95,
        pass:
          enabled.calibration.achievedHz >= 118 &&
          enabled.calibration.achievedHz <= 122 &&
          disabled.calibration.achievedHz >= 118 &&
          disabled.calibration.achievedHz <= 122 &&
          enabled.active.sampler.p95 <= 0.25 &&
          enabled.active.sampler.max <= 1 &&
          enabled.active.work.p95 - disabled.active.work.p95 <= 1 &&
          enabled.active.workFramesOver16_6Ms === 0 &&
          disabled.active.workFramesOver16_6Ms === 0 &&
          enabled.active.simIdOfCalls === 0 &&
          disabled.active.simIdOfCalls === 0,
      };
    } else if (args.mode === 'memory') {
      const runs = [];
      for (let repetition = 0; repetition < 3; repetition += 1) {
        const order = repetition % 2 === 0 ? [true, false] : [false, true];
        for (const audioEnabled of order) {
          runs.push(await runMemory(browser, args.url, audioEnabled, repetition));
        }
      }
      report = {
        mode: args.mode,
        generatedAt: new Date().toISOString(),
        contract: {
          repetitions: 3,
          warmupTicks: WARMUP_TICKS,
          measuredTicks: FIXED_TICKS - WARMUP_TICKS,
          sampleEveryTicks: MEMORY_STEP_TICKS,
          audioRetainedAllowanceBytes: AUDIO_RETAINED_ALLOWANCE_BYTES,
        },
        runs,
        analysis: analyseMemory(runs),
      };
    } else {
      const result = await runScheduler(browser, args.url);
      report = {
        mode: args.mode,
        generatedAt: new Date().toISOString(),
        result,
        pass:
          result.walkers === 40 &&
          result.ticks === 600 &&
          result.tracks === 40 &&
          result.capacity >= 40 &&
          result.p95MsPerTick <= 0.25 &&
          result.maxMsPerTick <= 1,
      };
    }
  } finally {
    await browser.close();
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output !== null) fs.writeFileSync(args.output, json, 'utf8');
  process.stdout.write(json);
  const pass =
    report.mode === 'memory'
      ? report.analysis.retainedAudioPass && report.analysis.structuralPass
      : report.pass;
  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
