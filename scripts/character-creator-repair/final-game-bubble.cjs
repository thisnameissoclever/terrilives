const { fs, path, out, save, decode } = require('./final-game-common.cjs');
const file = 'bed-repaired-textures.json', region = JSON.parse(fs.readFileSync(path.join(out, file), 'utf8')), sample = decode(region);
// The selected bubble is the left sleeper's visible circle, identified in the screenshot.
// Its depth comes from a covered outline pixel, not the positioning formula.
const witness = sample(407, 462, 0, 0), bubble = [], head = [];
if (witness.identity !== 0 || Math.max(...witness.rgba.slice(0, 3)) >= .15) throw Error('The visible bubble-outline witness changed');
for (let y = 435; y < 500; y++) for (let x = 391; x < 445; x++) for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
  const pixel = sample(x, y, sx, sy), center = [x + (sx + .5) / 2, y + (sy + .5) / 2];
  if (pixel.identity === 0 && Math.abs(pixel.surface - witness.surface) < 1e-7) bubble.push(center);
  if (pixel.identity === 37) head.push(center);
}
if (bubble.length < 100 || head.length < 100) throw Error('Bubble or character capture was empty');
const bubbleBottomEdge = Math.max(...bubble.map(point => point[1])) + .25, headTopEdge = Math.min(...head.map(point => point[1])) - .25, gap = headTopEdge - bubbleBottomEdge;
if (!(gap > 0)) throw Error('Visible bubble overlaps the inspected head');
const receipt = { status: 'PASS', source: file, screenshot: 'bed-repaired.png', actorToken: 37, measuredRegionLogical: [391, 435, 54, 65], bubbleDepthWitness: witness, bubbleSamples: bubble.length, headSamples: head.length, bubbleBottomEdge, headTopEdge, clearLogicalPixels: gap, viewScale: region.scene.view.scale, scope: 'One inspected sleeper at the saved camera. Coverage/depth/identity readback supplies the visible edges. This does not establish every character, action, or scale.' };
save('bubble-pixel-receipt.json', receipt); console.log(JSON.stringify(receipt));
