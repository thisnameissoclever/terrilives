const { chromium } = require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const metricsForRow = require('./number-layout-metrics.cjs');
const gameUrl = 'http://127.0.0.1:5193';
const bundleDir = path.join(process.env.CREATOR_FINAL_BUILD_DIR || '.local-build/merge-20261015/web-width', 'assets');
const out = path.join(__dirname, process.env.CREATOR_FINAL_RUN || 'pass-01');
if (fs.existsSync(out)) throw Error('Choose a fresh CREATOR_FINAL_RUN; preserve existing evidence.');
fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = { gameUrl, checks: [], errors: [], captures: [], status: 'RUNNING' };
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  let page;
  try {
    page = await context.newPage();
    page.on('pageerror', error => report.errors.push(String(error)));
    page.on('console', message => {
      if (['warning', 'error'].includes(message.type()) && !message.location().url.endsWith('/favicon.ico')) report.errors.push(message.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem('terrilives.help-dismissed.v1', '1');
      let harness;
      Object.defineProperty(window, '__terriStress', {
        configurable: true,
        get: () => harness,
        set: value => { harness = value; document.querySelector('#speed-0').click(); },
      });
    });
    await page.goto(gameUrl + '/?stress=0');
    const started = async () => {
      await page.waitForFunction(() => window.__terriStress, null, { timeout: 120000 });
      await page.locator('#startup-loading').waitFor({ state: 'detached', timeout: 120000 });
      await page.locator('label[for="speed-0"]').click();
      if (await page.locator('#help-panel').evaluate(node => node.open)) await page.locator('#close-help').click();
    };
    await started();
    const root = page.locator('#character-creator-root');
    const byField = id => root.locator(`[data-field=${JSON.stringify(id)}]`);
    const nav = name => root.locator(`[data-page="${name}"]`).click();
    const group = async name => {
      const details = root.locator('details').filter({ has: page.locator('summary', { hasText: new RegExp('^' + name + '$') }) });
      if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
    };
    const ready = async () => {
      await nav('review');
      await page.waitForFunction(() => {
        const button = document.querySelector('#character-creator-root [data-next]');
        return button && !button.disabled;
      }, null, { timeout: 120000 });
    };
    const capture = async name => {
      await root.screenshot({ path: path.join(out, name + '.png') }); report.captures.push(name + '.png');
    };
    const snapshot = () => page.evaluate(() => __terriStress.sim.characterSnapshot(0));
    report.fixture = await page.evaluate(async () => {
      const harness = __terriStress, sim = harness.sim, catalog = sim.characterCatalog();
      const condition = catalog.traits.find(row => row.kind === 'condition');
      const other = catalog.traits.filter(row => row.kind !== 'condition').slice(0, 2);
      if (!condition || other.length !== 2) throw Error('Fixture needs one condition and two other traits.');
      const buffer = new ArrayBuffer(4), view = new DataView(buffer); view.setFloat32(0, .73123455, true);
      const traits = [other[0], condition, other[1]].map(row => ({ id: row.id, state: row.id === condition.id ? view.getUint32(0, true) : row.initial_state }));
      if (!await harness.characters.edit(73001, 0, { version: 1, traits })) throw Error('Fixture edit was not queued.');
      sim.flushCommands();
      if (sim.characterResults().some(row => row.request === 73001 && row.reason !== null)) throw Error('Fixture edit was refused.');
      const person = sim.characterAppearances().find(row => row.sim === 0); sim.select(person.entity);
      return { condition, other, snapshot: sim.characterSnapshot(0), severityBits: view.getUint32(0, true) };
    });
    await page.locator('#edit-housemate').click();
    check('Existing creator opens with Walking playing', await root.locator('[data-action]').inputValue() === 'walk' && await root.locator('[data-play]').textContent() === 'Pause');
    await ready(); await nav('personality'); await group('Conditions');
    const traitId = id => JSON.stringify(['trait', id]);
    const severityId = JSON.stringify(['severity', report.fixture.condition.id]);
    const severityBefore = await byField(severityId).locator('input[type=number]').inputValue();
    await byField(severityId).scrollIntoViewIfNeeded();
    await capture('01-condition-before');
    await byField(traitId(report.fixture.condition.id)).locator('input[type=checkbox]').uncheck();
    await byField(traitId(report.fixture.other[0].id)).locator('input[type=checkbox]').uncheck();
    await byField(traitId(report.fixture.condition.id)).locator('input[type=checkbox]').check();
    await byField(traitId(report.fixture.other[0].id)).locator('input[type=checkbox]').check();
    check('Reselected condition displays its exact previous severity', await byField(severityId).locator('input[type=number]').inputValue() === severityBefore);
    assert.deepStrictEqual(await snapshot(), report.fixture.snapshot); report.checks.push('Unapplied toggles preserve the live native record');
    await byField(severityId).scrollIntoViewIfNeeded();
    await capture('02-condition-reselected');
    report.percentageLayouts = [];
    for (const width of [1440, 1051, 1050, 761, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await byField(severityId).scrollIntoViewIfNeeded();
      for (const state of ['Lock', 'Locked']) {
        if (await byField(severityId).locator('.creator-lock').textContent() !== state) await byField(severityId).locator('.creator-lock').click();
        await byField(severityId).scrollIntoViewIfNeeded();
        const layout = await byField(severityId).evaluate(metricsForRow);
        report.percentageLayouts.push(layout);
        await capture('02-condition-width-' + width + '-' + state.toLowerCase());
        check('Loaded percentage is readable without overlap at ' + width + 'px/' + state,
          layout.fits && !layout.controlOverflow && !layout.editorOverflow && !layout.documentOverflow && !layout.editorScrollOverflow && !layout.overlaps.length && !layout.uncontained.length && !layout.clippedLabels.length && layout.value === severityBefore);
      }
    }
    check('Actual 320px creator has a content scrollbar', report.percentageLayouts.some(row => row.width === 320 && row.contentScrollbar > 0));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await nav('identity');
    await byField('name').locator('input[type=text]').fill('Final Creator Edit');
    await byField('name').locator('input[type=text]').press('Tab');
    await ready(); await group('Personality'); await capture('03-existing-review');
    await root.locator('[data-next]').click();
    await page.waitForFunction(() => !document.querySelector('#housemate-dialog').open, null, { timeout: 120000 });
    report.applied = await snapshot();
    assert.deepStrictEqual(report.applied, { ...report.fixture.snapshot, name: 'Final Creator Edit' });
    report.checks.push('Apply preserves exact stored traits, order and every unedited character field');
    await page.locator('#options-toggle').click(); await page.locator('#save-game').click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Game saved', null, { timeout: 60000 });
    await page.reload(); await started();
    assert.deepStrictEqual(await snapshot(), report.applied); report.checks.push('Player Save and browser reload preserve the applied character');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#options-toggle').click(); await page.locator('#new-housemate').click();
    check('Narrow new creator keeps the optional preview hidden', await root.getAttribute('data-preview-expanded') === 'false');
    report.navigation = [];
    for (const name of ['identity', 'appearance', 'personality', 'needs', 'interests', 'household', 'review']) {
      await nav(name);
      report.navigation.push(await root.evaluate((node, name) => ({ name, selected: node.querySelector('[aria-current=step]').dataset.page, overflow: document.documentElement.scrollWidth > innerWidth }), name));
    }
    check('Seven narrow pages are reachable without page overflow', report.navigation.every(row => row.name === row.selected && !row.overflow));
    await nav('identity'); await byField('name').locator('input[type=text]').fill('Final Narrow'); await byField('name').locator('input[type=text]').press('Tab');
    await nav('needs');
    const activities = root.locator('[data-field^="activity-category:"] input[type=number]');
    check('Ten activity categories begin visible', await activities.count() === 10 && await activities.first().isVisible());
    const prior = await activities.evaluateAll(nodes => nodes.map(node => Number(node.value)));
    await root.locator('[data-reset]').click();
    check('Section Reset restores all activity preferences to 1.0x', await activities.evaluateAll(nodes => nodes.every(node => Number(node.value) === 1)));
    await capture('04-narrow-reset'); await root.locator('[data-undo]').click();
    assert.deepStrictEqual(await activities.evaluateAll(nodes => nodes.map(node => Number(node.value))), prior); report.checks.push('Undo restores the previous activity preferences');
    await ready(); check('Move in enables without opening the narrow preview', await root.getAttribute('data-preview-expanded') === 'false');
    await capture('05-narrow-review'); await root.locator('[data-next]').click();
    await page.waitForFunction(() => __terriStress.sim.characterAppearances().length === 4, null, { timeout: 120000 });
    report.created = await page.evaluate(() => {
      const sim = __terriStress.sim;
      return sim.characterAppearances().map(row => sim.characterSnapshot(row.sim)).find(row => row.name === 'Final Narrow');
    });
    check('Hidden-preview Move in creates the new character with one to four traits', report.created && report.created.traits.length >= 1 && report.created.traits.length <= 4);
    await page.screenshot({ path: path.join(out, '06-created-household.png') }); report.captures.push('06-created-household.png');
    check('No browser or graphics diagnostics', report.errors.length === 0);
    report.browser = browser.version();
    report.bundleFiles = Object.fromEntries(fs.readdirSync(bundleDir).filter(name => /\.(js|css|wasm)$/.test(name)).map(name => [name, hash(fs.readFileSync(path.join(bundleDir, name)))]));
    report.loadedScripts = await page.evaluate(() => performance.getEntriesByType('resource').map(row => row.name).filter(url => /\/assets\/.*\.js(?:\?|$)/.test(url)));
    report.loadedStyles = await page.evaluate(() => performance.getEntriesByType('resource').map(row => row.name).filter(url => /\/assets\/.*\.css(?:\?|$)/.test(url)));
    const applicationBundle = fs.readdirSync(bundleDir).find(name => /^index-.*\.js$/.test(name));
    const applicationStyle = fs.readdirSync(bundleDir).find(name => /^index-.*\.css$/.test(name));
    check('Browser loaded the final built application module', !!applicationBundle && report.loadedScripts.some(url => url.endsWith('/assets/' + applicationBundle)));
    check('Browser loaded the final built application stylesheet', !!applicationStyle && report.loadedStyles.some(url => url.endsWith('/assets/' + applicationStyle)));
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.failure = String(error);
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close(); report.browserClosed = true;
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, errors: report.errors, browserClosed: report.browserClosed }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
