export const ORDER_QUEUE_FULL_MESSAGE = 'That person\'s order queue is full';

export interface CommandFeedbackSource {
  takeIntentCapacityRejections(): number;
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
 * Consumes simulation-authored order failures after a full or paused drain.
 *
 * Input events only know that a command entered the staging queue. The sim
 * resolves the agent and applies ordered cancellation, replacement, and append
 * commands before it can know whether the per-person queue had room.
 */
export function reportCommandFeedback(
  source: CommandFeedbackSource,
  status: CommandFeedbackStatus,
  onRejected: (count: number) => void = () => {},
): number {
  const rejected = source.takeIntentCapacityRejections();
  if (rejected === 0) return 0;
  status.textContent = ORDER_QUEUE_FULL_MESSAGE;
  status.setAttribute('data-kind', 'error');
  onRejected(rejected);
  return rejected;
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
