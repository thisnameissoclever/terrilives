/**
 * Turns activity log records into lines ([AL-compose], [AL-selected],
 * [AL-group] and [AL-numbers] in docs/specs/2026-10-18-activity-log.md).
 *
 * A line is one parent record with its children. It is visible when an
 * enabled filter is in the trigger mask of the parent or of any child, and
 * filters only add or remove clauses, so each event stays one line under
 * every combination. Details and Time never make a line visible. Every word
 * comes from `activity-log-words.ts` or the simulation's label table.
 *
 * Text is built only on request, which the panel makes only while it is
 * open. Deciding whether a record makes a line allocates nothing, so records
 * whose lines stay hidden leave no garbage; only a visible line builds a
 * `LogLine` and its text ([AL-perf]).
 */

import { type ActivityLogStore, KIND, NONE, OTHER_PARTIAL, PARTIAL, highHalf, lowHalf } from './activity-log-store.js';
import * as words from './activity-log-words.js';

/** Filter bits. The first five match the record's trigger mask. */
export const FILTER = {
  actions: 1,
  chores: 2,
  social: 4,
  skills: 8,
  career: 16,
  details: 32,
  time: 64,
} as const;

/** The filters in the order the panel shows them, matching `PANEL_WORDS.filters`. */
export const FILTER_ORDER = [
  FILTER.actions, FILTER.chores, FILTER.social, FILTER.skills, FILTER.career, FILTER.details, FILTER.time,
] as const;

/** Actions, Social and Career ([AL-panel] item 8). */
export const DEFAULT_FILTERS = FILTER.actions | FILTER.social | FILTER.career;

const TRIGGER_FILTERS = FILTER.actions | FILTER.chores | FILTER.social | FILTER.skills | FILTER.career;

/** Chore outcome codes, the `v0` of a chore outcome record. */
const OUTCOME = { done: 0, covered: 1, skipped: 2, missed: 3 } as const;
/** Career change codes, the `v0` of a career change record. */
const CHANGE = { hired: 0, assigned: 1, left: 2 } as const;
/** Bit 8 of a weekly review's `v0`: the person carries a warning. */
const REVIEW_WARNED = 1 << 8;
/** The weekly review outcome code for a dismissal. */
const REVIEW_FIRED = 4;

export interface ComposeContext {
  /** The simulation's label table, read once per page. */
  readonly labels: readonly string[];
  /** Enabled filters as `FILTER` bits. */
  readonly filters: number;
  /** The selected housemate's `SimId`, or null for everyone. */
  readonly selected: number | null;
  readonly dayTicks: number;
  /** The Likes and dislikes band edges in hundredths, the unit of a recorded preference. */
  readonly bands: { readonly loves: number; readonly likes: number };
  /** The last name the shell saw for a `SimId`, or null. */
  name(simId: number): string | null;
  /** The current room name of a chore duty, or an empty string. */
  room(kind: number, target: number): string;
}

/** One visible line: its newest record, and how many same-day annoyances it stands for. */
export interface LogLine {
  seq: number;
  tick: number;
  /** Same-day annoyance group, or null for a line that never merges. */
  readonly key: string | null;
  count: number;
  /** Summed opinion change of a group, in record units. */
  change: number;
  /** A group's member records by `seq`, oldest first; null for a line that never merges. */
  readonly members: number[] | null;
}

/**
 * The visible lines of a store in order, oldest first, with same-day
 * annoyances merged into their latest occurrence ([AL-group] rule 1).
 */
export class LogLines {
  readonly lines: LogLine[] = [];
  private readonly groups = new Map<string, LogLine>();
  /** Reused by every `add`, so a call that finds nothing visible allocates nothing. */
  private readonly changed: LogLine[] = [];
  /** Reused by every `recount`. */
  private readonly recounted: LogLine[] = [];
  /** The oldest `seq` the store held at the last `recount`. */
  private oldest = 0;

  reset(): void {
    this.lines.length = 0;
    this.groups.clear();
    this.oldest = 0;
  }

