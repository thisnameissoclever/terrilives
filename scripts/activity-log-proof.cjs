// The activity log's performance budget, [AL-perf] in
// docs/specs/2026-10-18-activity-log.md. Every mode compares the same
// build with the log on and with `?activitylog=0`, the disabled baseline.
//
//   node scripts/activity-log-proof.cjs performance [--stress N] [--repetitions R] [--url U] [--output F]
//   node scripts/activity-log-proof.cjs allocation  [--stress N] [--url U] [--sampling-interval B]
//   node scripts/activity-log-proof.cjs memory      [--stress N] [--url U] [--fill-ticks T] [--after-ticks T]
//   node scripts/activity-log-proof.cjs rebuild     [--stress N] [--url U] [--fill-ticks T] [--repetitions R]
//   node scripts/activity-log-proof.cjs clicks      [--stress N] [--url U] [--fill-ticks T] [--repetitions R]
//
// `--everyone` clears the selected housemate after opening the panel, so
// every record's line shows rather than only those involving one person.
//
// performance: the release frame-time gate of docs/ARCHITECTURE.md with the
//   panel closed, then open with every filter on. Needs a displayed
//   production build on a display calibrated at 120 Hz.
// allocation: the [V11] sampling heap profile of docs/gpu-verification.md
//   (6 seconds of warm-up, a 20-second window, both garbage-collection
//   inclusion flags), attributed by function. Point --url at the dev server
//   so function names and module paths survive.
// memory: alternating enabled and disabled pairs, panel closed, sampled
//   after the store has filled and again after more ticks.
// rebuild: the one-off work outside the frame, with the store filled:
//   opening the panel, each filter change and each Show earlier entries,
//   timed as the click's script and the layout it leaves for the frame.
// clicks: the same clicks with a pause between them, each timed as its
//   script plus the main-thread work of the frame after it (ResizeObserver
//   callbacks, style, layout and paint), less the median of frames without
//   a click. Work a click defers to its frame is charged to the click.
//
// Every page runs with `audio=0` and Chrome's `--mute-audio`, so a proof
// never plays sound.

const fs = require('node:fs');
const {
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
  setSpeed,
  stats,
  summarizeCalibration,
  summarizeWindow,
} = require('./lib/browser-frame-gate.cjs');

/** [AL-perf] thresholds. */
const LOG_P95_MS = 0.25;
const LOG_MAX_MS = 1;
const WORK_P95_REGRESSION_MS = 1;
const RETAINED_ALLOWANCE_BYTES = 160 * 1024;
const OPEN_BYTES_PER_LINE = 2 * 1024;

/** [V11]'s sampling procedure. */
const ALLOCATION_WARMUP_MS = 6_000;
const ALLOCATION_WINDOW_MS = 20_000;
const SAMPLING_INTERVAL_BYTES = 32_768;

const FILTER_COUNT = 7;

function parseArgs(argv) {
  const result = {
    mode: 'performance',
    url: 'http://127.0.0.1:4173/',
    output: null,
    stress: 1000,
    samplingInterval: SAMPLING_INTERVAL_BYTES,
    fillTicks: 1_440,
    afterTicks: 720,
    readyTimeoutMs: 600_000,
    repetitions: 3,
    everyone: false,
  };
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
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === 'performance' || value === 'allocation' || value === 'memory' || value === 'rebuild'
      || value === 'clicks') {
      result.mode = value;
    } else if (value === '--everyone') {
      result.everyone = true;
    } else if (value === '--url') {
      result.url = readValue(value, index++);
    } else if (value === '--output') {
      result.output = readValue(value, index++);
    } else if (value === '--stress') {
      result.stress = readCount(value, index++, 0);
    } else if (value === '--sampling-interval') {
      result.samplingInterval = readCount(value, index++, 1);
    } else if (value === '--fill-ticks') {
      result.fillTicks = readCount(value, index++, 1);
    } else if (value === '--after-ticks') {
      result.afterTicks = readCount(value, index++, 1);
    } else if (value === '--repetitions') {
      result.repetitions = readCount(value, index++, 1);
    } else if (value === '--ready-timeout-ms') {
      result.readyTimeoutMs = readCount(value, index++, 1);
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return result;
}

