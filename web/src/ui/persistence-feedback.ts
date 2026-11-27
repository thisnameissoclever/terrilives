import { operationFeedback, type SceneFeedback } from './operation-feedback.js';
import { exportSuccessKeepsFailure, type PersistenceFeedbackEvent } from './persistence-controller.js';

type ProtectionHint = Pick<HTMLElement, 'hidden' | 'textContent'>;

/** Persistence uses the shared scene surface; protection remains beside its recovery controls. */
export class PersistenceSceneFeedback {
  private lastPublished: PersistenceFeedbackEvent | null = null;

  constructor(private readonly scene: SceneFeedback, private readonly protection: ProtectionHint) {}

  present(event: PersistenceFeedbackEvent): void {
    // A late "Game exported" must not cover a save failure from while the
    // dialog was open. Automatic "Saving" does not replace that failure, so
    // the check uses the note actually on screen.
    if (exportSuccessKeepsFailure(event, this.visibleFailureNote())) return;

    this.protection.hidden = !event.savingPaused;
    if (!event.savingPaused) this.protection.textContent = '';
    else if (event.state === 'failure') this.protection.textContent = event.message;

    if (event.automatic && event.state !== 'failure') {
      if (event.state === 'success' && this.lastPublished?.operation === 'save' && this.lastPublished.state === 'failure') {
        this.scene.clear('persistence');
        this.lastPublished = null;
      }
      return;
    }
    if (event.operation === 'restore' && event.state !== 'failure') return;

    this.lastPublished = event;
    if (!event.message) {
      this.scene.clear('persistence');
      return;
    }
    const feedback = operationFeedback(event.operation, event.state, 'Saved game', event.message,
      event.state === 'failure' ? 'retry' : undefined);
    this.scene.present('persistence', { ...feedback, expectedSlow: event.operation === 'load' }, null);
  }

  /** The failure note currently on screen, by the order it was published. */
  private visibleFailureNote(): number | undefined {
    const shown = this.lastPublished;
    if (!shown || shown.state !== 'failure' || shown.message === '') return undefined;
    return shown.failureNote;
  }
}
