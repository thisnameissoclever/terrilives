const { fs, path, out, save, hashes, launch, ready, frame, load, camera, readRegion, decode, assertHealthy } = require('./final-game-common.cjs');
const source = 'docs/evidence/2026-10-13-creator-repair/reviewer-game';
const original = JSON.parse(fs.readFileSync(path.join(source, 'bed-arc-textures.json'), 'utf8'));
function countArcs(region) {
  const sample = decode(region), dark = [];
  for (let y = 518; y < 555; y++) for (let x = 450; x < 525; x++) for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
    const pixel = sample(x, y, sx, sy);
    if (pixel.identity === 20 && Math.max(...pixel.rgba.slice(0, 3)) < .15) dark.push(pixel);
  }
  return { darkSubpixels: dark.length, dark, witness: sample(502, 527, 1, 1) };
}
(async () => {
  const before = hashes(), { browser, context, page, diagnostics } = await launch();
  const receipt = { command: 'node scripts/character-creator-repair/final-game-bed.cjs', original: countArcs(original), diagnostics, productionHashesBefore: before };
  try {
    await ready(page);
    await load(page, path.join(source, 'bed-arc.sav'));
    receipt.camera = await camera(page, original.scene.view);
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map(row => row.name).find(name => /\/src\/render\/character\/renderer\.ts(?:\?|$)/.test(name));
      if (!url) throw Error('Actual renderer module not observed');
      const { CharacterRenderer } = await import(url), prototype = CharacterRenderer.prototype, original = prototype.drawScene;
      window.__coverMutation = { enabled: false, observations: 0, url, prototype, original };
      prototype.drawScene = function (pass) {
        const cover = this.geometry.description.parts.find(part => part.name === 'Configured shared sleeping cover');
        const ranges = this.outlineRanges;
        if (cover) { window.__coverMutation.observations++; if (window.__coverMutation.enabled) this.outlineRanges = [...ranges, { start: cover.start, count: cover.count }]; }
        try { return original.call(this, pass); } finally { this.outlineRanges = ranges; }
      };
    });
    for (const [label, mutant] of [['repaired', false], ['cover-outline-mutant', true], ['restored', false]]) {
      await page.evaluate(enabled => { __coverMutation.enabled = enabled; __coverMutation.observations = 0; }, mutant);
      await frame(page);
      const region = await readRegion(page, original.origin, original.size), counts = countArcs(region);
      save(`bed-${label}-textures.json`, region);
      await page.screenshot({ path: path.join(out, `bed-${label}.png`), clip: { x: 180, y: 242.00044, width: 600, height: 550 } });
      const observations = await page.evaluate(() => __coverMutation.observations);
      if (!observations) throw Error('Cover renderer was never observed');
      receipt[label] = { ...counts, observations, scene: region.scene };
      if (!mutant && counts.darkSubpixels !== 0) throw Error(label + ': shared-bed fabric contains ' + counts.darkSubpixels + ' dark subpixels');
      if (mutant && counts.darkSubpixels === 0) throw Error('Cover-outline mutation survived the symptom check');
      console.log(JSON.stringify({ label, darkSubpixels: counts.darkSubpixels, observations }));
    }
    await page.evaluate(() => { __coverMutation.prototype.drawScene = __coverMutation.original; });
    receipt.prototypeRestored = await page.evaluate(() => __coverMutation.prototype.drawScene === __coverMutation.original);
    assertHealthy(diagnostics);
    receipt.status = 'PASS';
  } catch (error) { receipt.status = 'FAIL'; receipt.failure = error.stack; process.exitCode = 1; }
  finally {
    await context.close(); await browser.close();
    receipt.productionHashesAfter = hashes(); receipt.productionUnchanged = JSON.stringify(before) === JSON.stringify(receipt.productionHashesAfter);
    if (!receipt.productionUnchanged) { receipt.status = 'FAIL'; process.exitCode = 1; }
    save('bed-receipt.json', receipt); console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, productionUnchanged: receipt.productionUnchanged }));
  }
})();
