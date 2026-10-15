const { chromium } = require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const out = path.resolve('docs/evidence/2026-10-13-creator-repair/final-creator-review', process.env.FINAL_LIFECYCLE_RUN || 'lifecycle-pass-2');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const report = { cycles: [], errors: [], notices: [], scope: 'Counts explicit buffers and textures allocated after startup; physical driver reclamation is not measured.' };
  let page;
  try {
    page = await context.newPage();
    page.on('pageerror', error => report.errors.push(String(error)));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) { const item = { text: message.text(), location: message.location() }; (item.location.url.endsWith('/favicon.ico') ? report.notices : report.errors).push(item); } });
    await page.goto('http://127.0.0.1:5187/?stress=0');
    await page.waitForFunction(() => window.__terriStress, null, { timeout: 120000 });
    if (await page.locator('#help-panel').evaluate(el => el.open)) await page.locator('#close-help').click();
    await page.getByText('Pause', { exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    report.contactBaseline = await page.evaluate(() => window.__terriStress.characters.readiness());
    const root = page.locator('#character-creator-root');
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map(row => row.name).find(url => /\/ui\/character-creator\/view\.[jt]s(?:\?|$)/.test(url));
      if (!url) throw Error('Creator module not observed');
      const { CreatorView } = await import(url), render = CreatorView.prototype.render;
      CreatorView.prototype.render = function (...args) { window.__finalLifecycleView = this; return render.apply(this, args); };
      const device = window.__terriStress.graphicsDevice;
      const buffers = new Set(), textures = new Set(), createBuffer = device.createBuffer.bind(device), createTexture = device.createTexture.bind(device);
      window.__finalResources = { buffers, textures, restore: () => { device.createBuffer = createBuffer; device.createTexture = createTexture; } };
      for (const [name, original, live] of [['createBuffer', createBuffer, buffers], ['createTexture', createTexture, textures]]) device[name] = function (descriptor) {
        const resource = original(descriptor), destroy = resource.destroy.bind(resource); live.add(resource);
        resource.destroy = () => { live.delete(resource); destroy(); }; return resource;
      };
    });
    const ready = () => page.waitForFunction(() => window.__finalLifecycleView?.previewReady && !window.__finalLifecycleView?.previewInFlight, null, { timeout: 60000 });
    const resourceCounts = () => page.evaluate(() => ({ buffers: window.__finalResources.buffers.size, textures: window.__finalResources.textures.size, bufferBytes: [...window.__finalResources.buffers].reduce((n, b) => n + b.size, 0) }));
    for (let cycle = 0; cycle < (process.env.FINAL_RECOVERY_ONLY ? 0 : 4); cycle++) {
      await page.locator('#options-toggle').click(); await page.locator('#new-housemate').click(); await ready();
      await root.locator('[data-play]').click();
      await root.locator('details[data-group="Body"] summary').click();
      const values = [];
      for (const n of [0, 50, 100, 33]) {
        const height = root.locator('[data-field="appearance.body.height"] input[type=number]');
        await height.fill(String(n)); await height.press('Tab'); await ready(); values.push(await height.inputValue());
      }
      await root.locator('[data-action]').selectOption('read'); await ready();
      const alive = await resourceCounts();
      assert.ok(alive.buffers > 0 && alive.textures > 0);
      await root.locator('[data-cancel]').click();
      await page.evaluate(async () => { await window.__terriStress.graphicsDevice.queue.onSubmittedWorkDone(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const after = await resourceCounts();
      const contacts = await page.evaluate(() => window.__terriStress.characters.readiness());
      report.cycles.push({ cycle, values, alive, after, contacts });
      assert.deepEqual(after, { buffers: 0, textures: 0, bufferBytes: 0 });
      assert.equal(contacts.service.owners, report.contactBaseline.service.owners);
      assert.equal(contacts.service.entries, report.contactBaseline.service.entries);
      assert.equal(contacts.service.queued, 0);
      assert.equal(contacts.service.inFlight, 0);
      assert.equal(contacts.service.lastError, null);
    }
    await page.evaluate(() => window.__finalResources.restore());
    await page.locator('#household-roster-members button').first().click();
    await page.waitForFunction(() => window.__terriStress.sim.selectedIndex() !== null);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const before = await page.evaluate(() => Array.from(window.__terriStress.sim.saveBytes()));
    fs.writeFileSync(path.join(out, 'before-open.bin'), Buffer.from(before));
    await page.locator('#edit-housemate').click(); await ready();
    await root.locator('[data-page="identity"]').click();
    await root.locator('[data-field="name"] input').fill('Draft survives graphics'); await root.locator('[data-field="name"] input').press('Tab');
    await root.locator('[data-page="appearance"]').click(); await root.locator('details[data-group="Body"] summary').click();
    await root.getByRole('button', { name: 'Height: protect from randomization', exact: true }).click();
    const beforeLoss = await page.evaluate(() => Array.from(window.__terriStress.sim.saveBytes()));
    fs.writeFileSync(path.join(out, 'before-loss.bin'), Buffer.from(beforeLoss));
    assert.deepEqual(beforeLoss, before);
    const generation = await page.evaluate(() => window.__terriStress.graphicsGeneration);
    const contactsBeforeLoss = await page.evaluate(() => window.__terriStress.characters.readiness());
    await page.evaluate(() => window.__terriStress.loseGraphics());
    await page.waitForFunction(old => window.__terriStress.graphicsGeneration === old + 1 && window.__finalLifecycleView?.previewReady && document.querySelector('#graphics-recovery').hidden, generation, { timeout: 90000 });
    await ready();
    const contactsAfterLoss = await page.evaluate(() => window.__terriStress.characters.readiness());
    assert.deepEqual(contactsAfterLoss, contactsBeforeLoss);
    await root.locator('details[data-group="Body"] summary').click();
    assert.equal(await root.getByRole('button', { name: 'Height: protect from randomization', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await root.getByRole('button', { name: 'Height: randomize', exact: true }).isDisabled(), true);
    await root.screenshot({ path: path.join(out, 'recovered-lock.png') });
    await root.locator('[data-page="identity"]').click();
    assert.equal(await root.locator('[data-field="name"] input').inputValue(), 'Draft survives graphics');
    await root.screenshot({ path: path.join(out, 'recovered-name.png') });
    const recovered = await page.evaluate(() => Array.from(window.__terriStress.sim.saveBytes()));
    fs.writeFileSync(path.join(out, 'recovered.bin'), Buffer.from(recovered));
    assert.deepEqual(recovered, before);
    await root.locator('[data-cancel]').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await page.evaluate(() => Array.from(window.__terriStress.sim.saveBytes()));
    fs.writeFileSync(path.join(out, 'after-cancel.bin'), Buffer.from(after));
    assert.deepEqual(after, before);
    report.recovery = { generationBefore: generation, generationAfter: await page.evaluate(() => window.__terriStress.graphicsGeneration), contactsBeforeLoss, contactsAfterLoss, unsavedNamePreserved: true, lockPreserved: true, lockRandomDisabled: true, bytesBefore: hash(Buffer.from(before)), bytesRecovered: hash(Buffer.from(recovered)), bytesAfterCancel: hash(Buffer.from(after)) };
    assert.deepEqual(report.errors, []);
    report.pass = true;
  } catch (error) {
    report.pass = false; report.failure = { error: String(error), stack: error.stack }; process.exitCode = 1; console.error(error);
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  } finally {
    await context.close(); await browser.close(); report.cleanup = { contextClosed: true, browserClosed: true, serverUntouched: true };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  }
  console.log(JSON.stringify({ pass: report.pass, cycles: report.cycles.length, errors: report.errors.length, recovery: report.recovery }));
})();
