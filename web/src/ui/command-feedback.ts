export const ORDER_QUEUE_FULL_MESSAGE = 'That person\'s order queue is full';
/**
 * "Last in line" rather than "last waiting": after enough plain clicks the
 * order at the back of a full queue is the one the sim is carrying out, and
 * that is what falls off. Both cases are the order that would have run last.
 */
export const ORDER_DISPLACED_MESSAGE =
  'That person\'s order queue was full, so the order last in line was dropped';

export interface CommandFeedbackSource {
  /** Orders refused at the per-sim cap: nothing was added. */
  takeIntentCapacityRejections(): number;
  /**
   * Orders dropped from the back of a full queue to make room for a
   * front-placed order, whether the dropped order was waiting or being
   * carried out: the new order WAS added, an older one fell off.
   */
  takeIntentDisplacements(): number;
}

export interface CommandFeedbackStatus {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * Starts one visible order attempt with an empty announcement region.
 *
 * The attempt and the later simulation drain happen in separate browser
 * turns. Clearing here gives a repeated identical rejection a real DOM state
 * transition, while the dedicated surface keeps persistence messages under
 * their own owner.
 */
export function clearCommandFeedback(status: CommandFeedbackStatus): void {
  status.textContent = '';
  status.removeAttribute('data-kind');
}

/**
 * Consumes simulation-authored order outcomes after a full or paused drain.
 *
 * Input events only know that a command entered the staging queue. The sim
 * resolves the agent and applies the batch, in issue order, before it can
 * know whether the per-person queue had room - and, for a front placement,
 * whether making room cost an older order.
 *
 * Two outcomes, two sentences, because they are opposites for the player: a
 * REJECTION means the order they just gave was refused, a DISPLACEMENT means
 * it went in and the order that would have run last fell off. When one drain
 * produced both, the rejection is shown: it is the one the player has to act
 * on, since a refused order has to be given again. `onRejected` receives the
 * combined count, which is what the audio cue keys on: the cue means "an
 * order did not survive this drain", which is true of a drop as much as of a
 * refusal, and the click that caused the drop already played the staged cue
 * for the order that did go in.
 */
export function reportCommandFeedback(
  source: CommandFeedbackSource,
  status: CommandFeedbackStatus,
  onRejected: (count: number) => void = () => {},
): number {
  const rejected = source.takeIntentCapacityRejections();
  const displaced = source.takeIntentDisplacements();
  const total = rejected + displaced;
  if (total === 0) return 0;
  status.textContent = rejected > 0 ? ORDER_QUEUE_FULL_MESSAGE : ORDER_DISPLACED_MESSAGE;
  status.setAttribute('data-kind', 'error');
  onRejected(total);
  return total;
}

/**
 * Pins the cross-owner part of one frame: apply staged commands, publish any
 * persistence transition, then consume simulation-authored command feedback.
 */
export function advanceFrameWithCommandFeedback<T>(
  advanceSimulation: () => T,
  updatePersistence: () => void,
  source: CommandFeedbackSource,
  status: CommandFeedbackStatus,
  onRejected: (count: number) => void = () => {},
): T {
  const result = advanceSimulation();
  updatePersistence();
  reportCommandFeedback(source, status, onRejected);
  return result;
}
