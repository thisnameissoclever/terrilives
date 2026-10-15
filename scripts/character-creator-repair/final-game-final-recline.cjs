const { fs, path, out, launch, ready, frame, load, camera, assertHealthy } = require('./final-game-common.cjs');
const crypto = require('node:crypto');
const directory = path.join(out, 'recline-final'); fs.mkdirSync(directory, { recursive: true });
const originals = JSON.parse(fs.readFileSync(path.join(out, 'extra-recline-pass-visual-fail.json'), 'utf8'));
const fingerprint = () => Object.fromEntries([
  ...fs.readdirSync('web/src/render/character').filter(file => /\.(ts|wgsl)$/.test(file)).map(file => 'web/src/render/character/' + file),
  'web/src/wasm/terri_wasm_bg.wasm', 'web/src/render/sprites.ts', 'web/src/render/sprites.wgsl', 'web/src/render/scene-target.ts', 'web/src/frame.ts',
].sort().map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const save = (name, data) => fs.writeFileSync(path.join(directory, name), JSON.stringify(data, null, 2) + '\n');

async function bubbleProof(page, moduleResponses, actorEntity, formerAnchor = null) {
  const prefix = formerAnchor ? 'bubble-former-anchor' : 'bubble';
  const moduleUrl = moduleResponses.find(url => /\/src\/render\/sprites\.(?:ts|js)(?:\?|$)/.test(url));
  const characterUrl = moduleResponses.find(url => /\/src\/render\/character\/renderer\.(?:ts|js)(?:\?|$)/.test(url));
  if (!moduleUrl) throw Error('The actual game sprite module was not observed');
  await page.evaluate(async ({ moduleUrl, characterUrl, actorEntity, formerAnchor }) => {
    const { SpriteRenderer } = await import(moduleUrl), prototype = SpriteRenderer.prototype, original = prototype.draw;
    const { CharacterRenderer } = await import(characterUrl), characterPrototype = CharacterRenderer.prototype, originalCharacterDraw = characterPrototype.drawScene, originalAnchors = characterPrototype.anchors;
    const actor = __terriStress.characters.snapshot().actors.find(actor => actor.entity === actorEntity);
    if (!actor) throw Error('Reclining actor is missing before instrumentation');
    window.__finalBubble = { prototype, original, characterPrototype, originalCharacterDraw, originalAnchors, formerAnchor, anchorCalls: 0, headMask: false, headMaskCalls: 0, mode: 'normal', actorEntity, calls: 0, renderer: null, token: actor.token, source: null };
    characterPrototype.anchors = function (...args) {
      const anchors = originalAnchors.apply(this, args), state = __finalBubble;
      if (state.formerAnchor && this.data[6] === state.token) { anchors.head = [state.formerAnchor[0] - actor.x, actor.y - state.formerAnchor[1], state.formerAnchor[2]]; state.anchorCalls++; }
      return anchors;
    };
    characterPrototype.drawScene = function (pass) {
      const state = __finalBubble;
      if (!state.headMask || this.data[6] !== state.token) return originalCharacterDraw.call(this, pass);
      const headRanges = this.geometry.description.parts.filter(part => [1, 8, 9].includes(part.region));
      if (!headRanges.length) throw Error('Head-only physical pixel reference has no geometry');
      const drawIndexed = pass.drawIndexed; state.headMaskCalls++;
      pass.drawIndexed = function (count, instances = 1, start = 0, baseVertex = 0, firstInstance = 0) {
        for (const part of headRanges) { const first = Math.max(start, part.start), last = Math.min(start + count, part.start + part.count); if (last > first) drawIndexed.call(this, last - first, instances, first, baseVertex, firstInstance); }
      };
      try { return originalCharacterDraw.call(this, pass); } finally { pass.drawIndexed = drawIndexed; }
    };
    prototype.draw = function (...args) {
      if (this.gpu.context.canvas !== document.querySelector('#stage')) return original.apply(this, args);
      const state = __finalBubble, actor = __terriStress.characters.snapshot().actors.find(actor => actor.entity === state.actorEntity);
      if (!actor) throw Error('Expected actual reclining actor was not drawn');
      const [instances, count, scale, ambient, skyShade, dynamic, owners, annotations] = args;
      state.calls++; state.renderer = this; state.token = actor.token;
      const index = Array.from({ length: annotations.count }, (_, i) => annotations.start + i).find(i => owners[i] === actor.token);
      if (index === undefined) throw Error('Expected person has no activity annotation');
      const bubble = instances.slice(index * 16, index * 16 + 16);
      state.source = { instance: [...bubble], token: actor.token, scale, annotations: { ...annotations } };
      if (state.mode === 'old-depth') { args[7] = { start: count, count: 0 }; return original.apply(this, args); }
      if (state.mode === 'isolated') {
        const staticCount = this.staticCount, lowWallCount = this.lowWallCount, grimeCount = this.grimeCount;
        this.staticCount = 0; this.lowWallCount = 0; this.grimeCount = 0;
        try { return original.call(this, bubble, 1, scale, ambient, skyShade, undefined, new Uint32Array([actor.token]), { start: 0, count: 1 }); }
        finally { this.staticCount = staticCount; this.lowWallCount = lowWallCount; this.grimeCount = grimeCount; this.uploadStatic(); }
      }
      return original.apply(this, args);
    };
  }, { moduleUrl, characterUrl, actorEntity, formerAnchor });
  await frame(page);
  const acquire = async () => page.evaluate(async () => {
    const state = __finalBubble, h = __terriStress, d = h.graphicsDevice, token = state.token;
    async function raw(texture, bytes) {
      if (!texture) return null;
      const stride = Math.ceil(texture.width * bytes / 256) * 256, buffer = d.createBuffer({ size: stride * texture.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try { const encoder = d.createCommandEncoder(); encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride }, [texture.width, texture.height]); d.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ); return { width: texture.width, height: texture.height, stride, data: new Uint8Array(buffer.getMappedRange()).slice() }; }
      finally { buffer.unmap(); buffer.destroy(); }
    }
    const annotation = await raw(h.sceneAnnotationIdentityTexture, 4), physical = await raw(h.sceneIdentityTexture, 4), color = await raw(h.sceneColorTexture, 8);
    const selected = [], body = []; let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    if (annotation) { const ids = new Uint32Array(annotation.data.buffer), stride = annotation.stride / 4; for (let y = 0; y < annotation.height; y++) for (let x = 0; x < annotation.width; x++) if (ids[y * stride + x] === token) { selected.push([x, y]); left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); } }
    const ids = new Uint32Array(physical.data.buffer), stride = physical.stride / 4;
    for (let y = 0; y < physical.height; y++) for (let x = 0; x < physical.width; x++) if (ids[y * stride + x] === token) body.push([x, y]);
    let bounds = state.referenceBounds ?? [left, top, right, bottom];
    if (bounds.some(value => !Number.isFinite(value))) throw Error('No bubble annotation coverage');
    if (state.mode === 'isolated') state.referenceBounds = bounds;
    const [x0, y0, x1, y1] = bounds, colors = [], mask = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const at = y * color.stride + x * 8; colors.push(...color.data.subarray(at, at + 8)); mask.push(annotation ? new DataView(annotation.data.buffer).getUint32(y * annotation.stride + x * 4, true) === token ? 1 : 0 : 0); }
    const bodyTop = body.length ? Math.min(...body.map(point => point[1])) / 2 : null;
    return { mode: state.mode, token, source: state.source, bounds, covered: selected.length, mask, colors, bodyTop, physicalSamples: body.length, bubbleBottom: selected.length ? (bottom + 1) / 2 : null, bodyWitness: body.length ? body[Math.floor(body.length / 3)].map(value => Math.floor(value / 2)) : null, bubbleWitness: selected.length ? selected[Math.floor(selected.length / 3)].map(value => Math.floor(value / 2)) : null, calls: state.calls, anchorCalls: state.anchorCalls, headMaskCalls: state.headMaskCalls, view: h.characters.snapshot().view };
  });
  const observation = [];
  try {
    // Isolate the exact submitted sprite row in the same production renderer and atlas.
    await page.evaluate(() => { __finalBubble.mode = 'isolated'; }); await frame(page);
    const reference = await acquire(); save(`${prefix}-isolated-reference.json`, reference);
    if (reference.covered < 100) throw Error('Bubble reference has too little actual coverage');
    if (formerAnchor && !reference.anchorCalls) throw Error('Recorded former-anchor hook did not run');
    await page.screenshot({ path: path.join(directory, `${prefix}-isolated-reference.png`) });
    for (const mode of ['normal', 'old-depth', 'normal']) {
      await page.evaluate(mode => { __finalBubble.mode = mode; }, mode); await frame(page);
      const current = await acquire(), covered = reference.mask.reduce((n, value) => n + value, 0); let maskDifferences = 0, lostColorSamples = 0;
      for (let i = 0; i < reference.mask.length; i++) { if (reference.mask[i] !== current.mask[i]) maskDifferences++; if (reference.mask[i] && Array.from({ length: 8 }, (_, channel) => channel).some(channel => reference.colors[i * 8 + channel] !== current.colors[i * 8 + channel])) lostColorSamples++; }
      const label = mode === 'old-depth' ? 'old-depth-mutant' : observation.length === 0 ? 'normal' : 'restored';
      const row = { label, covered, maskDifferences, lostColorSamples, source: current.source, bodyTop: current.bodyTop, bubbleBottom: current.bubbleBottom };
      save(`${prefix}-${label}.json`, current); await page.screenshot({ path: path.join(directory, `${prefix}-${label}.png`), clip: { x: 500, y: 280, width: 600, height: 550 } });
      if (mode === 'old-depth') row.mutationOutcome = lostColorSamples > 0 ? 'KILLED_BY_COLOR_LOSS' : 'NO_FAILURE_ON_THIS_REPAIRED_SCENE';
      else {
        if (maskDifferences || lostColorSamples || current.covered !== reference.covered) throw Error('Actual bubble differs from complete no-wall reference');
        if (!formerAnchor) {
          await page.evaluate(() => { __finalBubble.headMask = true; }); await frame(page);
          const head = await acquire(); save(`${prefix}-${label}-head-mask.json`, head);
          await page.screenshot({ path: path.join(directory, `${prefix}-${label}-head-mask.png`), clip: { x: 500, y: 280, width: 600, height: 550 } });
          await page.evaluate(() => { __finalBubble.headMask = false; }); await frame(page);
          if (!head.headMaskCalls || head.physicalSamples < 100 || head.bodyTop === null) throw Error('Actual head-only pixel reference missing');
          row.headTop = head.bodyTop; row.headSamples = head.physicalSamples; row.clearLogicalPixels = head.bodyTop - current.bubbleBottom;
          if (row.clearLogicalPixels < 4) throw Error('Actual bubble has less than four logical pixels of head clearance');
        }
        row.picks = await page.evaluate(async ({ bubble, body, entity }) => ({ bubble: await __terriStress.characters.pick(...bubble), body: await __terriStress.characters.pick(...body), entity }), { bubble: current.bubbleWitness, body: current.bodyWitness, entity: actorEntity });
        if ([row.picks.bubble, row.picks.body].some(hit => hit?.kind !== 'person' || hit.entity !== actorEntity)) throw Error('Bubble or body did not pick the actual person');
      }
      observation.push(row); console.log(JSON.stringify({ bubble: row }));
    }
    return { status: formerAnchor ? 'FORMER_ANCHOR_POSITION_STRESS_RECORDED' : 'FULL_MASK_CLEARANCE_AND_PICKING_PASS', formerAnchor, referenceCovered: reference.covered, observations: observation, mutationLimit: 'The repaired scene may no longer intersect the old world-depth path. A surviving scene mutation is retained, not counted as proof that the annotation layer is necessary; the independent near-geometry GPU contract supplies that rejection control.' };
  } finally { await page.evaluate(() => { __finalBubble.prototype.draw = __finalBubble.original; __finalBubble.characterPrototype.drawScene = __finalBubble.originalCharacterDraw; __finalBubble.characterPrototype.anchors = __finalBubble.originalAnchors; }); await frame(page); }
}

