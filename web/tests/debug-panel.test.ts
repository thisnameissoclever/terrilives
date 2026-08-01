/**
 * The developer overlay's formatter and throttle, over a structural
 * fake per the needs-panel pattern - no DOM, no bridge, every branch.
 */
import { describe, expect, it } from 'vitest';

import {
  DebugPanel,
  formatDebugReport,
  type DebugRoot,
  type DebugSource,
} from '../src/ui/debug-panel';

/** Three rows: a named sim, an id-less bare agent, and an object. */
function source(overrides: Partial<DebugSource> = {}): DebugSource {
  return {
    count: 3,
    kinds: () => Uint32Array.from([0, 0, 1]),
    ids: () => Uint32Array.from([7, 9, 11]),
    activities: () => Uint32Array.from([4, 0, 0]),
    simName: (entity) => (entity === 7 ? 'Terri' : ''),
    simIdOf: (entity) => (entity === 7 ? 0 : null),
    needsOf: () => Float32Array.from([1, 2, 3, 4, 5, 6, 7]),
    personalityOf: (entity) =>
      entity === 7
        ? Float32Array.from([
            1.5, 1, 1, 1, 1, 1, 1, 0.5, 1, 1, 1, 1, 1, 0.75,
          ])
        : new Float32Array(0),
    // Terri feels about SimId 3 (unknown - departed or unspawned) and
    // about herself-adjacent id 0 is not present; odd tail exercised
    // in its own test below.
    relationshipsOf: (entity) =>
      entity === 7 ? Float32Array.from([3, 0.42]) : new Float32Array(0),
    needNames: () => ['hunger', 'energy', 'hygiene', 'bladder', 'social', 'fun', 'comfort'],
    ...overrides,
  };
}

describe('formatDebugReport', () => {
  it('reports each agent with identity, activity, needs and both personality halves', () => {
    const report = formatDebugReport(source());
    expect(report).toContain('Terri  (entity 7, SimId 0)  talking');
    expect(report).toContain('entity 9, SimId none');
    // Objects never appear - activity is a fact about agents.
    expect(report).not.toContain('entity 11');
    expect(report).toContain('needs: hunger 1.0');
    // Drain first, satisfaction second: the asymmetric fixture halves
    // (1.5 heads drain, 0.75 tails satisfaction) tell a swap apart.
    expect(report).toContain('drain: hunger 1.50');
    expect(report).toContain('satisfaction: hunger 0.50');
    expect(report).toContain('comfort 0.75');
  });

  it('names a known SimId and falls back for an unknown one', () => {
    // SimId 3 belongs to nobody in the buffer - a feeling about the
    // departed. It prints as sim#3 rather than vanishing: a debug panel
    // that hides data is worse than none.
    const report = formatDebugReport(source());
    expect(report).toContain('feels: sim#3 +0.42');
  });

  it('tolerates an odd-length pair array by ignoring the tail', () => {
    const report = formatDebugReport(
      source({
        relationshipsOf: (entity) =>
          entity === 7
            ? Float32Array.from([3, 0.42, 99])
            : new Float32Array(0),
      }),
    );
    expect(report).toContain('sim#3 +0.42');
    expect(report).not.toContain('99');
  });

  it('says so when a sim has met nobody', () => {
    const report = formatDebugReport(
      source({ relationshipsOf: () => new Float32Array(0) }),
    );
    expect(report).toContain('feels: nobody yet');
  });
});

describe('DebugPanel', () => {
  function root(): DebugRoot {
    return { hidden: true, textContent: null };
  }

  it('renders only while visible, on the refresh cadence', () => {
    let reads = 0;
    const counting = source({
      kinds: () => {
        reads++;
        return Uint32Array.from([0, 0, 1]);
      },
    });
    const r = root();
    const panel = new DebugPanel(counting, r, 100);

    panel.update(0);
    expect(reads).toBe(0); // hidden: no read at all

    panel.toggle();
    panel.update(0);
    panel.update(50); // inside the window: throttled
    expect(reads).toBe(1);
    panel.update(150);
    expect(reads).toBe(2);
    expect(r.textContent).toContain('Terri');
  });

  it('refreshes immediately on reopen instead of showing the stale report', () => {
    const r = root();
    const panel = new DebugPanel(source(), r, 10_000);
    panel.toggle();
    panel.update(0);
    panel.toggle(); // hide
    panel.toggle(); // reopen inside the same throttle window
    r.textContent = 'stale';
    panel.update(1);
    expect(r.textContent).not.toBe('stale');
  });
});
