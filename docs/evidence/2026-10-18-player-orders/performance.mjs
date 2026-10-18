export async function runPerformance({ chromium, fs, qaRoot, helperPath }) {
  let browser;
  try {
    browser = await chromium.launch({ headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5198/?stress=0&debug=1');
    await page.locator('#startup-loading').waitFor({ state: 'hidden', timeout: 45000 });
    await page.evaluate(await fs.readFile(helperPath, 'utf8'));
    await page.evaluate(() => issue273Qa.ready());
    await page.evaluate(() => issue273Qa.select('Casey'));
    const fill = await page.evaluate(() => {
      const sim = __terriStress.sim, actor = issue273Qa.person('Casey').entity;
      const object = issue273Qa.objects().find(row => row.model === 'moving_box').entity;
      const started = performance.now();
      for (let index = 0; index < 1025; index++) {
        sim.useObject(actor, object, 0); sim.flushCommands(); sim.cancelIntents(actor); sim.flushCommands();
      }
      const batch = sim.orderEventsSince('0');
      if (batch.events.length !== 2048 || !batch.expired) throw new Error('The native history did not reach its bound');
      return { durationMs: performance.now() - started, count: batch.events.length, cursor: batch.nextCursor, actor };
    });
    await page.locator('#order-history-person').selectOption('selected');
    await page.waitForFunction(() => document.querySelector('#order-history').textContent.split('\n').length === 2049);
    const before = await page.evaluate(() => Array.from(__terriStress.sim.saveBytes()));
    const trials = [];
    for (let trial = 0; trial < 3; trial++) for (const visible of [true, false]) {
      if (await page.locator('#debug-details').evaluate(node => node.open) !== visible) await page.getByText('debug stats', { exact: true }).click();
      if (await page.locator('#order-history').isVisible() !== visible) throw new Error('Displayed workload does not match its timing label');
      const samples = await page.evaluate(async () => {
        for (let frame = 0; frame < 10; frame++) await new Promise(requestAnimationFrame);
        const samples = []; let previous = await new Promise(requestAnimationFrame);
        for (let frame = 0; frame < 45; frame++) { const now = await new Promise(requestAnimationFrame); samples.push(now - previous); previous = now; }
        return samples;
      });
      trials.push({ trial, visible, samples });
    }
    const after = await page.evaluate(() => Array.from(__terriStress.sim.saveBytes()));
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Diagnostics rendering changed gameplay');
    if (!await page.locator('#debug-details').evaluate(node => node.open)) await page.getByText('debug stats', { exact: true }).click();
    await page.locator('#order-history').scrollIntoViewIfNeeded();
    const bounds = await page.evaluate(() => {
      const panel = document.querySelector('#debug-panel').getBoundingClientRect();
      const dock = document.querySelector('#sim-dock').getBoundingClientRect();
      const history = document.querySelector('#order-history');
      history.scrollTop = history.scrollHeight;
      if(panel.bottom > dock.top - 7 || panel.top < 0 || panel.bottom > innerHeight) throw new Error('History panel escapes available viewport');
      return {panel:{top:panel.top,bottom:panel.bottom},dockTop:dock.top,lastScroll:history.scrollTop};
    });
    await page.screenshot({ path: `${qaRoot}/final-full-history.png` });
    const workload = await page.evaluate(() => ({ lines: document.querySelector('#order-history').textContent.split('\n').length,
      selected: document.querySelector('#order-history-person').value, tick: __terriStress.sim.clockTick(), visible: document.visibilityState }));
    const result = { browser: browser.version(), fill, workload, gameplayBytesUnchanged: true, bounds, trials,
      limit: 'Shared desktop frame intervals include game rendering and other host workloads; they do not isolate browser layout cost.' };
    await fs.writeFile(`${qaRoot}/final-debug-performance.json`, JSON.stringify(result, null, 2));
    return result;
  } finally { await browser?.close(); }
}
