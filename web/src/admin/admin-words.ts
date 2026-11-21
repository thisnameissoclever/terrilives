import type { AdminBeginResult, AdminRefusalCode } from './codec.js';

// The admin panel's functional text ([AP-strings] of
// docs/specs/2026-11-20-admin-panel.md). Wording follows the plan's table
// exactly; the owner reviews player-visible text (docs/player-visible-strings.md
// and L58). Two sentences are not in the table and are marked NEW below: the
// refusal for a malformed change, and the begin refusal for a session the
// panel believed closed.

/** S-title, S-hint, S-close and S-tabs. */
export const ADMIN_WORDS = {
  title: 'Admin panel',
  cheat: 'Cheat',
  hint: '~ opens and closes',
  close: 'Close',
  pickerGroup: 'Housemate',
  paused: 'Game paused',
  stays: 'The game stays paused after you close the panel.',
  skipping: 'Skipping ahead',
} as const;

/** S-pill: what closing does, at the speed that was chosen before opening. */
export function pillNote(speed: number): string {
  return speed === 0 ? ADMIN_WORDS.stays : `Closing the panel resumes the game at ${speed}x.`;
}

/** S-undo. */
export const UNDO_WORDS = {
  idle: 'Undo',
  nothing: 'Nothing to undo',
  unknown: 'Undo last change',
  failed: 'Undo failed. Your changes are kept.',
} as const;

/** S-undo: the button's text for the change it would undo. */
export const undoWithChange = (change: string): string => `Undo: ${change}`;

/** The values a refusal's wording can name. Each is the display word the tab already shows. */
export interface RefusalParams {
  /** Refusal 2: the person who is gone. */
  readonly name?: string;
  /** Refusal 12: the bill's kind as the Household tab labels it. */
  readonly kind?: string;
  /** Refusal 15: the day the late fee may start. */
  readonly day?: number;
  /** Refusal 16: the cap in dollars, as shown ("12.50"), without the dollar sign. */
  readonly cap?: string;
}

/** S-refuse, plus refusal 19 (NEW). A refusal is the whole sentence the status line shows. */
export const ADMIN_REFUSAL_TEXT: Readonly<Record<AdminRefusalCode, (params: RefusalParams) => string>> = {
  1: () => 'The admin panel is closed.',
  2: p => `${p.name ?? 'That housemate'} is no longer in the household.`,
  3: () => 'That value is outside the allowed range.',
  4: () => 'That option no longer exists.',
  5: () => 'That has already ended or been removed.',
  6: () => 'They are at work or on the way. Change the job when they are home.',
  7: () => 'Four traits at most. Remove one first.',
  8: () => 'They already have that trait.',
  9: () => "They don't have that trait.",
  10: () => 'That trait has no value to set.',
  11: () => 'Choose someone else.',
  12: p => `There is already a${p.kind ? ` ${p.kind}` : ''} bill due that day.`,
  13: () => 'That bill is paid.',
  14: () => 'Bills fall due on the first day of a billing month, today or earlier.',
  15: p => `A late fee starts only after Day ${p.day ?? 0}.`,
  16: p => `The late fee can be at most $${p.cap ?? '0.00'}.`,
  17: () => "Funds don't cover this bill.",
  18: () => 'One of them is at work or on the way.',
  19: () => 'Invalid change',
  99: () => 'That change could not be kept. Nothing was changed.',
};

export function refusalText(code: AdminRefusalCode, params: RefusalParams): string {
  return ADMIN_REFUSAL_TEXT[code](params);
}

/** S-errors: why `admin_begin` refused, in the sentence the alert shows. */
export function beginRefusalText(result: Exclude<AdminBeginResult, 'ok'>): string {
  switch (result) {
    case 'build-active': return 'Leave Build mode to open the admin panel.';
    case 'would-not-reload': return "This game's state would not reload, so the admin panel can't open.";
    case 'already-open': return 'Admin panel already open';
  }
}

