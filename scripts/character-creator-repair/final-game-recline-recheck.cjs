const { fs, path, out, launch, ready, frame, load, camera, assertHealthy } = require('./final-game-common.cjs');
const crypto = require('node:crypto');
const tag = process.env.RECLINE_REVIEW_TAG ?? 'recline-candidate';
if (!/^[a-z0-9-]+$/.test(tag)) throw Error('Invalid review output name');
const directory = path.join(out, tag); fs.mkdirSync(directory, { recursive: true });
const originals = JSON.parse(fs.readFileSync(path.join(out, 'extra-recline-pass-visual-fail.json'), 'utf8'));
const fingerprint = () => Object.fromEntries([
  ...fs.readdirSync('web/src/render/character').filter(file => /\.(ts|wgsl)$/.test(file)).map(file => 'web/src/render/character/' + file),
  'web/src/wasm/terri_wasm_bg.wasm',
].sort().map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const save = value => fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(value, null, 2) + '\n');
(async () => {
  const before = fingerprint(), { browser, context, page, diagnostics } = await launch(), receipt = { command: 'node scripts/character-creator-repair/final-game-recline-recheck.cjs', rows: [], diagnostics, hashesBefore: before };
  try {
    await ready(page);
    for (const facing of [1, 3, 0, 2]) {
      const prior = originals.rows.find(row => row.setup.facing === facing), actor = prior.setup.actor.entity;
      if (facing === 1) await load(page, path.join(out, 'extra-recline-1-active.sav'));
      else await page.evaluate(async prior => {
        const s = __terriStress.sim, { default: init, SimHandle } = await import('/src/wasm/terri_wasm.js'); await init(); const h = SimHandle.from_lot();
        try { if (!(await globalThis.__terriStress.characters.loadBytes(h.save_bytes()))) throw Error('Household load rejected'); } finally { h.free(); }
        (await globalThis.__terriStress.characters.edit(9510, prior.setup.actor.sim, { version: 1, appearance: prior.setup.appearance })); s.flushCommands();
        s.placeObject(prior.setup.fixture, prior.setup.spot.x, prior.setup.spot.y, prior.setup.facing); s.flushCommands();
        if (s.lastPlacementResult()?.reason !== null) throw Error('Original fixture placement rejected');
        s.useObjectFirst(prior.setup.actor.entity, prior.setup.fixture, 0); s.flushCommands();
        let active = false;
        for (let tick = 0; tick < 420; tick++) { s.tick(); const row = [...s.ids()].indexOf(prior.setup.actor.entity); if (s.activities()[row] === 15 && s.seatedWhole()[row] === 1 && s.seatedFurniture()[row] === prior.setup.fixture) { active = true; break; } }
        if (!active) throw Error('Reclining did not reach actual whole-seat state');
      }, prior);
      const targetView = prior.captures.find(capture => capture.label === 'active').scene.view;
      await camera(page, targetView);
      fs.writeFileSync(path.join(directory, `recline-${facing}-active.sav`), Buffer.from(await page.evaluate(() => [...__terriStress.sim.saveBytes()])));
      const row = { facing, savedReplay: facing === 1, actor, originalScreenshot: `extra-recline-${facing}-active.png`, captures: [] }; receipt.current = row;
      for (const offset of [0, 8, 18]) {
        if (offset) await page.evaluate(count => { for (let i = 0; i < count; i++) __terriStress.sim.tick(); }, offset === 8 ? 8 : 10);
        await frame(page);
        const scene = await page.evaluate(() => __terriStress.characters.snapshot()), drawn = scene.actors.find(row => row.entity === actor);
        if (drawn?.clip !== 'sofa_recline' || drawn.fixture !== prior.setup.fixture) throw Error('Actual reclining draw missing');
        const screenshot = `recline-${facing}-t${offset}.png`;
        await page.screenshot({ path: path.join(directory, screenshot), clip: { x: 500, y: 280, width: 600, height: 550 } });
        row.captures.push({ offset, screenshot, scene, actor: drawn }); save(receipt);
      }
      assertHealthy(diagnostics); receipt.rows.push(row); save(receipt); console.log(JSON.stringify({ facing, captures: row.captures.length, head: row.captures[0].actor.head }));
    }
    receipt.status = 'CAPTURED';
  } catch (error) { receipt.status = 'FAIL'; receipt.failure = error.stack; process.exitCode = 1; }
  finally { await context.close(); await browser.close(); receipt.hashesAfter = fingerprint(); receipt.unchanged = JSON.stringify(before) === JSON.stringify(receipt.hashesAfter); if (!receipt.unchanged) { receipt.status = 'FAIL'; process.exitCode = 1; } save(receipt); console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, unchanged: receipt.unchanged })); }
})();
