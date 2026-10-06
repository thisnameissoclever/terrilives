import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { splitBuyingDetails } from '../src/books/codec.js';
import { modelFactsLabel } from '../src/ui/buy-tool-controls.js';

let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });

it('separates canonical optional hardware roles from opaque display notes at the projection boundary', () => {
  expect(splitBuyingDetails(['meal_table', 'Handwashing raises Hygiene only up to 40', 'dining_seat', 'An opaque future display note']))
    .toEqual({ optionalRequirements: ['meal_table', 'dining_seat'], additionalDetails: ['Handwashing raises Hygiene only up to 40', 'An opaque future display note'] });
});

it('shows actual merged handwashing and two-user media conditions without inventing optional dining hardware', () => {
  const handle = SimHandle.from_lot(), source = new SimBridge(handle, memory);
  try {
    const models = source.modelFacts(), names = source.needNames();
    const sink = models.find(model => model.id === 'sink')!;
    expect(sink.actions[0].optionalRequirements).toEqual([]);
    expect(sink.actions[0].additionalDetails).toContain('Handwashing raises Hygiene only up to 40');
    expect(modelFactsLabel(sink, names)).toContain('Hygiene only up to 40');
    expect(modelFactsLabel(sink, names)).not.toContain('Optional seating');
    for (const id of ['television', 'radio']) {
      const model = models.find(row => row.id === id)!;
      expect(model.actions[0].capacity).toBe(2);
      expect(model.actions[0].optionalRequirements).toEqual([]);
      const text = modelFactsLabel(model, names);
      expect(text).toContain('2 users at once');
      expect(text).toContain('Social requires liked company using the same device');
      expect(text).toContain('Comfort depends on the seat actually used');
      expect(text).not.toContain('Optional seating');
      expect(text).not.toContain('eat beside a preparation counter');
    }
  } finally { handle.free(); }
});