/** S-undolabels: the words after "Undo: ". A caller passes the display word it already shows for each slot. */
export const undoLabels = {
  need: (need: string): string => `Change ${need}`,
  fillNeeds: 'Fill needs',
  satisfaction: 'Change life satisfaction',
  repetition: (action: string): string => `Change repetition: ${action}`,
  clearRepetition: 'Clear repetition',
  endMoodlet: (moodlet: string): string => `End ${moodlet}`,
  endTimedMoodlets: 'End timed moodlets',
  affinity: (kind: string): string => `Change liking for ${kind}`,
  skill: (skill: string): string => `Change ${skill}`,
  trait: (trait: string): string => `Change ${trait}`,
  addTrait: (trait: string): string => `Add ${trait}`,
  removeTrait: (trait: string): string => `Remove ${trait}`,
  job: 'Change job',
  shift: 'Change shift',
  pay: 'Change pay',
  jobSatisfaction: 'Change job satisfaction',
  goodWeeks: 'Change good weeks',
  poorWeeks: 'Change poor weeks',
  searchOn: 'Turn job search on',
  searchOff: 'Turn job search off',
  feeling: (a: string, b: string): string => `Change ${a}'s feeling about ${b}`,
  bothFeelings: 'Set both feelings to 0',
  allFeelings: (a: string): string => `Set ${a}'s feelings to 0`,
  startFight: 'Start a fight',
  funds: 'Change funds',
  addThousand: 'Add $1,000',
  subtractThousand: 'Subtract $1,000',
  addTenThousand: 'Add $10,000',
  zeroFunds: 'Set funds to $0',
  bill: (kind: string): string => `Change ${kind} bill`,
  moveBill: (kind: string): string => `Move ${kind} bill`,
  payBill: (kind: string): string => `Pay ${kind} bill`,
  markBillPaid: (kind: string): string => `Mark ${kind} bill paid`,
  deleteBill: (kind: string): string => `Delete ${kind} bill`,
  addBill: (kind: string): string => `Add ${kind} bill`,
  removeLateFees: 'Remove late fees',
  markAllPaid: 'Mark all bills paid',
} as const;

/**
 * S-needs, S-sat, S-rep, S-mood, S-likes, S-skills, S-traits and S-career:
 * the Housemate tab's words, exactly as the plan's table has them. Words that
 * name a housemate, a need, a skill or a trait take the display word the game
 * already uses for it.
 */
export const HOUSEMATE_WORDS = {
  needs: 'Needs',
  needsRange: '0 to 100',
  fillNeeds: (name: string): string => `Fill ${name}'s needs`,
  deathNote: 'At 0, Hunger and Energy count toward death.',
  satisfaction: 'Life satisfaction',
  satisfactionRow: 'Satisfaction',
  repetition: 'Repetition',
  repetitionRange: (max: string): string => `0 to ${max}`,
  clearRepetition: (name: string): string => `Clear ${name}'s repetition`,
  overdoing: 'Overdoing',
  /** The folded Repetition summary on a phone: how many rows are past the overdoing line. */
  overdoingCount: (count: number): string => `${count} ${'Overdoing'.toLowerCase()}`,
  feelingSick: 'Feeling sick',
  noRepetition: 'No repetition.',
  /** A Repetition row's label when other rows share its action label: the object's name follows in brackets. */
  repetitionRow: (activity: string, object: string): string => `${activity} (${object})`,
  /** The same, numbered in the order the rows appear when the object names are identical too. */
  repetitionRowNumbered: (activity: string, object: string, number: number): string => `${activity} (${object} ${number})`,
  mood: 'Mood and moodlets',
  moodOverall: (word: string): string => `Mood ${word}`,
  /** The folded Mood summary on a phone: the overall word and score the section shows. */
  moodSummary: (word: string, score: string): string => `${word}, ${score}`,
  endsIn: (duration: string): string => `Ends in ${duration}`,
  endNow: 'End now',
  endTimed: (name: string): string => `End ${name}'s timed moodlets`,
  fromNeed: (need: string, level: number): string => `From ${need} below ${level}`,
  fromJob: 'From job satisfaction',
  fromFeeling: (name: string, other: string): string => `From ${name}'s feeling about ${other}`,
  fromBills: 'While a bill is overdue',
  likes: 'Likes and dislikes',
  likesRange: '-1 to 1',
  skills: 'Skills',
  skillsRange: (max: number): string => `Level 0 to ${max}`,
  traits: 'Traits',
  learned: 'how far learned',
  severe: 'how severe',
  noValue: 'No value to set',
  remove: 'Remove',
  chooseTrait: 'Choose a trait to add',
  add: 'Add',
  fourTraits: 'Four traits at most.',
  career: 'Career',
  job: 'Job',
  noJob: 'No job',
  jobOption: (path: string, title: string, level: number, levels: number): string => `${path}: ${title} (level ${level} of ${levels})`,
  shift: 'Shift',
  shiftOption: (name: string, start: string, end: string): string => `${name}, ${start} to ${end}`,
  shiftNote: 'Takes effect tomorrow.',
  pay: 'Pay per shift',
  payRange: (min: number, max: number): string => `$${min} to $${max}`,
  jobSatisfaction: 'Job satisfaction',
  ofHundred: 'of 100',
  goodWeeks: 'Good weeks in a row',
  promotionHint: (weeks: number): string => `${weeks} earns a promotion`,
  poorWeeks: 'Poor weeks in a row',
  poorHint: '2 brings a warning. 3 or more risk being fired.',
  search: 'Job search',
  searchWords: 'Looks for work on their own',
} as const;

