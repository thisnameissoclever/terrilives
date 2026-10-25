import { describe, expect, it } from 'vitest';
import { ACTIVITY_LOG_CAPACITY, ActivityLogStore, KIND } from '../src/ui/activity-log-store.js';
import { QueueSource, record } from './activity-log-records.js';

function action(seq: number) { return record({ seq, tick: seq * 2, kind: KIND.actionDone, triggers: 1, actor: 7 }); }

/** Drains `count` records from `first` in chunks no larger than the simulation's staging ring. */
function drainRange(store: ActivityLogStore, source: QueueSource, first: number, count: number): void {
  for (let seq = first; seq < first + count; seq += 256) {
    const chunk = Math.min(256, first + count - seq);
    source.push(...Array.from({ length: chunk }, (_, offset) => action(seq + offset)));
    expect(store.drain(source)).toBe(chunk);
  }
}

describe('activity log store', () => {
  it('holds 2,000 records and overwrites the oldest beyond that', () => {
    const store = new ActivityLogStore();
    const source = new QueueSource();
    expect(store.capacity).toBe(ACTIVITY_LOG_CAPACITY);
    expect(store.words.length).toBe(2_000 * 12);
    drainRange(store, source, 1, 2_100);
    expect(store.length).toBe(2_000);
    expect(store.total).toBe(2_100);
    expect(store.seq(0)).toBe(101);
    expect(store.seq(1_999)).toBe(2_100);
    expect(store.tick(0)).toBe(202);
    expect(store.kind(5)).toBe(KIND.actionDone);
    expect(store.triggers(5)).toBe(1);
    expect(store.actor(5)).toBe(7);
  });

  it('reads records across the ring wrap in order', () => {
    const store = new ActivityLogStore(4);
    const source = new QueueSource();
    source.push(action(1), action(2), action(3));
    store.drain(source);
    source.push(action(4), action(5), action(6));
    expect(store.drain(source)).toBe(3);
    expect(Array.from({ length: store.length }, (_, index) => store.seq(index))).toEqual([3, 4, 5, 6]);
    expect(store.indexOfSeq(5)).toBe(2);
    expect(store.indexOfSeq(2)).toBe(-1);
    expect(store.indexOfSeq(9)).toBe(-1);
  });

  it('reads signed values and the other fields', () => {
    const store = new ActivityLogStore(4);
    store.drain(new QueueSource().push(record({
      seq: 1, tick: 9, kind: KIND.chatDone, triggers: 5, flags: 1 << 16, actor: 1, other: 2,
      label: 3, label2: 4, parent: 0, values: [-5, 6, -7, 8],
    })));
    expect([store.flags(0), store.other(0), store.label(0), store.label2(0), store.parent(0)]).toEqual([1 << 16, 2, 3, 4, 0]);
    expect([0, 1, 2, 3].map(slot => store.value(0, slot))).toEqual([-5, 6, -7, 8]);
  });

  it('does nothing for an empty drain', () => {
    const store = new ActivityLogStore();
    expect(store.drain(new QueueSource())).toBe(0);
    expect(store.length).toBe(0);
  });

  it('throws when a sequence number does not rise', () => {
    const store = new ActivityLogStore();
    const source = new QueueSource();
    store.drain(source.push(action(5)));
    expect(() => store.drain(source.push(action(5)))).toThrow(/went backwards/);
    expect(() => store.drain(source.push(action(3)))).toThrow(/went backwards/);
    expect(() => store.drain(source.push(action(8), action(7)))).toThrow(/went backwards/);
  });

  it('starts again at seq 1 after a Load', () => {
    const store = new ActivityLogStore();
    const source = new QueueSource();
    drainRange(store, source, 1, 300);
    store.resetAfterLoad();
    expect(store.length).toBe(0);
    expect(store.total).toBe(0);
    expect(store.drain(source.push(action(1), action(2)))).toBe(2);
    expect([store.seq(0), store.seq(1)]).toEqual([1, 2]);
  });
});