  /**
   * Adds the visible lines of records `from` onward and returns the lines
   * that are new or moved to the end. A merged line leaves its old place.
   * The returned list is reused by the next call.
   */
  add(store: ActivityLogStore, from: number, context: ComposeContext): readonly LogLine[] {
    const changed = this.changed;
    changed.length = 0;
    for (let index = Math.max(0, from); index < store.length; index++) {
      if (store.parent(index) !== 0 || !visible(store, index, context)) continue;
      const seq = store.seq(index);
      const tick = store.tick(index);
      if (store.kind(index) !== KIND.annoyed) {
        const line: LogLine = { seq, tick, key: null, count: 1, change: 0, members: null };
        this.lines.push(line);
        changed.push(line);
        continue;
      }
      const key = groupKey(store, index, context.dayTicks);
      const group = this.groups.get(key);
      if (group) {
        group.seq = seq;
        group.tick = tick;
        group.count += 1;
        group.change += store.value(index, 2);
        group.members!.push(seq);
        this.moveToEnd(group);
        // A group merged twice in one call moves past the lines between, as
        // it does in `lines`, so rows append in the order a rebuild gives.
        moveToEndOf(changed, group);
        continue;
      }
      const line: LogLine = { seq, tick, key, count: 1, change: store.value(index, 2), members: [seq] };
      this.groups.set(key, line);
      this.lines.push(line);
      changed.push(line);
    }
    return changed;
  }

  /**
   * After records have left the store, counts each group's members the
   * store still holds, as a rebuild would, and returns the groups that
   * changed. Groups whose newest record left are evicted lines and are
   * skipped. The returned list is reused by the next call.
   */
  recount(store: ActivityLogStore): readonly LogLine[] {
    const recounted = this.recounted;
    recounted.length = 0;
    if (store.length === 0) return recounted;
    const oldest = store.seq(0);
    if (oldest === this.oldest) return recounted;
    this.oldest = oldest;
    for (let at = 0; at < this.lines.length; at++) {
      const line = this.lines[at];
      const members = line.members;
      if (members === null || members[0] >= oldest || line.seq < oldest) continue;
      while (members[0] < oldest) members.shift();
      line.count = members.length;
      let change = 0;
      for (let member = 0; member < members.length; member++) {
        change += store.value(store.indexOfSeq(members[member]), 2);
      }
      line.change = change;
      recounted.push(line);
    }
    return recounted;
  }

  /** Forgets the oldest lines beyond `limit`. */
  trim(limit: number): void {
    const excess = this.lines.length - limit;
    if (excess <= 0) return;
    for (let index = 0; index < excess; index++) {
      const line = this.lines[index];
      if (line.key !== null && this.groups.get(line.key) === line) this.groups.delete(line.key);
    }
    this.lines.copyWithin(0, excess);
    this.lines.length = limit;
  }

  /** Moves a merged line to the newest position without building an array of removed lines. */
  private moveToEnd(line: LogLine): void {
    const lines = this.lines;
    const last = lines.length - 1;
    for (let index = lines.lastIndexOf(line); index < last; index++) lines[index] = lines[index + 1];
    lines[last] = line;
  }
}

/** Moves `line` to the end of `list` when it is there already, or appends it. */
function moveToEndOf(list: LogLine[], line: LogLine): void {
  const at = list.indexOf(line);
  if (at < 0) {
    list.push(line);
    return;
  }
  for (let index = at; index < list.length - 1; index++) list[index] = list[index + 1];
  list[list.length - 1] = line;
}

/**
 * Same cause, same two people, same day and same object: annoyances about two
 * different objects, such as a disliked television and radio, stay apart.
 */
function groupKey(store: ActivityLogStore, index: number, dayTicks: number): string {
  const day = Math.floor(store.tick(index) / Math.max(1, dayTicks));
  return `${store.label(index)}:${store.actor(index)}:${store.other(index)}:${store.label2(index)}:${day}`;
}

/** Every visible line's text, oldest first. */
export function composeAll(store: ActivityLogStore, context: ComposeContext): string[] {
  const lines = new LogLines();
  lines.add(store, 0, context);
  return lines.lines.map(line => lineText(store, line, context));
}

/**
 * The children of one record, and their children, as store indexes in
 * sequence order. One instance is refilled for every record it is asked
 * about, so collecting a family allocates nothing once its array has grown
 * to the largest family seen.
 */
class Family {
  readonly members: number[] = [];
  length = 0;

