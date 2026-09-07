import { EXERCISE_FRAME_TICKS } from '../frame.js';

export type SimActivityAudioState =
  | 'other'
  | 'conversation'
  | 'sleep'
  | 'eating'
  | 'reading'
  | 'exercise';

export const CONVERSATION_REPEAT_TICKS = 8;
export const SLEEP_REPEAT_TICKS = 30;

type PersonalActivityAudioState = 'eating' | 'reading' | 'exercise';

const INITIAL_PERSONAL_TRACK_CAPACITY = 8;
const PERSONAL_ACTIVITY_EATING = 1;
const PERSONAL_ACTIVITY_READING = 2;
const PERSONAL_ACTIVITY_EXERCISE = 3;

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
    }
  | {
      readonly type: 'sim.eating';
      readonly simId: number;
      readonly biteIndex: number;
    }
  | {
      readonly type: 'sim.page-turn';
      readonly simId: number;
      readonly pageIndex: number;
    }
  | {
      readonly type: 'sim.exercise';
      readonly simId: number;
      readonly repetitionIndex: number;
    };

export interface ActivityCueEventSink {
  emit(event: ActivityCueEvent): void;
}

/**
 * Converts fixed-tick activity state into sparse audio cues at the correct
 * ownership scope.
 *
 * Conversation and sleep are shared scenes. Emitting once per participant
 * would double a conversation and turn a bedroom into a pile of synchronized
 * breathing loops. The lowest stable Sim ID identifies each active scene, and
 * retained counters keep the cues audible without firing on every 10 Hz tick.
 * Eating, reading, and exercise belong to individual Sims, so each Sim retains
 * an independent cadence until the authored action changes or disappears.
 */
export class ActivityCueScheduler {
  private readonly seenSimIds = new Set<number>();
  private readonly personalSlotBySimId = new Map<number, number>();
  private personalSimIds = new Float64Array(INITIAL_PERSONAL_TRACK_CAPACITY);
  private personalStates = new Uint8Array(INITIAL_PERSONAL_TRACK_CAPACITY);
  private personalTicksRemaining = new Uint32Array(INITIAL_PERSONAL_TRACK_CAPACITY);
  private personalCueIndices = new Float64Array(INITIAL_PERSONAL_TRACK_CAPACITY);
  private personalSeenGeneration = new Float64Array(INITIAL_PERSONAL_TRACK_CAPACITY);
  private personalTrackCount = 0;
  private personalGeneration = 0;
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
    if (this.personalGeneration >= Number.MAX_SAFE_INTEGER) {
      this.personalGeneration = 1;
      this.personalSeenGeneration.fill(0, 0, this.personalTrackCount);
    } else {
      this.personalGeneration += 1;
    }
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

