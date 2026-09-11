/**
 * Drives a real trusted touch tap and checks that sound follows it.
 *
 * This exists because the bug it guards is invisible to every desktop check.
 * A finger never grants user activation on `pointerdown`; Blink grants it when
 * the finger lifts. A `resume()` called without activation is not rejected,
 * it is left pending forever, so the failure is silent in every sense.
 *
 * What this run does and does not establish:
 *
 * - It DOES exercise the whole path a phone player takes, with a trusted touch
 *   sequence in a mobile context: tap, context running, cues counting up.
 * - It DOES record whether user activation was live at the instant `resume()`
 *   was called, which is the question the autoplay gate actually asks.
 * - It does NOT reliably close the autoplay gate. A desktop Chrome ignores
 *   `--autoplay-policy` for a top-level frame, so a fresh context may simply
 *   start running. The report says whether the gate was armed, and the run
 *   warns when a pass is therefore weaker evidence than it looks. The unit
 *   tests in web/tests/gesture-unlock.test.ts carry the activation rule.
 *
 * Usage: node scripts/audio-touch-unlock-proof.cjs [--url <url>] [--output <file>]
 */
const fs = require('node:fs');
const path = require('node:path');

const ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

function parseArgs(argv) {
  const result = { url: 'https://localhost:5174/', output: null };
  const readValue = (flag, index) => {
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw new Error(`missing value for ${flag}`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--url') result.url = readValue(value, index++);
    else if (value === '--output') result.output = readValue(value, index++);
    else throw new Error(`unknown argument: ${value}`);
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

/**
 * Records every AudioContext the page builds, and the user activation state at
 * each gesture event, before any application module runs.
 */
const INSTRUMENT = () => {
  const contexts = [];
  const activation = [];
  const resumeCalls = [];
  const Native = window.AudioContext;
  const snapshot = () => ({
    isActive: navigator.userActivation?.isActive ?? null,
    hasBeenActive: navigator.userActivation?.hasBeenActive ?? null,
  });
  // Taken before any input can have happened. If this already reports sticky
  // activation then the page is not virgin and no later reading about what a
  // tap granted can be trusted.
  const atLoad = snapshot();

  const Wrapped = function AudioContext(...args) {
    const context = new Native(...args);
    contexts.push(context);
    return context;
  };
  Wrapped.prototype = Native.prototype;
  window.AudioContext = Wrapped;
  window.webkitAudioContext = Wrapped;

  // The decisive measurement: was activation live at the instant the app asked
  // the browser to resume? That is the question the autoplay gate answers, and
  // it is true or false regardless of whether the gate happens to be open.
  const nativeResume = Native.prototype.resume;
  Native.prototype.resume = function resume(...args) {
    resumeCalls.push(snapshot());
    return nativeResume.apply(this, args);
  };

  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
    document.addEventListener(
      type,
      (event) => {
        activation.push({
          type,
          pointerType: event.pointerType ?? null,
          isTrusted: event.isTrusted,
          activationActive: navigator.userActivation?.isActive ?? null,
          activationSticky: navigator.userActivation?.hasBeenActive ?? null,
        });
      },
      true,
    );
  }

  window.__terriAudioProof = {
    contexts,
    activation,
    resumeCalls,
    atLoad,
    // The gate probe must not be counted as one of the app's contexts, so it
    // is built from the untouched constructor.
    Native,
    states: () => contexts.map((context) => context.state),
  };
};

async function run(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    userAgent: ANDROID_USER_AGENT,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      consoleErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.addInitScript(INSTRUMENT);
  // `?stress=0` adds no filler entities; it only asks main() to publish the
  // debug handle, which is where the real cue counters live.
  const target = new URL(url);
  target.searchParams.set('stress', '0');
  await page.goto(target.toString(), { waitUntil: 'load', timeout: 60_000 });

  let booted = true;
  await page
    .waitForFunction(() => globalThis.__terriStress !== undefined, undefined, {
      polling: 100,
      timeout: 60_000,
    })
    .catch(() => {
      booted = false;
    });
  if (!booted) {
    const bodyText = await page.evaluate(() =>
      document.body.innerText.slice(0, 1000),
    );
    await context.close();
    return { booted: false, bodyText, consoleErrors };
  }
  // An occluded window reports itself hidden, and the controller refuses to
  // build a context while backgrounded. That would look exactly like the bug.
  await page.bringToFront();

  // A context built with no gesture behind it must start suspended, otherwise
  // the autoplay gate is not actually armed and a later pass proves nothing.
  const probe = await page.evaluate(async () => {
    const context = new window.__terriAudioProof.Native();
    const state = context.state;
    await context.close();
    return { state, visibility: document.visibilityState };
  });
  const gateArmed = probe.state !== 'running';

  const before = await page.evaluate(() => window.__terriAudioProof.states());

  // A real player's first touch on a phone is the help dialog's "Got it",
  // and game time is paused until it is dismissed, so nothing would walk or
  // make a sound while it is up. This is the gesture that has to unlock audio.
  const firstTouchTarget = (await page.isVisible('#close-help'))
    ? '#close-help'
    : 'canvas';
  await page.tap(firstTouchTarget);
  await page
    .waitForFunction(
      () => window.__terriAudioProof.states().includes('running'),
      undefined,
      { polling: 50, timeout: 10_000 },
    )
    .catch(() => undefined);

  // A running context is necessary but not sufficient. What a player actually
  // needs is cues starting, so wait for the sim to walk somebody about and
  // report the counters either way.
  let cuesStarted = false;
  await page
    .waitForFunction(
      () => {
        const counts = globalThis.__terriStress?.audio.cuePlayCounts;
        if (counts === undefined) return false;
        return Object.values(counts).some((value) => value > 0);
      },
      undefined,
      { polling: 200, timeout: 30_000 },
    )
    .then(() => {
      cuesStarted = true;
    })
    .catch(() => undefined);

  const cuePlayCounts = await page.evaluate(() => ({
    ...globalThis.__terriStress.audio.cuePlayCounts,
  }));
  const after = await page.evaluate(() => window.__terriAudioProof.states());
  const activation = await page.evaluate(
    () => window.__terriAudioProof.activation,
  );
  const visibilityAtTap = await page.evaluate(() => document.visibilityState);
  const atLoad = await page.evaluate(() => window.__terriAudioProof.atLoad);
  const resumeCalls = await page.evaluate(
    () => window.__terriAudioProof.resumeCalls,
  );
  await context.close();

  const running = after.includes('running');
  return {
    booted: true,
    // Informational. Chrome no longer honours the autoplay flags on a desktop
    // build, so an open gate weakens the run without invalidating it: the
    // tap-to-cue path is still exercised end to end.
    gateArmed,
    probe,
    visibilityAtTap,
    firstTouchTarget,
    // A virgin page is the precondition for reading anything into the tap.
    pageWasVirgin: atLoad.hasBeenActive === false,
    atLoad,
    resumeCalls,
    resumedWithActivation: resumeCalls.every((call) => call.isActive !== false),
    consoleErrors,
    contextsBeforeTap: before,
    contextsAfterTap: after,
    activation,
    unlockedByTouch: running,
    cuesStarted,
    cuePlayCounts,
    pass: running && cuesStarted && resumeCalls.every((c) => c.isActive !== false),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    // Playwright relaxes autoplay by default so that test media just plays.
    // That default is the whole subject here, so it has to go: left in place
    // it opens the gate for us and the run proves nothing.
    ignoreDefaultArgs: ['--autoplay-policy=no-user-gesture-required'],
    args: [
      '--window-position=0,0',
      // The mobile condition, stated rather than inherited. This is the value
      // Chrome itself defaults to on Android, and the one that actually gates
      // Web Audio; `document-user-activation-required` no longer does.
      '--autoplay-policy=user-gesture-required',
    ],
  });
  let report;
  try {
    report = await run(browser, args.url);
  } finally {
    await browser.close();
  }
  const json = JSON.stringify(report, null, 2);
  if (args.output !== null) fs.writeFileSync(args.output, json, 'utf8');
  console.log(json);
  if (!report.booted) {
    console.error('FAIL: the app did not start, so nothing about audio was tested.');
    process.exitCode = 1;
    return;
  }
  if (!report.gateArmed) {
    console.warn(
      'WARNING: this Chrome allowed audio with no gesture, so the run shows the ' +
        'tap-to-cue path works but does not prove the gesture was required.',
    );
  }
  if (!report.unlockedByTouch) {
    console.error('FAIL: a trusted touch tap did not start the AudioContext.');
    process.exitCode = 1;
    return;
  }
  if (!report.cuesStarted) {
    console.error('FAIL: the context ran but no cue ever started.');
    process.exitCode = 1;
    return;
  }
  if (!report.resumedWithActivation) {
    console.error(
      'FAIL: resume() was called with no user activation live. That call is the ' +
        'one the browser leaves pending forever.',
    );
    process.exitCode = 1;
    return;
  }
  if (!report.pageWasVirgin) {
    console.warn(
      'WARNING: the page already held sticky activation before the first tap, ' +
        'so this run cannot show that the tap is what granted it.',
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
