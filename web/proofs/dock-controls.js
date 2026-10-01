async (page, outputDir) => {
  const require = (condition, message) => { if (!condition) throw Error(message); };
  const expanded = id => page.locator('#' + id).getAttribute('aria-expanded');
  const sheet = page.locator('#sim-sheet');
  try {
    await page.waitForFunction(() => !!globalThis.__terriStress);
    await page.setViewportSize({ width: 1280, height: 800 });
    const help = page.getByRole('button', { name: 'Got it', exact: true });
    if (await help.isVisible()) await help.click();
    await page.getByText('Pause', { exact: true }).click();
    await page.locator('#sim-details').click();
    require(await sheet.isVisible(), 'Sim details did not open');
    await page.locator('#sim-details').click();
    require(await sheet.isHidden(), 'Sim details did not toggle closed');
    await page.locator('#dock-queue').click();
    const queueMode = page.locator('#queue-mode');
    require(await queueMode.innerText() === 'Queue mode', 'Wrong mode label');
    require(await queueMode.getAttribute('aria-pressed') === 'true', 'Queue mode did not start enabled');
    await queueMode.click();
    require(await queueMode.getAttribute('aria-pressed') === 'false', 'Queue mode did not turn off');
    await queueMode.click();
    require(await queueMode.getAttribute('aria-pressed') === 'true', 'Queue mode did not turn back on');
    await page.mouse.move(500, 200);
    const active = await page.locator('#dock-queue').evaluate(node => getComputedStyle(node).borderColor);
    require(await expanded('dock-queue') === 'true', 'Open Queue is not expanded');
    require(await expanded('sim-details') === 'true', 'Open sheet is not expanded');
    if (outputDir) await page.screenshot({ path: outputDir + '/queue-desktop.png' });
    await page.locator('#dock-queue').click();
    await page.mouse.move(500, 200);
    const closed = await page.locator('#dock-queue').evaluate(node => getComputedStyle(node).borderColor);
    require(await sheet.isHidden() && active !== closed, 'Queue did not close and clear its highlight');
    require(await expanded('sim-details') === 'false', 'Closed sheet retained its highlight');
    await page.locator('#sim-details').click();
    await page.locator('#sim-sheet-header nav').getByRole('button', { name: 'People', exact: true }).click();
    require(await expanded('sim-details') === 'true', 'Tab switch cleared the sheet highlight');
    await page.locator('#sim-details').click();
    require(await sheet.isHidden(), 'Sim details did not close the People section');
    require(await page.evaluate(() => document.activeElement.id) === 'sim-details', 'Toggle close lost focus');
    await page.locator('#dock-queue').click();
    await page.keyboard.press('Escape');
    require(await sheet.isHidden() && await expanded('dock-queue') === 'false', 'Escape retained the panel state');
    await page.locator('#sim-details').click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    require(await expanded('sim-details') === 'false', 'Close retained the panel state');
    await page.locator('#dock-queue').click();
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    require(await sheet.isHidden() && await expanded('dock-queue') === 'false', 'Options retained the panel state');
    await page.getByRole('button', { name: 'Close Options', exact: true }).click();
    const geometry = await page.evaluate(() => {
      const mood = document.querySelector('#mood-label');
      const track = document.querySelector('#mood-meter').getBoundingClientRect();
      const satisfaction = document.querySelector('#dock-satisfaction');
      return { moodFont: getComputedStyle(mood).fontSize, moodWeight: getComputedStyle(mood).fontWeight,
        trackWidth: track.width, satisfactionAlignment: getComputedStyle(satisfaction).justifyContent };
    });
    require(geometry.moodFont === '12px' && geometry.moodWeight === '700', 'Mood text is not small and bold');
    require(geometry.trackWidth > 170, 'Desktop mood meter was not widened');
    require(geometry.satisfactionAlignment === 'center', 'Life satisfaction is not centered');
    const satisfaction = page.locator('#satisfaction-summary');
    const score = page.locator('#satisfaction-score');
    require(await page.locator('#satisfaction-meter').isVisible(), 'Life satisfaction meter is hidden');
    require(await page.locator('#satisfaction-label').innerText() === 'Content', 'Starting satisfaction label is wrong');
    require(await score.isHidden(), 'Exact score is not initially tucked away');
    await satisfaction.hover();
    require(await score.isVisible(), 'Hover does not reveal exact satisfaction');
    await page.mouse.move(500, 200);
    await satisfaction.focus();
    require(await score.isVisible(), 'Focus does not reveal exact satisfaction');
    const accessible = await satisfaction.getAttribute('aria-label');
    require(accessible.includes('out of 100'), 'Accessible score lacks its range');
    const bands = [];
    for (const [value, label] of [[0, 'Very dissatisfied'], [20, 'Dissatisfied'], [40, 'Content'], [60, 'Satisfied'], [80, 'Fulfilled'], [100, 'Fulfilled']]) {
      await page.evaluate(value => { globalThis.__terriStress.sim.satisfactionOf = () => value; }, value);
      await page.waitForFunction(label => document.querySelector('#satisfaction-label').textContent === label, label);
      await page.waitForFunction(value => document.querySelector('#satisfaction-meter').value === value, value);
      bands.push({ value, label });
    }
    await page.evaluate(() => { delete globalThis.__terriStress.sim.satisfactionOf; });
    await page.waitForFunction(() => document.querySelector('#satisfaction-label').textContent === 'Content');
    await page.locator('#sim-details').focus();
    await page.mouse.move(500, 200);
    if (outputDir) await page.locator('#sim-dock').screenshot({ path: outputDir + '/dock-desktop.png' });
    return { panelToggles: true, defaultQueueMode: true, persistentHighlights: true, closeRoutes: ['toggle', 'Escape', 'Close', 'Options'], activeBorder: active, closedBorder: closed, geometry, satisfaction: { bands, hoverAndFocus: true, accessible } };
  } finally {
    await page.close();
  }
}
