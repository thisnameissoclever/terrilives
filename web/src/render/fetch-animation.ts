/**
 * The fridge reach follows the chain step's saved progress, not a looping clock.
 *
 * `render_buffer::visual_action::FETCH`: the simulation publishes the step's
 * elapsed share, 0 to 1000, in the body's chore-progress column. Equal shares
 * of the step select the samples in order, so the door opens, the hand reaches
 * in and the door closes within any sampled step length; Pause holds the
 * sample and Load resumes from the simulation's own progress. Reduced motion
 * holds the closed rest sample. `fridge_reach_geometry.sample_for_progress`
 * in the Blender source is the same rule.
 */
export const FETCH_VISUAL_ACTION = 22;

export function fetchFrame(progress: number, count: number, reducedMotion: boolean): number {
  if (!Number.isInteger(count) || count < 1) throw new Error('Fetch sample count must be a positive integer');
  if (reducedMotion || count === 1 || !Number.isFinite(progress)) return 0;
  const phase = Math.max(0, Math.min(1000, Math.floor(progress)));
  return Math.min(count - 1, Math.floor(phase * count / 1000));
}