/**
 * S-rel: the Relationships tab's words, exactly as the plan's table has them.
 * `fightMoodlet` is the existing name of the timed moodlet, used in the Undo
 * button's "End {moodlet}".
 */
export const RELATIONSHIP_WORDS = {
  pair: (a: string, b: string): string => `${a} and ${b}`,
  feeling: (a: string, b: string): string => `${a}'s feeling about ${b}`,
  startFight: (a: string): string => `${a} starts a fight`,
  both: 'Set both to 0',
  all: (a: string): string => `Set all of ${a}'s feelings to 0`,
  fought: (a: string, duration: string): string => `${a} had a fight. Ends in ${duration}.`,
  fightQueued: 'The fight starts when the game resumes.',
  fightMoodlet: 'Had a fight',
} as const;

/** "1 hour", "8 hours": the plan writes "{n} hours", and one hour reads as one hour. */
export function hoursText(hours: number): string {
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/**
 * S-funds, S-bills and S-time: the Household tab's words, exactly as the
 * plan's table has them, with the singular where a count is 1.
 */
export const HOUSEHOLD_WORDS = {
  funds: 'Funds',
  addThousand: 'Add $1,000',
  subtractThousand: 'Subtract $1,000',
  addTenThousand: 'Add $10,000',
  zeroFunds: 'Set to $0',
  places: 'Use at most two decimal places.',
  bills: 'Bills',
  bill: 'Bill',
  due: 'Due',
  amount: 'Amount',
  lateFee: 'Late fee',
  status: 'Status',
  day: (day: number, weekday: string): string => `Day ${day}, ${weekday}`,
  overdue: 'Overdue',
  noFeeUntil: (day: number): string => `No fee until Day ${day}`,
  paidDay: (day: number): string => `Paid Day ${day}`,
  pay: 'Pay from funds',
  markPaid: 'Mark paid, free',
  remove: 'Delete',
  addBill: 'Add bill',
  removeFees: 'Remove all late fees',
  markAllPaid: 'Mark all paid, free',
  noBills: 'No bills.',
  nextDue: (day: number, weekday: string): string => `Next bills due: Day ${day}, ${weekday}`,
  feeRule: (percent: number, grace: number, cap: number): string =>
    `Late fee: ${percent}% a day after ${grace} days, up to ${cap}% of the bill`,
  autoPay: 'Unpaid bills are paid from funds automatically when the game resumes, oldest first, while funds cover them.',
  cannotCover: "Funds don't cover this bill.",
  /** Once under the bills table, when the funds fall short of two or more unpaid bills. */
  cannotCoverMany: "Funds don't cover these bills.",
  time: 'Time',
  now: 'Now',
  clock: (day: number, weekday: string, time: string): string => `Day ${day}, ${weekday}, ${time}`,
  skipBy: 'Skip ahead by',
  hours: 'hours',
  skip: 'Skip',
  stop: 'Stop',
  skipNote: "Skipping can't be undone, and it clears Undo.",
  skipping: (done: number, asked: number): string => `Skipping: ${done} of ${hoursText(asked)}.`,
  skipped: (hours: number): string => `Skipped ${hoursText(hours)}.`,
  stopped: (hours: number): string => `Stopped after ${hoursText(hours)}.`,
  died: (hours: number, name: string): string => `Stopped after ${hoursText(hours)}: ${name} died.`,
} as const;
