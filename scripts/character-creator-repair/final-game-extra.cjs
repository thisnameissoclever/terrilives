const { fs, path, out, save, hashes, launch, ready, frame, load, camera, assertHealthy } = require('./final-game-common.cjs');
const crypto = require('node:crypto');
const cases = [
  ['office-sit', 'desk_chair', 0, 8, 'seat_office_sit'], ['office-read', 'desk_chair', 1, 3, 'seat_office_read'],
  ['ottoman-sit', 'sofa', 0, 8, 'seat_ottoman_sit'], ['ottoman-read', 'sofa', 1, 3, 'seat_ottoman_read'],
  ['dining-sit', 'chair', 0, 8, 'seat_dining_sit'], ['dining-read', 'chair', 1, 3, 'seat_dining_read'],
  ['sofa-read', 'long_sofa', 2, 3, 'seat_sofa_read'], ['recline', 'long_sofa', 0, 0, 'sofa_recline'],
].map(([name, model, interaction, action, clip]) => ({ name, model, interaction, action, clip }));
const fingerprint = () => ({ ...hashes(), ...Object.fromEntries(['web/src/wasm/terri_wasm_bg.wasm', 'assets/models/sims/character-repair/dropped-book/manifest.json'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) });
(async () => {
  const before = fingerprint(), { browser, context, page, diagnostics } = await launch(), receipt = { command: 'node scripts/character-creator-repair/final-game-extra.cjs', rows: [], diagnostics, hashesBefore: before };
  try {
    await ready(page);
    for (const sc of cases.filter(sc => !process.env.CASES || process.env.CASES.split(',').includes(sc.name))) for (const facing of [0, 1, 2, 3].filter(facing => !process.env.FACINGS || process.env.FACINGS.split(',').includes(String(facing)))) {
      const name = `extra-${sc.name}-${facing}`; receipt.current = { name, status: 'setup' }; save('extra-receipt.json', receipt);
      const setup = await page.evaluate(async ({ sc, facing }) => {
        const s = __terriStress.sim, { default: init, SimHandle } = await import('/src/wasm/terri_wasm.js'), { defaultAppearance } = await import('/src/character/schema.ts'); await init();
        const h = SimHandle.from_lot(); try { if (!(await globalThis.__terriStress.characters.loadBytes(h.save_bytes()))) throw Error('Household load failed'); } finally { h.free(); }
        const actor = s.characterAppearances().find(row => row.sim === (facing % 2 ? 2 : 1)), fixture = [...s.ids()].find(id => s.objectModel(id)?.id === sc.model), appearance = defaultAppearance(facing % 2 ? 'masculine' : 'feminine');
        appearance.body = { height: facing % 2 ? 100 : 0, build: facing % 2 ? 0 : 100, shoulders: facing % 2 ? 0 : 100, hips: facing % 2 ? 100 : 0, torso: facing % 2 ? 0 : 100 };
        (await globalThis.__terriStress.characters.edit(9300, actor.sim, { version: 1, appearance })); s.flushCommands();
        const base = s.saveBytes(), fixtureRow = [...s.ids()].indexOf(fixture), position = [s.positions()[fixtureRow * 2], s.positions()[fixtureRow * 2 + 1]], spots = [], attempts = [];
        for (let y = 0; y < 13; y++) for (let x = 0; x < 16; x++) spots.push({ x, y }); spots.sort((a, b) => Math.hypot(a.x - position[0], a.y - position[1]) - Math.hypot(b.x - position[0], b.y - position[1]));
        for (const spot of spots) {
          (await globalThis.__terriStress.characters.loadBytes(base)); if (s.placementPreview(fixture, spot.x, spot.y, facing).reason !== null) continue;
          s.placeObject(fixture, spot.x, spot.y, facing); s.flushCommands(); if (s.lastPlacementResult()?.reason !== null) throw Error('Placement refused');
          const start = [...s.saveBytes()]; s.useObjectFirst(actor.entity, fixture, sc.interaction); s.flushCommands(); let active = false, tick = 0;
          for (; tick < 420; tick++) { s.tick(); const row = [...s.ids()].indexOf(actor.entity); if (s.visualActions()[row] === sc.action && (sc.name !== 'recline' || s.activities()[row] === 15 && s.seatedWhole()[row] === 1) && (sc.action === 3 ? s.readingSeats()[row] : s.seatedFurniture()[row]) === fixture) { active = true; break; } }
          attempts.push({ spot, active, tick });
          if (active) { const activeSave = [...s.saveBytes()]; (await globalThis.__terriStress.characters.loadBytes(Uint8Array.from(start))); const row = [...s.ids()].indexOf(fixture); return { actor, appearance, fixture, facing, spot, firstActive: tick, attempts, activeSave, position: [s.positions()[row * 2], s.positions()[row * 2 + 1]] }; }
          if (attempts.length >= 20) break;
        }
        throw Error('No actual active placement: ' + JSON.stringify(attempts));
      }, { sc, facing });
      fs.writeFileSync(path.join(out, `${name}-active.sav`), Buffer.from(setup.activeSave)); delete setup.activeSave;
      await camera(page, { scale: 1.37, originX: 800 - (setup.position[0] - setup.position[1]) * 32 * 1.37, originY: 620 - (setup.position[0] + setup.position[1]) * 21 * 1.37 });
      const row = { name, sc, setup, captures: [], states: [], entered: false, exited: false }; receipt.current = row;
      const capture = async label => { await frame(page); const scene = await page.evaluate(() => __terriStress.characters.snapshot()), screenshot = `${name}-${label}.png`; await page.screenshot({ path: path.join(out, screenshot), clip: { x: 500, y: 280, width: 600, height: 550 } }); row.captures.push({ label, screenshot, scene }); save('extra-receipt.json', receipt); return scene; };
      await capture('unused'); await page.evaluate(({ setup, sc }) => { const s = __terriStress.sim; if (!s.useObjectFirst(setup.actor.entity, setup.fixture, sc.interaction)) throw Error('Order refused'); s.flushCommands(); }, { setup, sc });
      let prior = '', activeTicks = 0;
      for (let tick = 0; tick < 600; tick++) {
        const state = await page.evaluate(({ actor, sc, fixture }) => { const s = __terriStress.sim; s.tick(); const at = [...s.ids()].indexOf(actor); return { tick: s.clockTick(), action: s.visualActions()[at], activity: s.activities()[at], read: s.readingStages()[at], target: s.interactionTargets()[at], fixture: sc.action === 3 ? s.readingSeats()[at] : s.seatedFurniture()[at], facing: s.facings()[at], position: [s.positions()[at * 2], s.positions()[at * 2 + 1]] }; }, { actor: setup.actor.entity, sc, fixture: setup.fixture });
        row.states.push(state); const active = state.action === sc.action && state.fixture === setup.fixture && (sc.name !== 'recline' || state.activity === 15);
        const key = JSON.stringify([state.action, state.activity, state.read, state.target, state.fixture]);
        if (active && !row.entered) { row.entered = true; const scene = await capture('active'); if (scene.actors.find(actor => actor.entity === setup.actor.entity)?.clip !== sc.clip) throw Error('Expected clip not rendered'); }
        else if (active && [8, 18].includes(activeTicks)) await capture(`active-${activeTicks}`);
        else if (row.entered && !active) { row.exited = true; await capture('exit'); break; }
        else if (key !== prior) await capture(`entry-${tick}`);
        if (active) activeTicks++; prior = key;
      }
      if (!row.entered || !row.exited) throw Error('Missing active/exit transition for ' + name);
      assertHealthy(diagnostics); receipt.rows.push(row); save('extra-receipt.json', receipt); console.log(JSON.stringify({ name, captures: row.captures.length, states: row.states.length, entered: row.entered, exited: row.exited }));
    }
    receipt.status = 'PASS';
  } catch (error) { receipt.status = 'FAIL'; receipt.failure = error.stack; process.exitCode = 1; }
  finally { await context.close(); await browser.close(); receipt.hashesAfter = fingerprint(); receipt.unchanged = JSON.stringify(before) === JSON.stringify(receipt.hashesAfter); if (!receipt.unchanged) { receipt.status = 'FAIL'; process.exitCode = 1; } save('extra-receipt.json', receipt); console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, completed: receipt.rows.length })); }
})();
