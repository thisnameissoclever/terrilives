/**
 * Operates the first-run help dialog in a real browser and checks that it
 * actually hides when closed.
 *
 * This exists because measuring the dialog is not operating it. The bug it
 * guards put an unconditional `display: flex` on `#help-panel`, which outranks
 * the browser's own `dialog:not([open]) { display: none }`, so "Got it" set
 * `dialog.open` to false and the dialog kept rendering, and came back on every
 * later load despite the stored dismissal. Rectangles, computed layout and
 * markup all passed; nothing had clicked the button. See
 * [L-measuring-a-control-is-not-operating-it] in docs/lessons-learned.md.
 *
 * What one run establishes, in order:
 *
 * 1. On a first visit the dialog is open and rendered.
 * 2. Tapping "Got it" leaves `getComputedStyle(dialog).display` at `none` and
 *    the dialog's bounding height at zero, not merely `dialog.open` false.
 * 3. After a reload it stays closed, because the dismissal was stored.
 * 4. Help in the Options menu reopens it at the first instruction, with focus
 *    on the title.
 * 5. With it open, "Got it" sits inside the viewport at 375x812 portrait and
 *    at 640x360 landscape.
 *
 * What it does NOT establish: Playwright's mobile emulation does not emulate
 * `env(safe-area-inset-*)`, so the dialog's safe-area padding is not proven
 * here. Emulating insets needs `Emulation.setDeviceMetricsOverride` over CDP,
 * and this script does not do that. The report says so in `notCovered`.
 *
 * `--expect-regression` is the positive control. It injects the known
 * defective rule, `#help-panel { display: flex }`, before the page loads and
 * requires the bug's exact signature after Got it: `dialog.open` false and
 * the computed display not `none`. A run that still hides the dialog proves
 * the detector is blind; a run where the dialog never closed at all proves
 * nothing about the cascade. Both exit 1.
 *
 * The JSON report is always written, even when a tap times out: the steps
 * taken so far are the evidence, and an unexpected error is recorded as a
 * failed step.
 *
 * Exit codes: 0 pass, 1 fail.
 *
 * Usage: node scripts/help-dialog-proof.cjs [--url <url>] [--output <file>]
 *                                           [--expect-regression]
 *
 * Needs a server already running; see docs/gpu-verification.md for the two
 * standing ones. Against the live working tree that is:
 *   node scripts/help-dialog-proof.cjs --url http://127.0.0.1:5174/
 *
 * The cheap CI-able proxy, a text sweep of every CSS rule that can match the
 * closed dialog, stays in web/tests/help-panel.test.ts. This script needs a
 * running server, so it cannot gate a pull request as-is; run it by hand
 * whenever the dialog's styling or wiring changes.
 */
const fs = require('node:fs');
const path = require('node:path');

const ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

const PORTRAIT = { width: 375, height: 812 };
const LANDSCAPE = { width: 640, height: 360 };

/** The known defect, as an author rule the browser's own stylesheet loses to. */
const REGRESSION_CSS = '#help-panel { display: flex; }';

function parseArgs(argv) {
  const result = { url: 'http://127.0.0.1:5174/', output: null, expectRegression: false };
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
    else if (value === '--expect-regression') result.expectRegression = true;
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

/** Everything a check reads about the dialog, taken in one evaluate. */
const DIALOG_STATE = () => {
  const dialog = document.querySelector('#help-panel');
  if (dialog === null) return null;
  const rect = dialog.getBoundingClientRect();
  const body = document.querySelector('#help-body');
  const active = document.activeElement;
  return {
    open: dialog.open,
    display: getComputedStyle(dialog).display,
    height: rect.height,
    bodyScrollTop: body === null ? null : body.scrollTop,
    activeElementId: active === null ? null : active.id,
  };
};

/** The confirm button's rectangle against the viewport. */
const BUTTON_PLACEMENT = () => {
  const button = document.querySelector('#close-help');
  if (button === null) return null;
  const rect = button.getBoundingClientRect();
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  return {
    rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right },
    viewport,
    inside:
      rect.width > 0 &&
      rect.height > 0 &&
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= viewport.height &&
      rect.right <= viewport.width,
  };
};

/** Closed means hidden: the browser's rule won, not just the attribute. */
function isHidden(state) {
  return state !== null && !state.open && state.display === 'none' && state.height === 0;
}

function isShowing(state) {
  return state !== null && state.open && state.display !== 'none' && state.height > 0;
}

async function waitForBoot(page) {
  // `?stress=0` adds no filler entities; it only asks main() to publish the
  // debug handle, which is the sign that the HUD, including the help wiring,
  // has been built.
  let booted = true;
  await page
    .waitForFunction(() => globalThis.__terriStress !== undefined, undefined, {
      polling: 100,
      timeout: 60_000,
    })
    .catch(() => {
      booted = false;
    });
  return booted;
}

/** The bug's exact signature: the attribute is gone but the box still renders. */
function closedButRendering(state) {
  return state !== null && !state.open && state.display !== 'none';
}