function withQuery(baseUrl, stress, logEnabled) {
  const url = new URL(baseUrl);
  url.searchParams.set('stress', String(stress));
  url.searchParams.set('audio', '0');
  if (!logEnabled) url.searchParams.set('activitylog', '0');
  return url.toString();
}

async function openPage(browser, args, logEnabled) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await page.goto(withQuery(args.url, args.stress, logEnabled), { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForFunction(() => globalThis.__terriStress !== undefined, undefined, {
    polling: 500,
    timeout: args.readyTimeoutMs,
  });
  return { context, page };
}

/**
 * Opens the panel through its button and turns every filter on through its
 * toggle. With `everyone`, clears the selection and waits for the panel's
 * poll to show every person's lines.
 */
async function openPanelWithEveryFilter(page, everyone = false) {
  if (everyone) {
    await page.evaluate(() => globalThis.__terriStress.sim.select(null));
    // Let the roster's poll see the cleared selection before the panel reads it.
    await page.waitForTimeout(500);
  }
  await page.locator('#activity-log-toggle').click();
  const filters = page.locator('#activity-log-filters button');
  const count = await filters.count();
  if (count !== FILTER_COUNT) throw new Error(`expected ${FILTER_COUNT} filters, found ${count}`);
  for (let index = 0; index < count; index += 1) {
    const filter = filters.nth(index);
    if ((await filter.getAttribute('aria-pressed')) !== 'true') await filter.click();
  }
  const state = await page.evaluate(() => ({
    open: globalThis.__terriStress.activityLog.open,
    pressed: Array.from(document.querySelectorAll('#activity-log-filters button'))
      .filter((button) => button.getAttribute('aria-pressed') === 'true').length,
  }));
  if (!state.open || state.pressed !== FILTER_COUNT) {
    throw new Error(`panel did not open with every filter on: ${JSON.stringify(state)}`);
  }
  if (everyone) {
    await page.waitForFunction(() => document.querySelector('#activity-log-selected')?.hidden === true, undefined, {
      polling: 100,
      timeout: 10_000,
    });
  }
}

async function logState(page) {
  return page.evaluate(() => {
    const log = globalThis.__terriStress.activityLog;
    return {
      drained: log.drained,
      held: log.held,
      capacity: log.capacity,
      dropped: log.dropped,
      open: log.open,
      rows: document.querySelectorAll('#activity-log-list > li').length,
    };
  });
}

/**
 * Splits per-frame log samples by whether the frame drained new records,
 * read from the `drained` counter recorded beside each sample.
 */
function splitLogSamples(values, counters, drainedBefore) {
  const withRecords = [];
  const withoutRecords = [];
  let previous = drainedBefore;
  values.forEach((value, index) => {
    const drained = counters[index];
    (drained > previous ? withRecords : withoutRecords).push(value);
    previous = drained;
  });
  return { withRecords: stats(withRecords), withoutRecords: stats(withoutRecords) };
}

async function runPerformance(browser, args, logEnabled, panelOpen) {
  const { context, page } = await openPage(browser, args, logEnabled);
  try {
    const calibration = summarizeCalibration(await calibrateRefresh(page));
    await closeHelpAndSetThreeTimes(page);
    if (panelOpen) await openPanelWithEveryFilter(page, args.everyone);
    const before = await logState(page);
    const result = await measureFixedTicks(page, {
      warmupTicks: WARMUP_TICKS,
      retainedTicks: FIXED_TICKS - WARMUP_TICKS,
      recorded: [{ name: 'activityLogSampler', counter: 'activityLog.drained' }],
    });
    const after = await logState(page);
    const samples = result.recorded.activityLogSampler;
    return {
      logEnabled,
      panelOpen,
      calibration,
      active: summarizeWindow(result),
      log: {
        ...stats(samples.values),
        ...splitLogSamples(samples.values, samples.counters, before.drained),
        recordsDrained: after.drained - before.drained,
        before,
        after,
      },
    };
  } finally {
    await context.close();
  }
}

/**
 * [AL-perf] verdicts for one panel state from alternating pairs of enabled
 * and disabled runs. Every run must meet the per-run limits; the work p95
 * regression is judged on the median pair, and every pair is reported.
 */
function analysePerformance(pairs) {
  const runs = pairs.flatMap(({ enabled, disabled }) => [enabled, disabled]);
  const enabledRuns = pairs.map(({ enabled }) => enabled);
  const regressions = pairs.map(({ enabled, disabled }) => enabled.active.work.p95 - disabled.active.work.p95);
  const medianRegressionMs = median(regressions);
  const checks = {
    calibrated: runs.every((run) => calibrationPasses(run.calibration)),
    logP95: enabledRuns.every((run) => run.log.p95 <= LOG_P95_MS),
    logMax: enabledRuns.every((run) => run.log.max <= LOG_MAX_MS),
    workRegression: medianRegressionMs <= WORK_P95_REGRESSION_MS,
    noLongWorkFrame: runs.every((run) => run.active.workFramesOver16_6Ms === 0),
    noSteadySimIdOf: runs.every((run) => run.active.simIdOfCalls === 0),
    recordsArrived: enabledRuns.every((run) => run.log.recordsDrained > 0),
    baselineEmitsNothing: pairs.every(({ disabled }) => disabled.log.recordsDrained === 0),
  };
  return {
    workP95RegressionsMs: regressions,
    medianWorkP95RegressionMs: medianRegressionMs,
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}

/**
 * Sums the sampled allocation per function. A frame belongs to the log
 * when its module is one of the activity log's shell modules, or when it
 * is one of the bridge's activity log methods.
 */
const LOG_BRIDGE_METHODS = new Set([
  'takeActivityLog',
  'activityLogLabels',
  'activityLogDropped',
  'activityLogReactionBands',
  'setActivityLogEnabled',
]);

function isLogFrame(callFrame) {
  return (
    /\/activity-log-[a-z]+\.ts(?:\?|$)/.test(callFrame.url) ||
    (/\/bridge\.ts(?:\?|$)/.test(callFrame.url) && LOG_BRIDGE_METHODS.has(callFrame.functionName))
  );
}

function attributeAllocation(profile) {
  const byFunction = new Map();
  let total = 0;
  let log = 0;
  const visit = (node) => {
    const { functionName, url, lineNumber } = node.callFrame;
    if (node.selfSize > 0) {
      total += node.selfSize;
      const key = `${functionName || '(anonymous)'} ${url.replace(/^.*\/(src|node_modules)\//, '$1/')}:${lineNumber + 1}`;
      const entry = byFunction.get(key) ?? { function: key, bytes: 0, log: isLogFrame(node.callFrame) };
      entry.bytes += node.selfSize;
      byFunction.set(key, entry);
      if (entry.log) log += node.selfSize;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(profile.head);
  const functions = [...byFunction.values()].sort((left, right) => right.bytes - left.bytes);
  return {
    totalBytes: total,
    logBytes: log,
    logFunctions: functions.filter((entry) => entry.log),
    topFunctions: functions.slice(0, 15),
  };
}

async function runAllocation(browser, args, panelOpen) {
  const { context, page } = await openPage(browser, args, true);
  const cdp = await context.newCDPSession(page);
  try {
    await closeHelpAndSetThreeTimes(page);
    if (panelOpen) await openPanelWithEveryFilter(page, args.everyone);
    await page.waitForTimeout(ALLOCATION_WARMUP_MS);
    // Counts frames, frames that drained records and rows appended to the
    // list, without allocating per frame beyond the counters themselves.
    await page.evaluate(() => {
      const stress = globalThis.__terriStress;
      const sampler = stress.activityLogSampler;
      const original = sampler.sample.bind(sampler);
      const counts = { frames: 0, framesWithRecords: 0, rowsAdded: 0, drained: stress.activityLog.drained };
      let previous = counts.drained;
      sampler.sample = (elapsedMs) => {
        counts.frames += 1;
        const drained = stress.activityLog.drained;
        if (drained > previous) counts.framesWithRecords += 1;
        previous = drained;
        original(elapsedMs);
      };
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) counts.rowsAdded += mutation.addedNodes.length;
      });
      observer.observe(document.querySelector('#activity-log-list'), { childList: true });
      globalThis.__activityLogAllocation = {
        counts,
        stop() {
          sampler.sample = original;
          observer.disconnect();
          counts.drained = stress.activityLog.drained - counts.drained;
          return counts;
        },
      };
    });
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.startSampling', {
      samplingInterval: args.samplingInterval,
      includeObjectsCollectedByMinorGC: true,
      includeObjectsCollectedByMajorGC: true,
    });
    const startTick = await page.evaluate(() => globalThis.__terriStress.sim.clockTick());
    await page.waitForTimeout(ALLOCATION_WINDOW_MS);
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const counts = await page.evaluate(() => globalThis.__activityLogAllocation.stop());
    const endTick = await page.evaluate(() => globalThis.__terriStress.sim.clockTick());
    const visibility = await page.evaluate(() => document.visibilityState);
    return {
      panelOpen,
      visibility,
      ticks: endTick - startTick,
      ...counts,
      ...attributeAllocation(profile),
    };
  } finally {
    await context.close();
  }
}

