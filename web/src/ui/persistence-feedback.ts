import { operationFeedback, type SceneFeedback } from './operation-feedback.js';
import type { PersistenceFeedbackEvent } from './persistence-controller.js';

type ProtectionHint = Pick<HTMLElement, 'hidden' | 'textContent'>;

/** Persistence uses the shared scene surface; protection remains beside its recovery controls. */
export class PersistenceSceneFeedback {
  private lastPublished: PersistenceFeedbackEvent | null = null;

  constructor(private readonly scene: SceneFeedback, private readonly protection: ProtectionHint) {}

  present(event: PersistenceFeedbackEvent): void {
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
}