async function run(browser, url, expectRegression) {
  const context = await browser.newContext({
    viewport: PORTRAIT,
    userAgent: ANDROID_USER_AGENT,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  if (expectRegression) {
    // Injected before any application module runs, so it sits in the cascade
    // exactly where the original author rule did.
    await page.addInitScript((css) => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.append(style);
      });
    }, REGRESSION_CSS);
  }
  const target = new URL(url);
  target.searchParams.set('stress', '0');
  target.searchParams.set('audio', '0');

  const steps = [];
  const step = (name, pass, detail) => {
    steps.push({ name, pass, detail });
    return pass;
  };
  let booted = false;
  let afterClose = null;

  // Every tap can throw a Playwright timeout. The steps already taken are
  // the evidence, so an unexpected error becomes a failed step in the
  // report rather than a crash that prints nothing.
  try {
    await page.goto(target.toString(), { waitUntil: 'load', timeout: 60_000 });
    booted = await waitForBoot(page);
    if (!booted) {
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1000));
      step('the app booted', false, { bodyText });
    } else {
      // 1. A first visit opens it. The context is fresh, so nothing is stored.
      const firstVisit = await page.evaluate(DIALOG_STATE);
      step('opens on a first visit', isShowing(firstVisit), firstVisit);

      // 2. Tap "Got it", then ask the cascade rather than the attribute.
      await page.tap('#close-help');
      await page
        .waitForFunction(() => !document.querySelector('#help-panel').open, undefined, {
          polling: 50,
          timeout: 5_000,
        })
        .catch(() => undefined);
      afterClose = await page.evaluate(DIALOG_STATE);
      const closedHides = step('closing hides it', isHidden(afterClose), afterClose);

      // A dialog that is still rendering sits over the whole HUD and swallows
      // every later tap, so the remaining steps would only time out. Stop
      // here and report what was seen; this is the defect the script exists
      // for.
      if (closedHides) {
        // 3. Reload. The dismissal is stored, so it must not come back.
        await page.reload({ waitUntil: 'load', timeout: 60_000 });
        const rebooted = await waitForBoot(page);
        const afterReload = rebooted ? await page.evaluate(DIALOG_STATE) : null;
        if (!step('stays closed after a reload', rebooted && isHidden(afterReload), afterReload)) {
          throw new Error('the dialog did not stay closed, so reopening it proves nothing');
        }

        // 4. Reopen from the Options menu, the way a player does.
        await page.tap('#options-toggle');
        await page.waitForSelector('#show-help', { state: 'visible', timeout: 5_000 });
        await page.tap('#show-help');
        await page
          .waitForFunction(() => document.querySelector('#help-panel').open, undefined, {
            polling: 50,
            timeout: 5_000,
          })
          .catch(() => undefined);
        const reopened = await page.evaluate(DIALOG_STATE);
        step(
          'reopens at the first instruction with focus on the title',
          isShowing(reopened) &&
            reopened.bodyScrollTop === 0 &&
            reopened.activeElementId === 'help-title',
          reopened,
        );

        // 5. The confirm button is reachable in both phone orientations.
        const portrait = await page.evaluate(BUTTON_PLACEMENT);
        step('Got it sits inside the 375x812 portrait viewport', portrait?.inside === true, portrait);
        await page.setViewportSize(LANDSCAPE);
        // Two frames so the layout has settled under the new size.
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const landscape = await page.evaluate(BUTTON_PLACEMENT);
        step('Got it sits inside the 640x360 landscape viewport', landscape?.inside === true, landscape);
      }
    }
  } catch (error) {
    step('no unexpected error', false, { error: String(error) });
  } finally {
    await context.close();
  }

  const closedHides = isHidden(afterClose);
  // What the positive control must see: Got it ran and cleared the attribute,
  // and the author display rule kept the box rendering anyway. A dialog that
  // never closed at all would mean the detector was not exercised.
  const controlCaught = closedButRendering(afterClose);
  return {
    booted,
    expectRegression,
    pageErrors,
    steps,
    closedHides,
    controlCaught,
    notCovered: [
      'env(safe-area-inset-*) padding: Playwright mobile emulation does not emulate insets, and this script does not set Emulation.setDeviceMetricsOverride over CDP.',
    ],
    // The one verdict `main` prints: in the ordinary run every step passed;
    // in the positive control the injected rule produced the bug's signature.
    pass:
      pageErrors.length === 0 &&
      (expectRegression ? controlCaught : steps.every((entry) => entry.pass)),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--window-position=0,0', '--mute-audio'],
  });
  let report;
  try {
    report = await run(browser, args.url, args.expectRegression);
  } finally {
    await browser.close();
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output !== null) fs.writeFileSync(args.output, json, 'utf8');
  console.log(json);
  if (!report.booted) {
    console.error('FAIL: the app did not start, so nothing about the dialog was tested.');
    process.exitCode = 1;
    return;
  }
  if (report.pageErrors.length > 0) {
    console.error(`FAIL: the page threw: ${report.pageErrors[0]}`);
    process.exitCode = 1;
    return;
  }
  if (args.expectRegression) {
    if (report.closedHides) {
      console.error(
        'FAIL: with the known defective rule injected, closing still hid the dialog, ' +
          'so this check cannot see the bug it exists for.',
      );
      process.exitCode = 1;
      return;
    }
    if (!report.controlCaught) {
      console.error(
        'FAIL: the dialog never closed at all, so the display check was not exercised ' +
          'and the positive control proves nothing. See the JSON above.',
      );
      process.exitCode = 1;
      return;
    }
  } else {
    const failed = report.steps.find((entry) => !entry.pass);
    if (failed !== undefined) {
      console.error(`FAIL: ${failed.name}: ${JSON.stringify(failed.detail)}`);
      process.exitCode = 1;
      return;
    }
  }
  // Every branch above returns, so reaching here and `report.pass` disagreeing
  // would mean the verdict printed and the verdict recorded had drifted apart.
  if (!report.pass) {
    console.error('FAIL: the report did not pass. See the JSON above.');
    process.exitCode = 1;
    return;
  }
  console.log(
    args.expectRegression
      ? 'PASS (positive control): the injected author display rule kept the closed ' +
          'dialog rendering, and the closed-state check caught it.'
      : 'PASS: Got it hid the dialog, it stayed hidden after a reload, Help brought it ' +
          'back at the top with the title focused, and Got it is reachable in both ' +
          'phone orientations. Safe-area insets are not covered; see notCovered.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