/**
 * Panel closed: allocation attributed to the log fits one typed-array view
 * per drain that found records, so frames without records add nothing.
 * Panel open: at most 2 KB per appended row.
 */
function analyseAllocation(closed, open, viewBytes) {
  const closedPerDrain = closed.framesWithRecords === 0 ? null : closed.logBytes / closed.framesWithRecords;
  const openPerRow = open.rowsAdded === 0 ? null : open.logBytes / open.rowsAdded;
  return {
    closedLogBytesPerDrainWithRecords: closedPerDrain,
    openLogBytesPerAddedRow: openPerRow,
    checks: {
      framesRan: closed.frames > 0 && open.frames > 0 && closed.visibility === 'visible' && open.visibility === 'visible',
      closedWithinOneViewPerDrain: closed.logBytes <= closed.framesWithRecords * viewBytes,
      openWithinRowAllowance: open.logBytes <= Math.max(open.rowsAdded, 0) * OPEN_BYTES_PER_LINE,
    },
  };
}

/**
 * Runs `ticks` simulation ticks through the page's own frame body with a
 * fabricated, increasing clock, five ticks a frame, then pauses. Synchronous
 * inside the page, so no real frame interleaves; a paused real frame adds
 * nothing to the step accumulator.
 */
function fastForward(ticks) {
  const stress = globalThis.__terriStress;
  const choose = (id) => {
    const input = document.querySelector(id);
    if (!(input instanceof HTMLInputElement)) throw new Error(`missing ${id} input`);
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const start = stress.sim.clockTick();
  let now = Math.max(globalThis.__activityLogProofClock ?? 0, performance.now());
  choose('#speed-3');
  while (stress.sim.clockTick() - start < ticks) {
    now += 200;
    stress.step(now);
  }
  choose('#speed-0');
  globalThis.__activityLogProofClock = now;
  return stress.sim.clockTick() - start;
}

async function collectMemorySample(page, cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const [heap, dom, state] = await Promise.all([
    cdp.send('Runtime.getHeapUsage'),
    cdp.send('Memory.getDOMCounters'),
    page.evaluate(() => {
      const stress = globalThis.__terriStress;
      const log = stress.activityLog;
      return {
        tick: stress.sim.clockTick(),
        wasmMemoryBytes: stress.wasmMemoryBytes,
        drained: log.drained,
        held: log.held,
        capacity: log.capacity,
        dropped: log.dropped,
        open: log.open,
      };
    }),
  ]);
  return {
    ...state,
    jsUsedBytes: heap.usedSize,
    jsEmbedderBytes: heap.embedderHeapUsedSize,
    backingStorageBytes: heap.backingStorageSize,
    domNodes: dom.nodes,
    eventListeners: dom.jsEventListeners,
  };
}

async function runMemory(browser, args, logEnabled, repetition) {
  const { context, page } = await openPage(browser, args, logEnabled);
  const cdp = await context.newCDPSession(page);
  try {
    await closeHelpAndSetThreeTimes(page);
    await setSpeed(page, 0);
    const startTick = await page.evaluate(() => globalThis.__terriStress.sim.clockTick());
    const filled = await page.evaluate(fastForward, args.fillTicks);
    const full = await collectMemorySample(page, cdp);
    const after = await page.evaluate(fastForward, args.afterTicks);
    const later = await collectMemorySample(page, cdp);
    return { repetition, logEnabled, startTick, filledTicks: filled, afterTicks: after, samples: [full, later] };
  } finally {
    await context.close();
  }
}

/**
 * Clicks `selector` inside the page and times the click's script, then the
 * style and layout it left behind, read back at once. The layout part is
 * what the next frame's rendering would otherwise do.
 */
function timedClick(selector) {
  const target = document.querySelector(selector);
  if (!(target instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  const started = performance.now();
  target.click();
  const clicked = performance.now();
  void document.body.offsetHeight;
  return {
    scriptMs: clicked - started,
    layoutMs: performance.now() - clicked,
    rows: document.querySelectorAll('#activity-log-list > li').length,
  };
}

/** Opening, filter changes and Show earlier entries, with the store filled first. */
async function runRebuild(browser, args) {
  const { context, page } = await openPage(browser, args, true);
  try {
    await closeHelpAndSetThreeTimes(page);
    await setSpeed(page, 0);
    await page.evaluate(fastForward, args.fillTicks);
    if (args.everyone) await page.evaluate(() => globalThis.__terriStress.sim.select(null));
    // Let the roster's poll see the selection before the panel reads it.
    await page.waitForTimeout(500);
    const state = await logState(page);
    const opens = [];
    const filters = [];
    const earlier = [];
    for (let repetition = 0; repetition < args.repetitions; repetition += 1) {
      opens.push(await page.evaluate(timedClick, '#activity-log-toggle'));
      for (let index = 1; index <= FILTER_COUNT; index += 1) {
        const selector = `#activity-log-filters button:nth-child(${index})`;
        filters.push({ filter: index, ...(await page.evaluate(timedClick, selector)) });
        filters.push({ filter: index, ...(await page.evaluate(timedClick, selector)) });
      }
      for (let more = 0; more < 10; more += 1) {
        const visible = await page.evaluate(() => document.querySelector('#activity-log-earlier')?.hidden === false);
        if (!visible) break;
        earlier.push(await page.evaluate(timedClick, '#activity-log-earlier'));
      }
      await page.evaluate(timedClick, '#activity-log-toggle');
    }
    const summary = (runs) => ({
      script: stats(runs.map((run) => run.scriptMs)),
      layout: stats(runs.map((run) => run.layoutMs)),
      rows: stats(runs.map((run) => run.rows)),
    });
    return {
      state,
      open: summary(opens),
      filterChange: summary(filters),
      showEarlier: earlier.length === 0 ? null : summary(earlier),
      opens,
      filters,
      earlier,
    };
  } finally {
    await context.close();
  }
}

/**
 * One click at the start of a task after a frame, as a player's click
 * lands: its script, then the main-thread work of the next frame, from this
 * page's animation-frame callback to a task queued there, which runs after
 * that frame's ResizeObserver callbacks, style, layout and paint. A null
 * selector clicks nothing and measures a frame for the baseline.
 */
function clickAndFrame(selector) {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        const started = performance.now();
        if (selector !== null) {
          const target = document.querySelector(selector);
          if (!(target instanceof HTMLElement)) throw new Error(`missing ${selector}`);
          target.click();
        }
        const clicked = performance.now();
        requestAnimationFrame(() => {
          const frame = performance.now();
          setTimeout(() => resolve({
            scriptMs: clicked - started,
            renderMs: performance.now() - frame,
            rows: document.querySelectorAll('#activity-log-list > li').length,
          }), 0);
        });
      }, 0);
    });
  });
}

