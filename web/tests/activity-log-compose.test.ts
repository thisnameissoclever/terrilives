import { describe, expect, it } from 'vitest';
import {
  type ComposeContext, DEFAULT_FILTERS, FILTER, LogLines, composeAll, lineText, stamp,
} from '../src/ui/activity-log-compose.js';
import { ActivityLogStore, KIND, OTHER_PARTIAL, PARTIAL } from '../src/ui/activity-log-store.js';
import { QueueSource, pack, record } from './activity-log-records.js';

// Every example line of [AL-compose] under each filter combination the
// specification lists, the selected-housemate rule of [AL-selected], the
// grouping of [AL-group] and the rounding of [AL-numbers]. Labels are the
// specification's invented ones, so the lines match it word for word.

const { actions: A, chores: C, social: S, skills: K, career: R, details: D, time: T } = FILTER;
const TIM = 1;
const BILL = 2;
const CASEY = 3;
const NAMES = new Map([[TIM, 'Tim'], [BILL, 'Bill'], [CASEY, 'Casey']]);

const LABELS = [
  'Chat', 'cooking', 'Read a book', 'Reading', 'Do dishes', 'cause:chore-fulfilled', 'cause:household-mess',
  'cause:privacy-entry', 'cause:nuisance', 'television', 'Cooking', 'Senior clerk', 'Office clerk', 'Fight',
  'fight-dishes', 'Dishes', 'Floor', 'Join meal', 'cause:meal-shared', 'cause:chore-neglected', 'smalltalk',
  'Watch TV', 'cause:privacy-start', 'Shower',
] as const;
const L = Object.fromEntries(LABELS.map((label, index) => [label, index])) as Record<(typeof LABELS)[number], number>;

const D74_1545 = 73 * 1_440 + 15 * 60 + 45;

function context(filters: number, selected: number | null = null): ComposeContext {
  return {
    labels: LABELS,
    filters,
    selected,
    dayTicks: 1_440,
    bands: { loves: 60, likes: 20 },
    name: simId => NAMES.get(simId) ?? null,
    room: (kind, target) => (kind === 1 && target === 7 ? 'Kitchen' : ''),
  };
}

function storeOf(...records: number[][]): ActivityLogStore {
  const store = new ActivityLogStore();
  store.drain(new QueueSource().push(...records));
  return store;
}

function lines(store: ActivityLogStore, filters: number, selected: number | null = null): string[] {
  return composeAll(store, context(filters, selected));
}

/** Tim starts a chat with Bill about cooking; Tim loves the topic and Bill dislikes it. */
function chat(fields: { seq?: number; tick?: number; flags?: number; values?: number[] } = {}): number[] {
  return record({
    seq: fields.seq ?? 1, tick: fields.tick ?? D74_1545, kind: KIND.chatDone, triggers: A | S, flags: fields.flags,
    actor: TIM, other: BILL, label: L.Chat, label2: L.cooking,
    values: fields.values ?? [pack(80, -30), pack(480, 310), 1_700, -100],
  });
}

/** Tim reads a book, practicing Reading at level 3 and 40 percent of the way to level 4. */
function book(seq = 1, level = 3, progress = 40): number[] {
  return record({
    seq, tick: 500, kind: KIND.actionDone, triggers: A, actor: TIM, label: L['Read a book'], label2: L.Reading,
    values: [0, level, progress, 0],
  });
}

/** Bill does Tim's dishes, covering Tim's chore, and Casey appreciates it. */
function dishes(): number[][] {
  return [
    record({ seq: 10, tick: 900, kind: KIND.actionDone, triggers: A, actor: BILL, label: L['Do dishes'] }),
    record({ seq: 11, tick: 900, kind: KIND.choreOutcome, triggers: C, actor: BILL, other: TIM, label: L['Do dishes'], parent: 10, values: [1] }),
    record({ seq: 12, tick: 900, kind: KIND.feeling, triggers: S, actor: CASEY, other: BILL, label: L['cause:chore-fulfilled'], parent: 11, values: [0, 0, 100] }),
  ];
}

