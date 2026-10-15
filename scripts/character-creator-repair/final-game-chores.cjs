const { fs, path, out, save, hashes, launch, ready, frame, load, camera, assertHealthy } = require('./final-game-common.cjs');
const crypto = require('node:crypto');
const { auditPicks } = require('./final-game-picking.cjs');
const fingerprint = () => ({ ...hashes(), ...Object.fromEntries(['web/src/wasm/terri_wasm_bg.wasm', 'assets/models/sims/character-repair/dropped-book/manifest.json'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) });
(async () => {
  const before = fingerprint(), { browser, context, page, diagnostics } = await launch(), receipt = { command: 'node scripts/character-creator-repair/final-game-chores.cjs', rows: [], diagnostics, hashesBefore: before };
  try {
    await ready(page);
    if (!process.env.ONLY_BOOK) {
    for (const approach of [1, 2, 3, 4]) {
      await load(page, `docs/evidence/2026-10-12-full-character-creator/fixtures/cleaning/cleaning-trashcan-${approach}.sav`);
      const setup = await page.evaluate(async approach => {
        const s = __terriStress.sim, actor = s.characterAppearances()[0], fixture = s.ids()[0], { defaultAppearance } = await import('/src/character/schema.ts');
        const appearance = defaultAppearance(approach % 2 ? 'feminine' : 'masculine'); appearance.body = { height: approach % 2 ? 0 : 100, build: approach % 2 ? 100 : 0, shoulders: approach % 2 ? 100 : 0, hips: approach % 2 ? 0 : 100, torso: approach % 2 ? 100 : 0 };
        (await globalThis.__terriStress.characters.edit(9400, actor.sim, { version: 1, appearance })); s.flushCommands(); return { actor, fixture, position: [...s.positions().slice(0, 2)], appearance };
      }, approach);
      await camera(page, { scale: 1.37, originX: 800 - (setup.position[0] - setup.position[1]) * 32 * 1.37, originY: 620 - (setup.position[0] + setup.position[1]) * 21 * 1.37 });
      const row = { name: `empty-bin-${approach}`, approach, setup, states: [], captures: [], entered: false, exited: false }; receipt.current = row;
      const capture = async label => { await frame(page); const screenshot = `${row.name}-${label}.png`, scene = await page.evaluate(() => __terriStress.characters.snapshot()); await page.screenshot({ path: path.join(out, screenshot), clip: { x: 500, y: 280, width: 600, height: 550 } }); row.captures.push({ label, screenshot, scene }); save('chores-receipt.json', receipt); return scene; };
      await capture('unused'); await page.evaluate(({ actor, fixture }) => { const s = __terriStress.sim; if (!s.cleanChore(actor.entity, 3, fixture, true)) throw Error('Bin order rejected'); s.flushCommands(); }, setup);
      for (let tick = 0; tick < 90; tick++) {
        const state = await page.evaluate(actor => { const s = __terriStress.sim; s.tick(); const i = [...s.ids()].indexOf(actor); return { tick: s.clockTick(), action: s.visualActions()[i], target: s.interactionTargets()[i], facing: s.facings()[i], progress: s.choreProgress()[i] }; }, setup.actor.entity); row.states.push(state);
        if (state.action === 17) { if (state.facing !== approach || state.target !== setup.fixture) throw Error('Bin approach or target mismatch'); if (!row.entered || tick % 12 === 0) { const scene = await capture(`active-${tick}`); if (scene.actors.find(a => a.entity === setup.actor.entity)?.clip !== 'empty_bin') throw Error('Bin clip not drawn'); } row.entered = true; }
        else if (row.entered) { row.exited = true; await capture('exit'); break; }
      }
      if (!row.entered || !row.exited) throw Error('Bin sequence did not complete'); assertHealthy(diagnostics); receipt.rows.push(row); save('chores-receipt.json', receipt); console.log(JSON.stringify({ name: row.name, captures: row.captures.length }));
    }
    await load(page, path.join(out, 'dining-before-cooking.sav'));
    const setup = await page.evaluate(async () => {
      const s = __terriStress.sim, actor = s.characterAppearances().find(a => a.sim === 1), { defaultAppearance } = await import('/src/character/schema.ts');
      const appearance = defaultAppearance('feminine'); appearance.body = { height: 100, build: 100, shoulders: 100, hips: 100, torso: 100 }; (await globalThis.__terriStress.characters.edit(9401, actor.sim, { version: 1, appearance })); s.flushCommands();
      const floors = [...s.floorGrime()], width = s.lotWidth(); let target;
      for (let i = 0; i < floors.length; i += 2) if (floors[i + 1] > 0) { const at = s.floorChoreAt(floors[i] % width, Math.floor(floors[i] / width)); if (at.length === 2 && at[0] === 1) { target = [...at]; break; } }
      if (!target) throw Error('Actual household checkpoint has no floor grime');
      const cells = []; for (let i = 0; i < floors.length; i += 2) if (floors[i + 1] > 0) { const at = s.floorChoreAt(floors[i] % width, Math.floor(floors[i] / width)); if (at[1] === target[1]) cells.push(floors[i]); }
      return { actor, appearance, target, cells, width, originalFloors: floors };
    });
    const row = { name: 'mop', setup, states: [], captures: [], entered: false, cleaned: false, exited: false }; receipt.current = row;
    const capture = async label => { await frame(page); const actor = await page.evaluate(id => { const s = __terriStress.sim, i = [...s.ids()].indexOf(id); return [s.positions()[i * 2], s.positions()[i * 2 + 1]]; }, setup.actor.entity); await camera(page, { scale: 1.37, originX: 800 - (actor[0] - actor[1]) * 32 * 1.37, originY: 620 - (actor[0] + actor[1]) * 21 * 1.37 }); const screenshot = `mop-${label}.png`, scene = await page.evaluate(() => __terriStress.characters.snapshot()); await page.screenshot({ path: path.join(out, screenshot), clip: { x: 500, y: 280, width: 600, height: 550 } }); row.captures.push({ label, screenshot, scene }); save('chores-receipt.json', receipt); return scene; };
    await capture('before'); await page.evaluate(({ actor, target }) => { const s = __terriStress.sim; if (!s.cleanChore(actor.entity, ...target, true)) throw Error('Floor order refused'); s.flushCommands(); }, setup);
    for (let tick = 0; tick < 600; tick++) {
      const state = await page.evaluate(({ actor, cells }) => { const s = __terriStress.sim; s.tick(); const i = [...s.ids()].indexOf(actor), floor = [...s.floorGrime()], remaining = []; for (let at = 0; at < floor.length; at += 2) if (cells.includes(floor[at]) && floor[at + 1] > 0) remaining.push([floor[at], floor[at + 1]]); return { tick: s.clockTick(), action: s.visualActions()[i], facing: s.facings()[i], progress: s.choreProgress()[i], remaining }; }, { actor: setup.actor.entity, cells: setup.cells }); row.states.push(state);
      if (state.action === 14) { if (state.facing !== 1) throw Error('Unexpected supported mop facing'); if (!row.entered || tick % 24 === 0) { const scene = await capture(`active-${tick}`); if (scene.actors.find(a => a.entity === setup.actor.entity)?.clip !== 'mop') throw Error('Mop clip not drawn'); } row.entered = true; }
      if (row.entered && state.remaining.length === 0) row.cleaned = true;
      if (row.cleaned && state.action !== 14) { row.exited = true; await capture('exit'); break; }
    }
    if (!row.entered || !row.cleaned || !row.exited) throw Error('Actual mopping did not finish the checkpoint floor cells'); assertHealthy(diagnostics); receipt.rows.push(row);
    }
    await load(page, 'web/tests/fixtures/owned-reading-dropped.sav');
    const bookBefore = await page.evaluate(() => { const s = __terriStress.sim; return { copies: s.bookCopies(), funds: s.funds(), position: [...s.droppedBookPositions()], count: s.droppedBookCount }; });
    if (bookBefore.count !== 1) throw Error('Expected one real dropped book');
    const [x, y] = bookBefore.position; await camera(page, { scale: 2, originX: 800 - (x - y) * 64, originY: 550 - (x + y) * 42 });
    const picks = await auditPicks(page), bookPick = picks.result.find(row => row.actual.bookCopy !== undefined);
    if (!bookPick) throw Error('Promoted dropped book has no authoritative pick');
    await page.screenshot({ path: path.join(out, 'book-promoted-before-recovery.png') });
    await page.mouse.click(...bookPick.point);
    await page.getByText('Recover book', { exact: true }).click();
    await page.waitForFunction(() => __terriStress.sim.droppedBookCount === 0, null, { timeout: 10000 });
    await frame(page);
    const bookAfter = await page.evaluate(() => { const s = __terriStress.sim; return { copies: s.bookCopies(), funds: s.funds(), count: s.droppedBookCount }; });
    const oldCopy = bookBefore.copies.find(copy => copy.id === bookPick.actual.bookCopy), newCopy = bookAfter.copies.find(copy => copy.id === bookPick.actual.bookCopy);
    if (!newCopy || newCopy.titleId !== oldCopy.titleId || newCopy.location.kind !== 'shelf' || bookAfter.funds !== bookBefore.funds) throw Error('Recover book changed identity/title/funds or failed to restore shelf ownership');
    await page.screenshot({ path: path.join(out, 'book-promoted-after-recovery.png') });
    receipt.bookRecovery = { before: bookBefore, pick: bookPick, after: bookAfter, interaction: 'Actual game click, then Recover book button', status: 'PASS' };
    assertHealthy(diagnostics); receipt.status = 'PASS';
  } catch (error) { receipt.status = 'FAIL'; receipt.failure = error.stack; process.exitCode = 1; }
  finally { await context.close(); await browser.close(); receipt.hashesAfter = fingerprint(); receipt.unchanged = JSON.stringify(before) === JSON.stringify(receipt.hashesAfter); if (!receipt.unchanged) { receipt.status = 'FAIL'; process.exitCode = 1; } save(process.env.ONLY_BOOK ? 'book-recovery-receipt.json' : 'chores-receipt.json', receipt); console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, completed: receipt.rows.length })); }
})();
