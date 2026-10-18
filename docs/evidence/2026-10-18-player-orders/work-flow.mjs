export async function runWorkFlow({ chromium, fs, qaRoot, helperPath }) {
  let browser, page;
  try {
    browser = await chromium.launch({ headless: false,
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    await page.goto('http://127.0.0.1:5198/?stress=0&debug=1');
    await page.locator('#startup-loading').waitFor({ state: 'hidden', timeout: 45000 });
    await page.evaluate(await fs.readFile(helperPath, 'utf8'));
    await page.evaluate(() => issue273Qa.ready());
    await page.getByText('debug stats', { exact: true }).click();
    const work = await page.evaluate(() => issue273Qa.prepareWork());
    const before = await page.evaluate(() => Array.from(__terriStress.sim.saveBytes()));
    async function pickChat(point) {
      await page.mouse.click(point.x, point.y, { button: 'right' });
      const buttons = page.locator('#object-menu button[data-menu-index]');
      await buttons.first().waitFor({ state: 'visible' });
      const index = await buttons.evaluateAll(nodes => nodes.findIndex(node => node.querySelector('span')?.textContent === 'Chat'));
      if (index < 0) throw new Error('No Chat control');
      await buttons.nth(index).click();
    }
    await pickChat(work.recipientPoint);
    await page.locator('#work-order-dialog').waitFor({ state: 'visible' });
    await page.screenshot({ path: `${qaRoot}/final-desktop-work.png` });
    await page.locator('#work-order-cancel').click();
    await page.evaluate(() => issue273Qa.paint());
    const after = await page.evaluate(() => Array.from(__terriStress.sim.saveBytes()));
    const cancelExact = JSON.stringify(before) === JSON.stringify(after);
    if (!cancelExact) throw new Error('Cancel changed gameplay bytes');
    const cancelFocus = await page.evaluate(() => document.activeElement?.id);
    await page.locator('#options-toggle').click();
    await page.locator('#save-game').click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('Game saved'));
    const savedTick = await page.evaluate(() => __terriStress.sim.clockTick());
    const savedBytes = await page.evaluate(() => Array.from(__terriStress.sim.saveBytes()));
    await page.locator('label[for="speed-1"]').click();
    await page.waitForFunction(tick => __terriStress.sim.clockTick() > tick + 2, savedTick);
    await page.locator('label[for="speed-0"]').click();
    const changedTick = await page.evaluate(() => __terriStress.sim.clockTick());
    if (!await page.locator('#load-game').isVisible()) await page.locator('#options-toggle').click();
    await page.locator('#load-game').click();
    await page.locator('#confirm-load-game').click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('Saved game loaded'));
    await page.evaluate(() => issue273Qa.paint());
    const loadedBytes = await page.evaluate(() => Array.from(__terriStress.sim.saveBytes()));
    const loadedTick = await page.evaluate(() => __terriStress.sim.clockTick());
    if (JSON.stringify(savedBytes) !== JSON.stringify(loadedBytes)) throw new Error('Save/Load bytes differ');
    const cursor = await page.evaluate(() => __terriStress.sim.orderEventsSince('0').nextCursor);
    const point = await page.evaluate(() => issue273Qa.point(issue273Qa.person('Bill').entity));
    await pickChat(point);
    await page.locator('#work-order-proceed').click();
    await page.evaluate(() => issue273Qa.paint());
    const accepted = await page.evaluate(cursor => __terriStress.sim.orderEventsSince(cursor).events.filter(event => event.phase === 'accepted'), cursor);
    if (accepted.length !== 1) throw new Error('Proceed was not accepted once');
    await page.locator('label[for="speed-3"]').click();
    await page.waitForFunction(cursor => __terriStress.sim.orderEventsSince(cursor).events.some(event => event.phase === 'completed'), cursor, { timeout: 30000 });
    await page.locator('label[for="speed-0"]').click();
    await page.evaluate(() => issue273Qa.paint());
    const outcomes = await page.evaluate(cursor => __terriStress.sim.orderEventsSince(cursor), cursor);
    if (outcomes.events.filter(event => event.phase === 'completed' && event.orderId === accepted[0].orderId).length !== 1) throw new Error('Expected one completion');
    const result = { cancelExact, cancelFocus, savedTick, changedTick, loadedTick,
      saveVersion: savedBytes[8] + 256 * savedBytes[9], accepted, outcomes, browser: browser.version() };
    await fs.writeFile(`${qaRoot}/final-work-save-load.json`, JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: `${qaRoot}/work-flow-error.png` });
    throw error;
  } finally { await browser?.close(); }
}
