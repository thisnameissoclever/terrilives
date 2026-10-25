import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { ACTIVITY_LOG_RECORD_WORDS, SimBridge } from '../src/bridge.js';
import { NO_SUBJECT_TAGS, SOMETHING, TOPIC_WORDS, topicWord } from '../src/ui/activity-log-words.js';

// [AL-bridge] against the freshly built wasm: records cross the boundary,
// the label table decodes, a detached view cannot lose records, and a Load
// starts the sequence again.

const WORDS = ACTIVITY_LOG_RECORD_WORDS;
const NONE = 0xffff_ffff;
const CHAT = 2;
const ACTIONS = 1;
const SOCIAL = 4;

let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });

function people(bridge: SimBridge): Map<number, string> {
  const count = bridge.count;
  const ids = Array.from(bridge.ids().subarray(0, count));
  const kinds = Array.from(bridge.kinds().subarray(0, count));
  const names = new Map<number, string>();
  ids.forEach((entity, row) => {
    if (kinds[row] !== 0) return;
    const simId = bridge.simIdOf(entity);
    if (simId !== null) names.set(simId, bridge.simName(entity));
  });
  return names;
}

/** Ticks until a drained record satisfies `wanted`, returning every record drained so far. */
function tickUntil(handle: SimHandle, bridge: SimBridge, wanted: (record: Uint32Array) => boolean, limit: number) {
  const ring = new Uint32Array(2_000 * WORDS);
  const records: Uint32Array[] = [];
  let at = 0;
  for (let tick = 0; tick < limit; tick++) {
    handle.tick();
    const count = bridge.takeActivityLog(ring, at);
    for (let index = 0; index < count; index++) {
      const slot = (at + index) % 2_000;
      records.push(ring.slice(slot * WORDS, slot * WORDS + WORDS));
    }
    at = (at + count) % 2_000;
    if (records.some(wanted)) return records;
  }
  return records;
}

describe('activity log bridge', () => {
  it('names every cause and topic tag the shell words in the real label table', () => {
    // The shell matches these strings; a rename on either side must fail here.
    const source = ['activity-log-words.ts', 'activity-log-compose.ts']
      .map(file => readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8')).join(' ');
    const causes = [...new Set(source.match(/'cause:[a-z-]+'/g)!.map(quoted => quoted.slice(1, -1)))];
    expect(causes.length).toBeGreaterThan(8);
    const handle = SimHandle.from_lot();
    try {
      const labels = new Set(new SimBridge(handle, memory).activityLogLabels());
      expect(causes.filter(cause => !labels.has(cause))).toEqual([]);
      const tags = [...TOPIC_WORDS.keys(), ...NO_SUBJECT_TAGS];
      expect(tags.filter(tag => !labels.has(tag))).toEqual([]);
    } finally {
      handle.free();
    }
  });

  it('has a topic word for every fight reason the simulation can name', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      const fights = bridge.activityLogLabels().filter(label => label === 'fight' || label.startsWith('fight-'));
      expect(fights.length).toBeGreaterThan(3);
      expect(fights.filter(tag => topicWord(tag) === SOMETHING)).toEqual([]);
    } finally {
      handle.free();
    }
  });

  it('carries a finished chat with its people, labels and both reactions', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      const names = people(bridge);
      const records = tickUntil(handle, bridge, record => (record[2] & 0xff) === CHAT, 4 * 1_440);
      const chat = records.find(record => (record[2] & 0xff) === CHAT);
      expect(chat, 'a chat finishes within four game days').toBeDefined();
      const seqs = records.map(record => record[0]);
      expect(seqs).toEqual(seqs.map((_, index) => index + 1));

      const labels = bridge.activityLogLabels();
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.every(label => label !== '')).toBe(true);
      expect(bridge.activityLogLabels()).toBe(labels);

      const [seq, tick, kind, actor, other, label, topic, parent] = chat!;
      expect(seq).toBeGreaterThan(0);
      expect(tick).toBeLessThanOrEqual(4 * 1_440);
      expect((kind >> 8) & 0xff).toBe(ACTIONS | SOCIAL);
      expect(names.has(actor)).toBe(true);
      expect(names.has(other)).toBe(true);
      expect(other).not.toBe(actor);
      expect(label).toBeLessThan(labels.length);
      expect(topic === NONE || topic < labels.length).toBe(true);
      expect(parent).toBe(0);
      expect(bridge.activityLogDropped()).toBe(0);
      expect(bridge.activityLogReactionBands()).toEqual({ loves: expect.closeTo(0.6, 6), likes: expect.closeTo(0.2, 6) });
    } finally { handle.free(); }
  });

  it('keeps every copied record when the first label lookup detaches memory', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      for (let tick = 0; tick < 600; tick++) handle.tick();
      const ring = new Uint32Array(2_000 * WORDS);
      const count = bridge.takeActivityLog(ring, 1_998);
      expect(count, 'ten game hours stage records').toBeGreaterThan(2);
      const stale = new Uint32Array(memory.buffer, handle.activity_log_ptr(), count * WORDS);
      const copied = Array.from(ring);
      const original = handle.activity_log_labels.bind(handle);
      (handle as unknown as { activity_log_labels: () => string }).activity_log_labels = () => {
        memory.grow(1);
        return original();
      };
      expect(bridge.activityLogLabels().length).toBeGreaterThan(0);
      expect(stale.length, 'the label lookup detached earlier views').toBe(0);
      expect(Array.from(ring)).toEqual(copied);
      const slots = [1_998, 1_999, ...Array.from({ length: count - 2 }, (_, index) => index)];
      expect(slots.map(slot => ring[slot * WORDS])).toEqual(slots.map((_, index) => index + 1));
    } finally { handle.free(); }
  });

  it('starts the next take at seq 1 after a Load', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      const ring = new Uint32Array(2_000 * WORDS);
      for (let tick = 0; tick < 600; tick++) handle.tick();
      expect(bridge.takeActivityLog(ring, 0)).toBeGreaterThan(0);
      for (let tick = 0; tick < 120; tick++) handle.tick();
      expect(handle.load_bytes(handle.save_bytes())).toBe(true);
      expect(bridge.takeActivityLog(ring, 0), 'staged records do not survive a Load').toBe(0);
      const records = tickUntil(handle, bridge, () => true, 1_440);
      expect(records.length).toBeGreaterThan(0);
      expect(records[0][0]).toBe(1);
    } finally { handle.free(); }
  });

  it('stages nothing while disabled', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      bridge.setActivityLogEnabled(false);
      for (let tick = 0; tick < 600; tick++) handle.tick();
      expect(bridge.takeActivityLog(new Uint32Array(WORDS * 4), 0)).toBe(0);
    } finally { handle.free(); }
  });

  it('refuses a destination the records do not fit', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      for (let tick = 0; tick < 600; tick++) handle.tick();
      expect(() => bridge.takeActivityLog(new Uint32Array(WORDS), 0)).toThrow(/do not fit/);
    } finally { handle.free(); }
  });
});
