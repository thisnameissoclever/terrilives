const { path, out, save, hashes, launch, frame, assertHealthy } = require('./final-game-common.cjs');
(async () => {
  const before = hashes(), { browser, context, page, diagnostics } = await launch();
  const receipt = { command: 'node scripts/character-creator-repair/final-game-proof.cjs', cases: [], diagnostics, productionHashesBefore: before };
  try {
    await page.goto('http://127.0.0.1:5187/proofs/character-appearance.html?baseline=1');
    await page.waitForFunction(() => window.appearanceProof || document.querySelector('#status')?.classList.contains('bad'), null, { timeout: 120000 });
    if (!await page.evaluate(() => !!window.appearanceProof)) throw Error(await page.locator('#status').innerText());
    for (const action of ['idle', 'walk', 'read', 'standing_read', 'sit_down', 'stand_up']) {
      await page.evaluate(action => appearanceProof.seek(action, action === 'standing_read' ? 0 : 3, 0), action);
      await frame(page);
      const observation = await page.evaluate(async () => ({ errors: appearanceProof.errors, bounds: await appearanceProof.bounds(), status: document.querySelector('#status').textContent }));
      if (observation.errors.length || !observation.bounds || observation.bounds.bodyPixels < 100 || observation.bounds.maxX <= observation.bounds.minX || observation.bounds.maxY <= observation.bounds.minY) throw Error('Old proof failed: ' + JSON.stringify(observation));
      await page.screenshot({ path: path.join(out, `old-proof-${action}.png`), fullPage: true });
      receipt.cases.push({ action, observation });
    }
    assertHealthy(diagnostics); receipt.status = 'PASS';
  } catch (error) { receipt.status = 'FAIL'; receipt.failure = error.stack; process.exitCode = 1; }
  finally { await context.close(); await browser.close(); receipt.productionHashesAfter = hashes(); receipt.productionUnchanged = JSON.stringify(before) === JSON.stringify(receipt.productionHashesAfter); if (!receipt.productionUnchanged) { receipt.status = 'FAIL'; process.exitCode = 1; } save('old-proof-receipt.json', receipt); console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, cases: receipt.cases.length })); }
})();