(async () => {
  const before = fingerprint(), { browser, context, page, diagnostics, moduleResponses } = await launch(), receipt = { command: 'node scripts/character-creator-repair/final-game-final-recline.cjs', rows: [], diagnostics, hashesBefore: before };
  try {
    await ready(page);
    for (const variant of ['original', 'masculine-wave-max-face', 'feminine-wave-max-face'].filter(variant => !process.env.ONLY_WAVE || variant !== 'original')) for (const facing of variant === 'original' && process.env.RECLINE_RESUME ? [2] : [1, 3, 0, 2]) {
      const prior = originals.rows.find(row => row.setup.facing === facing), actor = prior.setup.actor.entity;
      if (facing === 1) await load(page, path.join(out, 'extra-recline-1-active.sav'));
      else await page.evaluate(async prior => {
        const s = __terriStress.sim, { default: init, SimHandle } = await import('/src/wasm/terri_wasm.js'); await init(); const h = SimHandle.from_lot(); try { if (!(await globalThis.__terriStress.characters.loadBytes(h.save_bytes()))) throw Error('Household load rejected'); } finally { h.free(); }
        (await globalThis.__terriStress.characters.edit(9550, prior.setup.actor.sim, { version: 1, appearance: prior.setup.appearance })); s.flushCommands(); s.placeObject(prior.setup.fixture, prior.setup.spot.x, prior.setup.spot.y, prior.setup.facing); s.flushCommands(); if (s.lastPlacementResult()?.reason !== null) throw Error('Original sofa placement rejected');
        s.useObjectFirst(prior.setup.actor.entity, prior.setup.fixture, 0); s.flushCommands(); let active = false;
        for (let tick = 0; tick < 420; tick++) { s.tick(); const row = [...s.ids()].indexOf(prior.setup.actor.entity); if (s.activities()[row] === 15 && s.seatedWhole()[row] === 1 && s.seatedFurniture()[row] === prior.setup.fixture) { active = true; break; } }
        if (!active) throw Error('Actual reclining state missing');
      }, prior);
      if (variant !== 'original') await page.evaluate(async ({ variant, sim }) => { const s = __terriStress.sim, { defaultAppearance } = await import('/src/character/schema.ts'), appearance = defaultAppearance(variant.startsWith('masculine') ? 'masculine' : 'feminine'); appearance.body = { height: 100, build: 100, shoulders: 100, hips: 100, torso: 0 }; appearance.hairstyle = 'wave'; appearance.face.shape = 'angular'; for (const key of Object.keys(appearance.face)) if (typeof appearance.face[key] === 'number') appearance.face[key] = 100; appearance.glasses = true; (await globalThis.__terriStress.characters.edit(9551, sim, { version: 1, appearance })); s.flushCommands(); }, { variant, sim: prior.setup.actor.sim });
      await camera(page, prior.captures.find(capture => capture.label === 'active').scene.view);
      const row = { variant, facing, actor, captures: [] }; receipt.current = row;
      fs.writeFileSync(path.join(directory, `${variant}-${facing}-active.sav`), Buffer.from(await page.evaluate(() => [...__terriStress.sim.saveBytes()])));
      for (const offset of [0, 8, 18]) {
        if (offset) await page.evaluate(count => { for (let i = 0; i < count; i++) __terriStress.sim.tick(); }, offset === 8 ? 8 : 10); await frame(page);
        const scene = await page.evaluate(() => __terriStress.characters.snapshot()), drawn = scene.actors.find(row => row.entity === actor); if (drawn?.clip !== 'sofa_recline' || drawn.fixture !== prior.setup.fixture) throw Error('Actual reclining draw missing');
        const screenshot = `${variant}-${facing}-t${offset}.png`; await page.screenshot({ path: path.join(directory, screenshot), clip: { x: 500, y: 280, width: 600, height: 550 } }); row.captures.push({ offset, screenshot, scene, actor: drawn }); save('receipt.json', receipt);
      }
      if (variant === 'original' && facing === 2) {
        receipt.bubbleProof = await bubbleProof(page, moduleResponses, actor);
        const oldActor = prior.captures.find(capture => capture.label === 'active').scene.actors.find(a => a.entity === actor);
        receipt.formerAnchorStress = await bubbleProof(page, moduleResponses, actor, oldActor.head);
      }
      assertHealthy(diagnostics); receipt.rows.push(row); save('receipt.json', receipt); console.log(JSON.stringify({ variant, facing, captures: row.captures.length }));
    }
    receipt.status = 'CAPTURED';
  } catch (error) { receipt.status = 'FAIL'; receipt.failure = error.stack; process.exitCode = 1; }
  finally { await context.close(); await browser.close(); receipt.hashesAfter = fingerprint(); receipt.unchanged = JSON.stringify(before) === JSON.stringify(receipt.hashesAfter); if (!receipt.unchanged) { receipt.status = 'FAIL'; process.exitCode = 1; } save('receipt.json', receipt); console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, unchanged: receipt.unchanged, cases: receipt.rows.length })); }
})();