  collect(store: ActivityLogStore, index: number): this {
    this.length = 0;
    this.collectChildren(store, index);
    for (let at = 0; at < this.length; at++) this.collectChildren(store, this.members[at]);
    this.sort();
    return this;
  }

  /** Children share their parent's tick: the link pass only links records staged together. */
  private collectChildren(store: ActivityLogStore, index: number): void {
    const seq = store.seq(index);
    const tick = store.tick(index);
    for (let at = index - 1; at >= 0 && store.tick(at) === tick; at--) {
      if (store.parent(at) === seq) this.members[this.length++] = at;
    }
    for (let at = index + 1; at < store.length && store.tick(at) === tick; at++) {
      if (store.parent(at) === seq) this.members[this.length++] = at;
    }
  }

  /** Insertion sort: a family is a handful of records, and `Array.prototype.sort` may allocate. */
  private sort(): void {
    const members = this.members;
    for (let at = 1; at < this.length; at++) {
      const value = members[at];
      let to = at - 1;
      while (to >= 0 && members[to] > value) {
        members[to + 1] = members[to];
        to--;
      }
      members[to + 1] = value;
    }
  }
}

/** The family `visible` inspects. Composition keeps its own, so the two never overlap. */
const VISIBILITY = new Family();

/** Whether a child's clause shows under the current filters. */
function childShown(store: ActivityLogStore, child: number, filters: number): boolean {
  switch (store.kind(child)) {
    case KIND.choreOutcome: return (filters & FILTER.chores) !== 0;
    case KIND.feeling: return (filters & FILTER.social) !== 0;
    case KIND.skillLevel: return (filters & FILTER.skills) !== 0;
    case KIND.duty: return true;
    default: return false;
  }
}

function involves(store: ActivityLogStore, index: number, person: number): boolean {
  return store.actor(index) === person || store.other(index) === person;
}

/**
 * Whether the parent at `index` makes a line: a trigger of it or of a child
 * is enabled, and with a housemate selected, the head or a shown child
 * involves them ([AL-selected]). Allocates nothing, so a record whose line
 * stays hidden leaves no garbage.
 */
export function visible(store: ActivityLogStore, index: number, context: ComposeContext): boolean {
  const enabled = context.filters & TRIGGER_FILTERS;
  const family = VISIBILITY.collect(store, index);
  const children = family.members;
  let triggers = store.triggers(index);
  for (let at = 0; at < family.length; at++) triggers |= store.triggers(children[at]);
  if ((triggers & enabled) === 0) return false;
  const selected = context.selected;
  if (selected === null || involves(store, index, selected)) return true;
  for (let at = 0; at < family.length; at++) {
    const child = children[at];
    if (childShown(store, child, context.filters) && involves(store, child, selected)) return true;
  }
  return false;
}

/** The line's text under the current filters, or an empty string once its record has left the store. */
export function lineText(store: ActivityLogStore, line: LogLine, context: ComposeContext): string {
  const index = store.indexOfSeq(line.seq);
  if (index < 0) return '';
  const body = TEXT.compose(store, index, context, line);
  return (context.filters & FILTER.time) !== 0 ? stamp(line.tick, context.dayTicks) + body : body;
}

/** `D{day}, T{hh}:{mm} ` for a tick: day counted from 1, as the HUD counts it. */
export function stamp(tick: number, dayTicks: number): string {
  const day = Math.max(1, dayTicks);
  const minute = Math.floor(((tick % day) * 1_440) / day);
  return words.timestamp(Math.floor(tick / day) + 1, Math.floor(minute / 60), minute % 60);
}

/**
 * A rounded Details number, or null when it rounds to zero ([AL-numbers]).
 * Halves round away from zero for both signs; `Math.round` alone would turn
 * -1.5 into -1 but +1.5 into +2.
 */
function rounded(value: number, unit: number): number | null {
  const result = Math.sign(value) * Math.round(Math.abs(value) / unit);
  return result === 0 ? null : result;
}

/** `list` with `part` added after `separator`; a null or empty part leaves it unchanged. */
function joined(list: string, part: string | null, separator: string): string {
  if (part === null || part === '') return list;
  return list === '' ? part : list + separator + part;
}

