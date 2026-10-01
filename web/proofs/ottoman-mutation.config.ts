import { defineConfig } from 'vitest/config';

// Transform only the loaded module. Production source files are never rewritten.
const cases: Record<string, { before: string; after: string; count: number; file?: string }> = {
  acceptUnrelatedFailure: {
    file: '/proofs/ottoman-mutation-result.mjs',
    before: " || !message.includes(marker)", after: '', count: 1,
  },
  acceptRuntimeError: {
    file: '/proofs/ottoman-mutation-result.mjs',
    before: ' || runtime.unhandledErrors.length', after: '', count: 1,
  },
  cancelBoth: {
    file: '/src/bridge.ts',
    before: 'const bytes = [VARIANT_CANCEL_INTENTS];',
    after: `for (let row = 0; row < this.count; row++) {
      if (this.kinds()[row] !== 0 || this.ids()[row] === agent) continue;
      const other = [VARIANT_CANCEL_INTENTS];
      pushVarint(other, this.ids()[row]);
      this.enqueueCommand(new Uint8Array(other));
    }
    const bytes = [VARIANT_CANCEL_INTENTS];`, count: 1,
  },
  wrongTarget: {
    before: 'const target = this.findRow(targets[row]);',
    after: 'const target = kinds.findIndex((kind, i) => kind !== KIND_AGENT && this.catalog[sprites[i]]?.action === actions[row]);',
    count: 1,
  },
  wrongCadence: {
    before: '2 * profile.halfCycleTicks / frames.length',
    after: '2 * 24 / frames.length', count: 1,
  },
  frozenSample: {
    before: 'this.bodies[row] = frames[sample];',
    after: 'this.bodies[row] = frames[0];', count: 1,
  },
  wrongShirt: {
    before: 'this.shirtVariant(simIds?.[row])',
    after: "'blue'", count: 1,
  },
  wrongFacing: {
    before: 'this.catalog[sprites[target]]',
    after: 'this.catalog[1358]', count: 2,
  },
  ignoredReducedMotion: {
    before: 'frames.length, 2 * profile.halfCycleTicks / frames.length, reducedMotion)',
    after: 'frames.length, 2 * profile.halfCycleTicks / frames.length, false)', count: 1,
  },
  visibleEmpty: {
    before: 'this.suppressed[target] = 1;',
    after: 'this.suppressed[target] = 0;', count: 1,
  },
};
const selected = process.env.OTTOMAN_MUTATION;
if (!selected || (selected !== 'baseline' && !cases[selected])) {
  throw new Error('Select a named ottoman mutation or baseline');
}
export default defineConfig({
  plugins: [{
    name: 'ottoman-intentional-break', enforce: 'pre',
    transform(source, id) {
      if (selected === 'baseline') return;
      const mutation = cases[selected];
      if (!id.replaceAll('\\', '/').endsWith(mutation.file ?? '/src/render/interaction-sprites.ts')) return;
      if (source.split(mutation.before).length - 1 !== mutation.count) {
        throw new Error(`Mutation ${selected} does not match its expected source`);
      }
      return { code: source.replaceAll(mutation.before, mutation.after), map: null };
    },
  }],
  test: { maxWorkers: 1 },
});
