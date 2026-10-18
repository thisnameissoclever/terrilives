/**
 * Every new player-visible string the activity log shows, in one place for
 * the owner's review beside a running build ([AL-strings] in
 * docs/specs/2026-10-18-activity-log.md, lesson L58). These are proposals,
 * not approved copy. Existing labels (actions, chains, social interactions,
 * skills, career titles, chore duties, room names and the affinity kinds)
 * come from the simulation's label table unchanged; nothing else in the
 * shell defines wording for the log.
 */

/** The toggle, the panel and its filters ([AL-panel]). */
export const PANEL_WORDS = {
  toggle: 'Log',
  title: 'Log',
  close: 'Close',
  filters: ['Actions', 'Chores', 'Social', 'Skills', 'Career', 'Details', 'Time'] as const,
  nothingYet: 'Nothing has happened yet.',
  nothingMatches: 'Nothing matches these filters.',
  showEarlier: 'Show earlier entries',
} as const;

export function onlyInvolving(name: string): string { return `Only entries involving ${name}.`; }

/** A person the shell never saw a name for. */
export const SOMEONE = 'Someone';

/** A label index the table does not hold, and a topic with no word. */
export const SOMETHING = 'something';

/** Punctuation that joins a line's parts. */
export const CLAUSE_SEPARATOR = '; ';
export const LIST_SEPARATOR = ', ';
export function parenthesized(parts: readonly string[]): string { return ` (${parts.join(LIST_SEPARATOR)})`; }

/** The head: `Name: label`, with the other person and the topic ([AL-compose]). */
export function head(name: string, label: string): string { return `${name}: ${label}`; }
export function withPerson(name: string): string { return ` with ${name}`; }
export function aboutTopic(topic: string): string { return ` about ${topic}`; }

/** The Time prefix, `D74, T15:45`, then a space before the line. */
export function timestamp(day: number, hours: number, minutes: number): string {
  return `D${day}, T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} `;
}

/**
 * Phase 1 topic words by conversation topic tag. Tags that share a bubble
 * share a word. Phase 2 replaces this table with content labels.
 */
export const TOPIC_WORDS: ReadonlyMap<string, string> = new Map([
  ['eating', 'eating'], ['food', 'eating'],
  ['socialising', 'small talk'], ['smalltalk', 'small talk'],
  ['sleeping', 'sleep'], ['sleep', 'sleep'],
  ['reading', 'reading'],
  ['exercise', 'exercise'],
  ['aquarium', 'the aquarium'], ['fish', 'the aquarium'],
  ['sitting', 'comfort'], ['comfort', 'comfort'],
  ['showering', 'showers'], ['shower', 'showers'],
  ['toilet', 'the toilet'],
  ['television', 'TV'], ['tv', 'TV'],
  ['lounging', 'lounging about'],
  ['washing', 'washing'], ['hygiene', 'washing'],
  ['cleaning', 'cleaning'],
  ['music', 'music'], ['radio', 'music'],
  ['correspondence', 'letters'],
  ['bathing', 'baths'], ['bath', 'baths'],
  ['cooking', 'cooking'],
  ['fight-dishes', 'the dishes'],
  ['fight-chore', 'chores'],
  ['fight', 'nothing in particular'],
]);

export function topicWord(tag: string): string { return TOPIC_WORDS.get(tag) ?? SOMETHING; }

/** A chat reaction, chosen from the Likes and dislikes band edges. */
export type Reaction = 'loves' | 'likes' | 'neutral' | 'dislikes' | 'hates';
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

/** Annoyance lines, by the cause label the simulation records. */
export function annoyance(cause: string, other: string, object: string | null): string {
  switch (cause) {
    case 'cause:household-mess': return `Annoyed by ${other}'s dishes`;
    case 'cause:dirty-setting': return `Annoyed by ${other}'s dirty place setting`;
    case 'cause:privacy-entry': return `Annoyed that ${other} walked in`;
    case 'cause:privacy-start':
      return object === null ? `Annoyed that ${other} used something nearby` : `Annoyed that ${other} used the ${object} nearby`;
    case 'cause:low-need-interruption':
    case 'cause:critical-need-interruption': return `Annoyed that ${other} interrupted`;
    // Reused from the mood panel's moodlet.
    case 'cause:nuisance': return `Bothered by ${other} using the ${object ?? SOMETHING}`;
    default: return `Annoyed by ${other}`;
  }
}
export function times(count: number): string { return `${count} times`; }

/** Chores. */
export function choresThisWeek(duties: readonly string[]): string { return `Chores this week: ${duties.join(LIST_SEPARATOR)}`; }
export function dutyInRoom(duty: string, room: string): string { return `${duty} (${room})`; }
export function coveredChore(owner: string): string { return `covered ${owner}'s chore`; }
export function missedChore(duty: string): string { return `Missed ${duty}`; }
export function skippedChore(duty: string): string { return `Skipped ${duty}`; }

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
export const JOB_LEFT = 'Job left';

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