/**
 * Builds one line's text. A single instance serves every line in turn, and
 * clauses are joined as they are found rather than gathered into arrays, so
 * a line allocates little beyond its own strings. Details numbers are built
 * only while Details is on.
 */
class LineText {
  private store!: ActivityLogStore;
  private index = 0;
  private context!: ComposeContext;
  private details = false;
  private readonly family = new Family();

  private on(filter: number): boolean { return (this.context.filters & filter) !== 0; }
  /** A person anywhere after the start of a line. */
  private name(simId: number): string { return this.context.name(simId) ?? words.SOMEONE_IN_SENTENCE; }
  /** The person a line starts with. */
  private headName(simId: number): string { return this.context.name(simId) ?? words.SOMEONE; }
  private label(index: number): string {
    return index === NONE ? words.SOMETHING : this.context.labels[index] ?? words.SOMETHING;
  }

  private opinion(units: number, about: number): string | null {
    const points = rounded(units, 100);
    return points === null ? null : words.opinionOf(points, this.name(about));
  }

  private social(tenths: number, partial: boolean): string | null {
    if (partial) return null;
    const points = rounded(tenths, 10);
    return points === null ? null : words.socialGained(points);
  }

  /** ` (a, b)` from the Details numbers that survived rounding, or an empty string. */
  private numbers(a: string | null, b: string | null = null, c: string | null = null, d: string | null = null): string {
    if (!this.details) return '';
    const separator = words.LIST_SEPARATOR;
    const list = joined(joined(joined(joined('', a, separator), b, separator), c, separator), d, separator);
    return list === '' ? '' : words.inParentheses(list);
  }

  private reaction(name: string, hundredths: number): string {
    const { loves, likes } = this.context.bands;
    const kind = hundredths >= loves ? 'loves'
      : hundredths >= likes ? 'likes'
        : hundredths <= -loves ? 'hates'
          : hundredths <= -likes ? 'dislikes' : 'neutral';
    return words.reaction(name, kind);
  }

  compose(store: ActivityLogStore, index: number, context: ComposeContext, line: LogLine): string {
    this.store = store;
    this.index = index;
    this.context = context;
    this.details = (context.filters & FILTER.details) !== 0;
    this.family.collect(store, index);
    const actor = this.headName(store.actor(index));
    switch (store.kind(index)) {
      case KIND.actionDone: return this.action(actor);
      case KIND.chatDone: return this.chat(actor);
      case KIND.fightDone: return this.fight(actor);
      case KIND.annoyed: return this.annoyed(actor, line);
      case KIND.choresThisWeek: return this.week(actor);
      case KIND.choreOutcome: return this.outcome(actor);
      // A feeling with no line to attach to: its own line.
      case KIND.feeling: return this.loneFeeling(actor);
      case KIND.skillLevel: return words.head(actor, this.levelText(index));
      case KIND.weeklyReview: return this.review(actor);
      case KIND.careerChange: return this.change(actor);
      case KIND.death: return words.head(actor, words.DIED);
      default: return words.head(actor, words.SOMETHING);
    }
  }

  /** Clauses in the fixed order chore, social, skill, career, after the head. */
  private join(head: string, a: string | null, b: string | null = null, c: string | null = null): string {
    const separator = words.CLAUSE_SEPARATOR;
    return joined(joined(joined(head, a, separator), b, separator), c, separator);
  }

  private feelingText(child: number): string {
    const { store } = this;
    const actor = this.name(store.actor(child));
    const other = this.name(store.other(child));
    const sentence = this.label(store.label(child)) === 'cause:chore-neglected'
      ? words.resents(actor, other) : words.appreciates(actor, other);
    return this.details ? sentence + this.numbers(this.opinion(store.value(child, 2), store.other(child))) : sentence;
  }

  /** A feeling whose line was not logged, headed by the person who felt it. */
  private loneFeeling(actor: string): string {
    const { store, index } = this;
    const other = this.name(store.other(index));
    const cause = this.label(store.label(index));
    const label = cause === 'cause:meal-shared' ? words.appreciatedMeal(other)
      : cause === 'cause:chore-neglected' ? words.resentedNeglectedChore(other) : words.appreciatedChore(other);
    return words.head(actor, label) + this.numbers(this.opinion(store.value(index, 2), store.other(index)));
  }