/** Opening, every filter twice and Show earlier entries, paced, with baseline frames before and after. */
async function runClicks(browser, args) {
  const { context, page } = await openPage(browser, args, true);
  try {
    await closeHelpAndSetThreeTimes(page);
    await setSpeed(page, 0);
    await page.evaluate(fastForward, args.fillTicks);
    if (args.everyone) await page.evaluate(() => globalThis.__terriStress.sim.select(null));
    await page.waitForTimeout(500);
    const state = await logState(page);
    const report = { state, baseline: [], open: [], filter: [], earlier: [] };
    const measure = async (selector) => {
      const result = await page.evaluate(clickAndFrame, selector);
      await page.waitForTimeout(150);
      return result;
    };
    const baseline = async () => {
      for (let frame = 0; frame < 10; frame += 1) report.baseline.push(await measure(null));
    };
    for (let repetition = 0; repetition < args.repetitions; repetition += 1) {
      await baseline();
      report.open.push(await measure('#activity-log-toggle'));
      for (let index = 1; index <= FILTER_COUNT; index += 1) {
        const selector = `#activity-log-filters button:nth-child(${index})`;
        report.filter.push({ filter: index, ...(await measure(selector)) });
        report.filter.push({ filter: index, ...(await measure(selector)) });
      }
      for (let more = 0; more < 10; more += 1) {
        const visible = await page.evaluate(() => document.querySelector('#activity-log-earlier')?.hidden === false);
        if (!visible) break;
        report.earlier.push(await measure('#activity-log-earlier'));
      }
      await baseline();
      await measure('#activity-log-toggle');
    }
    return report;
  } finally {
    await context.close();
  }
}

