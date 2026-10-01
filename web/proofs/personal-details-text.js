async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.waitForFunction(() => !!globalThis.__terriStress);
    if (await page.getByRole('button', { name: 'Got it', exact: true }).isVisible()) {
      await page.getByRole('button', { name: 'Got it', exact: true }).click();
    }
    await page.getByText('Pause', { exact: true }).click();
    await page.getByRole('button', { name: 'Tim', exact: true }).click();
    await page.getByRole('button', { name: 'Sim details', exact: true }).click();
    await page.locator('#personal-details > summary').click();
    await page.waitForFunction(() => {
      globalThis.__terriStress.step(performance.now());
      return document.querySelectorAll('#personal-details-content td').length === 14;
    });
    const result = await page.evaluate(() => {
      const harness = globalThis.__terriStress;
      const content = document.querySelector('#personal-details-content');
      const leaves = [...document.querySelectorAll('#personal-details-empty, #personal-details-content p, #personal-details-content th, #personal-details-content td, #personal-details-content strong, #personal-details-content span')];
      const before = leaves.map(node => ({ node, child: node.firstChild, text: node.textContent }));
      if (!before.length || !content.querySelector('td')) throw Error('Personal details are absent');
      const tick = harness.sim.clockTick();
      const observer = new MutationObserver(() => {});
      observer.observe(document.querySelector('#personal-details'), { subtree: true, childList: true, characterData: true });
      const start = performance.now();
      for (let i = 1; i <= 20; i++) harness.step(start + i * 200);
      const mutations = observer.takeRecords();
      observer.disconnect();
      if (harness.sim.clockTick() !== tick) throw Error('Paused refresh advanced the simulation');
      if (before.some(row => row.node.textContent !== row.text)) throw Error('Unchanged values changed text');
      const replacedTextChildren = before.filter(row => row.node.firstChild !== row.child).length;
      const repaired = content.querySelector('td');
      const expected = repaired.textContent;
      repaired.textContent = 'Changed outside the panel';
      harness.step(start + 4200);
      if (repaired.textContent !== expected) throw Error('Refresh failed to repair changed DOM text');
      return { pausedTick: tick, unchangedRefreshes: 20, leaves: before.length,
        replacedTextChildren, nativeTextMutations: mutations.length, repairedText: repaired.textContent };
    });
    if (errors.length) throw Error(errors.join('\n'));
    return { ...result, pageErrors: errors };
  } finally {
    await page.close();
  }
}
