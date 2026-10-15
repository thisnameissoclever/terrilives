const { fs, path, out, save, hashes, launch, ready, frame, load, camera, assertHealthy } = require('./final-game-common.cjs');
(async () => {
  const before = hashes(), { browser, context, page, diagnostics } = await launch();
  const receipt = { command: 'node scripts/character-creator-repair/final-game-cleaning.cjs', rows: [], diagnostics, productionHashesBefore: before };
  try {
    for (const model of ['counter', 'dining_table']) for (const approach of [1, 2, 3, 4]) {
      await ready(page);
      await load(page, `docs/evidence/2026-10-12-full-character-creator/fixtures/cleaning/cleaning-${model}-${approach}.sav`);
      const setup = await page.evaluate(async () => {
        const s = __terriStress.sim, actor = s.characterAppearances()[0], fixture = s.ids()[0];
        if (!actor) throw Error('Cleaning fixture has no persistent character');
        const { defaultAppearance } = await import('/src/character/schema.ts');
        const appearance = defaultAppearance('feminine'); appearance.body = { height: 100, build: 100, shoulders: 100, hips: 100, torso: 100 };
        (await globalThis.__terriStress.characters.edit(8921, actor.sim, { version: 1, appearance })); s.flushCommands();
        const row = [...s.ids()].indexOf(fixture), x = s.positions()[row * 2], y = s.positions()[row * 2 + 1];
        return { actor, fixture, x, y };
      });
      await camera(page, { scale: 2, originX: 800 - (setup.x - setup.y) * 64, originY: 550 - (setup.x + setup.y) * 42 });
      const name = `cleaning-${model}-${approach}`, captures = [];
      const capture = async label => {
        await frame(page); const scene = await page.evaluate(() => __terriStress.characters.snapshot());
        await page.screenshot({ path: path.join(out, `${name}-${label}.png`), clip: { x: 450, y: 200, width: 700, height: 500 } });
        captures.push({ label, scene });
      };
      await capture('unused');
      await page.evaluate(({ actor, fixture }) => { const s = __terriStress.sim; if (!s.cleanChore(actor.entity, 2, fixture, true)) throw Error('Cleaning order refused'); s.flushCommands(); }, setup);
      const states = []; let entered = false, exited = false;
      for (let tick = 0; tick < 80; tick++) {
        const state = await page.evaluate(entity => { const s = __terriStress.sim; s.tick(); const row = [...s.ids()].indexOf(entity); return { action: s.visualActions()[row], facing: s.facings()[row], target: s.interactionTargets()[row], progress: s.choreProgress()[row] }; }, setup.actor.entity);
        states.push(state);
        if (state.action === (model === 'counter' ? 15 : 16)) {
          if (state.facing !== approach || state.target !== setup.fixture) throw Error('Incorrect cleaning approach or target');
          if (!entered || tick % 8 === 0) await capture(`t${String(tick).padStart(3, '0')}`);
          entered = true;
        } else if (entered) { exited = true; await capture('exited'); break; }
      }
      if (!entered || !exited) throw Error('Cleaning transition did not complete');
      receipt.rows.push({ name, model, approach, setup, states, captures });
      save('cleaning-receipt.json', receipt);
      assertHealthy(diagnostics);
      console.log(JSON.stringify({ name, states: states.length, captures: captures.length, entered, exited }));
    }
    receipt.status = 'PASS';
  } catch (error) { receipt.status = 'FAIL'; receipt.failure = error.stack; process.exitCode = 1; }
  finally { await context.close(); await browser.close(); receipt.productionHashesAfter = hashes(); receipt.productionUnchanged = JSON.stringify(before) === JSON.stringify(receipt.productionHashesAfter); if (!receipt.productionUnchanged) { receipt.status = 'FAIL'; process.exitCode = 1; } save('cleaning-receipt.json', receipt); console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure })); }
})();
