const { chromium } = require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const out = path.resolve('docs/evidence/2026-10-13-creator-repair/final-creator-review', process.env.FINAL_LEGACY_RUN || 'legacy-pass-2');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const routes = {
  eat: [['fridge','grab_snack'],['fridge','cook_dinner'],['dining_table','sit_properly'],['dining_table','take_prepared_food']],
  sleep: [['bed','sleep'],['double_bed','sleep_properly']],
  wash: [['shower','take_shower'],['toilet','relieve_self'],['sink','wash_hands'],['kitchen_sink','wash_up'],['bathtub','soak']],
  relax: [['sofa','lounge'],['chair','sit'],['long_sofa','stretch_out'],['long_sofa','sit'],['armchair','take_the_chair'],['desk_chair','sit'],['reading_chair','sit']],
  read: [['sofa','read'],['bookshelf','read'],['chair','read'],['long_sofa','read'],['armchair','read'],['desk_chair','read'],['reading_chair','settle_in']],
  television: [['television','watch_tv']], music: [['radio','listen']], exercise: [['moving_box','use_exercise_bike']], letters: [['desk','attend_correspondence']], fish: [['reference_shelf','watch_fish']],
};
const decode = bits => { const b = Buffer.alloc(4); b.writeUInt32LE(bits); return b.readFloatLE(); };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const report = { cases: [], errors: [], scope: 'Historical native save fixtures loaded through the existing isolated development harness, then edited through the actual CreatorView controls. This is separate from the main-game UI flow reviewed in pass-2.' };
  let page;
  try {
    page = await context.newPage();
    page.on('pageerror', e => report.errors.push(String(e)));
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) report.errors.push({ text: m.text(), location: m.location() }); });
    await page.goto('http://127.0.0.1:5187/proofs/character-creator.html');
    await page.waitForFunction(() => window.creatorHarness || window.creatorHarnessError, null, { timeout: 120000 });
    const root = page.locator('#creator');
    const readDraft = () => page.evaluate(() => window.creatorHarness.draft.value);
    for (const fixture of ['pre-voice-157.hex', 'pre-trait-library-2400.hex']) {
      const fixturePath = path.resolve('crates/terri-wasm/tests/fixtures', fixture);
      const bytes = Buffer.from(fs.readFileSync(fixturePath, 'utf8').replace(/\s/g, ''), 'hex');
      const loaded = await page.evaluate(async bytes => { const h = window.creatorHarness; h.close(); const loaded = await h.load(bytes); if (loaded) h.open(0, 450); return loaded; }, [...bytes]);
      assert.equal(loaded, true);
      await page.waitForTimeout(350);
      const before = await readDraft();
      const saveBefore = await page.evaluate(() => window.creatorHarness.save());
      await root.locator('[data-page="needs"]').click();
      const available = await page.evaluate(() => window.creatorHarness.draft.catalog.activities);
      const categories = [];
      for (const [id, membership] of Object.entries(routes)) {
        const members = membership.filter(([object, action]) => available.some(row => row.object === object && row.action === action));
        const values = members.map(([object, action]) => { const row = before.behavior.dispositions.find(row => row.object === object && row.action === action); return row ? decode(row.weight) : 1; });
        const expected = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 1;
        const displayed = Number(await root.locator(`[data-field="activity-category:${id}"] input[type=number]`).inputValue());
        assert.ok(Math.abs(expected - displayed) <= .000051, `${id}: ${expected} versus ${displayed}`);
        categories.push({ id, expected, displayed, explicitMembers: members.filter(([object, action]) => before.behavior.dispositions.some(row => row.object === object && row.action === action)).length, totalMembers: members.length });
      }
      for (const name of ['identity', 'appearance', 'personality', 'needs', 'interests', 'household', 'review']) await root.locator(`[data-page="${name}"]`).click();
      assert.deepEqual(await readDraft(), before);
      assert.deepEqual(await page.evaluate(() => window.creatorHarness.save()), saveBefore);
      await root.locator('[data-page="identity"]').click();
      await root.locator('[data-field="name"] input').fill('Historical Edit'); await root.locator('[data-field="name"] input').press('Tab');
      await root.locator('[data-page="review"]').click();
      await root.locator('[data-next]').click();
      await page.waitForFunction(() => document.querySelector('#result').textContent.startsWith('Applied character'), null, { timeout: 60000 });
      await page.locator('#edit').click();
      const after = await readDraft();
      assert.deepEqual(after, { ...before, name: 'Historical Edit' });
      const savedAfterName = await page.evaluate(() => window.creatorHarness.save());
      await root.locator('[data-page="personality"]').click();
      const shy = root.locator('[data-field="behavior.shyness"] input[type=number]'); await shy.fill('29'); await shy.press('Tab');
      await root.locator('[data-cancel]').click();
      assert.deepEqual(await page.evaluate(() => window.creatorHarness.save()), savedAfterName);
      report.cases.push({ fixture, sourceHash: hash(bytes), before, after, categories, viewingSaveExact: true, nameOnlyPreservesEveryOtherGroup: true, cancelSaveExact: true });
    }
    await page.locator('#new').click();
    await root.locator('[data-page="personality"]').click();
    await root.locator('details[data-group="Conditions"] summary').click();
    const traitIds = await root.locator('[data-field]').evaluateAll(nodes => nodes.map(node => node.dataset.field).filter(id => id.startsWith('["trait",')));
    const byField = id => root.locator(`[data-field=${JSON.stringify(id)}]`);
    for (const id of traitIds) if (await byField(id).locator('input[type=checkbox]').isChecked()) await byField(id).locator('input[type=checkbox]').uncheck();
    const notes = [];
    for (let count = 0; count <= 4; count++) {
      if (count) await byField(traitIds[count - 1]).locator('input[type=checkbox]').check();
      await root.locator('.creator-note').first().scrollIntoViewIfNeeded();
      const text = await root.locator('.creator-note').first().innerText();
      notes.push({ count, text });
      await root.screenshot({ path: path.join(out, `trait-note-${count}.png`) });
    }
    report.notes = notes;
    assert.deepEqual(report.errors, []);
    report.pass = true;
  } catch (error) {
    report.pass = false; report.failure = { error: String(error), stack: error.stack }; process.exitCode = 1; console.error(error);
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  } finally {
    fs.writeFileSync(path.join(out, 'report-before-cleanup.json'), JSON.stringify(report, null, 2), 'utf8');
    await browser.close(); report.cleanup = { contextClosedWithBrowser: true, browserClosed: true, serverUntouched: true };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  }
  console.log(JSON.stringify({ pass: report.pass, historicalCases: report.cases.length, errors: report.errors.length }));
})();
