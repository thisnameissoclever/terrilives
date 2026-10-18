import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import init, { SimHandle } from '../web/src/wasm/terri_wasm.js';

const moduleBytes = readFileSync(new URL('../web/src/wasm/terri_wasm_bg.wasm', import.meta.url));
const moduleHash = createHash('sha256').update(moduleBytes).digest('hex');
assert.equal(moduleHash, '6c0562aca59fe17b20000845ebeddb71337859b2b39bd8e212a10ec5ab3154c1');
const { memory } = await init({ module_or_path: moduleBytes });
const server = await createServer({ root: 'web', server: { middlewareMode: true }, appType: 'custom' });
const results = [];
try {
  const { SimBridge } = await server.ssrLoadModule('/src/bridge.ts');
  const { FurnitureBuilder } = await server.ssrLoadModule('/src/ui/builder.ts');
  const { OverlayPauseController } = await server.ssrLoadModule('/src/ui/overlay-pause.ts');
  for (const object of [15, 22]) {
    const handle = SimHandle.from_lot();
    const verifier = SimHandle.from_lot();
    try {
      const source = new SimBridge(handle, memory);
      const pause = new OverlayPauseController({ setSpeed() {} }, () => {}, 2);
      const builder = new FurnitureBuilder(source, pause, { changed() {}, enter() {}, exit() {} });
      const labels = handle.interaction_labels(object);
      const ids = Array.from(source.ids());
      const kinds = Array.from(source.kinds());
      const agent = ids.find((_, row) => kinds[row] === 0);
      assert.notEqual(agent, undefined);
      assert.equal(source.buildActive(), false);
      builder.enter();
      builder.select(object);
      assert.equal(builder.canSell, true);
      assert.equal(source.useObject(agent, object, 0), true);
      assert.equal(builder.sell(), true);
      source.flushCommands();
      const beforeAfterCommands = Array.from(handle.last_sale_result());
      builder.afterCommands();
      const afterAfterCommands = Array.from(handle.last_sale_result());
      const error = Array.from(handle.take_build_error());
      const current = source.saveBytes();
      assert.equal(current[8], 16);
      assert.equal(verifier.load_bytes(current), true);
      assert.deepEqual(verifier.save_bytes(), current);
      const result = {
        object, labels, agent, beforeAfterCommands, afterAfterCommands, error,
        selected: builder.selected, pending: builder.pending, saleValue: builder.saleValue,
        canSell: builder.canSell, status: builder.status, saleRefusal: builder.saleRefusal,
        strictV16RoundTrip: true,
      };
      if (object === 15) {
        assert.deepEqual(labels, []);
        assert.deepEqual(beforeAfterCommands, []);
        assert.deepEqual(afterAfterCommands, []);
        assert.deepEqual(error, [1, 0, 1, 10, 1, 6]);
      } else {
        assert(labels.length > 0);
        assert.equal(beforeAfterCommands[0], object);
        assert.equal(beforeAfterCommands[2], 0);
        assert.deepEqual(afterAfterCommands, beforeAfterCommands);
        assert.deepEqual(error, [1, 0, 0]);
        assert.equal(builder.canSell, false);
        assert.equal(builder.pending, false);
        assert.equal(builder.status, 'Wait until nobody is using or approaching this object.');
      }
      results.push(result);
    } finally { verifier.free(); handle.free(); }
  }
  const evidence = { moduleHash, mode: 'actual release module, no native Build begun, no simulation ticks', results };
  writeFileSync(new URL('./builder-sale-diagnostic.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await server.close(); }
