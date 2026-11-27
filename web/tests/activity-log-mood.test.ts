import { describe, expect, it } from 'vitest';
import { ActivityLogStore } from '../src/ui/activity-log-store.js';
import { composeAll, FILTER, LogLines, lineText, lineContent, type ComposeContext } from '../src/ui/activity-log-compose.js';
import { QueueSource, record } from './activity-log-records.js';

const context: ComposeContext = {
  labels: [], topics: { table: [], rows: [] }, filters: FILTER.details | FILTER.time,
  selected: null, dayTicks: 1440, bands: { loves: 60, likes: 20 },
  name: id => id === 1 ? 'Shayla' : id === 2 ? 'Bill' : null, room: () => '',
};
const start = 1328 * 1440 + 8 * 60 + 8;
function checkpoint(seq: number, minutes: number, delta: number, result: number, actor = 1) {
  return record({ seq, tick: start + minutes, kind: 13, actor, other: 2, label: 2, label2: 1,
    values: [delta, result, start, delta] });
}

describe('mood log episodes', () => {
  it('groups progression checkpoints into one latest absolute result across refresh and eviction', () => {
    const store = new ActivityLogStore(3);
    const source = new QueueSource();
    const lines = new LogLines();
    store.drain(source.push(checkpoint(1, 5, -400, -1650)));
    lines.add(store, 0, context);
    store.drain(source.push(checkpoint(2, 10, -800, -2050), checkpoint(3, 20, -1498, -2747)));
    lines.add(store, 1, context);
    const expected = 'D1329, T08:28 Shayla: Mood fell 15 points to -27.5 (Low)\n“Comforted by Bill” faded over 20 game minutes as they moved farther apart.';
    expect(lines.lines.map(line => lineText(store, line, context))).toEqual([expected]);
    expect(composeAll(store, context)).toEqual([expected]);
    store.drain(source.push(record({ seq: 4, kind: 1, actor: 3 })));
    lines.recount(store);
    expect(lines.lines.map(line => lineText(store, line, context))).toEqual([expected]);
    expect(composeAll(store, context)).toEqual([expected]);
    expect(composeAll(store, { ...context, filters: 0 })).toEqual([]);
    expect(composeAll(store, { ...context, selected: 99 })).toEqual([]);
  });
});

it('keeps separate actors and start ticks, and does not invent a distance explanation', () => {
  const store = new ActivityLogStore();
  const source = new QueueSource();
  store.drain(source.push(
    record({ seq: 1, tick: 150, kind: 13, actor: 1, other: 2, label: 2, label2: 0, values: [500, 500, 100, 500] }),
    record({ seq: 2, tick: 151, kind: 13, actor: 2, label: 0, label2: 0, values: [-100, -100, 100, 0] }),
    record({ seq: 3, tick: 160, kind: 13, actor: 1, other: 2, label: 3, label2: 1, values: [200, 700, 155, 200] }),
  ));
  const result = composeAll(store, { ...context, filters: FILTER.details });
  expect(result).toHaveLength(3);
  expect(result[0]).toContain('Comforted by Bill: increased over 50 game minutes.');
  expect(result[0]).not.toContain('moved');
  expect(result[1]).toContain('Multiple or unspecified causes');
  expect(result[2]).toContain('as they moved farther apart');
});

it('applies the selected person to the newest checkpoint when the cause changes', () => {
  const store = new ActivityLogStore();
  store.drain(new QueueSource().push(
    record({ seq: 1, tick: 110, kind: 13, actor: 1, other: 2, label: 2, values: [-300, -300, 100, -300] }),
    record({ seq: 2, tick: 120, kind: 13, actor: 1, label: 1, values: [-500, -500, 100, -500] }),
   ));
  expect(composeAll(store, { ...context, selected: 2 })).toEqual([]);
  expect(composeAll(store, { ...context, selected: 1 })).toHaveLength(1);
});

it('removes a selected person\'s row as a later checkpoint changes the cause', () => {
  const store = new ActivityLogStore();
  const source = new QueueSource();
  const selected = { ...context, selected: 2 };
  const lines = new LogLines();
  store.drain(source.push(record({ seq: 1, tick: 110, kind: 13, actor: 1, other: 2, label: 2, values: [-300, -300, 100, -300] })));
  lines.add(store, 0, selected);
  expect(lines.lines).toHaveLength(1);
  const previous = lines.lines[0];
  store.drain(source.push(record({ seq: 2, tick: 120, kind: 13, actor: 1, label: 1, values: [-500, -500, 100, -500] })));
  expect(lines.add(store, 1, selected)).toHaveLength(0);
  expect(lines.removed).toEqual([previous]);
  expect(lines.lines).toHaveLength(0);
});

it('orders a backdated final checkpoint by its displayed tick on refresh and rebuild', () => {
  const store = new ActivityLogStore();
  const source = new QueueSource();
  const c = { ...context, filters: FILTER.details | FILTER.actions | FILTER.time };
  const lines = new LogLines();
  store.drain(source.push(record({ seq: 1, tick: 10, kind: 13, actor: 1, label: 1, values: [-100, -100, 1, -100] }),
    record({ seq: 2, tick: 30, kind: 1, triggers: FILTER.actions, actor: 2 })));
  lines.add(store, 0, c);
  store.drain(source.push(record({ seq: 3, tick: 20, kind: 13, actor: 1, label: 1, values: [-200, -200, 1, -200] })));
  lines.add(store, 2, c);
  expect(lines.lines.map(line => line.tick)).toEqual([20, 30]);
  expect(composeAll(store, c)).toEqual(lines.lines.map(line => lineText(store, line, c)));
});

it('uses the native mood band even when rounding the score crosses a boundary', () => {
  const store = new ActivityLogStore();
  store.drain(new QueueSource().push(record({ seq: 1, tick: 10, kind: 13, actor: 1, label: 1, label2: 3 << 8,
    values: [-100, -1500, 1, -100] })));
  expect(composeAll(store, context)[0]).toContain('to -15 (Okay)');
});

it('names the hobby effect when it contributes most to a grouped mood change', () => {
  const store = new ActivityLogStore();
  store.drain(new QueueSource().push(record({ seq: 1, tick: 110, kind: 13, actor: 1, label: 22,
    values: [-400, -500, 100, -200] })));
  expect(composeAll(store, context)[0]).toContain('Enjoying a hobby: decreased over 10 game minutes.');
});

it('keeps embedded newlines in names inside the correct row content', () => {
  const store = new ActivityLogStore();
  store.drain(new QueueSource().push(
    record({ seq: 1, tick: 5, kind: 1, triggers: FILTER.actions, actor: 1 }),
    record({ seq: 2, tick: 10, kind: 13, actor: 1, label: 1, values: [-100, -100, 1, -100] }),
  ));
  const c = { ...context, filters: FILTER.actions | FILTER.details, name: () => 'Shayla\nSmith' };
  const lines = new LogLines();
  lines.add(store, 0, c);
  expect(lineContent(store, lines.lines[0], c)).toBe('Shayla\nSmith: something');
  expect(lineContent(store, lines.lines[1], c)).toEqual({ result: 'Shayla\nSmith: Mood fell 1 point to -1 (Okay)', cause: 'Needs: decreased over 9 game minutes.' });
});
