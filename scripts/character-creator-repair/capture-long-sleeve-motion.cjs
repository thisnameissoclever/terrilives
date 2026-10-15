const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '../..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve(process.env.SLEEVE_MOTION_OUTPUT || path.join(root, 'docs/evidence/2026-10-14-long-sleeves', `motion-${stamp}`));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = { capturedAt: stamp, output, rows: [], cycles: [], errors: [], producerHashes: {} };

async function run() {
  fs.mkdirSync(output, { recursive: true });
  for (const file of ['scripts/character-creator-repair/capture-long-sleeve-motion.cjs',
    'web/src/ui/character-creator/view.ts', 'web/src/ui/character-creator/preview.ts',
    'web/src/ui/character-creator/clock.ts', 'web/src/ui/character-creator/animation-metadata.ts',
    'assets/models/sims/character-creator/export/manifest.json']) report.producerHashes[file] = sha(fs.readFileSync(path.join(root, file)));
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio'] });
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(String(error)));
    await page.goto(process.env.CREATOR_REVIEW_URL || 'http://127.0.0.1:5187/proofs/character-creator.html');
    await page.waitForFunction(() => window.creatorHarness || window.creatorHarnessError, null, { timeout: 180000 });
    const error = await page.evaluate(() => window.creatorHarnessError);
    if (error) throw Error(error);
    await page.bringToFront();
    await page.evaluate(() => { document.title = 'Repaired sleeves - live creator animation review'; });
    const previewModuleUrls = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource')
      .map(entry => entry.name).filter(url => /\/src\/ui\/character-creator\/preview\.(?:ts|js)(?:\?|$)/.test(url)))]);
    report.instrumentation = { previewModuleUrls };
    if (previewModuleUrls.length !== 1) throw Error(`Expected one loaded Preview module, found ${JSON.stringify(previewModuleUrls)}`);
    await page.evaluate(async moduleUrl => {
      const { CreatorPreview } = await import(moduleUrl);
      const original = CreatorPreview.prototype.draw;
      window.sleeveMotionFrames = [];
      CreatorPreview.prototype.draw = async function(...args) {
        const [appearance, facing, action, requested, clock] = args;
        let consumed = requested;
        if (clock) args[4] = () => { consumed = clock(); return consumed; };
        const drawn = await original.apply(this, args);
        if (drawn) window.sleeveMotionFrames.push({ action, facing, requested, consumed, time: performance.now(),
          presentation: appearance.presentation, sleeves: appearance.sleeves });
        return drawn;
      };
    }, previewModuleUrls[0]);
    for (const presentation of ['masculine', 'feminine']) {
      await page.evaluate(presentation => {
        const harness = window.creatorHarness;
        harness.open(null, 61423);
        harness.draft.set('appearance.presentation', presentation);
        harness.draft.resetAppearanceToPreset();
        harness.draft.set('appearance.sleeves', 'long');
        harness.draft.set('appearance.colors.shirt', [126, 63, 91]);
      }, presentation);
      await page.locator('[data-page="appearance"]').click();
      for (let facing = 0; facing < 4; facing++) {
        if (facing) await page.locator('[data-turn]').click();
        for (const [action, seconds] of [['walk', 1], ['read', 4.8], ['mop', 4]]) {
          const marker = await page.evaluate(() => window.sleeveMotionFrames.length);
          await page.locator('[data-action]').selectOption(action);
          try {
            await page.waitForFunction(({ marker, action, presentation, facing }) => window.sleeveMotionFrames.slice(marker)
              .some(row => row.action === action && row.presentation === presentation && row.sleeves === 'long' && row.facing === facing*Math.PI/2),
            { marker, action, presentation, facing }, { timeout: 60000 });
          } catch (error) {
            report.observerFailure = await page.evaluate(() => ({ visibility: document.visibilityState,
              appearance: window.creatorHarness.value.appearance, count: window.sleeveMotionFrames.length,
              recent: window.sleeveMotionFrames.slice(-3), status: document.querySelector('.creator-status')?.textContent }));
            await page.screenshot({ path: path.join(output, 'observer-failure.png') });
            throw error;
          }
          if (await page.locator('[data-play]').getAttribute('aria-label') !== 'Pause animation') throw Error('The actual creator animation is paused');
          for (let sample = 0; sample < 8; sample++) {
            await page.waitForTimeout(seconds*250);
            const file = `${presentation}-${action}-${facing}-${sample}.png`;
            const drawBeforeCapture = await page.evaluate(() => window.sleeveMotionFrames.at(-1));
            await page.locator('.creator-portrait').screenshot({ path: path.join(output, file) });
            const drawAfterCapture = await page.evaluate(() => window.sleeveMotionFrames.at(-1));
            report.rows.push({ presentation, action, facing, sample, file, drawBeforeCapture, drawAfterCapture });
            if (sample === 0 || sample === 7) await page.locator('.creator-world-sample canvas').screenshot({ path: path.join(output, `normal-${file}`) });
          }
          const frames = await page.evaluate(({ marker, action, presentation, facing }) => window.sleeveMotionFrames.slice(marker)
            .filter(row => row.action === action && row.presentation === presentation && row.sleeves === 'long' && row.facing === facing*Math.PI/2),
          { marker, action, presentation, facing });
          const wrapped = frames.some((row, index) => index > 0 && row.consumed < frames[index-1].consumed);
          report.cycles.push({ presentation, action, facing, wrapped, frames });
          if (!wrapped || new Set(frames.map(row => row.consumed)).size < 5) throw Error(`The live clock did not complete a cycle: ${presentation}/${action}/${facing}`);
          const status = await page.locator('.creator-status').textContent();
          if (status) throw Error(status);
        }
      }
    }
    report.errors.push(...await page.evaluate(() => window.creatorHarness.errors));
    for (const [file, digest] of Object.entries(report.producerHashes)) {
      if (sha(fs.readFileSync(path.join(root, file))) !== digest) throw Error(`Motion source changed during review: ${file}`);
    }
    if (report.errors.length) throw Error('Browser or graphics errors occurred');
  } finally {
    await context?.close();
    await browser.close();
    fs.writeFileSync(path.join(output, 'motion-report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ output, cycles: report.cycles.length, captures: report.rows.length, errors: report.errors.length }));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
