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
 * open.
 */

import { type ActivityLogStore, KIND, NONE, OTHER_PARTIAL, PARTIAL, unpackPair } from './activity-log-store.js';
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
}

/**
 * The visible lines of a store in order, oldest first, with same-day
 * annoyances merged into their latest occurrence ([AL-group] rule 1).
 */
export class LogLines {
  readonly lines: LogLine[] = [];
  private readonly groups = new Map<string, LogLine>();

  reset(): void {
    this.lines.length = 0;
    this.groups.clear();
  }

  /**
   * Adds the visible lines of records `from` onward and returns the lines
   * that are new or moved to the end. A merged line leaves its old place.
   */
  add(store: ActivityLogStore, from: number, context: ComposeContext): LogLine[] {
    const changed: LogLine[] = [];
    for (let index = Math.max(0, from); index < store.length; index++) {
      if (store.parent(index) !== 0 || !visible(store, index, context)) continue;
      const seq = store.seq(index);
      const tick = store.tick(index);
      if (store.kind(index) !== KIND.annoyed) {
        const line: LogLine = { seq, tick, key: null, count: 1, change: 0 };
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
        this.lines.splice(this.lines.indexOf(group), 1);
        this.lines.push(group);
        if (!changed.includes(group)) changed.push(group);
        continue;
      }
      const line: LogLine = { seq, tick, key, count: 1, change: store.value(index, 2) };
      this.groups.set(key, line);
      this.lines.push(line);
      changed.push(line);
    }
    return changed;
  }

