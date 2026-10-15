const { chromium } = require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const out = path.resolve('docs/evidence/2026-10-13-creator-repair/final-creator-review', process.env.FINAL_CREATOR_RUN || 'pass-2');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const write = (name, data) => fs.writeFileSync(path.join(out, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
const sourceFiles = [];
for (const directory of ['web/src/character', 'web/src/ui/character-creator', 'web/src/render/character']) {
  const walk = dir => { for (const row of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, row.name); if (row.isDirectory()) walk(file); else sourceFiles.push(file); } };
  walk(directory);
}
sourceFiles.push('web/src/render/scene-pipeline.ts', 'web/src/render/sprite-pipelines.ts', 'web/src/render/scene-target.ts', 'web/src/render/sprites.ts', 'web/src/render/sprites.wgsl', 'web/src/main.ts', 'web/index.html');
const sourceHashes = () => Object.fromEntries(sourceFiles.sort().map(file => [file.replaceAll('\\', '/'), hash(fs.readFileSync(file))]));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const beforeHashes = sourceHashes();
  write('source-before.json', beforeHashes);
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const errors = [], notices = [], checks = [], captures = [];
  let page;
  const check = (name, evidence, condition = true) => { checks.push({ name, pass: !!condition, evidence }); if (!condition) throw Error(name + ': ' + JSON.stringify(evidence)); };
  try {
    page = await context.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) { const row = { type: message.type(), text: message.text(), location: message.location() }; if (row.location.url.endsWith('/favicon.ico')) notices.push(row); else errors.push(row); } });
    await page.goto('http://127.0.0.1:5187/?stress=0');
    await page.waitForFunction(() => window.__terriStress || document.querySelector('#startup-error'), null, { timeout: 120000 });
    if (await page.locator('#help-panel').evaluate(el => el.open)) await page.locator('#close-help').click();
    await page.getByText('Pause', { exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const imported = await page.evaluate(async () => {
      const urls = performance.getEntriesByType('resource').map(row => row.name);
      const url = urls.find(url => /\/ui\/character-creator\/view\.[jt]s(?:\?|$)/.test(url));
      if (!url) throw Error('Actual creator module URL not observed');
      const { CreatorView } = await import(url);
      const render = CreatorView.prototype.render;
      CreatorView.prototype.render = function (...args) { window.__finalCreatorView = this; window.__finalCreatorSource = this.session.source; return render.apply(this, args); };
      return url;
    });
    check('Observer attached to actual application module', imported, !!imported);
    const root = page.locator('#character-creator-root');
    const byField = id => root.locator(`[data-field=${JSON.stringify(id)}]`);
    const nav = async name => { await root.locator(`[data-page="${name}"]`).click(); await page.waitForTimeout(40); };
    const openGroup = async name => { const group = root.locator('details').filter({ has: page.locator('summary', { hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }); if (await group.count() && !await group.evaluate(el => el.open)) await group.locator('summary').click(); };
    const ready = async () => { await page.waitForFunction(() => window.__finalCreatorView?.previewReady && !window.__finalCreatorView?.previewInFlight, null, { timeout: 60000 }); };
    const value = () => page.evaluate(() => window.__finalCreatorView.session.draft.value);
    const number = async (id, n) => { const input = byField(id).locator('input[type=number]'); await input.fill(String(n)); await input.press('Tab'); };
    const capture = async (name, locator = root) => { await ready(); const file = name + '.png'; await locator.screenshot({ path: path.join(out, file) }); captures.push(file); };
    await page.locator('#options-toggle').click();
    await page.locator('#new-housemate').click();
    await ready();
    const initial = await value();
    check('Walking is selected by default', await root.locator('[data-action]').inputValue(), await root.locator('[data-action]').inputValue() === 'walk');
    check('Walking starts playing', await root.locator('[data-play]').textContent(), await root.locator('[data-play]').textContent() === 'Pause');
    check('First draft traits are between one and four', initial.traits, initial.traits.length >= 1 && initial.traits.length <= 4);
    const groups = await root.locator('.creator-editor details').evaluateAll(nodes => nodes.map(node => ({ label: node.querySelector('summary').textContent, open: node.open })));
    check('Appearance groups start collapsed', groups, JSON.stringify(groups) === JSON.stringify(['Colors', 'Body', 'Style', 'Face', 'Details'].map(label => ({ label, open: false }))));
    await root.locator('[data-global-random]').click();
    await ready();
    const firstRoll = await value();
    check('First Randomize traits are between one and four', firstRoll.traits, firstRoll.traits.length >= 1 && firstRoll.traits.length <= 4);
    await capture('01-desktop-first-randomize');

    await nav('personality');
    await openGroup('Conditions');
    const traitIds = await root.locator('[data-field]').evaluateAll(nodes => nodes.map(node => node.dataset.field).filter(id => id.startsWith('["trait",')));
    for (const id of traitIds) if (await byField(id).locator('input[type=checkbox]').isChecked()) await byField(id).locator('input[type=checkbox]').uncheck();
    const cap = [];
    for (let count = 0; count <= 4; count++) {
      if (count) await byField(traitIds[count - 1]).locator('input[type=checkbox]').check();
      const row = await root.evaluate(el => ({ note: el.querySelector('.creator-note').textContent, occurrences: el.textContent.split('Remove a selected trait to make room.').length - 1, checked: [...el.querySelectorAll('.creator-field input[type=checkbox]')].filter(input => input.checked).length, disabled: [...el.querySelectorAll('.creator-field input[type=checkbox]')].filter(input => !input.checked && input.disabled).length }));
      cap.push(row);
      check('Trait cap count ' + count, row, row.checked === count && row.occurrences === (count === 4 ? 1 : 0) && (count === 4 ? row.disabled === traitIds.length - 4 : row.disabled === 0));
    }
    await capture('02-trait-limit');
    await byField(traitIds[0]).locator('input[type=checkbox]').uncheck();
    check('Selected trait remains removable', (await value()).traits.length, (await value()).traits.length === 3);
    write('trait-cap.json', cap);
    await capture('03-trait-room');
    await byField('behavior.shyness').locator('.creator-lock').click();
    const randomDisabled = await byField('behavior.shyness').getByRole('button', { name: 'Shyness: randomize', exact: true }).isDisabled();
    check('Locked field Random is disabled', randomDisabled, randomDisabled);
    const locked = (await value()).behavior.shyness;
    await root.getByRole('button', { name: 'Randomize section', exact: true }).click();
    check('Section random respects Shyness lock', (await value()).behavior.shyness, (await value()).behavior.shyness === locked);
    await byField('behavior.shyness').locator('.creator-lock').click();

    await nav('appearance');
    await openGroup('Body');
    await byField('appearance.presentation').locator('select').selectOption({ label: 'Female' });
    const femaleName = (await value()).name;
    await byField('appearance.presentation').locator('select').selectOption({ label: 'Male' });
    check('Manual gender change keeps name', (await value()).name, (await value()).name === femaleName);
    const names = [];
    for (const gender of ['Male', 'Female']) {
      await nav('appearance'); await byField('appearance.presentation').locator('select').selectOption({ label: gender });
      await nav('identity');
      for (let i = 0; i < 6; i++) { await byField('name').getByRole('button', { name: 'Name: randomize', exact: true }).click(); names.push({ gender, name: (await value()).name }); }
    }
    const tags = await page.evaluate(async () => (await import('/src/character/names.ts')).taggedCharacterNames);
    check('Name samples use current gender or either tag', names, names.every(row => ['either', row.gender.toLowerCase()].includes(tags.find(tag => tag.name === row.name)?.gender)));
    write('name-samples.json', { names, tags });

    await nav('needs');
    const beforeCategory = await value();
    const categoryRows = await page.evaluate(() => {
      const draft = window.__finalCreatorView.session.draft;
      return draft.fields.filter(field => field.id.startsWith('activity-category:')).map(field => ({ id: field.id, label: field.label, displayed: document.querySelector(`[data-field="${field.id}"] input[type=number]`).value, value: field.get(draft.value) }));
    });
    check('Ten activity categories', categoryRows, categoryRows.length === 10);
    check('Viewing categories leaves draft exact', null, JSON.stringify(beforeCategory) === JSON.stringify(await value()));
    await number('activity-category:read', 1.6);
    const categoryChanged = await value();
    const readingRoutes = [['sofa', 'read'], ['bookshelf', 'read'], ['chair', 'read'], ['long_sofa', 'read'], ['armchair', 'read'], ['desk_chair', 'read'], ['reading_chair', 'settle_in']];
    const f32 = n => { const b = Buffer.alloc(4); b.writeFloatLE(n); return b.readUInt32LE(); };
    const selectedRows = categoryChanged.behavior.dispositions.filter(row => readingRoutes.some(([object, action]) => row.object === object && row.action === action));
    check('Read category sets all seven routes atomically', selectedRows, selectedRows.length === 7 && selectedRows.every(row => row.weight === f32(1.6)));
    await root.locator('[data-undo]').click();
    check('Category Undo restores exact draft', null, JSON.stringify(await value()) === JSON.stringify(beforeCategory));
    await number('activity-category:read', 1.6);
    const beforePersonality = await value();
    await nav('personality'); await number('behavior.shyness', 17); await root.locator('[data-reset]').click();
    const afterPersonality = await value();
    check('Personality reset preserves need rates and activities', null, JSON.stringify(afterPersonality.behavior.dispositions) === JSON.stringify(beforePersonality.behavior.dispositions) && JSON.stringify(afterPersonality.behavior.drain) === JSON.stringify(beforePersonality.behavior.drain) && JSON.stringify(afterPersonality.behavior.recovery) === JSON.stringify(beforePersonality.behavior.recovery));
    await number('behavior.shyness', 23);
    await nav('needs'); await root.locator('[data-reset]').click();
    const resetCategories = await page.evaluate(() => {
      const draft = window.__finalCreatorView.session.draft;
      return draft.fields.filter(field => field.id.startsWith('activity-category:')).map(field => ({ id: field.id, value: field.get(draft.value) }));
    });
    check('Needs reset preserves Personality and restores 1.0x activity preferences', resetCategories, (await value()).behavior.shyness === 23 && resetCategories.length === 10 && resetCategories.every(row => row.value === 1));
    write('category-checks.json', { categoryRows, beforeCategory, categoryChanged, afterPersonality });

    await nav('appearance'); await openGroup('Body');
    const heightProof = [];
    for (const height of [0, 50, 100]) {
      await number('appearance.body.height', height);
      const description = await byField('appearance.body.height').innerText();
      await nav('review'); await openGroup('Appearance');
      const shown = await root.locator('dt').filter({ hasText: /^Height$/ }).evaluate(el => el.nextElementSibling.textContent);
      heightProof.push({ height, description, shown });
      check('Height Review ' + height, shown, shown === `${85 + .3 * height}% of average`);
      await capture('04-height-' + height);
      await nav('appearance');
    }
    check('Height explains center and endpoints', heightProof[0].description, heightProof[0].description.includes('50 is average height; 0 and 100 are 15% shorter and taller.'));
    write('height-proof.json', heightProof);

    const bodyCases = [{ name: 'neutral', height: 50, build: 50, shoulders: 50, hips: 50, torso: 50 }, { name: 'minimum', height: 0, build: 0, shoulders: 0, hips: 0, torso: 0 }, { name: 'maximum', height: 100, build: 100, shoulders: 100, hips: 100, torso: 100 }];
    if (await root.locator('[data-play]').textContent() === 'Pause') await root.locator('[data-play]').click();
    await root.locator('[data-action]').selectOption('read'); await ready();
    const readingProof = [];
    for (const gender of ['Male', 'Female']) for (const body of bodyCases) {
      await byField('appearance.presentation').locator('select').selectOption({ label: gender });
      for (const [key, n] of Object.entries(body)) if (key !== 'name') await number('appearance.body.' + key, n);
      await ready();
      const actualBody = (await value()).appearance.body;
      check('Body controls accepted: ' + gender + ' ' + body.name, actualBody, Object.entries(body).filter(([key]) => key !== 'name').every(([key, n]) => actualBody[key] === n));
      for (let facing = 0; facing < 4; facing++) {
        const observed = await root.locator('[data-facing]').innerText();
        const name = `reading-${gender.toLowerCase()}-${body.name}-${facing}`;
        await capture(name, root.locator('.creator-preview'));
        readingProof.push({ gender, body: (await value()).appearance.body, facing: observed, file: name + '.png' });
        await root.locator('[data-turn]').click(); await ready();
      }
    }
    write('reading-proof.json', readingProof);
    await capture('05-desktop-preview-spacing');

    const animation = [];
    for (const [action, label] of [['idle', 'Standing'], ['walk', 'Walking'], ['read', 'Reading'], ['mop', 'Cleaning']]) {
      await root.locator('[data-action]').selectOption(action); await ready();
      if (await root.locator('[data-play]').textContent() === 'Play') await root.locator('[data-play]').click();
      await page.waitForTimeout(150);
      const a = await root.locator('.creator-portrait').screenshot();
      await page.waitForTimeout(450);
      const b = await root.locator('.creator-portrait').screenshot();
      await root.locator('[data-play]').click(); await ready();
      const c = await root.locator('.creator-portrait').screenshot();
      await page.waitForTimeout(250);
      const d = await root.locator('.creator-portrait').screenshot();
      fs.writeFileSync(path.join(out, `animation-${action}-a.png`), a); fs.writeFileSync(path.join(out, `animation-${action}-b.png`), b);
      const row = { label, playingDifferent: hash(a) !== hash(b), pausedSame: hash(c) === hash(d) }; animation.push(row);
      check(label + ' pause freezes actual pixels', row, row.pausedSame);
      if (action !== 'idle') check(label + ' plays actual pixels', row, row.playingDifferent);
    }
    write('animation-proof.json', animation);
    await root.locator('[data-action]').selectOption('idle'); await ready();
    await page.evaluate(() => { const preview = window.__finalCreatorView.preview; window.__finalPreviewRefs = { actor: preview.actor, small: preview.smallActor, geometry: preview.actor.geometry, deformed: preview.actor.deformed, generation: preview.generation }; });
    const stableBefore = await root.locator('.creator-portrait').screenshot();
    const boundsBefore = await root.locator('.creator-portrait').boundingBox();
    await nav('identity'); await byField('name').locator('input').fill('Final Creator Review'); await byField('name').locator('input').press('Tab');
    await nav('personality'); await number('behavior.shyness', 31);
    const stableAfter = await root.locator('.creator-portrait').screenshot();
    const stable = await page.evaluate(() => { const p = window.__finalCreatorView.preview, r = window.__finalPreviewRefs; return { actor: p.actor === r.actor, small: p.smallActor === r.small, geometry: p.actor.geometry === r.geometry, deformed: p.actor.deformed === r.deformed, generationBefore: r.generation, generationAfter: p.generation }; });
    check('Unrelated name and shyness edits keep actual preview and geometry', stable, Object.entries(stable).filter(([key]) => !key.startsWith('generation')).every(([, value]) => value) && stable.generationBefore === stable.generationAfter && hash(stableBefore) === hash(stableAfter) && JSON.stringify(boundsBefore) === JSON.stringify(await root.locator('.creator-portrait').boundingBox()));
    write('unrelated-edit-proof.json', { stable, boundsBefore, boundsAfter: await root.locator('.creator-portrait').boundingBox(), before: hash(stableBefore), after: hash(stableAfter) });

    await page.setViewportSize({ width: 390, height: 844 });
    await nav('review');
    for (const summary of await root.locator('.creator-editor summary').all()) await summary.click();
    const mobile = [];
    for (const show of [false, true]) {
      if (show) await root.locator('[data-preview-toggle]').click();
      for (const name of ['identity', 'appearance', 'personality', 'needs', 'interests', 'household', 'review']) {
        await nav(name);
        const row = { show, name, selected: await root.locator('[data-page][aria-current]').getAttribute('data-page'), nav: await root.locator('.creator-nav').boundingBox(), button: await root.locator(`[data-page="${name}"]`).boundingBox() };
        mobile.push(row); check('Narrow navigation ' + show + ' ' + name, row, row.selected === name && row.nav.height >= row.button.height);
      }
    }
    await capture('06-narrow-expanded-review');
    await root.locator('[data-action]').scrollIntoViewIfNeeded();
    await root.locator('[data-action]').selectOption('walk');
    await root.locator('[data-play]').click(); await page.waitForTimeout(250); await root.locator('[data-play]').click();
    await page.screenshot({ path: path.join(out, '07-narrow-preview-controls.png') });
    await nav('personality'); await capture('08-narrow-personality');
    write('mobile-proof.json', mobile);

    const beforeCancel = await page.evaluate(() => Array.from(window.__finalCreatorSource.saveBytes()));
    await root.locator('[data-cancel]').click(); await page.waitForTimeout(100);
    const afterCancel = await page.evaluate(() => Array.from(window.__finalCreatorSource.saveBytes()));
    check('Cancel leaves game bytes exact', { before: hash(Buffer.from(beforeCancel)), after: hash(Buffer.from(afterCancel)) }, JSON.stringify(beforeCancel) === JSON.stringify(afterCancel));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#edit-housemate').click(); await ready();
    const loadedBefore = await value();
    await nav('needs');
    check('Viewing saved sparse preferences leaves exact draft', null, JSON.stringify(await value()) === JSON.stringify(loadedBefore));
    await nav('identity'); await byField('name').locator('input').fill('Existing Person Review'); await byField('name').locator('input').press('Tab');
    await nav('review'); await ready(); await root.locator('[data-next]').click();
    await page.waitForFunction(() => !document.querySelector('#housemate-dialog').open);
    await page.locator('#edit-housemate').click(); await ready();
    const loadedAfter = await value();
    check('Committed name-only edit preserves all other saved groups exactly', { before: loadedBefore, after: loadedAfter }, loadedAfter.name === 'Existing Person Review' && JSON.stringify({ ...loadedBefore, name: loadedAfter.name }) === JSON.stringify(loadedAfter));
    write('saved-edit-proof.json', { loadedBefore, loadedAfter });
    await root.locator('[data-cancel]').click();
    check('No graphics warnings or application errors', errors, errors.length === 0);
    check('Source remained frozen', null, JSON.stringify(beforeHashes) === JSON.stringify(sourceHashes()));
    write('source-after.json', sourceHashes());
  } catch (error) {
    checks.push({ name: 'Harness completed', pass: false, error: String(error), stack: error.stack });
    if (page) await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
    console.error(error);
  } finally {
    write('checks.json', { checks, errors, notices, captures });
    await context.close(); await browser.close();
    write('cleanup.json', { contextClosed: true, browserClosed: true, serverOwner: 'root', serverUntouched: true });
  }
  console.log(JSON.stringify({ checks: checks.length, failed: checks.filter(row => !row.pass).map(row => row.name), errors: errors.length, screenshots: captures.length }));
})();
