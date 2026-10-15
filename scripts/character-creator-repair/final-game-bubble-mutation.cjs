const { fs, path, out, save, hashes, launch, ready, frame, load, camera, readRegion, decode, assertHealthy } = require('./final-game-common.cjs');
const source = 'docs/evidence/2026-10-13-creator-repair/reviewer-game';
function inspect(region, baseline, depth) {
  const sample = decode(region), reference = decode(baseline), bubble = [], head = [], overlaps = []; let outsideBubbleIdentityChanges = 0;
  for (let y = 435; y < 500; y++) for (let x = 391; x < 445; x++) for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
    const pixel = sample(x, y, sx, sy), before = reference(x, y, sx, sy), center = [x + (sx + .5) / 2, y + (sy + .5) / 2];
    const covered = pixel.identity === 0 && Math.abs(pixel.surface - depth) < 1e-7, oldBubble = before.identity === 0 && Math.abs(before.surface - depth) < 1e-7;
    if (covered) bubble.push(center);
    if (before.identity === 37) { head.push(center); if (covered) overlaps.push(center); }
    if (!covered && !oldBubble && pixel.identity !== before.identity) outsideBubbleIdentityChanges++;
  }
  if (bubble.length < 100 || head.length < 100) throw Error('Missing bubble or baseline head coverage');
  const bottom = Math.max(...bubble.map(point => point[1])) + .25, top = Math.min(...head.map(point => point[1])) - .25;
  return { bubbleSamples: bubble.length, baselineHeadSamples: head.length, bubbleBottomEdge: bottom, baselineHeadTopEdge: top, clearLogicalPixels: top - bottom, overlapSubpixels: overlaps.length, overlapWitnesses: overlaps.slice(0, 8), outsideBubbleIdentityChanges };
}
(async () => {
  const before = hashes(), { browser, context, page, diagnostics, moduleResponses } = await launch(), receipt = { command: 'node scripts/character-creator-repair/final-game-bubble-mutation.cjs', observations: [], diagnostics, productionHashesBefore: before };
  try {
    await ready(page); await load(page, path.join(source, 'bed-arc.sav'));
    const saved = JSON.parse(fs.readFileSync(path.join(source, 'bed-arc-textures.json'), 'utf8'));
    await camera(page, saved.scene.view);
    const url = moduleResponses.find(name => /\/src\/render\/character\/renderer\.(?:ts|js)(?:\?|$)/.test(name));
    await page.evaluate(async url => {
      if (!url) throw Error('Actual character renderer module not observed');
      const { CharacterRenderer } = await import(url), prototype = CharacterRenderer.prototype, original = prototype.anchors;
      window.__bubbleMutation = { prototype, original, enabled: false, observations: 0 };
      prototype.anchors = function (...args) { const anchors = original.apply(this, args); if (__bubbleMutation.enabled && this.data[6] === 37) { anchors.head[2] -= .3; __bubbleMutation.observations++; } return anchors; };
    }, url);
    const baseline = await readRegion(page, [782, 870], [108, 130]), witness = decode(baseline)(407, 462, 0, 0);
    if (witness.identity !== 0 || Math.max(...witness.rgba.slice(0, 3)) >= .15) throw Error('Bubble outline witness changed');
    for (const [label, enabled] of [['baseline', false], ['lowered-head-anchor-mutant', true], ['restored', false]]) {
      await page.evaluate(enabled => { __bubbleMutation.enabled = enabled; __bubbleMutation.observations = 0; }, enabled); await frame(page);
      const region = await readRegion(page, [782, 870], [108, 130]), measured = inspect(region, baseline, witness.surface), observations = await page.evaluate(() => __bubbleMutation.observations);
      save(`bubble-${label}-textures.json`, region); await page.screenshot({ path: path.join(out, `bubble-${label}.png`), clip: { x: 360, y: 360, width: 270, height: 210 } });
      receipt.observations.push({ label, ...measured, anchorMutationCalls: observations });
      if (enabled) {
        if (!(observations > 0 && measured.overlapSubpixels > 0 && measured.clearLogicalPixels < 0)) throw Error('Lowered-head anchor mutation escaped the visible-clearance check');
      } else if (!(measured.overlapSubpixels === 0 && measured.clearLogicalPixels > 0)) throw Error('Unmutated bubble overlaps the original visible head');
      if (measured.outsideBubbleIdentityChanges !== 0) throw Error('Identity changed outside the old/new bubble, so the mutation is not isolated');
      console.log(JSON.stringify({ label, ...measured, anchorMutationCalls: observations }));
    }
    await page.evaluate(() => { __bubbleMutation.prototype.anchors = __bubbleMutation.original; });
    receipt.methodRestored = await page.evaluate(() => __bubbleMutation.prototype.anchors === __bubbleMutation.original);
    assertHealthy(diagnostics); receipt.status = 'PASS';
  } catch (error) { receipt.status = 'FAIL'; receipt.failure = error.stack; process.exitCode = 1; }
  finally { await context.close(); await browser.close(); receipt.productionHashesAfter = hashes(); receipt.productionUnchanged = JSON.stringify(before) === JSON.stringify(receipt.productionHashesAfter); if (!receipt.productionUnchanged) { receipt.status = 'FAIL'; process.exitCode = 1; } save('bubble-mutation-receipt.json', receipt); console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure })); }
})();
