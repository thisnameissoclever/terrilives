/**
 * The developer overlay's formatter and throttle, over a structural
 * fake per the needs-panel pattern - no DOM, no bridge, every branch.
 */
import { describe, expect, it, vi } from 'vitest';
import * as debugPanel from '../src/ui/debug-panel';
import { DisclosureDocument } from './helpers/disclosure-dom';
import {textWriteProbe} from './helpers/text-write-probe';

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
    // A ledger for the named sim, none for the bare agent - the same
    // split simIdOf draws, so the absent branch is exercised too.
    satisfactionOf: (entity) => (entity === 7 ? 42.25 : null),
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
    funds: () => 375,
    // Terri wears the pack's SECOND trait - not the first, so a lookup
    // collapsing to index 0 is visible - at a state only a condition
    // words as severity.
    traitsOf: (entity) =>
      entity === 7 ? Float32Array.from([1, 0.55]) : new Float32Array(0),
    traitLabels: () => ['Gossip hound', 'Low spirits'],
    traitKinds: () => ['disposition', 'condition'],
    careerOf: (entity) => (entity === 7 ? 'Office clerk' : null),
    chainStatusOf: (entity) =>
      entity === 7 ? 'Cook dinner - step: Cook (carrying ingredients)' : null,
    stallReasonOf: (entity) =>
      entity === 7 ? 'waiting on something in use' : null,
    queuedOrdersOf: (entity) => (entity === 7 ? 2 : 0),
    ...overrides,
  };
}

