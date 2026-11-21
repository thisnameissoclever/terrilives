// The Housemate tab against the released wasm ([T10] in
// docs/specs/2026-11-20-admin-panel.md): the real reads line up with what the
// tab expects of them, and the changes its controls send are changes the real
// simulation accepts. A fake source cannot prove either.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { createHousemateTab } from '../src/admin/admin-housemate.js';
import { housemateSource } from '../src/admin/admin-sources.js';
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

describe('the Housemate tab on the released wasm', () => {
  it('reads content and a person in shapes that line up', () => {
    withGame(sim => {
      const source = housemateSource(sim);
      const library = source.library();
      const [a] = members(sim);
      expect(library.needNames).toHaveLength(7);
      expect(library.needNames[0], 'needs read as names').toBe('Hunger');
      expect(library.traitSkills).toHaveLength(library.traitLabels.length);
      expect(library.traitKinds).toHaveLength(library.traitLabels.length);
      expect(library.skillLevels).toHaveLength(library.skillLabels.length);
      expect(library.levelTitles).toHaveLength(library.pathLabels.length);
      expect(library.jobOptions.length).toBe(library.levelTitles.reduce((total, titles) => total + titles.length, 0));
      for (const option of library.jobOptions) expect(library.levelTitles[option.path][option.level], 'a title for every option').toBeTruthy();
      expect(source.adminAffinities(a.simId)).toHaveLength(library.affinityLabels.length);
      expect(source.affinityWords(a.simId)).toHaveLength(library.affinityLabels.length);
      expect(source.skills(a.simId)).toHaveLength(library.skillLabels.length);
      const scores = source.moodScores(a.simId);
      expect(source.moodLabels(a.simId)).toHaveLength(scores.length);
      expect(source.adminMoodlets(a.simId), 'one row per moodlet').toHaveLength(scores.length - 1);
      expect(source.traits(a.simId).length % 2).toBe(0);
      expect(source.moodScores(987_654), 'an unknown person reads empty').toHaveLength(0);
    });
  });

  it('draws for a real housemate and its controls send changes the simulation applies', () => {
    withGame(sim => {
      const people = members(sim);
      const h = tabHarness(people);
      h.attach(createHousemateTab(housemateSource(sim))(h.context));
      const f = finders(h.state.tab!.body);
      const first = people[0];
      const hunger = housemateSource(sim).library().needNames[0];
      const needs = sim.adminPerson(first.simId)!.needs;
      expect(f.box(hunger).value).toBe(String(Math.round(needs[0])));

      expect(sim.adminBegin()).toBe('ok');
      try {
        // Fill, a need, a skill, one affinity, the job search, and a new job: each as the tab sends it.
        f.button(`Fill ${first.name}'s needs`).click();
        enter(f.box('Fitness'), '3.5');
        enter(f.box('Plants'), '0.75');
        const search = f.control('Job search') as unknown as { checked: boolean; dispatch(type: string): void };
        search.checked = !search.checked;
        search.dispatch('change');
        enter(f.control('Job'), String(sim.adminJobOptions()[0].row));
        for (const { change, label } of h.sent) {
          const result = sim.adminApply(change);
          expect(result, label).toMatchObject({ applied: true });
        }
        expect(sim.adminPerson(first.simId)!.needs.every(value => value === 100)).toBe(true);
        expect(sim.adminPerson(first.simId)!.careerRow).toBe(sim.adminJobOptions()[0].row);
        expect(sim.adminAffinities(first.simId)[0]).toBe(0.75);
        // The skill reads back as the level and hundredths the box showed.
        const index = Array.from(sim.ids()).find(id => sim.simIdOf(id) === first.simId)!;
        const fitness = sim.skillsOf(index)![1];
        expect(fitness.level).toBe(3);
        expect(fitness.progress).toBeCloseTo(0.5, 2);
        // A tab redrawn on the new world shows them.
        h.state.tab!.refresh();
        expect(f.box('Fitness').value).toBe('3.50');
        expect(f.box('Plants').value).toBe('0.75');
        expect(f.control('Job').value).toBe(String(sim.adminJobOptions()[0].row));
        expect(f.has('Pay per shift')).toBe(true);
      } finally {
        sim.adminEnd();
      }
    });
  });
});
