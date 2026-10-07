const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright-core'));
const root = path.resolve(__dirname, '../../../../../..'), out = path.join(root, 'docs/assets/review-evidence/object-models/2026-10-06/resume-browser');
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
 const cases = [];
 try {
  for (const width of [1440, 390]) {
   const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390 });
   try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5198/?stress=0&audio=0');
    await page.waitForFunction(() => globalThis.__terriStress?.sim && document.querySelector('#book-title')?.options.length === 25);
    if (await page.locator('#close-help').isVisible()) await page.locator('#close-help').click();
    await page.locator('#time-controls label[for="speed-0"]').click();
    await page.evaluate(bytes => { const sim = globalThis.__terriStress.sim; if (!sim.loadBytes(Uint8Array.from(bytes))) throw Error('Fixture load failed'); sim.setSpeed(0); sim.flushCommands(); }, Array.from(fs.readFileSync(path.join(root, 'web/tests/fixtures/owned-reading-dropped.sav'))));
    await page.locator('#build-toggle').click(); await page.locator('#build-tool-buy').click();
    const options = await page.locator('#buy-object option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, text: node.textContent, disabled: node.disabled })));
    const model = options.find(option => !option.disabled && option.value && option.text.includes('Armchair')) || options.find(option => !option.disabled && option.value);
    await page.locator('#buy-object').selectOption(model.value);
    await page.locator('#buy-identity summary').click();
    await page.screenshot({ path: path.join(out, `review-buy-${width}.png`) });
    const buy = await page.locator('#buy-tool').innerText();
    await page.locator('#build-tool-books').click();
    await page.locator('#book-title').selectOption('the_locked_laundry');
    await page.locator('#book-description summary').click();
    await page.screenshot({ path: path.join(out, `review-books-${width}.png`) });
    const books = await page.locator('#book-tool').innerText();
    cases.push({ width, model, buy, books, furnitureModels: options.filter(option => option.value).length,
      bookTitles: await page.locator('#book-title option').count() - 1 });
   } finally { await context.close(); }
  }
 } finally { await browser.close(); }
 fs.writeFileSync(path.join(out, 'review-cards.json'), JSON.stringify({ wasmSHA256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'web/src/wasm/terri_wasm_bg.wasm'))).digest('hex'), cases, browserClosed: true, ownerReview: 'Pending' }, null, 2));
 console.log(JSON.stringify({ cases: cases.length, browserClosed: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });

