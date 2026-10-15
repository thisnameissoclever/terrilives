const { fs, path, out: baseOut, hashes: coreHashes, launch, ready, frame, camera, assertHealthy } = require('./final-game-common.cjs');
const crypto = require('node:crypto');
const tag = process.env.DINING_REVIEW_TAG;
if (tag && !/^[a-z0-9-]+$/.test(tag)) throw Error('Invalid dining review output name');
const out = tag ? path.join(baseOut, tag) : baseOut; fs.mkdirSync(out, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n');
const hashes = () => ({ ...coreHashes(), wasm: crypto.createHash('sha256').update(fs.readFileSync('web/src/wasm/terri_wasm_bg.wasm')).digest('hex') });
const { auditPicks } = require('./final-game-picking.cjs');
(async () => {
  const before = hashes(), { browser, context, page, diagnostics } = await launch();
  const receipt = { command: 'node scripts/character-creator-repair/final-game-dining.cjs', rows: [], diagnostics, productionHashesBefore: before };
  try {
    await ready(page);
    const checkpoint = path.join(baseOut, 'dining-before-cooking.sav');
    const setup = await page.evaluate(async bytes => {
      const s = __terriStress.sim, { default: init, SimHandle } = await import('/src/wasm/terri_wasm.js'); await init();
      const h = SimHandle.from_lot(); try { if (!(await globalThis.__terriStress.characters.loadBytes(bytes ? Uint8Array.from(bytes) : h.save_bytes()))) throw Error('Household rejected'); } finally { h.free(); }
      const objects = [...s.ids()].map(id => ({ id, model: s.objectModel(id)?.id })), actor = s.characterAppearances().find(row => row.sim === 1), table = objects.find(row => row.model === 'dining_table').id, fridge = objects.find(row => row.model === 'fridge').id, bed = objects.find(row => row.model === 'double_bed').id, chairs = objects.filter(row => row.model === 'chair').map(row => row.id);
      if (bytes) return { actor, table, fridge, bed, chairs, tick: s.clockTick(), bytes };
      for (const person of s.characterAppearances()) if (person.entity !== actor.entity) s.useObjectFirst(person.entity, bed, 0);
      s.useObjectFirst(actor.entity, fridge, 1); s.flushCommands();
      let sawPreparation = false, prepared = false, tick = 0;
      for (; tick < 500; tick++) { s.tick(); const row = [...s.ids()].indexOf(actor.entity), action = s.visualActions()[row]; if (action === 10) sawPreparation = true; if (action === 11 && sawPreparation) { prepared = true; break; } }
      if (!prepared) throw Error('Meal did not reach cooking');
      return { actor, table, fridge, bed, chairs, tick, bytes: [...s.saveBytes()] };
    }, fs.existsSync(checkpoint) ? [...fs.readFileSync(checkpoint)] : null);
    fs.writeFileSync(path.join(out, 'dining-before-cooking.sav'), Buffer.from(setup.bytes));
    const facings = process.env.FACINGS ? process.env.FACINGS.split(',').map(Number) : [0, 1, 2, 3];
    const settings = process.env.SETTINGS ? process.env.SETTINGS.split(',').map(Number) : [0, 1, 2, 3];
    for (const facing of facings) for (const setting of settings) {
      receipt.current = { facing, setting, status: 'setup' }; save('dining-receipt.json', receipt);
      const placement = await page.evaluate(async ({ setup, facing, setting }) => {
        const s = __terriStress.sim; if (!(await globalThis.__terriStress.characters.loadBytes(Uint8Array.from(setup.bytes)))) throw Error('Cooking checkpoint rejected');
        const place = (id, x, y, angle) => { const preview = s.placementPreview(id, x, y, angle); if (preview.reason !== null) throw Error('Invalid placement ' + JSON.stringify({ id, x, y, angle, preview })); s.placeObject(id, x, y, angle); s.flushCommands(); if (s.lastPlacementResult()?.reason !== null) throw Error('Placement refused'); };
        for (const [index, id] of setup.chairs.entries()) { let found = false; for (let y = 11; y >= 5 && !found; y--) for (let x = 14; x >= 7 && !found; x--) if (s.placementPreview(id, x, y, 0).reason === null) { place(id, x, y, 0); found = true; } if (!found) throw Error('No staging place for chair ' + index); }
        place(setup.table, 2, 3, facing);
        let x = setting % 2, y = setting < 2 ? -1 : 1;
        [x, y] = facing === 0 ? [x, y] : facing === 1 ? [-y, x] : facing === 2 ? [1 - x, -y] : [y, 1 - x];
        const chairFacing = (facing + (setting < 2 ? 0 : 2)) % 4;
        place(setup.chairs[0], 2 + x, 3 + y, chairFacing);
        const row = [...s.ids()].indexOf(setup.table);
        return { x: s.positions()[row * 2], y: s.positions()[row * 2 + 1], chair: setup.chairs[0], chairFacing, chairAt: [2 + x, 3 + y], baselineDishes: [...s.dishPiles()] };
      }, { setup, facing, setting });
      await camera(page, { scale: 2, originX: 850 - (placement.x - placement.y) * 64, originY: 580 - (placement.x + placement.y) * 42 });
      const name = `dining-facing-${facing}-setting-${setting}`, captures = [], states = []; let ate = false, deposited = false;
      receipt.current = { name, facing, setting, placement, captures, states, status: 'running' };
      const capture = async label => { await frame(page); const screenshot = `${name}-${label}.png`; await page.screenshot({ path: path.join(out, screenshot), clip: { x: 470, y: 180, width: 760, height: 650 } }); captures.push({ label, screenshot, scene: await page.evaluate(() => __terriStress.characters.snapshot()) }); save('dining-receipt.json', receipt); };
      await capture('unused');
      for (let tick = 0; tick < 450; tick += 10) {
        const chunk = await page.evaluate(({ actor, ate }) => {
          const s = __terriStress.sim, rows = [];
          for (let step = 0; step < 10; step++) { s.tick(); const row = [...s.ids()].indexOf(actor), state = { tick: s.clockTick(), action: s.visualActions()[row], target: s.interactionTargets()[row], mealTable: s.mealTables()[row], position: [s.positions()[row * 2], s.positions()[row * 2 + 1]], dishes: [...s.dishPiles()] }; rows.push(state); if (ate ? state.action !== 13 : state.action === 13) break; }
          return rows;
        }, { actor: setup.actor.entity, ate });
        const state = chunk.at(-1); states.push(...chunk);
        save('dining-receipt.json', receipt);
        if (state.action === 13) {
          if (state.mealTable !== setup.table || state.target !== placement.chair) throw Error('Meal used wrong table or chair ' + JSON.stringify(state));
          if (!ate) { ate = true; await capture('eating'); }
          fs.writeFileSync(path.join(out, `${name}-last-seated.sav`), Buffer.from(await page.evaluate(() => [...__terriStress.sim.saveBytes()])));
        }
        if (ate && state.action !== 13) {
          await capture('dish');
          fs.writeFileSync(path.join(out, `${name}-after-meal.sav`), Buffer.from(await page.evaluate(() => [...__terriStress.sim.saveBytes()])));
          const visualSetting = [2, 0, 1, 3][setting];
          const pile = []; for (let i = 0; i < state.dishes.length; i += 3) if (state.dishes[i] === setup.table && state.dishes[i + 1] === visualSetting) pile.push(state.dishes[i + 2]);
          if (!pile.length) throw Error('Completed meal did not leave dishes at expected setting: ' + JSON.stringify({ setting, state }));
          const baselineIds = placement.baselineDishes.filter((_, i) => i % 3 === 2);
          if (!pile.some(id => !baselineIds.includes(id))) throw Error('Meal did not create a new dish identity');
          deposited = true;
          const picks = await auditPicks(page), witnessed = picks.result.filter(row => row.expected.surface === setup.table && row.expected.setting === visualSetting);
          if (witnessed.length !== 1 || JSON.stringify(witnessed[0].expected.dishes.sort()) !== JSON.stringify(pile.sort())) throw Error('Dish setting lacks exact authoritative picking ' + JSON.stringify({ pile, witnessed }));
          receipt.rows.push({ name, facing, setting, visualSetting, placement, states, captures, picks }); save('dining-receipt.json', receipt); break;
        }
      }
      if (!ate || !deposited) throw Error(name + ': bounded meal sequence incomplete ' + JSON.stringify({ ate, deposited, last: states.at(-1) }));
      assertHealthy(diagnostics); console.log(JSON.stringify({ name, states: states.length, ate, deposited }));
    }
    receipt.status = 'PASS';
  } catch (error) { receipt.status = 'FAIL'; receipt.failure = error.stack; process.exitCode = 1; }
  finally { await context.close(); await browser.close(); receipt.productionHashesAfter = hashes(); receipt.productionUnchanged = JSON.stringify(before) === JSON.stringify(receipt.productionHashesAfter); if (!receipt.productionUnchanged) { receipt.status = 'FAIL'; process.exitCode = 1; } save('dining-receipt.json', receipt); console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, cases: receipt.rows.length })); }
})();
