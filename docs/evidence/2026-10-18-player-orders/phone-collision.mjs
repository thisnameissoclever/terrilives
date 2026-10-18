export async function runVisualFlow({ chromium, fs, qaRoot, helperPath }) {
  let browser;
  let phase = 'startup';
  const receipts = [];
  try {
    browser = await chromium.launch({ headless: false,
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
    for (const phone of [true]) {
      const name = phone ? 'phone' : 'desktop';
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
      const page = await context.newPage();
      const warnings = [];
      page.on('console', message => { if (message.type() === 'warning' && message.text().includes('Casey') && message.text().includes('failed')) warnings.push(message.text()); });
      await page.goto('http://127.0.0.1:5198/?stress=0&debug=1');
      await page.locator('#startup-loading').waitFor({ state: 'hidden', timeout: 45000 });
      await page.evaluate(await fs.readFile(helperPath, 'utf8'));
      await page.evaluate(() => issue273Qa.ready());
      async function frameScene() {
        if (await page.locator('#debug-details').evaluate(node => node.open)) await page.getByText('debug stats', { exact: true }).click();
        if (!phone) return;
        const before = await page.evaluate(() => ({ view: __terriStress.characters.snapshot().view,
          hits: [document.elementFromPoint(95,350)?.id, document.elementFromPoint(295,350)?.id] }));
        if (before.hits.some(id => id !== 'stage')) throw new Error('Phone pinch starts behind an overlay');
        const touch = await context.newCDPSession(page);
        try {
          await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: 95, y: 350 }, { id: 1, x: 295, y: 350 }] });
          await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: 145, y: 350 }, { id: 1, x: 245, y: 350 }] });
        } finally { await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach(); }
        await page.waitForFunction(() => Math.abs(__terriStress.characters.snapshot().view.scale - .5) < .001);
        const after = await page.evaluate(() => __terriStress.characters.snapshot().view);
        await fs.writeFile(`${qaRoot}/phone-camera-${phase.replaceAll(' ','-')}.json`, JSON.stringify({ before, after }, null, 2));
      }
      await frameScene();
      async function chatAt(point) {
        const buttons = page.locator('#object-menu button[data-menu-index]');
        if (phone) {
          const touch = await context.newCDPSession(page);
          try {
            await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1 }] });
            await buttons.first().waitFor({ state: 'visible' });
          } finally { await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach(); }
        } else {
          await page.mouse.click(point.x, point.y, { button: 'right' });
          await buttons.first().waitFor({ state: 'visible' });
        }
        const index = await buttons.evaluateAll(nodes => nodes.findIndex(node => node.querySelector('span')?.textContent === 'Chat'));
        if (index < 0) throw new Error('No Chat control');
        if (phone) await buttons.nth(index).tap(); else await buttons.nth(index).click();
      }
      phase = `${name} incoming`;
      const busy = await page.evaluate(() => issue273Qa.prepareBusy());
      await chatAt(busy.recipientPoint);
      await page.evaluate(() => issue273Qa.select('Bill'));
      if (phone) {
        await page.locator('#sim-details').click();
        await page.locator('#sim-sheet-header [data-open-sim-panel="queue"]').click();
      } else await page.locator('#dock-queue').click();
      await page.evaluate(() => issue273Qa.paint());
      const card = page.locator('#action-queue .action-card[data-order-id]').filter({ hasText: 'Incoming' });
      if (await card.count() !== 1 || !(await card.innerText()).includes('Casey')) throw new Error('Incoming card is missing its role or counterpart');
      await page.screenshot({ path: `${qaRoot}/final-${name}-incoming.png` });
      const incoming = await page.evaluate(() => issue273Qa.state().queues);
      if (!phone) {
        phase = 'desktop Build';
        const beforeBuild = await page.evaluate(() => ({ tick: __terriStress.sim.clockTick(),
          queues: issue273Qa.state().queues, history: __terriStress.sim.orderEventsSince('0') }));
        await page.locator('#build-toggle').click();
        await page.locator('#build-batch-cancel').waitFor({ state: 'visible' });
        await page.locator('#build-batch-cancel').click();
        await page.evaluate(() => issue273Qa.paint());
        await page.locator('#builder-exit').click();
        await page.locator('#build-batch-cancel').waitFor({ state: 'hidden' });
        await page.evaluate(() => issue273Qa.paint());
        const afterBuild = await page.evaluate(() => ({ tick: __terriStress.sim.clockTick(),
          queues: issue273Qa.state().queues, history: __terriStress.sim.orderEventsSince('0') }));
        if (JSON.stringify(beforeBuild) !== JSON.stringify(afterBuild)) throw new Error('Build cancellation changed orders, phases, history or time');
        await fs.writeFile(`${qaRoot}/final-build-history.json`, JSON.stringify({ beforeBuild, afterBuild }, null, 2));
      }
      if (await page.locator('#sim-sheet-close').isVisible()) await page.locator('#sim-sheet-close').click();
      await page.evaluate(() => issue273Qa.select('Casey'));
      if (phone) {
        const headPoint = await page.evaluate(() => {
          const snapshot=__terriStress.characters.snapshot(), view=snapshot.view;
          const actor=snapshot.actors.find(row=>row.entity===issue273Qa.person('Casey').entity);
          return {x:(actor.head[0]-actor.head[1])*32*view.scale+view.originX,y:(actor.head[0]+actor.head[1])*21*view.scale+view.originY-actor.head[2]*Math.sqrt(1166)*view.scale};
        });
        const touch=await context.newCDPSession(page);
        try {
          if(await page.evaluate(()=>document.elementFromPoint(300,600)?.id)!=='stage') throw new Error('Phone pan starts behind UI');
          await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x:300,y:600}]});
          await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:0,x:300+163-headPoint.x,y:600+259-headPoint.y}]});
        } finally {await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();}
        await page.evaluate(async()=>{
          await issue273Qa.paint();
          const snapshot=__terriStress.characters.snapshot(),view=snapshot.view;
          const actor=snapshot.actors.find(row=>row.entity===issue273Qa.person('Casey').entity);
          const point={x:(actor.head[0]-actor.head[1])*32*view.scale+view.originX,y:(actor.head[0]+actor.head[1])*21*view.scale+view.originY-actor.head[2]*Math.sqrt(1166)*view.scale};
          if(Math.abs(point.x-163)>2||Math.abs(point.y-259)>2) throw new Error('Phone obstruction anchor was not reproduced: '+JSON.stringify(point));
        });
      }
      phase = `${name} failure lifetime`;
      const failure = await page.evaluate(() => {
        const sim = __terriStress.sim, actor = issue273Qa.person('Casey').entity;
        const object = issue273Qa.objects().find(row => row.model === 'moving_box').entity;
        const cursor = sim.orderEventsSince('0').nextCursor, started = performance.now(), tick = sim.clockTick();
        const timeline = globalThis.__qaBubbleTimeline = {};
        const observer = new MutationObserver(() => {
          const node = document.querySelector(`.order-failure-bubble[data-entity="${actor}"]`);
          if (node && !node.hidden && node.getBoundingClientRect().width > 0) timeline.appeared ??= performance.now();
          if (!node && timeline.appeared !== undefined) { timeline.removed = performance.now(); observer.disconnect(); }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] });
        sim.useObjectFirst(actor, object, 9999); sim.flushCommands();
        return { actor, cursor, started, tick };
      });
      const bubble = page.locator(`.order-failure-bubble[data-entity="${failure.actor}"]`);
      await bubble.waitFor({ state: 'visible' });
      const feedbackBounds = await bubble.evaluate(node => {
        const box = node.getBoundingClientRect();
        const controls = [...document.querySelectorAll('#hud, #sim-dock')].map(control => control.getBoundingClientRect());
        if (controls.some(control => box.left < control.right && box.right > control.left && box.top < control.bottom && box.bottom > control.top)) throw new Error('Failure body overlaps interactive controls');
        return {left:box.left,top:box.top,right:box.right,bottom:box.bottom};
      });
      failure.bounds = feedbackBounds;
      await page.screenshot({ path: `${qaRoot}/final-${name}-failure.png` });
      await page.waitForFunction(() => globalThis.__qaBubbleTimeline.removed !== undefined, null, { timeout: 6000 });
      const expired = await page.evaluate(({ cursor }) => ({ elapsed: __qaBubbleTimeline.removed - __qaBubbleTimeline.appeared,
        timeline: __qaBubbleTimeline, tick: __terriStress.sim.clockTick(), status: document.querySelector('#command-feedback').textContent,
        events: __terriStress.sim.orderEventsSince(cursor) }), failure);
      if (expired.tick !== failure.tick || expired.elapsed < 2800 || expired.elapsed > 4000) throw new Error('Failure duration did not follow real time while paused');
      if (expired.events.events.filter(event => event.phase === 'failed' && event.actor === failure.actor).length !== 1 || warnings.length !== 1) throw new Error('Failure was not emitted once');
      let restoration;
      if (!phone) {
        phase = 'desktop matched pixel control';
        await page.evaluate(() => { const sim = __terriStress.sim; sim.useObjectFirst(issue273Qa.person('Casey').entity,
          issue273Qa.objects().find(row => row.model === 'moving_box').entity, 9999); sim.flushCommands(); });
        await bubble.waitFor({ state: 'visible' });
        const box = await bubble.boundingBox();
        const clip = { x: Math.max(0, Math.floor(box.x - 55)), y: Math.max(0, Math.floor(box.y - 20)), width: 160, height: 220 };
        const good = await page.screenshot({ clip });
        let bad;
        const visibility = await bubble.evaluate(node => node.style.visibility);
        try {
          await bubble.evaluate(node => { node.style.visibility = 'hidden'; });
          bad = await page.screenshot({ clip });
        } finally { await bubble.evaluate((node, value) => { node.style.visibility = value; }, visibility); }
        const restored = await page.screenshot({ clip });
        if (good.equals(bad)) throw new Error('Missing-feedback control did not change pixels');
        if (!good.equals(restored)) throw new Error('Failure control did not restore identical pixels');
        await fs.writeFile(`${qaRoot}/review-view-62.png`, good);
        await fs.writeFile(`${qaRoot}/review-view-19.png`, bad);
        await fs.writeFile(`${qaRoot}/failure-region-restored.png`, restored);
        restoration = { equalPixels: true, clip, elapsed: await page.evaluate(start => performance.now() - start, failure.started) };
      }
      if (!phone) {
        phase = 'desktop history';
        await page.getByText('debug stats', { exact: true }).click();
        await page.locator('#order-history-person').selectOption('selected');
        await page.waitForFunction(() => document.querySelector('#order-history').textContent.includes('failed'));
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
          value: { writeText: async text => { globalThis.__qaCopiedHistory = text; } } }));
        await page.locator('#order-history-copy').click();
        await page.waitForFunction(() => !!globalThis.__qaCopiedHistory);
        const copy = await page.evaluate(() => ({ copied: __qaCopiedHistory, displayed: document.querySelector('#order-history').textContent }));
        if (copy.copied !== copy.displayed) throw new Error('Copy did not receive displayed history');
        await page.screenshot({ path: `${qaRoot}/final-desktop-history.png` });
        receipts.push({ name, incoming, failure, expired, warnings, restoration, clipboard: 'Browser-local sink; operating-system clipboard unchanged', copy });
      } else receipts.push({ name, incoming, failure, expired, warnings });
      await fs.writeFile(`${qaRoot}/final-${name}-receipt.json`, JSON.stringify(receipts.at(-1), null, 2));
      await page.locator('#options-toggle').click();
      await page.locator('#save-game').click();
      await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('Game saved'));
      await page.reload();
      phase = `${name} work`;
      await page.locator('#startup-loading').waitFor({ state: 'hidden', timeout: 45000 });
      if (await page.locator('#save-status').innerText() !== 'Saved game loaded') throw new Error('Completed order-state save did not load at startup');
      await page.evaluate(await fs.readFile(helperPath, 'utf8'));
      await page.evaluate(() => issue273Qa.ready());
      await frameScene();
      const work = await page.evaluate(() => issue273Qa.prepareWork());
      await chatAt(work.recipientPoint);
      await page.locator('#work-order-dialog').waitFor({ state: 'visible' });
      await page.screenshot({ path: `${qaRoot}/final-${name}-work.png` });
      await page.locator('#work-order-cancel').click();
      const runtime = await page.evaluate(async () => { const adapter = await navigator.gpu.requestAdapter();
        return { gpu: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, isFallback: adapter.info.isFallbackAdapter },
          visible: document.visibilityState, snapshot: __terriStress.characters.snapshot() }; });
      await fs.writeFile(`${qaRoot}/final-${name}-runtime.json`, JSON.stringify(runtime, null, 2));
      await context.close();
    }
    await fs.writeFile(`${qaRoot}/final-visual-receipts.json`, JSON.stringify({ browser: browser.version(), phoneIsEmulated: true, receipts }, null, 2));
    return receipts;
  } catch (error) {
    const page = browser?.contexts().flatMap(context => context.pages()).find(page => !page.isClosed());
    if (page) await page.screenshot({ path: `${qaRoot}/visual-flow-error.png` });
    await fs.writeFile(`${qaRoot}/visual-flow-error.json`, JSON.stringify({ phase, error: String(error) }, null, 2));
    throw error;
  } finally { await browser?.close(); }
}