  /** Forgets the oldest lines beyond `limit`. */
  trim(limit: number): void {
    const excess = this.lines.length - limit;
    if (excess <= 0) return;
    for (const line of this.lines.splice(0, excess)) {
      if (line.key !== null && this.groups.get(line.key) === line) this.groups.delete(line.key);
    }
  }
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

/** Children of the record at `index`, and their children, in sequence order. */
function family(store: ActivityLogStore, index: number): number[] {
  const members: number[] = [];
  collectChildren(store, index, members);
  for (let at = 0; at < members.length; at++) collectChildren(store, members[at], members);
  return members.sort((left, right) => left - right);
}

/** Children share their parent's tick: the link pass only links records staged together. */
function collectChildren(store: ActivityLogStore, index: number, into: number[]): void {
  const seq = store.seq(index);
  const tick = store.tick(index);
  for (let at = index - 1; at >= 0 && store.tick(at) === tick; at--) {
    if (store.parent(at) === seq) into.push(at);
  }
  for (let at = index + 1; at < store.length && store.tick(at) === tick; at++) {
    if (store.parent(at) === seq) into.push(at);
  }
}

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
 * involves them ([AL-selected]).
 */
export function visible(store: ActivityLogStore, index: number, context: ComposeContext): boolean {
  const enabled = context.filters & TRIGGER_FILTERS;
  const children = family(store, index);
  let triggers = store.triggers(index);
  for (const child of children) triggers |= store.triggers(child);
  if ((triggers & enabled) === 0) return false;
  const selected = context.selected;
  if (selected === null || involves(store, index, selected)) return true;
  return children.some(child => childShown(store, child, context.filters) && involves(store, child, selected));
}

/** The line's text under the current filters, or an empty string once its record has left the store. */
export function lineText(store: ActivityLogStore, line: LogLine, context: ComposeContext): string {
  const index = store.indexOfSeq(line.seq);
  if (index < 0) return '';
  const text = new LineText(store, index, context);
  const body = text.compose(line);
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

class LineText {
  private readonly details: boolean;
  private readonly children: number[];

  constructor(
    private readonly store: ActivityLogStore,
    private readonly index: number,
    private readonly context: ComposeContext,
  ) {
    this.details = (context.filters & FILTER.details) !== 0;
    this.children = family(store, index);
  }

  private on(filter: number): boolean { return (this.context.filters & filter) !== 0; }
  private name(simId: number): string { return this.context.name(simId) ?? words.SOMEONE; }
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
  private numbers(parts: readonly (string | null)[]): string {
    if (!this.details) return '';
    const kept = parts.filter((part): part is string => part !== null);
    return kept.length === 0 ? '' : words.parenthesized(kept);
  }

  private reaction(name: string, hundredths: number): string {
    const { loves, likes } = this.context.bands;
    const kind = hundredths >= loves ? 'loves'
      : hundredths >= likes ? 'likes'
        : hundredths <= -loves ? 'hates'
          : hundredths <= -likes ? 'dislikes' : 'neutral';
    return words.reaction(name, kind);
  }

  compose(line: LogLine): string {
    const { store, index } = this;
    const actor = this.name(store.actor(index));
    switch (store.kind(index)) {
      case KIND.actionDone: return this.action(actor);
      case KIND.chatDone: return this.chat(actor);
      case KIND.fightDone: return this.fight(actor);
      case KIND.annoyed: return this.annoyed(actor, line);
      case KIND.choresThisWeek: return this.week(actor);
      case KIND.choreOutcome: return this.outcome(actor);
      case KIND.feeling: return this.feeling(index);
      case KIND.skillLevel: return words.head(actor, this.levelText(index));
      case KIND.weeklyReview: return this.review(actor);
      case KIND.careerChange: return this.change(actor);
      case KIND.death: return words.head(actor, words.DIED);
      default: return words.head(actor, words.SOMETHING);
    }
  }

  /** Clauses in the fixed order chore, social, skill, career, after the head. */
  private join(head: string, clauses: readonly (string | null)[]): string {
    let text = head;
    for (const clause of clauses) if (clause !== null && clause !== '') text += words.CLAUSE_SEPARATOR + clause;
    return text;
  }

  private kids(kind: number): number[] { return this.children.filter(child => this.store.kind(child) === kind); }

  private feelingText(child: number): string {
    const { store } = this;
    const actor = this.name(store.actor(child));
    const other = this.name(store.other(child));
    const sentence = this.label(store.label(child)) === 'cause:chore-neglected'
      ? words.resents(actor, other) : words.appreciates(actor, other);
    return sentence + this.numbers([this.opinion(store.value(child, 2), store.other(child))]);
  }

  /** The Social clause from feelings attached anywhere below this line. */
  private feelings(): string | null {
    if (!this.on(FILTER.social)) return null;
    const parts = this.kids(KIND.feeling).map(child => this.feelingText(child));
    return parts.length === 0 ? null : parts.join(words.LIST_SEPARATOR);
  }

  private choreClause(): string | null {
    if (!this.on(FILTER.chores)) return null;
    const parts = this.kids(KIND.choreOutcome)
      .filter(child => this.store.value(child, 0) === OUTCOME.covered && this.store.other(child) !== NONE)
      .map(child => words.coveredChore(this.name(this.store.other(child))));
    return parts.length === 0 ? null : parts.join(words.LIST_SEPARATOR);
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
    const { store, index } = this;
    let head = words.head(actor, this.label(store.label(index)));
    const other = store.other(index);
    if (other !== NONE) head += words.withPerson(this.name(other));
    if (this.on(FILTER.social)) {
      head += this.numbers([
        this.social(store.value(index, 0), (store.flags(index) & PARTIAL) !== 0),
        other === NONE ? null : this.opinion(store.value(index, 3), other),
      ]);
    }
    let skill: string | null = null;
    if (this.on(FILTER.skills)) {
      const practiced = store.label2(index);
      const progress = this.numbers([store.value(index, 2) === 0 ? null : words.percent(store.value(index, 2))]);
      const parts: string[] = [];
      let crossed = false;
      for (const level of this.kids(KIND.skillLevel)) {
        let text = this.levelClause(level);
        if (practiced !== NONE && store.label(level) === practiced && store.actor(level) === store.actor(index)) {
          text += progress;
          crossed = true;
        }
        parts.push(text);
      }
      if (practiced !== NONE && !crossed) {
        parts.unshift(words.skillLevel(this.label(practiced), store.value(index, 1)) + progress);
      }
      skill = parts.length === 0 ? null : parts.join(words.LIST_SEPARATOR);
    }
    return this.join(head, [this.choreClause(), this.feelings(), skill]);
  }

  private conversationHead(actor: string): string {
    const { store, index } = this;
    let head = words.head(actor, this.label(store.label(index))) + words.withPerson(this.name(store.other(index)));
    const topic = store.label2(index);
    if (topic !== NONE) head += words.aboutTopic(words.topicWord(this.label(topic)));
    return head;
  }

  private chat(actor: string): string {
    const { store, index } = this;
    const other = store.other(index);
    const otherName = this.name(other);
    let social: string | null = null;
    if (this.on(FILTER.social)) {
      const topic = store.label2(index) !== NONE;
      const [mine, theirs] = unpackPair(store.value(index, 0));
      const [gained, heard] = unpackPair(store.value(index, 1));
      const flags = store.flags(index);
      const sides: string[] = [];
      const side = (name: string, preference: number, numbers: string) => {
        if (topic) sides.push(this.reaction(name, preference) + numbers);
        else if (numbers !== '') sides.push(name + numbers);
      };
      side(actor, mine, this.numbers([
        this.social(gained, (flags & PARTIAL) !== 0), this.opinion(store.value(index, 2), other),
      ]));
      side(otherName, theirs, this.numbers([
        this.social(heard, (flags & OTHER_PARTIAL) !== 0), this.opinion(store.value(index, 3), store.actor(index)),
      ]));
      social = sides.length === 0 ? null : sides.join(words.LIST_SEPARATOR);
    }
    const skill = this.on(FILTER.skills) ? this.levels() : null;
    return this.join(this.conversationHead(actor), [social, skill]);
  }

  private levels(): string | null {
    const parts = this.kids(KIND.skillLevel).map(level => this.levelClause(level));
    return parts.length === 0 ? null : parts.join(words.LIST_SEPARATOR);
  }

  private fight(actor: string): string {
    const { store, index } = this;
    const other = store.other(index);
    const social = this.on(FILTER.social)
      ? words.likeEachOtherLess(actor, this.name(other)) + this.numbers([
        this.opinion(store.value(index, 2), other),
        this.opinion(store.value(index, 3), store.actor(index)),
      ])
      : null;
    return this.join(this.conversationHead(actor), [social]);
  }

  private annoyed(actor: string, line: LogLine): string {
    const { store, index } = this;
    const object = store.label2(index);
    const sentence = words.annoyance(
      this.label(store.label(index)),
      this.name(store.other(index)),
      object === NONE ? null : this.label(object),
    );
    const parts = [line.count > 1 ? words.times(line.count) : null];
    if (this.details) parts.push(this.opinion(line.change, store.other(index)));
    const kept = parts.filter((part): part is string => part !== null);
    return words.head(actor, sentence + (kept.length === 0 ? '' : words.parenthesized(kept)));
  }

  private week(actor: string): string {
    const duties = this.kids(KIND.duty).map(duty => {
      const label = this.label(this.store.label(duty));
      const room = this.context.room(this.store.value(duty, 0), this.store.value(duty, 1));
      return room === '' ? label : words.dutyInRoom(label, room);
    });
    return words.head(actor, words.choresThisWeek(duties));
  }

  private outcome(actor: string): string {
    const { store, index } = this;
    const duty = this.label(store.label(index));
    const code = store.value(index, 0);
    const head = words.head(actor, code === OUTCOME.missed ? words.missedChore(duty)
      : code === OUTCOME.skipped ? words.skippedChore(duty) : duty);
    const covered = code === OUTCOME.covered && store.other(index) !== NONE && this.on(FILTER.chores)
      ? words.coveredChore(this.name(store.other(index))) : null;
    return this.join(head, [covered, this.feelings()]);
  }

  /** A feeling with no line to attach to: the feeling alone. */
  private feeling(index: number): string { return this.feelingText(index); }

  private review(actor: string): string {
    const { store, index } = this;
    const code = store.value(index, 0);
    const title = this.label(store.label(index));
    let head = words.head(actor, words.weeklyReview(words.reviewOutcome(code & 0xff, title)));
    const [mastery, mood] = unpackPair(store.value(index, 3));
    const factor = (value: number, format: (value: number) => string) => value === 0 ? null : format(value);
    head += this.numbers([
      factor(store.value(index, 1), words.performanceOutOf100),
      factor(store.value(index, 2), words.fitFactor),
      factor(mastery, words.skillFactor),
      factor(mood, words.moodFactor),
    ]);
    // A dismissal also carries the warning bit; the line says Fired alone.
    const warned = (code & REVIEW_WARNED) !== 0 && (code & 0xff) !== REVIEW_FIRED;
    return this.join(head, [warned ? words.WARNED_AT_WORK : null]);
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
