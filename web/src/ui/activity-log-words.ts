/**
 * Every new player-visible string the activity log shows, in one place for
 * the owner's review beside a running build ([AL-strings] in
 * docs/specs/2026-10-18-activity-log.md, lesson L58). These are proposals,
 * not approved copy. Existing labels (actions, chains, social interactions,
 * skills, career titles, chore duties, room names, object types and the
 * affinity kinds) come from the simulation's label table, unchanged except
 * that an object's type is lowercased inside a sentence; nothing else in the
 * shell defines wording for the log.
 */

import { topicRow, type TopicRow } from '../topic-table.js';
import type { Reaction } from '../reaction-band.js';

/** The toggle, the panel and its filters ([AL-panel]). */
export const PANEL_WORDS = {
  toggle: 'Log',
  title: 'Log',
  close: 'Close',
  filters: ['Actions', 'Chores', 'Social', 'Skills', 'Career', 'Details', 'Time'] as const,
  /** The accessible names of the filter group and the scrolling list of entries. */
  filtersGroup: 'Filters',
  entries: 'Log entries',
  nothingYet: 'Nothing has happened yet.',
  nothingMatches: 'Nothing matches these filters.',
  showEarlier: 'Show earlier entries',
} as const;

/** The checkbox that narrows the log to the selected housemate. */
export function onlyNamed(name: string): string { return `Only ${name}`; }

/** A person the shell never saw a name for, at the start of a line. */
export const SOMEONE = 'Someone';
/** The same person anywhere else in a line. */
export const SOMEONE_IN_SENTENCE = 'someone';

/** A label index the table does not hold, and a topic with no word. */
export const SOMETHING = 'something';

/** Punctuation that joins a line's parts. */
export const CLAUSE_SEPARATOR = '; ';
export const LIST_SEPARATOR = ', ';
/** ` (a, b)` around a list already joined with `LIST_SEPARATOR`. */
export function inParentheses(list: string): string { return ` (${list})`; }

/** The head: `Name: label`, with the other person and the topic ([AL-compose]). */
export function head(name: string, label: string): string { return `${name}: ${label}`; }
export function withPerson(name: string): string { return ` with ${name}`; }
export function aboutTopic(topic: string): string { return ` about ${topic}`; }

/** The Time prefix, `D74, T15:45`, then a space before the line. */
export function timestamp(day: number, hours: number, minutes: number): string {
  return `D${day}, T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} `;
}

/**
 * The word after "about" for a topic value, from the topic table's row label
 * ([RT-shell] 2 in docs/specs/2026-11-22-richer-topics.md). A row with an
 * empty label, such as small talk or a plain argument, names no subject and
 * reads "Chat with Bill" or "Fight with Bill"; a value that names no row
 * reads as `SOMETHING`.
 */
export function topicWord(table: readonly TopicRow[], value: number): string | null {
  const row = topicRow(table, value);
  if (row === null) return SOMETHING;
  return row.label === '' ? null : row.label;
}

/** A chat reaction, chosen from the Likes and dislikes band edges by `reactionOf`. */
export function reaction(name: string, kind: Reaction): string {
  switch (kind) {
    case 'loves': return `${name} loves it`;
    case 'likes': return `${name} likes it`;
    case 'neutral': return `${name} does not mind it`;
    case 'dislikes': return `${name} dislikes it`;
    case 'hates': return `${name} hates it`;
  }
}

/** Feelings attached to another line: a chore, a meal or a fight. */
export function appreciates(name: string, other: string): string { return `${name} appreciates ${other}`; }
export function resents(name: string, other: string): string { return `${name} resents ${other}`; }
export function likeEachOtherLess(name: string, other: string): string { return `${name} and ${other} like each other less`; }
/** A feeling whose line was not logged, as its own line's label. */
export function appreciatedMeal(other: string): string { return `Appreciated ${other}'s meal`; }
export function appreciatedChore(other: string): string { return `Appreciated ${other}'s chore`; }
export function resentedNeglectedChore(other: string): string { return `Resented ${other}'s neglected chore`; }