describe('formatDebugReport', () => {
  it('reports each agent with identity, activity, needs and both personality halves', () => {
    const report = formatDebugReport(source());
    expect(report).toContain('Terri  (entity 7, SimId 0)  doing: talking');
    expect(report).toContain('entity 9, SimId none');
    // Objects never appear - activity is a fact about agents.
    expect(report).not.toContain('entity 11');
    expect(report).toContain('needs: hunger 1.0');
    // The second axis, one decimal, present only for a sim with a
    // ledger: the bare agent's block must not carry the line at all.
    // "life satisfaction", because the personality block already uses
    // the bare word for its refill multipliers.
    expect(report).toContain('life satisfaction: 42.3');
    expect(report.split('entity 9')[1]).not.toContain('life satisfaction:');
    // Multipliers as DEVIATIONS only: the neutral 1.00 columns are
    // noise the owner read as broken stats, so they are gone, and the
    // x prefix says what the number does. The asymmetric fixture
    // halves (1.5 heads drain, 0.75 tails refill) still tell a swap
    // apart.
    expect(report).toContain('need decay: hunger x1.50');
    expect(report).toContain('need refill: hunger x0.50');
    expect(report).toContain('comfort x0.75');
    expect(report).not.toContain('x1.00');
  });

  it('names generic object use without borrowing the eating label', () => {
    const report = formatDebugReport(
      source({ activities: () => Uint32Array.from([7, 0, 0]) }),
    );
    expect(report).toContain('Terri  (entity 7, SimId 0)  doing: using object');
    expect(report).not.toContain('doing: eating');
  });

  it('names exact seated reading without collapsing to generic object use', () => {
    const report = formatDebugReport(
      source({ activities: () => Uint32Array.from([8, 0, 0]) }),
    );
    expect(report).toContain('Terri  (entity 7, SimId 0)  doing: reading');
    expect(report).not.toContain('doing: using object');
    expect(report).not.toContain('doing: eating');
  });

  it('names exercise, watching fish and sitting as exact activities', () => {
    const exercise = formatDebugReport(
      source({ activities: () => Uint32Array.from([9, 0, 0]) }),
    );
    const watching = formatDebugReport(
      source({ activities: () => Uint32Array.from([10, 0, 0]) }),
    );
    const sitting = formatDebugReport(
      source({ activities: () => Uint32Array.from([11, 0, 0]) }),
    );
    expect(exercise).toContain('Terri  (entity 7, SimId 0)  doing: exercising');
    expect(watching).toContain(
      'Terri  (entity 7, SimId 0)  doing: watching fish',
    );
    expect(sitting).toContain('Terri  (entity 7, SimId 0)  doing: sitting');
    expect(exercise).not.toContain('doing: using object');
    expect(watching).not.toContain('doing: reading');
    expect(sitting).not.toContain('doing: using object');
  });

  it('prints the household funds once, at the top, before anybody', () => {
    const report = formatDebugReport(source());
    expect(report.startsWith('household funds: 375')).toBe(true);
    // Once: the money is the lot's, not any sim's.
    expect(report.match(/funds:/g)).toHaveLength(1);
  });

  it('prints the job and the outfit for the sim that has them, and neither for the bare agent', () => {
    const report = formatDebugReport(source());
    expect(report).toContain('career: Office clerk');
    // The mid-errand line rides between the job and the needs.
    expect(report).toContain('chain: Cook dinner - step: Cook (carrying ingredients)');
    expect(report.split('entity 9')[1]).not.toContain('chain:');
    // The fixture wears the SECOND pack trait, so a lookup collapsing
    // to index 0 would print the hound.
    expect(report).toContain('traits: Low spirits (condition, severity 0.55)');
    expect(report).not.toContain('Gossip hound');
    // The stalled line answers "why is she just standing there", and
    // the orders line is a separate fact rather than a reason.
    expect(report).toContain('stalled reason: waiting on something in use');
    expect(report).toContain('player orders waiting: 2');
    const bareBlock = report.split('entity 9')[1];
    expect(bareBlock).not.toContain('career:');
    expect(bareBlock).not.toContain('traits:');
    expect(bareBlock).not.toContain('stalled reason:');
    expect(bareBlock).not.toContain('player orders waiting:');
  });

  it('words a capability as a level and a disposition as nothing', () => {
    const report = formatDebugReport(
      source({
        traitsOf: (entity) =>
          entity === 7
            ? Float32Array.from([0, 0.4, 1, 0.25])
            : new Float32Array(0),
        traitKinds: () => ['capability', 'disposition'],
        traitLabels: () => ['All thumbs', 'Gossip hound'],
      }),
    );
    expect(report).toContain('traits: All thumbs (capability, level 0.40)');
    // A disposition carries no state, so none is invented for it.
    expect(report).toContain('traits: Gossip hound (disposition)');
  });

  it('names a known SimId and falls back for an unknown one', () => {
    // SimId 3 belongs to nobody in the buffer - a feeling about the
    // departed. It prints as sim#3 rather than vanishing: a debug panel
    // that hides data is worse than none.
    const report = formatDebugReport(source());
    expect(report).toContain('relationships: sim#3 +0.42');
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
    expect(report).toContain('relationships: nobody yet');
  });
});