  /** The Social clause from feelings attached anywhere below this line. */
  private feelings(): string | null {
    if (!this.on(FILTER.social)) return null;
    const { store, family } = this;
    let list = '';
    for (let at = 0; at < family.length; at++) {
      const child = family.members[at];
      if (store.kind(child) === KIND.feeling) list = joined(list, this.feelingText(child), words.LIST_SEPARATOR);
    }
    return list === '' ? null : list;
  }

  private choreClause(): string | null {
    if (!this.on(FILTER.chores)) return null;
    const { store, family } = this;
    let list = '';
    for (let at = 0; at < family.length; at++) {
      const child = family.members[at];
      if (store.kind(child) !== KIND.choreOutcome) continue;
      if (store.value(child, 0) !== OUTCOME.covered || store.other(child) === NONE) continue;
      list = joined(list, words.coveredChore(this.name(store.other(child))), words.LIST_SEPARATOR);
    }
    return list === '' ? null : list;
  }

  private levelText(level: number): string {
    return words.skillReached(this.label(this.store.label(level)), this.store.value(level, 1));
  }

  /** A level-up clause, naming the person when they are not the head's actor. */
  private levelClause(level: number): string {
    const text = this.levelText(level);
    const person = this.store.actor(level);
    return person === this.store.actor(this.index) ? text : words.head(this.name(person), text);
  }

  private action(actor: string): string {
    const { store, index, family } = this;
    let head = words.head(actor, this.label(store.label(index)));
    const other = store.other(index);
    if (other !== NONE) head += words.withPerson(this.name(other));
    if (this.details && this.on(FILTER.social)) {
      head += this.numbers(
        this.social(store.value(index, 0), (store.flags(index) & PARTIAL) !== 0),
        other === NONE ? null : this.opinion(store.value(index, 3), other),
      );
    }
    let skill: string | null = null;
    if (this.on(FILTER.skills)) {
      const practiced = store.label2(index);
      const percent = store.value(index, 2);
      const progress = this.details && percent !== 0 ? this.numbers(words.percent(percent)) : '';
      let list = '';
      let crossed = false;
      for (let at = 0; at < family.length; at++) {
        const level = family.members[at];
        if (store.kind(level) !== KIND.skillLevel) continue;
        let text = this.levelClause(level);
        if (practiced !== NONE && store.label(level) === practiced && store.actor(level) === store.actor(index)) {
          text += progress;
          crossed = true;
        }
        list = joined(list, text, words.LIST_SEPARATOR);
      }
      if (practiced !== NONE && !crossed) {
        list = joined(words.skillLevel(this.label(practiced), store.value(index, 1)) + progress, list, words.LIST_SEPARATOR);
      }
      skill = list === '' ? null : list;
    }
    return this.join(head, this.choreClause(), this.feelings(), skill);
  }

  private conversationHead(actor: string): string {
    const { store, index } = this;
    let head = words.head(actor, this.label(store.label(index))) + words.withPerson(this.name(store.other(index)));
    const topic = store.label2(index);
    const word = topic === NONE ? null : words.topicWord(this.label(topic));
    if (word !== null) head += words.aboutTopic(word);
    return head;
  }

  /** One person's part of a chat's Social clause: a reaction to the topic, or their numbers alone. */
  private side(name: string, preference: number, topic: boolean, numbers: string): string | null {
    if (topic) return this.reaction(name, preference) + numbers;
    return numbers === '' ? null : name + numbers;
  }

  private chat(actor: string): string {
    const { store, index } = this;
    const other = store.other(index);
    let social: string | null = null;
    if (this.on(FILTER.social)) {
      const topic = store.label2(index) !== NONE;
      const preferences = store.value(index, 0);
      const gains = store.value(index, 1);
      const flags = store.flags(index);
      const mine = this.details ? this.numbers(
        this.social(lowHalf(gains), (flags & PARTIAL) !== 0), this.opinion(store.value(index, 2), other),
      ) : '';
      const theirs = this.details ? this.numbers(
        this.social(highHalf(gains), (flags & OTHER_PARTIAL) !== 0), this.opinion(store.value(index, 3), store.actor(index)),
      ) : '';
      const separator = words.LIST_SEPARATOR;
      const sides = joined(
        joined('', this.side(this.name(store.actor(index)), lowHalf(preferences), topic, mine), separator),
        this.side(this.name(other), highHalf(preferences), topic, theirs),
        separator,
      );
      social = sides === '' ? null : sides;
    }
    const skill = this.on(FILTER.skills) ? this.levels() : null;
    return this.join(this.conversationHead(actor), social, skill);
  }