/**
 * An object's type label, such as Bathroom sink, as it reads after "the" in
 * a sentence: bathroom sink. A label that starts with an acronym, such as
 * TV stand, keeps its capitals. Lines name objects by type, never by model.
 */
export function objectInSentence(type: string): string {
  const second = type.charAt(1);
  return second !== '' && second === second.toUpperCase() && second !== second.toLowerCase()
    ? type
    : type.charAt(0).toLowerCase() + type.slice(1);
}

/**
 * Annoyance lines, by the cause label the simulation records. `object` is
 * the object's type label, or the affinity kind for a nuisance. For a
 * privacy incident it is the fixture in private use; only toilets, showers
 * and bathtubs start private use, so a fixture the shell cannot name is
 * still in the bathroom.
 */
export function annoyance(cause: string, other: string, object: string | null): string {
  const fixture = () => (object === null ? 'bathroom' : objectInSentence(object));
  switch (cause) {
    case 'cause:household-mess': return `Annoyed by ${other}'s dishes`;
    case 'cause:dirty-setting': return `Annoyed by ${other}'s dirty place setting`;
    case 'cause:privacy-entry': return `Annoyed that ${other} walked in while they were using the ${fixture()}. Awkward.`;
    case 'cause:privacy-start': return `Annoyed that ${other} started using the ${fixture()} right in front of them. Awkward.`;
    case 'cause:low-need-interruption':
    case 'cause:critical-need-interruption': return `Annoyed that ${other} interrupted`;
    // Reused from the mood panel's moodlet.
    case 'cause:nuisance': return `Bothered by ${other} using the ${object === null ? SOMETHING : objectInSentence(object)}`;
    default: return `Annoyed by ${other}`;
  }
}
export function times(count: number): string { return `${count} times`; }

/** Chores. */
/** `duties` is already joined with `LIST_SEPARATOR`. */
export function choresThisWeek(duties: string): string { return `Chores this week: ${duties}`; }
export function dutyInRoom(duty: string, room: string): string { return `${duty} (${room})`; }
export function coveredChore(owner: string): string { return `covered ${owner}'s chore`; }
export function missedChore(duty: string): string { return `Missed chore: ${duty}`; }
export function skippedChore(duty: string): string { return `Skipped chore: ${duty}`; }

/** Skills. */
export function skillLevel(skill: string, level: number): string { return `${skill} level ${level}`; }
export function skillReached(skill: string, level: number): string { return `${skill} reached level ${level}`; }
export function percent(value: number): string { return `${value}%`; }

/** Careers, by the outcome codes of a weekly review. */
export function weeklyReview(outcome: string): string { return `Weekly review: ${outcome}`; }
export function reviewOutcome(code: number, title: string): string {
  switch (code) {
    case 1: return `Promoted to ${title}`;
    case 2: return 'Got a raise';
    case 3: return `Demoted to ${title}`;
    case 4: return 'Fired';
    case 5: return `Changed path to ${title}`;
    default: return 'No change';
  }
}
export const WARNED_AT_WORK = 'Warned at work';
export function hiredAs(title: string): string { return `Hired as ${title}`; }
export function careerAssigned(title: string): string { return `Career assigned: ${title}`; }
/** The title of the job the housemate left. */
export function quitAs(title: string): string { return `Quit as ${title}`; }

/** Household. */
export const DIED = 'Died';

/** Details numbers ([AL-numbers]); callers omit a number that rounds to zero. */
export function signed(value: number): string { return value > 0 ? `+${value}` : `${value}`; }
export function socialGained(points: number): string { return `${signed(points)} Social`; }
export function opinionOf(points: number, name: string): string { return `${signed(points)} opinion of ${name}`; }
export function performanceOutOf100(value: number): string { return `performance ${value} of 100`; }
export function fitFactor(value: number): string { return `fit ${value}`; }
export function skillFactor(value: number): string { return `skill ${value}%`; }
export function moodFactor(value: number): string { return `mood ${value}`; }
