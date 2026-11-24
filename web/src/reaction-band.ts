/**
 * How a chat preference, from -1 to 1, reads as a reaction. The Log's words
 * and the conversation bubble both come from here, so a bubble never shows a
 * thumb the Log calls "does not mind it" (issue 360).
 */

/** A reaction band, from the Likes and dislikes edges in tuning. */
export type Reaction = 'loves' | 'likes' | 'neutral' | 'dislikes' | 'hates';

/** The band edges in hundredths, the unit the activity log records a preference in. */
export interface ReactionBands {
  readonly loves: number;
  readonly likes: number;
}

/** The tuning edges, from 0 to 1, as hundredths. */
export function bandsInHundredths(edges: { loves: number; likes: number }): ReactionBands {
  return { loves: Math.round(edges.loves * 100), likes: Math.round(edges.likes * 100) };
}

/**
 * A live preference as the activity log records it: times 100 in single
 * precision, rounded half away from zero, as Rust's `f32::round` does.
 */
export function preferenceHundredths(preference: number): number {
  if (!Number.isFinite(preference)) return 0;
  const scaled = Math.fround(Math.fround(preference) * 100);
  return Math.sign(scaled) * Math.round(Math.abs(scaled));
}

/** The reaction for a preference already in hundredths. */
export function reactionOf(hundredths: number, bands: ReactionBands): Reaction {
  if (hundredths >= bands.loves) return 'loves';
  if (hundredths >= bands.likes) return 'likes';
  if (hundredths <= -bands.loves) return 'hates';
  if (hundredths <= -bands.likes) return 'dislikes';
  return 'neutral';
}