  private levels(): string | null {
    const { store, family } = this;
    let list = '';
    for (let at = 0; at < family.length; at++) {
      const level = family.members[at];
      if (store.kind(level) === KIND.skillLevel) list = joined(list, this.levelClause(level), words.LIST_SEPARATOR);
    }
    return list === '' ? null : list;
  }

  private fight(actor: string): string {
    const { store, index } = this;
    const other = store.other(index);
    let social: string | null = null;
    if (this.on(FILTER.social)) {
      social = words.likeEachOtherLess(this.name(store.actor(index)), this.name(other));
      if (this.details) {
        social += this.numbers(
          this.opinion(store.value(index, 2), other),
          this.opinion(store.value(index, 3), store.actor(index)),
        );
      }
    }
    return this.join(this.conversationHead(actor), social);
  }

  private annoyed(actor: string, line: LogLine): string {
    const { store, index } = this;
    const object = store.label2(index);
    const sentence = words.annoyance(
      this.label(store.label(index)),
      this.name(store.other(index)),
      object === NONE ? null : this.label(object),
    );
    let list = line.count > 1 ? words.times(line.count) : '';
    if (this.details) list = joined(list, this.opinion(line.change, store.other(index)), words.LIST_SEPARATOR);
    return words.head(actor, list === '' ? sentence : sentence + words.inParentheses(list));
  }

  private week(actor: string): string {
    const { store, family } = this;
    let list = '';
    for (let at = 0; at < family.length; at++) {
      const duty = family.members[at];
      if (store.kind(duty) !== KIND.duty) continue;
      const label = this.label(store.label(duty));
      const room = this.context.room(store.value(duty, 0), store.value(duty, 1));
      list = joined(list, room === '' ? label : words.dutyInRoom(label, room), words.LIST_SEPARATOR);
    }
    return words.head(actor, words.choresThisWeek(list));
  }

  private outcome(actor: string): string {
    const { store, index } = this;
    const duty = this.label(store.label(index));
    const code = store.value(index, 0);
    const head = words.head(actor, code === OUTCOME.missed ? words.missedChore(duty)
      : code === OUTCOME.skipped ? words.skippedChore(duty) : duty);
    const covered = code === OUTCOME.covered && store.other(index) !== NONE && this.on(FILTER.chores)
      ? words.coveredChore(this.name(store.other(index))) : null;
    return this.join(head, covered, this.feelings());
  }

  private review(actor: string): string {
    const { store, index } = this;
    const code = store.value(index, 0);
    const title = this.label(store.label(index));
    let head = words.head(actor, words.weeklyReview(words.reviewOutcome(code & 0xff, title)));
    if (this.details) {
      const performance = store.value(index, 1);
      const fit = store.value(index, 2);
      const mastery = lowHalf(store.value(index, 3));
      const mood = highHalf(store.value(index, 3));
      head += this.numbers(
        performance === 0 ? null : words.performanceOutOf100(performance),
        fit === 0 ? null : words.fitFactor(fit),
        mastery === 0 ? null : words.skillFactor(mastery),
        mood === 0 ? null : words.moodFactor(mood),
      );
    }
    // A dismissal also carries the warning bit; the line says Fired alone.
    const warned = (code & REVIEW_WARNED) !== 0 && (code & 0xff) !== REVIEW_FIRED;
    return this.join(head, warned ? words.WARNED_AT_WORK : null);
  }

  private change(actor: string): string {
    const { store, index } = this;
    const title = this.label(store.label(index));
    switch (store.value(index, 0)) {
      case CHANGE.hired: return words.head(actor, words.hiredAs(title));
      case CHANGE.assigned: return words.head(actor, words.careerAssigned(title));
      case CHANGE.left: return words.head(actor, words.quitAs(title));
      default: return words.head(actor, words.SOMETHING);
    }
  }
}

/** The one line builder `lineText` reuses. */
const TEXT = new LineText();
