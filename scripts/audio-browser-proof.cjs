const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const FIXED_TICKS = 600;
const WARMUP_TICKS = 60;
const MEMORY_STEP_TICKS = 60;
const AUDIO_RETAINED_ALLOWANCE_BYTES = 64 * 1024;

function parseArgs(argv) {
  const result = {
    mode: 'performance',
    url: 'http://127.0.0.1:4173/',
    output: null,
    diagnosticWindow: false,
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
    } else if (value === '--diagnostic-window') {
      result.diagnosticWindow = true;
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
        activityTracks: stress.audio.activityTracks,
        activityCapacity: stress.audio.activityCapacity,
        objectSoundTracks: stress.audio.objectSoundTracks,
        objectSoundCapacity: stress.audio.objectSoundCapacity,
        conversationVoices: stress.audio.conversationVoices,
        retainedConversationVoices: stress.audio.retainedConversationVoices,
        objectLoopVoices: stress.audio.objectLoopVoices,
        retainedObjectLoopVoices: stress.audio.retainedObjectLoopVoices,
        doorVoices: stress.audio.doorVoices,
        toiletVoices: stress.audio.toiletVoices,
        toiletFlushes: stress.audio.cuePlayCounts['toilet-flush'],
        doorTracks: stress.audio.doorTracks,
        doorCapacity: stress.audio.doorCapacity,
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

async function warmToiletLifecycle(page, audioEnabled) {
  await setSpeed(page, 0);
  const setup = await page.evaluate(() => {
    const sim = globalThis.__terriStress.sim;
    const ids = Array.from(sim.ids()), kinds = Array.from(sim.kinds()), stable = Array.from(sim.simIds());
    const agent = ids.find((id, row) => kinds[row] === 0 && stable[row] !== 0xffff_ffff);
    const target = ids.find((id, row) => kinds[row] === 1 && sim.interactionLabels(id).includes('Use the toilet'));
    if (agent === undefined || target === undefined) throw new Error('Missing toilet warmup fixture');
    const clear = sim.clearCompletionSounds;
    const events = [];
    sim.clearCompletionSounds = function () {
      const view = this.completionSounds();
      for (let i = 0; i < view.length; i += 2) {
        if (view[i] === 1 && view[i + 1] === target) {
          if (events.length >= 16) throw new Error('Toilet warmup event bound exceeded');
          events.push({ tick: this.clockTick(), source: target, timeMs: performance.now() });
        }
      }
      clear.call(this);
    };
    globalThis.__toiletMemoryWarmup = { clear, events };
    return { agent, target, interaction: sim.interactionLabels(target).indexOf('Use the toilet'),
      initialFlushes: globalThis.__terriStress.audio.cuePlayCounts['toilet-flush'] };
  });
  try {
    const complete = async () => {
      await setSpeed(page, 0);
      const eventCount = await page.evaluate(() => globalThis.__toiletMemoryWarmup.events.length + 1);
      await page.evaluate(({ agent, target, interaction }) => {
        const sim = globalThis.__terriStress.sim;
        sim.cancelIntents(agent);
        sim.flushCommands();
        if (!sim.useObject(agent, target, interaction)) throw new Error('Toilet warmup order rejected');
        sim.flushCommands();
      }, setup);
      await setSpeed(page, 3);
      await page.waitForFunction(count => globalThis.__toiletMemoryWarmup.events.length >= count,
        eventCount, { polling: 25, timeout: 30_000 });
      return page.evaluate(() => ({
        event: globalThis.__toiletMemoryWarmup.events.at(-1),
        voices: globalThis.__terriStress.audio.toiletVoices,
        flushes: globalThis.__terriStress.audio.cuePlayCounts['toilet-flush'],
      }));
    };
    const first = await complete();
    // Stay running and observe the end, rather than sampling much later when
    // another autonomous Sim may already have started a new flush.
    await page.waitForFunction(start => performance.now() - start >= 4100 &&
      globalThis.__terriStress.audio.toiletVoices === 0,
      first.event.timeMs, { polling: 25, timeout: 10_000 });
    const naturallyDrained = await page.evaluate(start => ({
      elapsedMs: performance.now() - start,
      voices: globalThis.__terriStress.audio.toiletVoices,
      events: globalThis.__toiletMemoryWarmup.events.length,
    }), first.event.timeMs);
    const second = await complete();
    await setSpeed(page, 0);
    await waitForAudioDrain(page);
    const evidence = { first, second, naturallyDrained: naturallyDrained.voices === 0,
      naturalDrain: naturallyDrained, pausedVoices: 0,
      playedFlushes: second.flushes - setup.initialFlushes, target: setup.target };
    if (!evidence.naturallyDrained || (audioEnabled && (first.voices < 1 || second.voices < 1 || evidence.playedFlushes < 2))) {
      throw new Error(`Incomplete toilet lifecycle warmup: ${JSON.stringify(evidence)}`);
    }
    return evidence;
  } finally {
    await page.evaluate(() => {
      globalThis.__terriStress.sim.clearCompletionSounds = globalThis.__toiletMemoryWarmup.clear;
      delete globalThis.__toiletMemoryWarmup;
    });
  }
}

async function runMemory(browser, baseUrl, audioEnabled, repetition, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const loadedBundles = [];
  page.on('response', response => {
    if (!/\.(?:js|wasm)(?:\?|$)/.test(response.url())) return;
    loadedBundles.push(response.body().then(body => ({
      url: response.url(), sha256: createHash('sha256').update(body).digest('hex'),
    })));
  });
  try {
    await page.goto(withQuery(baseUrl, audioEnabled), { waitUntil: 'networkidle' });
    await page.bringToFront();
    await waitForStress(page);
    const bundleEvidence = (await Promise.all(loadedBundles)).sort((a, b) => a.url.localeCompare(b.url));
    const fixture = options.fixture ?? {};
    if (fixture.bytes === undefined) fixture.bytes = await page.evaluate(() => Array.from(globalThis.__terriStress.sim.saveBytes()));
    await page.evaluate(bytes => {
      if (!globalThis.__terriStress.sim.loadBytes(Uint8Array.from(bytes))) throw new Error('Memory fixture load rejected');
    }, fixture.bytes);
    const fixtureSha256 = createHash('sha256').update(Uint8Array.from(fixture.bytes)).digest('hex');
    await closeHelpAndSetThreeTimes(page);
    const toiletWarmup = await warmToiletLifecycle(page, audioEnabled);
    // Asset/player preparation must not choose the measured world's needs,
    // actions or clock. Restore the same public save before timed warmup.
    await page.evaluate(bytes => {
      if (!globalThis.__terriStress.sim.loadBytes(Uint8Array.from(bytes))) throw new Error('Post-lifecycle fixture load rejected');
    }, fixture.bytes);
    await setSpeed(page, 3);

    const startTick = await page.evaluate(() => globalThis.__terriStress.sim.clockTick());
    await page.waitForFunction(
      (start) => globalThis.__terriStress.sim.clockTick() - start >= 60,
      startTick,
      { polling: 100, timeout: 30_000 },
    );

    const samples = [];
    await setSpeed(page, 0);
    // Wall-clock polling can overshoot warmup by a tick. Pin the paused
    // baseline itself, not merely the random seed used before warmup.
    if (fixture.measurementBytes === undefined) fixture.measurementBytes = await page.evaluate(() => Array.from(globalThis.__terriStress.sim.saveBytes()));
    await page.evaluate(bytes => {
      if (!globalThis.__terriStress.sim.loadBytes(Uint8Array.from(bytes))) throw new Error('Measurement fixture load rejected');
    }, fixture.measurementBytes);
    const selected = await normalizeMemoryHud(page);
    await waitForAudioDrain(page);
    const measurementBaseline = await page.evaluate(() => ({
      tick: globalThis.__terriStress.sim.clockTick(),
      worldHash: String(globalThis.__terriStress.sim.worldHash()),
    }));
    samples.push(await collectMemorySample(page, cdp, true));
    if (options.onCheckpoint) await options.onCheckpoint(cdp, 'baseline');
    const baselineTick = samples[0].tick;
    await page.evaluate(entity => {
      const sim = globalThis.__terriStress.sim;
      if (!sim.select(entity)) throw new Error('Could not restore memory-run selection');
      sim.flushCommands();
    }, selected);
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
    await normalizeMemoryHud(page);
    await waitForAudioDrain(page);
    samples.push(await collectMemorySample(page, cdp, true));
    if (options.onCheckpoint) await options.onCheckpoint(cdp, 'first540');

    const diagnosticSamples = [];
    if (options.diagnosticWindow) {
      diagnosticSamples.push(samples.at(-1));
      await page.evaluate(entity => {
        const sim = globalThis.__terriStress.sim;
        sim.select(entity);
        sim.flushCommands();
      }, selected);
      await setSpeed(page, 3);
      const diagnosticStart = samples.at(-1).tick;
      await page.waitForFunction(tick => globalThis.__terriStress.sim.clockTick() - tick >= 540,
        diagnosticStart, { polling: 100, timeout: 35_000 });
      await setSpeed(page, 0);
      await normalizeMemoryHud(page);
      await waitForAudioDrain(page);
      diagnosticSamples.push(await collectMemorySample(page, cdp, true));
      if (options.onCheckpoint) await options.onCheckpoint(cdp, 'second540');
    }
    return { repetition, audioEnabled, bundleEvidence, fixtureSha256, toiletWarmup,
      diagnosticOnly: typeof options.onCheckpoint === 'function', measurementBaseline, samples, diagnosticSamples };
  } finally {
    await context.close();
  }
}

async function normalizeMemoryHud(page) {
  const selected = await page.evaluate(() => {
    const sim = globalThis.__terriStress.sim;
    const previous = sim.selectedIndex();
    if (!sim.select(null)) throw new Error('Could not clear memory-run selection');
    sim.flushCommands();
    return previous;
  });
  // Compare identical empty selected-person panels, while the measured
  // interval still renders normal changing moodlets and action cards.
  await page.waitForFunction(() => {
    const warnings = document.querySelectorAll('#needs-content .need-state');
    return globalThis.__terriStress.sim.selectedIndex() === null &&
      document.querySelector('#moodlet-list')?.childNodes.length === 0 &&
      document.querySelector('#action-queue')?.childNodes.length === 0 &&
      warnings.length === 7 && Array.from(warnings).every(span => span.childNodes.length === 0);
  }, undefined, { polling: 50, timeout: 5000 });
  return selected;
}

async function waitForAudioDrain(page) {
  // Pause allows short cues and conversations to finish. Their onended
  // listeners are live ownership, not leaked listeners.
  await page.waitForFunction(() => {
    const audio = globalThis.__terriStress.audio;
    return audio.activeVoices === 0 && audio.doorVoices === 0 && audio.toiletVoices === 0 &&
      audio.conversationVoices === 0 && audio.retainedConversationVoices === 0 &&
      audio.objectLoopVoices === 0 && audio.retainedObjectLoopVoices === 0;
  }, undefined, { polling: 50, timeout: 10_000 });
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
  const reference = runs[0];
  const coveragePass = runs.every(run => {
    const warmup = run.toiletWarmup;
    return run.diagnosticOnly === false &&
      typeof run.measurementBaseline?.worldHash === 'string' &&
      run.measurementBaseline.worldHash === reference.measurementBaseline?.worldHash &&
      Number.isInteger(run.measurementBaseline.tick) && run.measurementBaseline.tick === reference.measurementBaseline?.tick &&
      typeof run.fixtureSha256 === 'string' && run.fixtureSha256 === reference.fixtureSha256 &&
      run.bundleEvidence?.length > 0 &&
      run.bundleEvidence.some(bundle => /\.js(?:\?|$)/.test(bundle.url)) &&
      run.bundleEvidence.some(bundle => /\.wasm(?:\?|$)/.test(bundle.url)) &&
      JSON.stringify(run.bundleEvidence) === JSON.stringify(reference.bundleEvidence) &&
      warmup?.naturallyDrained === true && warmup.pausedVoices === 0 &&
      warmup.second?.event?.tick > warmup.first?.event?.tick &&
      warmup.second.event.source === warmup.first.event.source &&
      (run.audioEnabled ? warmup.playedFlushes >= 2 && warmup.first.voices > 0 && warmup.second.voices > 0 :
        warmup.playedFlushes === 0 && warmup.first.voices === 0 && warmup.second.voices === 0);
  });
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
        sample.activityCapacity === baseline.activityCapacity &&
        sample.activityTracks <= 3 &&
        sample.objectSoundCapacity === baseline.objectSoundCapacity &&
        // Three household Sims can each use one of the shower, stove or sinks.
        sample.objectSoundTracks <= 3 &&
        sample.doorCapacity === baseline.doorCapacity &&
        sample.doorTracks <= 4 &&
        sample.doorVoices <= 4 &&
        sample.toiletVoices <= 4 &&
        sample.activeVoices <= 8 &&
        // The recorded conversation voices are a retained scheduler like the
        // rest, and `activeVoices` cannot see them: that counts oscillators
        // and these are buffer sources. Leaving them out is the exact
        // omission [L-audio-boundaries-and-proofs-must-cover-every-scheduler]
        // records, so they are bounded here in the same change that added
        // them.
        //
        // The RETAINED count is the one worth bounding. A conversation that
        // has been stopped leaves the sounding list immediately and keeps its
        // nodes until its fade has rendered, so a reclaim that stopped
        // working would be invisible to the sounding count alone.
        // Six, not three: the retained count is the sounding ones plus the
        // ones still fading, and each is capped at three. Bounding it at the
        // number today's calling pattern happens to produce would make this
        // gate fail the day more than one conversation may sound at once,
        // which is the flake this check already had to have removed once.
        sample.conversationVoices <= 3 &&
        sample.retainedConversationVoices <= 6 &&
        sample.objectLoopVoices <= 4 &&
        sample.retainedObjectLoopVoices <= 8,
    );
    return (
      boundedLiveState &&
      (!run.audioEnabled || run.samples.some(sample => sample.doorTracks > 0)) &&
      // Intermediate samples may be sounding. Endpoints wait for natural
      // completion so listener comparisons measure retained ownership.
      [baseline, final].every(sample => ['activeVoices', 'objectLoopVoices',
        'doorVoices', 'toiletVoices', 'conversationVoices', 'retainedConversationVoices',
        'retainedObjectLoopVoices'].every(field => sample[field] === 0)) &&
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
    coveragePass,
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
      const fixture = {};
      for (let repetition = 0; repetition < 3; repetition += 1) {
        const order = repetition % 2 === 0 ? [true, false] : [false, true];
        for (const audioEnabled of order) {
          runs.push(await runMemory(browser, args.url, audioEnabled, repetition, { fixture, diagnosticWindow: args.diagnosticWindow }));
        }
      }
      report = {
        mode: args.mode,
        generatedAt: new Date().toISOString(),
        contract: {
          repetitions: 3,
          warmupTicks: WARMUP_TICKS,
          lifecycleWarmup: 'toilet completion, natural drain, second completion, pause drain',
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
      ? report.analysis.retainedAudioPass && report.analysis.structuralPass && report.analysis.coveragePass
      : report.pass;
  if (!pass) process.exitCode = 1;
}

module.exports = { analyseMemory, closeHelpAndSetThreeTimes, runMemory, warmToiletLifecycle, loadPlaywright };

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