describe('activity log lines', () => {
  it('shows a chat under each filter combination', () => {
    const store = storeOf(chat());
    expect(lines(store, A)).toEqual(['Tim: Chat with Bill about cooking']);
    expect(lines(store, S)).toEqual(['Tim: Chat with Bill about cooking; Tim loves it, Bill dislikes it']);
    expect(lines(store, S | D)).toEqual([
      'Tim: Chat with Bill about cooking; Tim loves it (+48 Social, +17 opinion of Bill), Bill dislikes it (+31 Social, -1 opinion of Tim)',
    ]);
    expect(lines(store, A | T)).toEqual(['D74, T15:45 Tim: Chat with Bill about cooking']);
    for (const filters of [C, K, R, C | K | R]) expect(lines(store, filters)).toEqual([]);
  });

  it('words every reaction band and the topic table', () => {
    const reactions = [[60, 'loves'], [59, 'likes'], [20, 'likes'], [19, 'does not mind'], [0, 'does not mind'],
      [-19, 'does not mind'], [-20, 'dislikes'], [-59, 'dislikes'], [-60, 'hates']] as const;
    for (const [preference, word] of reactions) {
      const store = storeOf(chat({ values: [pack(preference, 0), 0, 0, 0] }));
      expect(lines(store, S)[0]).toBe(`Tim: Chat with Bill about cooking; Tim ${word} it, Bill does not mind it`);
    }
    const smalltalk = record({ seq: 1, kind: KIND.chatDone, triggers: A | S, actor: TIM, other: BILL, label: L.Chat, label2: L.smalltalk });
    expect(lines(storeOf(smalltalk), A)).toEqual(['Tim: Chat with Bill about small talk']);
    const unknown = record({ seq: 1, kind: KIND.chatDone, triggers: A | S, actor: TIM, other: BILL, label: L.Chat, label2: L.Reading });
    expect(lines(storeOf(unknown), A)).toEqual(['Tim: Chat with Bill about something']);
    const none = record({ seq: 1, kind: KIND.chatDone, triggers: A | S, actor: TIM, other: BILL, label: L.Chat, values: [0, pack(480, 0)] });
    expect(lines(storeOf(none), S)).toEqual(['Tim: Chat with Bill']);
    expect(lines(storeOf(none), S | D)).toEqual(['Tim: Chat with Bill; Tim (+48 Social)']);
  });

  it('shows a book read under each filter combination', () => {
    const store = storeOf(book());
    expect(lines(store, A)).toEqual(['Tim: Read a book']);
    expect(lines(store, A | K)).toEqual(['Tim: Read a book; Reading level 3']);
    expect(lines(store, A | K | D)).toEqual(['Tim: Read a book; Reading level 3 (40%)']);
    expect(lines(store, K)).toEqual([]);
    expect(lines(store, S)).toEqual([]);
  });

  it('shows a level-up under Skills alone', () => {
    const store = storeOf(
      book(1, 4, 5),
      record({ seq: 2, tick: 500, kind: KIND.skillLevel, triggers: K, actor: TIM, label: L.Reading, parent: 1, values: [0, 4] }),
    );
    expect(lines(store, K)).toEqual(['Tim: Read a book; Reading reached level 4']);
    expect(lines(store, A | K | D)).toEqual(['Tim: Read a book; Reading reached level 4 (5%)']);
    expect(lines(store, A)).toEqual(['Tim: Read a book']);
  });

  it('attaches a child that arrives before its parent', () => {
    const store = storeOf(
      record({ seq: 1, tick: 500, kind: KIND.skillLevel, triggers: K, actor: TIM, label: L.Reading, parent: 2, values: [0, 4] }),
      book(2, 4, 5),
    );
    expect(lines(store, K)).toEqual(['Tim: Read a book; Reading reached level 4']);
  });

  it('shows a covered chore and its appreciation under each filter combination', () => {
    const store = storeOf(...dishes());
    expect(lines(store, A)).toEqual(['Bill: Do dishes']);
    expect(lines(store, C)).toEqual(["Bill: Do dishes; covered Tim's chore"]);
    expect(lines(store, S)).toEqual(['Bill: Do dishes; Casey appreciates Bill']);
    expect(lines(store, A | C | S | D)).toEqual(["Bill: Do dishes; covered Tim's chore; Casey appreciates Bill (+1 opinion of Bill)"]);
  });

  it('shows meal appreciation on the guest\'s meal line under Social', () => {
    const store = storeOf(
      record({ seq: 1, tick: 700, kind: KIND.actionDone, triggers: A, actor: CASEY, label: L['Join meal'] }),
      record({ seq: 2, tick: 700, kind: KIND.feeling, triggers: S, actor: CASEY, other: TIM, label: L['cause:meal-shared'], parent: 1, values: [0, 0, 300] }),
    );
    expect(lines(store, S)).toEqual(['Casey: Join meal; Casey appreciates Tim']);
    expect(lines(store, A)).toEqual(['Casey: Join meal']);
  });

  it('reads the other parents when their trigger is on', () => {
    const store = storeOf(
      record({ seq: 1, tick: 10, kind: KIND.choresThisWeek, triggers: C, actor: TIM, values: [3] }),
      record({ seq: 2, tick: 10, kind: KIND.duty, actor: TIM, label: L.Dishes, parent: 1, values: [0, 0] }),
      record({ seq: 3, tick: 10, kind: KIND.duty, actor: TIM, label: L.Floor, parent: 1, values: [1, 7] }),
      record({ seq: 4, tick: 20, kind: KIND.choreOutcome, triggers: C, actor: TIM, label: L.Dishes, values: [3] }),
      record({ seq: 5, tick: 30, kind: KIND.annoyed, triggers: S, actor: BILL, other: CASEY, label: L['cause:household-mess'] }),
      record({ seq: 6, tick: 40, kind: KIND.annoyed, triggers: S, actor: BILL, other: CASEY, label: L['cause:privacy-entry'] }),
      record({ seq: 7, tick: 50, kind: KIND.annoyed, triggers: S, actor: BILL, other: CASEY, label: L['cause:nuisance'], label2: L.television }),
      record({ seq: 8, tick: 60, kind: KIND.skillLevel, triggers: K, actor: TIM, label: L.Cooking, values: [0, 4] }),
      record({ seq: 9, tick: 70, kind: KIND.weeklyReview, triggers: R, actor: TIM, label: L['Senior clerk'], values: [1, 72, 40, pack(55, 20)] }),
      record({ seq: 10, tick: 80, kind: KIND.careerChange, triggers: R, actor: TIM, label: L['Office clerk'], values: [0] }),
      record({ seq: 11, tick: 90, kind: KIND.death, triggers: S, actor: TIM }),
      record({ seq: 12, tick: 95, kind: KIND.fightDone, triggers: A | S, actor: TIM, other: BILL, label: L.Fight, label2: L['fight-dishes'], values: [0, 0, -1_000, -1_000] }),
    );
    expect(lines(store, C)).toEqual(['Tim: Chores this week: Dishes, Floor (Kitchen)', 'Tim: Missed Dishes']);
    expect(lines(store, S)).toEqual([
      "Bill: Annoyed by Casey's dishes",
      'Bill: Annoyed that Casey walked in',
      'Bill: Bothered by Casey using the television',
      'Tim: Died',
      'Tim: Fight with Bill about the dishes; Tim and Bill like each other less',
    ]);
    expect(lines(store, K)).toEqual(['Tim: Cooking reached level 4']);
    expect(lines(store, R)).toEqual(['Tim: Weekly review: Promoted to Senior clerk', 'Tim: Hired as Office clerk']);
    expect(lines(store, R | D)).toEqual([
      'Tim: Weekly review: Promoted to Senior clerk (performance 72 of 100, fit 40, skill 55%, mood 20)',
      'Tim: Hired as Office clerk',
    ]);
    expect(lines(store, S | D).at(-1)).toBe(
      'Tim: Fight with Bill about the dishes; Tim and Bill like each other less (-10 opinion of Bill, -10 opinion of Tim)');
    expect(lines(store, A)).toEqual(['Tim: Fight with Bill about the dishes']);
  });

  it('words the other review outcomes, career changes, chore outcomes and feelings', () => {
    const review = (code: number, title?: number) =>
      record({ seq: 1, kind: KIND.weeklyReview, triggers: R, actor: TIM, label: title, values: [code] });
    expect(lines(storeOf(review(0, L['Office clerk'])), R)).toEqual(['Tim: Weekly review: No change']);
    expect(lines(storeOf(review(2, L['Office clerk'])), R)).toEqual(['Tim: Weekly review: Got a raise']);
    expect(lines(storeOf(review(3 | 1 << 8, L['Office clerk'])), R)).toEqual(['Tim: Weekly review: Demoted to Office clerk; Warned at work']);
    expect(lines(storeOf(review(4)), R)).toEqual(['Tim: Weekly review: Fired']);
    expect(lines(storeOf(review(5, L['Office clerk'])), R)).toEqual(['Tim: Weekly review: Changed path to Office clerk']);
    const change = (code: number) => record({ seq: 1, kind: KIND.careerChange, triggers: R, actor: TIM, label: L['Office clerk'], values: [code] });
    expect(lines(storeOf(change(1)), R)).toEqual(['Tim: Career assigned: Office clerk']);
    expect(lines(storeOf(change(2)), R)).toEqual(['Tim: Job left']);
    const skipped = record({ seq: 1, kind: KIND.choreOutcome, triggers: C, actor: TIM, label: L.Dishes, values: [2] });
    expect(lines(storeOf(skipped), C)).toEqual(['Tim: Skipped Dishes']);
    const missed = storeOf(
      record({ seq: 1, tick: 5, kind: KIND.choreOutcome, triggers: C, actor: TIM, label: L.Dishes, values: [3] }),
      record({ seq: 2, tick: 5, kind: KIND.feeling, triggers: S, actor: CASEY, other: TIM, label: L['cause:chore-neglected'], parent: 1, values: [0, 0, -200] }),
    );
    expect(lines(missed, S | D)).toEqual(['Tim: Missed Dishes; Casey resents Tim (-2 opinion of Tim)']);
    const start = record({ seq: 1, kind: KIND.annoyed, triggers: S, actor: BILL, other: CASEY, label: L['cause:privacy-start'], label2: L.Shower });
    expect(lines(storeOf(start), S)).toEqual(['Bill: Annoyed that Casey used the Shower nearby']);
  });

  it('keeps Details and Time from making any line appear', () => {
    const store = storeOf(chat({ seq: 1 }), book(2), ...dishes());
    expect(lines(store, D | T)).toEqual([]);
    expect(lines(store, D)).toEqual([]);
    expect(lines(store, T)).toEqual([]);
  });

  it('shows an action that refilled Social under Social with Actions off', () => {
    const shared = record({ seq: 1, kind: KIND.actionDone, triggers: A | S, actor: TIM, other: BILL, label: L['Watch TV'], values: [124, 0, 0, 130] });
    const alone = record({ seq: 2, kind: KIND.actionDone, triggers: A, actor: CASEY, label: L['Watch TV'] });
    const store = storeOf(shared, alone);
    expect(lines(store, S)).toEqual(['Tim: Watch TV with Bill']);
    expect(lines(store, S | D)).toEqual(['Tim: Watch TV with Bill (+12 Social, +1 opinion of Bill)']);
    expect(lines(store, A)).toEqual(['Tim: Watch TV with Bill', 'Casey: Watch TV']);
  });

  it('applies the defaults', () => {
    expect(DEFAULT_FILTERS).toBe(A | S | R);
    const store = storeOf(chat({ seq: 1, tick: 100 }), book(2), ...dishes());
    expect(lines(store, DEFAULT_FILTERS)).toEqual([
      'Tim: Chat with Bill about cooking; Tim loves it, Bill dislikes it',
      'Tim: Read a book',
      'Bill: Do dishes; Casey appreciates Bill',
    ]);
  });
});