/**
 * Each click's script plus its frame's work beyond the median frame without
 * a click, in hundredths of a millisecond, and the largest total per kind.
 */
function analyseClicks(report) {
  const round = (value) => Math.round(value * 100) / 100;
  const baselineRenderMs = round(median(report.baseline.map((frame) => frame.renderMs)));
  const kind = (runs) => {
    const clicks = runs.map((run) => {
      const renderMs = round(run.renderMs - baselineRenderMs);
      return { scriptMs: round(run.scriptMs), renderMs, totalMs: round(run.scriptMs + renderMs), rows: run.rows };
    });
    return { clicks, maxTotalMs: clicks.length === 0 ? null : Math.max(...clicks.map((click) => click.totalMs)) };
  };
  return { baselineRenderMs, open: kind(report.open), filter: kind(report.filter), earlier: kind(report.earlier) };
}

/**
 * Retained difference: enabled minus disabled JS heap at the first sample,
 * after the store has filled. Growth: the second sample minus the first,
 * enabled minus disabled, so growth both modes share is not charged to the log.
 */
function analyseMemory(runs) {
  const pairs = [...new Set(runs.map((run) => run.repetition))].map((repetition) => {
    const enabled = runs.find((run) => run.repetition === repetition && run.logEnabled);
    const disabled = runs.find((run) => run.repetition === repetition && !run.logEnabled);
    const delta = (run, field) => run.samples[1][field] - run.samples[0][field];
    return {
      repetition,
      retainedJsBytes: enabled.samples[0].jsUsedBytes - disabled.samples[0].jsUsedBytes,
      retainedWasmBytes: enabled.samples[0].wasmMemoryBytes - disabled.samples[0].wasmMemoryBytes,
      enabledGrowthJsBytes: delta(enabled, 'jsUsedBytes'),
      disabledGrowthJsBytes: delta(disabled, 'jsUsedBytes'),
      logGrowthJsBytes: delta(enabled, 'jsUsedBytes') - delta(disabled, 'jsUsedBytes'),
      enabledGrowthWasmBytes: delta(enabled, 'wasmMemoryBytes'),
      logGrowthWasmBytes: delta(enabled, 'wasmMemoryBytes') - delta(disabled, 'wasmMemoryBytes'),
      enabledGrowthDomNodes: delta(enabled, 'domNodes'),
      enabledGrowthListeners: delta(enabled, 'eventListeners'),
      storeFullAtFirstSample: enabled.samples[0].held === enabled.samples[0].capacity,
      disabledDrainedNothing: disabled.samples[1].drained === 0,
    };
  });
  const medianRetainedJsBytes = median(pairs.map((pair) => pair.retainedJsBytes));
  const medianLogGrowthJsBytes = median(pairs.map((pair) => pair.logGrowthJsBytes));
  const medianLogGrowthWasmBytes = median(pairs.map((pair) => pair.logGrowthWasmBytes));
  return {
    allowanceBytes: RETAINED_ALLOWANCE_BYTES,
    pairs,
    medianRetainedJsBytes,
    medianLogGrowthJsBytes,
    medianLogGrowthWasmBytes,
    checks: {
      storeFilled: pairs.every((pair) => pair.storeFullAtFirstSample),
      baselineEmitsNothing: pairs.every((pair) => pair.disabledDrainedNothing),
      retainedWithinAllowance: medianRetainedJsBytes <= RETAINED_ALLOWANCE_BYTES,
      noGrowthAfterFull: medianLogGrowthJsBytes <= 0 && medianLogGrowthWasmBytes <= 0,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();
  const browser = await launchDisplayedChrome(chromium, ['--mute-audio']);
  const report = { mode: args.mode, generatedAt: new Date().toISOString(), args };
  try {
    if (args.mode === 'performance') {
      for (const panelOpen of [false, true]) {
        const pairs = [];
        for (let repetition = 0; repetition < args.repetitions; repetition += 1) {
          const runs = {};
          const order = repetition % 2 === 0 ? [true, false] : [false, true];
          for (const logEnabled of order) {
            runs[logEnabled ? 'enabled' : 'disabled'] = await runPerformance(browser, args, logEnabled, panelOpen);
          }
          pairs.push(runs);
        }
        report[panelOpen ? 'open' : 'closed'] = { pairs, analysis: analysePerformance(pairs) };
      }
      report.pass = report.closed.analysis.pass && report.open.analysis.pass;
    } else if (args.mode === 'allocation') {
      const closed = await runAllocation(browser, args, false);
      const open = await runAllocation(browser, args, true);
      // A Uint32Array view is one small object; 256 bytes bounds it generously.
      const analysis = analyseAllocation(closed, open, 256);
      report.closed = closed;
      report.open = open;
      report.analysis = analysis;
      report.pass = Object.values(analysis.checks).every(Boolean);
    } else if (args.mode === 'clicks') {
      report.clicks = await runClicks(browser, args);
      report.analysis = analyseClicks(report.clicks);
      // Reported, not judged, as rebuild is.
      report.pass = report.clicks.state.held > 0;
    } else if (args.mode === 'rebuild') {
      report.rebuild = await runRebuild(browser, args);
      // Reported, not judged: [AL-perf] budgets the per-frame work, and
      // these run once per click.
      report.pass = report.rebuild.state.held > 0;
    } else {
      const runs = [];
      for (let repetition = 0; repetition < 3; repetition += 1) {
        const order = repetition % 2 === 0 ? [true, false] : [false, true];
        for (const logEnabled of order) runs.push(await runMemory(browser, args, logEnabled, repetition));
      }
      report.runs = runs;
      report.analysis = analyseMemory(runs);
      report.pass = Object.values(report.analysis.checks).every(Boolean);
    }
  } finally {
    await browser.close();
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output !== null) fs.writeFileSync(args.output, json, 'utf8');
  process.stdout.write(json);
  if (!report.pass) process.exitCode = 1;
}

module.exports = {
  FRAME_BUDGET_MS,
  analyseAllocation,
  analyseClicks,
  analyseMemory,
  analysePerformance,
  attributeAllocation,
  fastForward,
  isLogFrame,
  parseArgs,
  splitLogSamples,
  withQuery,
};

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
