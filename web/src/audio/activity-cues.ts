export type SimActivityAudioState = 'other' | 'conversation' | 'sleep';

export const CONVERSATION_REPEAT_TICKS = 8;
export const SLEEP_REPEAT_TICKS = 30;

export type ActivityCueEvent =
  | {
      readonly type: 'sim.conversation';
      readonly simId: number;
      readonly phraseIndex: number;
    }
  | {
      readonly type: 'sim.sleep-breath';
      readonly simId: number;
      readonly breathIndex: number;
    };

export interface ActivityCueEventSink {
  emit(event: ActivityCueEvent): void;
}

/**
 * Converts fixed-tick activity state into sparse, household-level audio cues.
 *
 * Conversation and sleep are shared scenes. Emitting once per participant
 * would double a conversation and turn a bedroom into a pile of synchronized
 * breathing loops. The lowest stable Sim ID identifies each active scene, and
 * retained counters keep the cues audible without firing on every 10 Hz tick.
 */
export class ActivityCueScheduler {
  private readonly seenSimIds = new Set<number>();
  private frameOpen = false;
  private conversationSimId = Number.MAX_SAFE_INTEGER;
  private sleepingSimId = Number.MAX_SAFE_INTEGER;
  private conversationActive = false;
  private sleepActive = false;
  private conversationTicksRemaining = 0;
  private sleepTicksRemaining = 0;
  private phraseIndex = 0;
  private breathIndex = 0;

  constructor(private readonly sink: ActivityCueEventSink) {}

  beginFrame(): void {
    if (this.frameOpen) throw new Error('activity audio frame is already open');
    this.frameOpen = true;
    this.seenSimIds.clear();
    this.conversationSimId = Number.MAX_SAFE_INTEGER;
    this.sleepingSimId = Number.MAX_SAFE_INTEGER;
  }

  observe(simId: number, activity: SimActivityAudioState): void {
    if (!this.frameOpen) throw new Error('activity audio frame is not open');
    if (!Number.isSafeInteger(simId) || simId < 0) return;
    if (this.seenSimIds.has(simId)) {
      throw new Error(`duplicate activity sample for Sim ${simId}`);
    }
    this.seenSimIds.add(simId);

    if (activity === 'conversation') {
      this.conversationSimId = Math.min(this.conversationSimId, simId);
    } else if (activity === 'sleep') {
      this.sleepingSimId = Math.min(this.sleepingSimId, simId);
    }
  }

  endFrame(): void {
    if (!this.frameOpen) throw new Error('activity audio frame is not open');
    this.frameOpen = false;
    this.finishConversationFrame();
    this.finishSleepFrame();
  }

  reset(): void {
    this.seenSimIds.clear();
    this.frameOpen = false;
    this.conversationSimId = Number.MAX_SAFE_INTEGER;
    this.sleepingSimId = Number.MAX_SAFE_INTEGER;
    this.conversationActive = false;
    this.sleepActive = false;
    this.conversationTicksRemaining = 0;
    this.sleepTicksRemaining = 0;
    this.phraseIndex = 0;
    this.breathIndex = 0;
  }

  private finishConversationFrame(): void {
    if (this.conversationSimId === Number.MAX_SAFE_INTEGER) {
      this.conversationActive = false;
      this.conversationTicksRemaining = 0;
      this.phraseIndex = 0;
      return;
    }

    if (!this.conversationActive) {
      this.conversationActive = true;
      this.conversationTicksRemaining = CONVERSATION_REPEAT_TICKS;
      this.phraseIndex = 0;
      this.emitConversation();
      return;
    }

    this.conversationTicksRemaining -= 1;
    if (this.conversationTicksRemaining > 0) return;
    this.conversationTicksRemaining = CONVERSATION_REPEAT_TICKS;
    this.phraseIndex += 1;
    this.emitConversation();
  }

  private finishSleepFrame(): void {
    if (this.sleepingSimId === Number.MAX_SAFE_INTEGER) {
      this.sleepActive = false;
      this.sleepTicksRemaining = 0;
      this.breathIndex = 0;
      return;
    }

    if (!this.sleepActive) {
      this.sleepActive = true;
      this.sleepTicksRemaining = SLEEP_REPEAT_TICKS;
      this.breathIndex = 0;
      this.emitSleepBreath();
      return;
    }

    this.sleepTicksRemaining -= 1;
    if (this.sleepTicksRemaining > 0) return;
    this.sleepTicksRemaining = SLEEP_REPEAT_TICKS;
    this.breathIndex += 1;
    this.emitSleepBreath();
  }

  private emitConversation(): void {
    this.sink.emit({
      type: 'sim.conversation',
      simId: this.conversationSimId,
      phraseIndex: this.phraseIndex,
    });
  }

  private emitSleepBreath(): void {
    this.sink.emit({
      type: 'sim.sleep-breath',
      simId: this.sleepingSimId,
      breathIndex: this.breathIndex,
    });
  }
}