describe('the selected housemate', () => {
  const annoyed = record({ seq: 20, tick: 1_000, kind: KIND.annoyed, triggers: S, actor: BILL, other: CASEY, label: L['cause:household-mess'] });

  it('shows a chat for both participants only', () => {
    const store = storeOf(chat());
    expect(lines(store, A, TIM)).toHaveLength(1);
    expect(lines(store, A, BILL)).toHaveLength(1);
    expect(lines(store, A, CASEY)).toEqual([]);
  });

  it('shows an annoyance for both sides', () => {
    const store = storeOf(annoyed);
    expect(lines(store, S, BILL)).toEqual(["Bill: Annoyed by Casey's dishes"]);
    expect(lines(store, S, CASEY)).toEqual(["Bill: Annoyed by Casey's dishes"]);
    expect(lines(store, S, TIM)).toEqual([]);
  });

  it('shows an appreciation for the appreciator only while Social is on', () => {
    const store = storeOf(...dishes());
    expect(lines(store, A | S, CASEY)).toEqual(['Bill: Do dishes; Casey appreciates Bill']);
    expect(lines(store, A, CASEY)).toEqual([]);
    expect(lines(store, A | C, TIM)).toEqual(["Bill: Do dishes; covered Tim's chore"]);
    expect(lines(store, A, TIM)).toEqual([]);
  });

  it('shows everything with nobody selected', () => {
    expect(lines(storeOf(chat({ seq: 1 }), annoyed), A | S)).toHaveLength(2);
  });
});

