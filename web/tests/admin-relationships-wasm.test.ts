// The Relationships tab against the released wasm ([T11] in
// docs/specs/2026-11-20-admin-panel.md): the real relationship reads draw the
// cards, and the changes the tab sends are changes the real simulation applies.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { createRelationshipsTab } from '../src/admin/admin-relationships.js';
import { entityOfSim, relationshipsSource } from '../src/admin/admin-sources.js';
import { enter, finders, tabHarness } from './helpers/admin-tab.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

function withGame<T>(body: (sim: SimBridge) => T): T {
  const handle = SimHandle.from_lot();
  try { return body(new SimBridge(handle, memory)); } finally { handle.free(); }
}

function members(sim: SimBridge) {
  const found: { simId: number; name: string }[] = [];
  for (const index of Array.from(sim.ids())) {
    const id = sim.simIdOf(index);
    if (id !== null && !found.some(person => person.simId === id)) found.push({ simId: id, name: sim.simName(index) });
  }
  return found.sort((a, b) => a.simId - b.simId);
}

/** What the world holds for `from` about `to`, 0 when nothing is stored. */
function feeling(sim: SimBridge, from: number, to: number): number {
  const pairs = Array.from(sim.relationshipsOf(entityOfSim(sim, from)!));
  for (let at = 0; at + 1 < pairs.length; at += 2) if (pairs[at] === to) return pairs[at + 1];
  return 0;
}

describe('the Relationships tab on the released wasm', () => {
  it('draws one card per other housemate and its changes apply to the real world', () => {
    withGame(sim => {
      const people = members(sim);
      expect(people.length).toBeGreaterThan(1);
      const [a, b] = people;
      const h = tabHarness(people);
      h.attach(createRelationshipsTab(relationshipsSource(sim))(h.context));
      const f = finders(h.state.tab!.body);
      const titles = f.root.querySelectorAll('.admin-rel-title').map(node => node.textContent);
      expect(titles).toEqual(people.slice(1).map(other => `${a.name} and ${other.name}`));
      expect(Number(f.box(`${a.name}'s feeling about ${b.name}`).value)).toBeCloseTo(feeling(sim, a.simId, b.simId), 2);

      expect(sim.adminBegin()).toBe('ok');
      try {
        enter(f.box(`${a.name}'s feeling about ${b.name}`), '0.8');
        enter(f.box(`${b.name}'s feeling about ${a.name}`), '-0.4');
        f.root.querySelectorAll('button').find(node => node.textContent === `${a.name} starts a fight`)!.click();
        for (const { change, label } of h.sent) expect(sim.adminApply(change), label).toMatchObject({ applied: true });
        expect(feeling(sim, a.simId, b.simId)).toBeCloseTo(0.8, 5);
        expect(feeling(sim, b.simId, a.simId)).toBeCloseTo(-0.4, 5);
        // The tab redrawn on the new world shows the new words.
        h.state.tab!.refresh();
        expect(f.box(`${a.name}'s feeling about ${b.name}`).value).toBe('0.80');
        expect(f.text()).toContain('Close');
        expect(f.text()).toContain('Dislikes');

        f.button(`Set all of ${a.name}'s feelings to 0`).click();
        expect(sim.adminApply(h.sent.at(-1)!.change)).toMatchObject({ applied: true });
        expect(feeling(sim, a.simId, b.simId)).toBe(0);
        expect(feeling(sim, b.simId, a.simId)).toBe(0);
      } finally {
        sim.adminEnd();
      }
    });
  });
});