    if (isPersonalActivity(activity)) {
      this.observePersonalActivity(simId, activity);
    } else {
      const personalSlot = this.personalSlotBySimId.get(simId);
      if (personalSlot !== undefined) this.removePersonalTrack(personalSlot);
    }
  }

  endFrame(): void {
    if (!this.frameOpen) throw new Error('activity audio frame is not open');
    this.frameOpen = false;
    this.finishConversationFrame();
    this.finishSleepFrame();
    let slot = 0;
    while (slot < this.personalTrackCount) {
      if (this.personalSeenGeneration[slot] === this.personalGeneration) {
        slot += 1;
      } else {
        this.removePersonalTrack(slot);
      }
    }
  }

  reset(): void {
    this.seenSimIds.clear();
    this.personalSlotBySimId.clear();
    this.personalTrackCount = 0;
    this.personalGeneration = 0;
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

  /** Retained personal-activity tracks for the production stress harness. */
  activePersonalTrackCount(): number {
    return this.personalTrackCount;
  }

  /** Allocated personal-activity capacity for retained-memory acceptance. */
  personalTrackCapacity(): number {
    return this.personalSimIds.length;
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

  private observePersonalActivity(
    simId: number,
    state: PersonalActivityAudioState,
  ): void {
    const stateCode = personalActivityCode(state);
    let slot = this.personalSlotBySimId.get(simId);
    if (slot === undefined) {
      slot = this.addPersonalTrack(simId, stateCode, state);
      this.emitPersonalActivity(simId, slot);
      return;
    }

    this.personalSeenGeneration[slot] = this.personalGeneration;
    if (this.personalStates[slot] !== stateCode) {
      this.personalStates[slot] = stateCode;
      this.personalTicksRemaining[slot] = personalRepeatTicks(state);
      this.personalCueIndices[slot] = 0;
      this.emitPersonalActivity(simId, slot);
      return;
    }

    this.personalTicksRemaining[slot] -= 1;
    if (this.personalTicksRemaining[slot] > 0) return;
    this.personalTicksRemaining[slot] = personalRepeatTicks(state);
    this.personalCueIndices[slot] += 1;
    this.emitPersonalActivity(simId, slot);
  }

  private emitPersonalActivity(simId: number, slot: number): void {
    const cueIndex = this.personalCueIndices[slot];
    switch (this.personalStates[slot]) {
      case PERSONAL_ACTIVITY_EATING:
        this.sink.emit({
          type: 'sim.eating',
          simId,
          biteIndex: cueIndex,
        });
        return;
      case PERSONAL_ACTIVITY_READING:
        this.sink.emit({
          type: 'sim.page-turn',
          simId,
          pageIndex: cueIndex,
        });
        return;
      case PERSONAL_ACTIVITY_EXERCISE:
        this.sink.emit({
          type: 'sim.exercise',
          simId,
          repetitionIndex: cueIndex,
        });
    }
  }

  private addPersonalTrack(
    simId: number,
    stateCode: number,
    state: PersonalActivityAudioState,
  ): number {
    this.ensurePersonalCapacity(this.personalTrackCount + 1);
    const slot = this.personalTrackCount;
    this.personalTrackCount += 1;
    this.personalSlotBySimId.set(simId, slot);
    this.personalSimIds[slot] = simId;
    this.personalStates[slot] = stateCode;
    this.personalTicksRemaining[slot] = personalRepeatTicks(state);
    this.personalCueIndices[slot] = 0;
    this.personalSeenGeneration[slot] = this.personalGeneration;
    return slot;
  }

  private removePersonalTrack(slot: number): void {
    const removedSimId = this.personalSimIds[slot];
    const lastSlot = this.personalTrackCount - 1;
    this.personalSlotBySimId.delete(removedSimId);
    if (slot !== lastSlot) {
      const movedSimId = this.personalSimIds[lastSlot];
      this.personalSimIds[slot] = movedSimId;
      this.personalStates[slot] = this.personalStates[lastSlot];
      this.personalTicksRemaining[slot] = this.personalTicksRemaining[lastSlot];
      this.personalCueIndices[slot] = this.personalCueIndices[lastSlot];
      this.personalSeenGeneration[slot] = this.personalSeenGeneration[lastSlot];
      this.personalSlotBySimId.set(movedSimId, slot);
    }
    this.personalTrackCount = lastSlot;
  }

  private ensurePersonalCapacity(required: number): void {
    if (required <= this.personalSimIds.length) return;
    const capacity = Math.max(required, this.personalSimIds.length * 2);
    this.personalSimIds = growFloats(this.personalSimIds, capacity);
    this.personalStates = growBytes(this.personalStates, capacity);
    this.personalTicksRemaining = growWords(
      this.personalTicksRemaining,
      capacity,
    );
    this.personalCueIndices = growFloats(this.personalCueIndices, capacity);
    this.personalSeenGeneration = growFloats(
      this.personalSeenGeneration,
      capacity,
    );
  }
}

function isPersonalActivity(
  activity: SimActivityAudioState,
): activity is PersonalActivityAudioState {
  return (
    activity === 'eating' ||
    activity === 'reading' ||
    activity === 'exercise'
  );
}

function personalRepeatTicks(activity: PersonalActivityAudioState): number {
  switch (activity) {
    case 'eating':
      return 12;
    case 'reading':
      return 28;
    case 'exercise':
      return EXERCISE_FRAME_TICKS;
  }
}

function personalActivityCode(activity: PersonalActivityAudioState): number {
  switch (activity) {
    case 'eating':
      return PERSONAL_ACTIVITY_EATING;
    case 'reading':
      return PERSONAL_ACTIVITY_READING;
    case 'exercise':
      return PERSONAL_ACTIVITY_EXERCISE;
  }
}

function growBytes(source: Uint8Array, capacity: number): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(capacity);
  result.set(source);
  return result;
}

function growWords(
  source: Uint32Array<ArrayBufferLike>,
  capacity: number,
): Uint32Array<ArrayBuffer> {
  const result = new Uint32Array(capacity);
  result.set(source);
  return result;
}

function growFloats(
  source: Float64Array<ArrayBufferLike>,
  capacity: number,
): Float64Array<ArrayBuffer> {
  const result = new Float64Array(capacity);
  result.set(source);
  return result;
}
