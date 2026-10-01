import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initSync, SimHandle } from '../web/src/wasm/terri_wasm.js';

// Checks autonomous bed use and save replay through a release package.
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--old-layout'),
  'usage: node scripts/bed-autonomy-proof.mjs [--old-layout]');
const oldLayout = process.argv[2] === '--old-layout';
const bytes = readFileSync(new URL('../web/src/wasm/terri_wasm_bg.wasm', import.meta.url));
const { memory } = initSync({ module: bytes });
const report = { scenario: oldLayout ? 'counterfactual-old-layout' : 'starting-household',
  wasmSha256: createHash('sha256').update(bytes).digest('hex'), days: 4, seeds: [] };

function places(handle, person) {
  const values = handle.bed_places_of(person);
  assert.equal(values[0], 1, 'the observed household member must remain alive');
  assert.equal((values.length - 1) % 6, 0, 'bed place rows must be complete');
  const result = [];
  for (let at = 1; at < values.length; at += 6) {
    const [bed, ordinal, x, y, assignee, occupant] = values.slice(at, at + 6);
    result.push({ bed, ordinal, x, y, assignee, occupant });
  }
  return result;
}

function activities(handle) {
  const count = handle.entity_count();
  const ids = Array.from(new Uint32Array(memory.buffer, handle.ids_ptr(), count));
  const codes = Array.from(new Uint32Array(memory.buffer, handle.activities_ptr(), count));
  return new Map(ids.map((id, row) => [id, codes[row]]));
}

for (const seed of oldLayout ? [2301] : [7, 19, 2301]) {
  const handle = SimHandle.from_lot_with_seed(seed, 0);
  const loaded = SimHandle.from_lot();
  try {
    const people = [...activities(handle).keys()]
      .filter((id) => handle.sim_id_of(id) !== 0xffffffff)
      .sort((a, b) => handle.sim_id_of(a) - handle.sim_id_of(b));
    assert.equal(people.length, 3);
    const rows = places(handle, people[0]);
    const double = rows.find((row) => row.ordinal === 1)?.bed;
    assert.notEqual(double, undefined, 'the household must have a double bed');
    assert.equal(rows.filter((row) => row.bed === double).length, 2);
    if (oldLayout) {
      assert.equal(handle.place_object(double, 0, 6, 0), true);
      handle.flush_commands();
      assert.ok(places(handle, people[0]).filter((row) => row.bed === double)
        .every((row) => row.x === 0 && row.y === 6), 'the counterfactual bed move must succeed');
    }
    const assignments = [rows.find((row) => row.bed === double && row.ordinal === 0),
      rows.find((row) => row.bed === double && row.ordinal === 1), rows.find((row) => row.bed !== double)];
    for (const [index, person] of people.entries()) {
      assert.equal(handle.set_bed_assignment(person, assignments[index].bed, assignments[index].ordinal), true);
    }
    handle.flush_commands();
    assert.equal(loaded.load_bytes(handle.save_bytes()), true);
    assert.deepEqual(loaded.save_bytes(), handle.save_bytes());
    const result = { seed, ticks: handle.day_ticks() * report.days, overlappingSleepTicks: 0, firstOverlap: null,
      sleepTicks: [0, 0, 0], assignedSleepTicks: [0, 0, 0], sleepBouts: [0, 0, 0],
      exitedSleepBouts: [0, 0, 0], reloadTicks: [0] };
    let previous = [false, false, false];
    for (let tick = 1; tick <= result.ticks; tick++) {
      handle.tick();
      loaded.tick();
      assert.equal(loaded.world_hash(), handle.world_hash(), `seed ${seed}, tick ${tick}`);
      const current = places(handle, people[0]);
      const codes = activities(handle);
      const sleeping = people.map((person) => codes.get(person) === 5);
      const occupants = current.filter((row) => row.occupant !== -1).map((row) => row.occupant);
      assert.equal(new Set(occupants).size, occupants.length, 'one person cannot occupy two places');
      for (const [index, person] of people.entries()) {
        const assigned = current.find((row) => row.bed === assignments[index].bed && row.ordinal === assignments[index].ordinal);
        assert.equal(assigned.assignee, person, `seed ${seed}, assignment ${index}, tick ${tick}`);
        if (previous[index] && !sleeping[index]) result.exitedSleepBouts[index]++;
        if (sleeping[index]) {
          assert.equal(occupants.filter((occupant) => occupant === person).length, 1,
            `seed ${seed}, sleeping person ${person} must occupy exactly one place, tick ${tick}`);
          result.sleepTicks[index]++;
          if (!previous[index]) result.sleepBouts[index]++;
          if (assigned.occupant === person) result.assignedSleepTicks[index]++;
        }
      }
      const both = current.filter((row) => row.bed === double)
        .every((row) => row.occupant !== -1 && codes.get(row.occupant) === 5);
      if (both) {
        result.overlappingSleepTicks++;
        if (result.firstOverlap === null) result.firstOverlap = tick;
      }
      if (tick % 60 === 0 || (both && result.firstOverlap === tick)) {
        assert.deepEqual(loaded.save_bytes(), handle.save_bytes());
      }
      if (tick % handle.day_ticks() === 0 || (both && result.firstOverlap === tick)) {
        const saved = handle.save_bytes();
        loaded.tick();
        assert.notEqual(loaded.sim_tick(), handle.sim_tick(), 'the reload must rewind a diverged world');
        assert.equal(loaded.load_bytes(saved), true);
        assert.deepEqual(loaded.save_bytes(), saved);
        assert.equal(loaded.world_hash(), handle.world_hash());
        result.reloadTicks.push(tick);
      }
      previous = sleeping;
    }
    report.seeds.push(result);
  } finally {
    loaded.free();
    handle.free();
  }
}
console.log(JSON.stringify(report, null, 2));
for (const result of report.seeds) {
  assert.ok(result.assignedSleepTicks.every((ticks) => ticks > 0),
    `seed ${result.seed}: each person must naturally sleep in their assigned place; observed ticks ${result.assignedSleepTicks}`);
  assert.ok(result.exitedSleepBouts.every((count) => count >= 2),
    `seed ${result.seed}: each person must leave sleep at least twice, not remain stuck in one action`);
}
assert.ok(report.seeds.some((result) => result.overlappingSleepTicks > 0),
  'the seed set must include autonomous shared-bed sleeping');
