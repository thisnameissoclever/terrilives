async (page, outputDir) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const screenshot = async name => {
    if (outputDir) await page.screenshot({ path: outputDir + '/' + name + '.png' });
  };
  const layout = async () => page.evaluate(() => {
    const dock = document.querySelector('#sim-dock');
    const ids = ['sim-identity', 'mood-block', 'dock-satisfaction', 'sim-details', 'dock-queue', 'sim-dock-collapse'];
    const bounds = ids.map(id => {
      const node = document.getElementById(id);
      const rect = node.getBoundingClientRect();
      if (!node.getClientRects().length) return null;
      return { id, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        overflow: node.scrollWidth > node.clientWidth + 1 };
    }).filter(Boolean);
    return { width: innerWidth, height: innerHeight,
      dockHeight: dock.getBoundingClientRect().height,
      pageOverflow: document.documentElement.scrollWidth > innerWidth, bounds };
  });
  const requireFit = result => {
    if (result.pageOverflow || result.bounds.some(rect =>
      rect.overflow || rect.x < 0 || rect.x + rect.width > result.width + 1)) {
      throw Error('Dock layout overflow: ' + JSON.stringify(result));
    }
  };
  try {
    await page.waitForFunction(() => !!globalThis.__terriStress);
    const help = page.getByRole('button', { name: 'Got it', exact: true });
    if (await help.isVisible()) await help.click();
    await page.getByText('Pause', { exact: true }).click();
    const sizes = [[1280,800],[1100,800],[900,700],[800,700],[640,700],[601,700],
      [600,700],[390,844],[320,568],[844,390]];
    const layouts = [];
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      const result = await layout();
      requireFit(result);
      layouts.push(result);
      if ([1280,800,390,320].includes(width)) await screenshot(width + 'x' + height);
    }
    await page.setViewportSize({ width: 320, height: 568 });
    for (const name of ['Tim', 'Bill', 'Casey']) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.waitForFunction(name =>
        document.querySelector('#needs-caption').textContent === name, name);
      if (!await page.locator('#mood-meter').isVisible() ||
          !await page.locator('#satisfaction-value').isVisible()) {
        throw Error('Selected wellbeing is hidden');
      }
    }
    await page.getByRole('button', { name: 'Collapse Sim dock', exact: true }).click();
    if (!await page.locator('#mood-meter').isVisible() ||
        !await page.locator('#satisfaction-value').isVisible()) {
      throw Error('Collapse hid wellbeing');
    }
    await page.getByRole('button', { name: 'Sim details', exact: true }).click();
    const tabs = await page.locator('#sim-sheet-header nav button').allTextContents();
    if (tabs.join(',') !== 'Overview,Queue,People,Traits') throw Error('Wrong Sim tabs');
    if (await page.locator('#sim-sheet #new-housemate').count()) {
      throw Error('New housemate remains in Sim details');
    }
    if (!await page.locator('#moodlet-list').isVisible()) {
      throw Error('Moodlets are absent from Overview');
    }
    await screenshot('phone-overview');
    for (const tab of tabs) {
      await page.locator('#sim-sheet-header nav').getByRole('button', { name: tab, exact: true }).click();
      if (!await page.locator('#sim-' + tab.toLowerCase()).isVisible()) {
        throw Error('Detail tab did not open: ' + tab);
      }
    }
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const openAndCancelHousemate = async () => {
      await page.getByRole('button', { name: 'Options', exact: true }).click();
      await page.getByRole('button', { name: 'New housemate', exact: true }).click();
      if (!await page.locator('#housemate-dialog').isVisible()) throw Error('Form did not open');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.id === 'options-toggle');
    };
    await openAndCancelHousemate();
    await page.evaluate(() => {
      if (!globalThis.__terriStress.sim.select(null)) throw Error('Clear selection refused');
    });
    await page.waitForFunction(() =>
      globalThis.__terriStress.sim.selectedIndex() === null &&
      document.querySelector('#satisfaction-value').textContent === 'unavailable' &&
      !document.querySelector('#mood-empty').hidden);
    await openAndCancelHousemate();
    await page.getByRole('button', { name: 'Expand Sim dock', exact: true }).click();
    await page.getByRole('button', { name: 'Bill', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#needs-caption').textContent === 'Bill');
    // Display-only fixtures exercise long labels and values without editing the world.
    await page.evaluate(() => {
      const source = globalThis.__terriStress.sim;
      source.moodSummaryOf = () => ['Miserable'];
      source.moodSnapshotOf = () => new Float32Array([-95]);
      source.satisfactionOf = () => 12345.6;
    });
    await page.waitForFunction(() =>
      document.querySelector('#mood-label').textContent === 'Miserable' &&
      document.querySelector('#satisfaction-value').textContent === '12345.6');
    const unchangedText = await page.evaluate(() => {
      const harness = globalThis.__terriStress;
      const nodes = ['mood-label', 'satisfaction-value'].map(id => document.getElementById(id));
      const before = nodes.map(node => node.firstChild);
      const tick = harness.sim.clockTick();
      const observer = new MutationObserver(() => {});
      for (const node of nodes) observer.observe(node, { childList: true, characterData: true, subtree: true });
      const start = performance.now();
      for (let index = 1; index <= 20; index++) harness.step(start + index * 200);
      const mutations = observer.takeRecords().length;
      observer.disconnect();
      if (nodes.some((node, index) => node.firstChild !== before[index]) || mutations) {
        throw Error('Unchanged wellbeing text was replaced');
      }
      if (harness.sim.clockTick() !== tick) throw Error('Paused refresh advanced the world');
      return { refreshes: 20, mutations, tick };
    });
    const enlarged = [];
    for (const width of [320, 601, 640, 800, 1280]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 800 });
      await page.evaluate(() => {
        for (const node of document.querySelectorAll('#sim-dock *')) node.style.fontSize = '';
        const nodes = [...document.querySelectorAll('#sim-dock *')]
          .filter(node => node.getClientRects().length && node.children.length === 0);
        const sizes = nodes.map(node => [node, parseFloat(getComputedStyle(node).fontSize)]);
        for (const [node, size] of sizes) node.style.fontSize = (size * 2) + 'px';
      });
      const result = await layout();
      requireFit(result);
      enlarged.push(result);
      await screenshot(width === 320 ? 'phone-text-200' : width + '-text-200');
    }
    if (errors.length) throw Error(errors.join('\n'));
    return { layouts, tabs, selectedAndUnselectedHousemate: true,
      cancelFocus: 'options-toggle', unchangedText, enlarged, errors };
  } finally {
    await page.close();
  }
}