describe('DebugPanel', () => {
  it('does no projection reads while folded and refreshes fresh values on reopening', () => {
    const reads = vi.fn(() => Uint32Array.from([0, 0, 1]));
    const r = {hidden: false, readable: false, textContent: ''};
    const panel = new DebugPanel(source({kinds: reads}), r, 10000);
    panel.update(0); expect(reads).not.toHaveBeenCalled();
    r.readable = true; panel.update(1); expect(reads).toHaveBeenCalledTimes(1);
    r.readable = false; panel.update(2);
    r.textContent = 'stale'; r.readable = true; panel.update(3);
    expect(reads).toHaveBeenCalledTimes(2); expect(r.textContent).not.toBe('stale');
  });

  it('toggles actual section visibility while preserving a folded native disclosure', () => {
    const section = {hidden: false}, details = {open: false}, report = {textContent: ''};
    const r = debugPanel.createDebugRoot(section, details, report);
    const reads = vi.fn(() => Uint32Array.from([0, 0, 1]));
    const panel = new DebugPanel(source({kinds: reads}), r, 10000);
    panel.update(0); panel.toggle(); expect(section.hidden).toBe(true); expect(details.open).toBe(false);
    panel.update(1); panel.toggle(); expect(section.hidden).toBe(false); expect(details.open).toBe(false);
    panel.update(2); expect(reads).not.toHaveBeenCalled();
    details.open = true; panel.update(3, true); expect(reads).toHaveBeenCalledTimes(1);
    details.open = false; panel.update(4, true); expect(reads).toHaveBeenCalledTimes(1);
    report.textContent = 'old values'; details.open = true; panel.update(5, true);
    expect(reads).toHaveBeenCalledTimes(2); expect(report.textContent).not.toBe('old values');
    details.open = false; details.open = true;
    report.textContent = 'changed between frames'; panel.update(6, true);
    expect(reads).toHaveBeenCalledTimes(3); expect(report.textContent).not.toBe('changed between frames');
  });
  it('starts people expanded and reads only open inner sections while preserving focus and text nodes', () => {
    const doc = new DisclosureDocument(), container = doc.createElement('div');
    const needsOf = vi.fn(() => Float32Array.of(12, 30, 40, 50, 60, 70, 80));
    const traitsOf = vi.fn(() => Float32Array.of(1, .55));
    const personalityOf = vi.fn(() => Float32Array.of(1.5, 1, 1, 1, 1, 1, 1, .5, 1, 1, 1, 1, 1, .75));
    const sourceValue = source({needsOf, traitsOf, personalityOf});
    let visible = true;
    const surface = debugPanel.createStructuredDebugSurface(doc as unknown as Document, container as unknown as HTMLElement, () => visible);
    const panel = new DebugPanel(sourceValue, {hidden: false, textContent: ''}, 100, surface);
    panel.update(0);
    const people = container.children.filter(node => node.tagName === 'details');
    expect(people).toHaveLength(2);
    expect(people.every(person => person.open)).toBe(true);
    const sections = people[0].children.filter(node => node.tagName === 'details');
    expect(sections.map(section => section.children[0].textContent)).toEqual(['Overview', 'Traits', 'Needs', 'Need rates', 'Relationships']);
    expect(sections.every(section => !section.open)).toBe(true);
    expect(needsOf).not.toHaveBeenCalled(); expect(traitsOf).not.toHaveBeenCalled();
    expect(personalityOf).not.toHaveBeenCalled();
    const needs = sections[2]; needs.open = true; needs.fire('toggle');
    expect(needsOf).toHaveBeenCalledExactlyOnceWith(7);
    expect(needs.textContent).toContain('hunger12.0');
    const table = needs.children[1], hunger = table.children[0].children[0];
    const oldText = hunger.children[1];
    const text = textWriteProbe(oldText);
    needs.children[0].focus();
    panel.update(100);
    expect(doc.activeElement).toBe(needs.children[0]);
    expect(container.children.includes(people[0])).toBe(true);
    expect(hunger.children[1]).toBe(oldText);
    expect(text.writes).toBe(0);
    expect(needs.open).toBe(true);
    people[0].open = false; panel.update(200);
    expect(needsOf).toHaveBeenCalledTimes(2);
    people[0].open = true; sections[4].open = true; sections[4].fire('toggle');
    expect(sections[4].textContent).toContain('sim#3+0.42');
    sections[0].open = true; sections[0].fire('toggle');
    expect(sections[0].textContent).toContain('Office clerk');
    expect(sections[0].textContent).toContain('waiting on something in use');
    expect(sections[0].textContent).toContain('player orders waiting2');
    expect(people[0].textContent).toContain('entity 7, SimId 0');
    sections[1].open = true; sections[1].fire('toggle');
    expect(sections[1].textContent).toContain('Low spirits (condition, severity 0.55)');
    sections[3].open = true; sections[3].fire('toggle');
    expect(sections[3].textContent).toContain('need decayhunger x1.50');
    expect(sections[3].textContent).toContain('comfort x0.75');
    needsOf.mockReturnValue(Float32Array.of(17, 30, 40, 50, 60, 70, 80));
    panel.update(300);
    expect(hunger.children[1].textContent).toBe('17.0');
    const reads = needsOf.mock.calls.length;
    visible = false; needs.fire('toggle');
    expect(needsOf).toHaveBeenCalledTimes(reads);
  });
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
