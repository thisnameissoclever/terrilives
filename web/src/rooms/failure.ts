import type { RoomFailure } from './codec.js';

/**
 * The load rule the simulation names when Build cannot open or confirm,
 * read from `build_failure_report`. `rule` is null when the refusal lies
 * outside the rules it can name.
 */
export interface BuildFailureReport {
  readonly rule: 'lot_usability' | 'edge_world' | 'portal_return' | 'seating' | 'reading' | null;
  /** The placement refusal code, for `lot_usability` only. */
  readonly refusal?: number;
}

const RULES = new Set(['lot_usability', 'edge_world', 'portal_return', 'seating', 'reading']);

export function parseBuildFailureReport(json: string): BuildFailureReport {
  try {
    const value = JSON.parse(json) as { rule?: unknown; refusal?: unknown };
    const rule = typeof value.rule === 'string' && RULES.has(value.rule) ? value.rule as BuildFailureReport['rule'] : null;
    return rule === 'lot_usability' && typeof value.refusal === 'number' ? { rule, refusal: value.refusal } : { rule };
  } catch {
    return { rule: null };
  }
}

/** The kind of failure each native code reports, as the console names it. */
export const FAILURE_NAMES: readonly string[] = ['Unknown error', 'Build is closed', 'Build is already open', 'Not enough memory',
  'Room counter exhausted', 'Room no longer exists', 'Invalid room name', 'Room choices refused', 'Build replay differs',
  'Build draft differs', 'Build validation failed', 'Review is out of date', 'Command unavailable during Build',
  'Invalid room request', 'Room request too large', 'Bed left outside'];

/** The failure a Confirm reports when it would leave a bed outside every room ([WB-beds]). */
export const BED_OUTSIDE = 15;

/** What happened, in one sentence for the player. */
const WHAT: Readonly<Record<number, string>> = {
  1: 'Build mode is not open.',
  2: 'Build mode is already open.',
  3: 'The game ran out of memory while checking the changes.',
  4: 'The game cannot record any more room changes in this session.',
  5: 'That room no longer exists.',
  6: 'That room name cannot be used.',
  7: 'The room choices could not be applied.',
  8: 'The pending changes could not be repeated in order.',
  9: 'The pending changes changed while they were being checked.',
  11: 'The room review is out of date because the build changed.',
  12: 'That action is not available in Build mode.',
  13: 'The room request was not valid.',
  14: 'The room request is too large.',
  // Issue 298, [WB-beds]: functional text proposed for the owner's review.
  15: 'A bed would be left outside.',
};

/**
 * What a Build validation failure found in the way, as a clause: what the
 * pending changes would do, or, when Build cannot open, what the house does now.
 */
function obstacle(report: BuildFailureReport, now = false): string | null {
  const [would, is] = now ? ['', 'is'] : ['would ', 'would be'];
  switch (report.rule) {
    case 'lot_usability':
      switch (report.refusal) {
        case 8: return `a wall or window ${now ? 'stands' : 'would come'} between someone and what they are using`;
        case 9: return `someone is standing where a wall or window ${now ? 'is' : 'would go'}`;
        case 10: return `a wall or window ${now ? 'blocks' : 'would block'} someone's way`;
        case 11: return `some furniture ${now ? 'faces' : 'would face'} a space nobody can reach`;
        case 12: case 13: return `the front door ${is} cut off`;
        default: return null;
      }
    case 'edge_world': return `a wall or window ${now ? 'blocks' : 'would block'} a housemate's walk or what they are using`;
    case 'portal_return': return `the front door or its landing ${is} cut off`;
    case 'seating': return `someone's seat ${would}${now ? 'is not' : 'no longer be'} usable`;
    case 'reading': return `someone's reading spot ${would}${now ? 'is not' : 'no longer be'} usable`;
    case null: return null;
    default: {
      const unhandled: never = report.rule;
      return unhandled;
    }
  }
}

/** What happened, without advice; advice depends on where it happened. */
export function failureWhat(error: RoomFailure, report: BuildFailureReport = { rule: null }): string {
  if (error.code !== 10) return WHAT[error.code] ?? 'Something went wrong with the build.';
  const cause = obstacle(report);
  return cause ? `These changes can't be confirmed: ${cause}.` : "These changes can't be confirmed because the house would not load afterwards.";
}

/** A refused Confirm, with what the player can do about it. */
export function confirmFailure(error: RoomFailure, report: BuildFailureReport = { rule: null }, bedModel = ''): string {
  if (error.code === BED_OUTSIDE) {
    // The refusal names the bed it would leave outside when its model is known.
    const what = bedModel === '' ? WHAT[BED_OUTSIDE] : `The ${bedModel} bed would be left outside.`;
    return `${what} Move it into a room, or choose Cancel, before confirming.`;
  }
  const fix = error.code === 10 ? 'Change the walls, doors or windows involved, or choose Cancel to undo all pending changes.'
    : 'Check the pending changes and try again, or choose Cancel to undo them.';
  return `${failureWhat(error, report)} ${fix}`;
}

/** A refused entry into Build mode. */
export function enterFailure(error: RoomFailure, report: BuildFailureReport = { rule: null }): string {
  if (error.code !== 10) return `${failureWhat(error, report)} Build mode stays closed.`;
  const cause = obstacle(report, true);
  return `Build mode can't open because the house would not load as it stands${cause ? `: ${cause}` : ''}. `
    + 'Let the game run for a moment and try again. If it keeps happening, load an earlier save.';
}

/** The console's details for a native failure. */
export function failureDetails(error: RoomFailure, report?: BuildFailureReport): Record<string, unknown> {
  return { code: error.code, kind: FAILURE_NAMES[error.code] ?? FAILURE_NAMES[0], detail: error.detail, ...(report ? { report } : {}) };
}
