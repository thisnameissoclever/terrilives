const { fs, path, out, save, hashes, launch, ready, frame, load, camera, assertHealthy } = require('./final-game-common.cjs');
async function auditPicks(page) {
  return page.evaluate(async () => {
    const h = __terriStress, s = h.sim, device = h.graphicsDevice, texture = h.sceneIdentityTexture;
    const row = Math.ceil(texture.width * 4 / 256) * 256, buffer = device.createBuffer({ size: row * texture.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const candidates = new Map(), counts = new Map();
    try {
      const encoder = device.createCommandEncoder(); encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: row }, [texture.width, texture.height]); device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
      const ids = new Uint32Array(buffer.getMappedRange()), stride = row / 4;
      // Full 2x2 agreement gives a categorical interior witness independent of nearest-depth tie handling.
      for (let y = 1; y < texture.height / 2 - 1; y++) for (let x = 1; x < texture.width / 2 - 1; x++) {
        const at = y * 2 * stride + x * 2, id = ids[at];
        if (id && [1, stride, stride + 1].every(offset => ids[at + offset] === id)) {
          counts.set(id, (counts.get(id) ?? 0) + 1);
          if (!candidates.has(id)) candidates.set(id, [x, y]);
        }
      }
    } finally { buffer.unmap(); buffer.destroy(); }
    const rows = [...s.ids()], kinds = [...s.kinds()], sims = [...s.simIds()], dishes = [...s.dishPiles()], books = [...s.droppedBookIds()], result = [], expectedExtras = new Map();
    let nextToken = rows.length + 1;
    // Draw order is surface row, then ascending visual setting; stable simulation dish IDs supply the payload.
    for (const surface of rows) {
      const settings = new Map();
      for (let i = 0; i < dishes.length; i += 3) if (dishes[i] === surface) {
        const setting = dishes[i + 1], ids = settings.get(setting) ?? []; ids.push(dishes[i + 2]); settings.set(setting, ids);
      }
      for (const [setting, ids] of [...settings].sort((a, b) => a[0] - b[0])) expectedExtras.set(nextToken++, { entity: surface, sim: null, kind: 'fixture', cleanup: { surface, dishes: ids }, setting });
    }
    for (const bookCopy of books) expectedExtras.set(nextToken++, { entity: 0xffffffff, sim: null, kind: 'fixture', bookCopy });
    for (const [token, point] of candidates) {
      const actual = await h.characters.pick(...point);
      if (!actual) throw Error('Visible token ' + token + ' produced no authoritative hit');
      let expected;
      if (token <= rows.length) {
        expected = { entity: rows[token - 1], sim: kinds[token - 1] === 0 && sims[token - 1] !== 0xffffffff ? sims[token - 1] : null, kind: kinds[token - 1] === 0 ? 'person' : 'fixture' };
      } else {
        const registered = expectedExtras.get(token);
        if (!registered) throw Error('Unexplained extra token ' + token);
        expected = registered;
      }
      if (actual.entity !== expected.entity || actual.kind !== expected.kind || actual.sim !== expected.sim || actual.bookCopy !== expected.bookCopy) throw Error('Entity identity mismatch: ' + JSON.stringify({ token, point, actual, expected }));
      if (expected.cleanup) {
        if (actual.cleanup?.surface !== expected.cleanup.surface || JSON.stringify([...(actual.cleanup?.dishes ?? [])].sort((a, b) => a - b)) !== JSON.stringify([...expected.cleanup.dishes].sort((a, b) => a - b))) throw Error('Dish identity mismatch: ' + JSON.stringify({ token, point, actual, expected }));
        expected = { surface: expected.cleanup.surface, setting: expected.setting, dishes: expected.cleanup.dishes };
      } else if (actual.cleanup) throw Error('Unexpected cleanup owner');
      result.push({ token, point, interiorPixels: counts.get(token), actual, expected });
    }
    if (!result.length) throw Error('No visible identity evidence');
    return { result, dishes, books, expectedExtras: [...expectedExtras], scene: h.characters.snapshot() };
  });
}
module.exports.auditPicks = auditPicks;
if (require.main === module) (async () => {
  const before = hashes(), { browser, context, page, diagnostics, moduleResponses } = await launch();
  const receipt = { command: 'node scripts/character-creator-repair/final-game-picking.cjs', cases: [], diagnostics, productionHashesBefore: before };
  try {
    await ready(page);
    await load(page, 'docs/evidence/2026-10-13-creator-repair/reviewer-game/bed-arc.sav');
    const original = JSON.parse(fs.readFileSync('docs/evidence/2026-10-13-creator-repair/reviewer-game/bed-arc-textures.json', 'utf8'));
    await camera(page, original.scene.view);
    const bed = await auditPicks(page);
    if (!bed.result.some(row => row.actual.kind === 'person') || !bed.result.some(row => row.actual.entity === 19)) throw Error('Bed case lacks person or fixture picks');
    receipt.cases.push({ name: 'occupied-bed', ...bed });
    await page.screenshot({ path: path.join(out, 'picking-occupied-bed.png') });
    await load(page, path.join(out, 'targeted-cleanup-stacks.sav'));
    const tablePosition = await page.evaluate(() => { const s = __terriStress.sim, row = [...s.ids()].findIndex(id => s.objectModel(id)?.id === 'dining_table'); return [s.positions()[row * 2], s.positions()[row * 2 + 1]]; });
    await camera(page, { scale: 2, originX: 800 - (tablePosition[0] - tablePosition[1]) * 64, originY: 550 - (tablePosition[0] + tablePosition[1]) * 42 });
    const stacks = await auditPicks(page), stack = stacks.result.find(row => row.expected.dishes?.length > 1);
    if (!stack) throw Error('No multi-dish stack was visibly picked');
    receipt.cases.push({ name: 'exact-dish-stacks', ...stacks });
    await page.screenshot({ path: path.join(out, 'picking-dish-stacks.png') });
    const registryUrl = moduleResponses.find(name => /\/src\/render\/scene-picks\.(?:ts|js)(?:\?|$)/.test(name));
    receipt.registryModuleResponses = moduleResponses.filter(name => name.includes('scene-picks'));
    save('picking-receipt.json', receipt);
    await page.evaluate(async url => {
      if (!url) throw Error('Actual pick registry module not observed');
      const { ScenePickRegistry } = await import(url), prototype = ScenePickRegistry.prototype, original = prototype.snapshot;
      window.__pickMutation = { prototype, original, observed: 0 };
      prototype.snapshot = function () { const map = original.call(this), rows = [...map].filter(([, hit]) => hit.cleanup); if (rows.length < 2) throw Error('Need two real dish owners for swap mutation'); const [[a, first], [b, second]] = rows; map.set(a, second); map.set(b, first); __pickMutation.observed++; return map; };
    }, registryUrl);
    let killed = null;
    try { await auditPicks(page); } catch (error) { killed = error.message; }
    finally { await page.evaluate(() => { __pickMutation.prototype.snapshot = __pickMutation.original; }); }
    const restored = await page.evaluate(() => ({ restored: __pickMutation.prototype.snapshot === __pickMutation.original, observed: __pickMutation.observed }));
    if (!killed || !/identity mismatch/.test(killed) || !restored.observed || !restored.restored) throw Error('Swapped valid dish owners escaped the pick observer: ' + JSON.stringify({ killed, restored }));
    receipt.mutation = { name: 'swap-two-valid-dish-token-owners', status: 'KILLED', failure: killed, ...restored };
    receipt.cases.push({ name: 'dish-stacks-restored', ...await auditPicks(page) });
    await load(page, 'web/tests/fixtures/owned-reading-dropped.sav');
    const position = await page.evaluate(() => { const s = __terriStress.sim; if (s.droppedBookCount !== 1) throw Error('Expected one dropped-book fixture'); return [...s.droppedBookPositions()]; });
    await camera(page, { scale: 2, originX: 800 - (position[0] - position[1]) * 64, originY: 550 - (position[0] + position[1]) * 42 });
    const book = await auditPicks(page);
    if (!book.result.some(row => row.actual.bookCopy !== undefined)) throw Error('Dropped book has no categorical visible pick witness');
    receipt.cases.push({ name: 'dropped-book', ...book });
    await page.screenshot({ path: path.join(out, 'picking-dropped-book.png') });
    assertHealthy(diagnostics); receipt.status = 'PASS';
  } catch (error) { receipt.status = 'FAIL'; receipt.failure = error.stack; process.exitCode = 1; }
  finally { await context.close(); await browser.close(); receipt.productionHashesAfter = hashes(); receipt.productionUnchanged = JSON.stringify(before) === JSON.stringify(receipt.productionHashesAfter); if (!receipt.productionUnchanged) { receipt.status = 'FAIL'; process.exitCode = 1; } save('picking-receipt.json', receipt); console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, cases: receipt.cases.map(row => ({ name: row.name, picks: row.result.length })) })); }
})();