describe('grouping and numbers', () => {
  const mess = (seq: number, tick: number, change: number) =>
    record({ seq, tick, kind: KIND.annoyed, triggers: S, actor: BILL, other: CASEY, label: L['cause:household-mess'], values: [0, 0, change] });

  it('merges same-day annoyance into its latest occurrence with a count and summed change', () => {
    const store = storeOf(mess(1, 100, -100), book(2), mess(3, 900, -150), mess(4, 1_000, -50), mess(5, 1_500, -100));
    expect(lines(store, A | S)).toEqual([
      'Tim: Read a book',
      "Bill: Annoyed by Casey's dishes (3 times)",
      "Bill: Annoyed by Casey's dishes",
    ]);
    expect(lines(store, A | S | D | T)).toEqual([
      'D1, T08:20 Tim: Read a book',
      "D1, T16:40 Bill: Annoyed by Casey's dishes (3 times, -3 opinion of Casey)",
      "D2, T01:00 Bill: Annoyed by Casey's dishes (-1 opinion of Casey)",
    ]);
  });

  it('merges incrementally and reports the moved line', () => {
    const store = new ActivityLogStore();
    const source = new QueueSource();
    const model = new LogLines();
    const ctx = context(S);
    store.drain(source.push(mess(1, 100, -100), chat({ seq: 2, tick: 200 })));
    expect(model.add(store, 0, ctx)).toHaveLength(2);
    store.drain(source.push(mess(3, 300, -100)));
    const changed = model.add(store, 2, ctx);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toBe(model.lines[1]);
    expect(model.lines.map(line => lineText(store, line, ctx))).toEqual([
      'Tim: Chat with Bill about cooking; Tim loves it, Bill dislikes it',
      "Bill: Annoyed by Casey's dishes (2 times)",
    ]);
    model.trim(1);
    expect(model.lines).toHaveLength(1);
  });

  it('omits numbers that round to zero and partial Social totals', () => {
    const small = chat({ values: [pack(80, -30), pack(4, 310), 40, -100] });
    expect(lines(storeOf(small), S | D)).toEqual([
      'Tim: Chat with Bill about cooking; Tim loves it, Bill dislikes it (+31 Social, -1 opinion of Tim)',
    ]);
    const partial = chat({ flags: PARTIAL | OTHER_PARTIAL });
    expect(lines(storeOf(partial), S | D)).toEqual([
      'Tim: Chat with Bill about cooking; Tim loves it (+17 opinion of Bill), Bill dislikes it (-1 opinion of Tim)',
    ]);
    expect(lines(storeOf(book(1, 3, 0)), A | K | D)).toEqual(['Tim: Read a book; Reading level 3']);
  });

  it('stamps the first and last minute of a day', () => {
    expect(stamp(0, 1_440)).toBe('D1, T00:00 ');
    expect(stamp(1_439, 1_440)).toBe('D1, T23:59 ');
    expect(stamp(1_440, 1_440)).toBe('D2, T00:00 ');
    expect(stamp(D74_1545, 1_440)).toBe('D74, T15:45 ');
    expect(stamp(719, 720)).toBe('D1, T23:58 ');
  });

  it('names people it never saw as Someone', () => {
    const stranger = record({ seq: 1, kind: KIND.death, triggers: S, actor: 99 });
    expect(lines(storeOf(stranger), S)).toEqual(['Someone: Died']);
  });
});
