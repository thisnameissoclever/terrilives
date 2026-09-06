export const OBJECT_SOUND_ACTION_SHOWER_WATER = 1;
export const OBJECT_SOUND_ACTION_STOVE_COOKING = 2;

export type ObjectSoundAction =
  | typeof OBJECT_SOUND_ACTION_SHOWER_WATER
  | typeof OBJECT_SOUND_ACTION_STOVE_COOKING;

export type ObjectSoundCueEvent =
  | {
      readonly type: 'object.sound-started';
      readonly sourceId: number;
      readonly action: ObjectSoundAction;
    }
  | {
      readonly type: 'object.sound-stopped';
      readonly sourceId: number;
      readonly action: ObjectSoundAction;
    };

export interface ObjectSoundCueEventSink {
  emit(event: ObjectSoundCueEvent): void;
}

const INITIAL_TRACK_CAPACITY = 8;
const NO_SOUND_ACTION = 0;
const NO_SOUND_SOURCE = 0xffff_ffff;

/**
 * Converts aligned fixed-tick object sound state into source-owned edges.
 *
 * Several Sims may use one placed object. The object entity owns its sound, so
 * identical observations collapse into one start and one stop. Conflicting
 * actions on one source fail closed for the whole frame instead of allowing
 * render-row order to decide which sound wins.
 *
 * Tracks live in retained typed arrays rather than per-source JavaScript
 * objects. Normal begin, observe, and end operations allocate no collection or
 * object proportional to active source count after warm-up.
 */
export class ObjectSoundCueScheduler {
  private readonly slotBySourceId = new Map<number, number>();
  private sourceIds = new Float64Array(INITIAL_TRACK_CAPACITY);
  private activeActions = new Uint8Array(INITIAL_TRACK_CAPACITY);
  private observedActions = new Uint8Array(INITIAL_TRACK_CAPACITY);
  private seenGeneration = new Float64Array(INITIAL_TRACK_CAPACITY);
  private conflicted = new Uint8Array(INITIAL_TRACK_CAPACITY);
  private trackCount = 0;
  private generation = 0;
  private frameOpen = false;

  constructor(private readonly sink: ObjectSoundCueEventSink) {}

  beginFrame(): void {
    if (this.frameOpen) throw new Error('object sound frame is already open');
    this.frameOpen = true;
    if (this.generation >= Number.MAX_SAFE_INTEGER) {
      this.generation = 1;
      this.seenGeneration.fill(0, 0, this.trackCount);
    } else {
      this.generation += 1;
    }
  }

  observe(sourceId: number, action: number): void {
    if (!this.frameOpen) throw new Error('object sound frame is not open');
    if (!isSoundSource(sourceId) || !isObjectSoundAction(action)) return;

    let slot = this.slotBySourceId.get(sourceId);
    if (slot === undefined) {
      slot = this.addTrack(sourceId);
    }

    if (this.seenGeneration[slot] !== this.generation) {
      this.observedActions[slot] = action;
      this.seenGeneration[slot] = this.generation;
      this.conflicted[slot] = 0;
      return;
    }
    if (this.observedActions[slot] !== action) {
      this.observedActions[slot] = NO_SOUND_ACTION;
      this.conflicted[slot] = 1;
    }
  }

  endFrame(): void {
    if (!this.frameOpen) throw new Error('object sound frame is not open');
    this.frameOpen = false;
    let slot = 0;
    while (slot < this.trackCount) {
      const desiredAction =
        this.seenGeneration[slot] === this.generation &&
        this.conflicted[slot] === 0
          ? this.observedActions[slot]
          : NO_SOUND_ACTION;
      const activeAction = this.activeActions[slot];
      const sourceId = this.sourceIds[slot];

      if (activeAction !== desiredAction) {
        if (activeAction !== NO_SOUND_ACTION) {
          this.sink.emit({
            type: 'object.sound-stopped',
            sourceId,
            action: activeAction as ObjectSoundAction,
          });
        }
        if (desiredAction !== NO_SOUND_ACTION) {
          this.sink.emit({
            type: 'object.sound-started',
            sourceId,
            action: desiredAction as ObjectSoundAction,
          });
        }
        this.activeActions[slot] = desiredAction;
      }

      if (this.activeActions[slot] === NO_SOUND_ACTION) {
        this.removeTrack(slot);
      } else {
        slot += 1;
      }
    }
  }

  reset(): void {
    this.slotBySourceId.clear();
    this.trackCount = 0;
    this.frameOpen = false;
  }

  /** Retained-track diagnostic for the production stress harness. */
  activeTrackCount(): number {
    return this.trackCount;
  }

  /** Allocated typed-array capacity for the production stress harness. */
  trackCapacity(): number {
    return this.sourceIds.length;
  }

  private addTrack(sourceId: number): number {
    this.ensureCapacity(this.trackCount + 1);
    const slot = this.trackCount;
    this.trackCount += 1;
    this.slotBySourceId.set(sourceId, slot);
    this.sourceIds[slot] = sourceId;
    this.activeActions[slot] = NO_SOUND_ACTION;
    this.observedActions[slot] = NO_SOUND_ACTION;
    this.seenGeneration[slot] = 0;
    this.conflicted[slot] = 0;
    return slot;
  }

  private removeTrack(slot: number): void {
    const removedSourceId = this.sourceIds[slot];
    const lastSlot = this.trackCount - 1;
    this.slotBySourceId.delete(removedSourceId);
    if (slot !== lastSlot) {
      const movedSourceId = this.sourceIds[lastSlot];
      this.sourceIds[slot] = movedSourceId;
      this.activeActions[slot] = this.activeActions[lastSlot];
      this.observedActions[slot] = this.observedActions[lastSlot];
      this.seenGeneration[slot] = this.seenGeneration[lastSlot];
      this.conflicted[slot] = this.conflicted[lastSlot];
      this.slotBySourceId.set(movedSourceId, slot);
    }
    this.trackCount = lastSlot;
  }

  private ensureCapacity(required: number): void {
    if (required <= this.sourceIds.length) return;
    const capacity = Math.max(required, this.sourceIds.length * 2);
    this.sourceIds = growFloats(this.sourceIds, capacity);
    this.activeActions = growBytes(this.activeActions, capacity);
    this.observedActions = growBytes(this.observedActions, capacity);
    this.seenGeneration = growFloats(this.seenGeneration, capacity);
    this.conflicted = growBytes(this.conflicted, capacity);
  }
}

function isSoundSource(sourceId: number): boolean {
  return (
    Number.isSafeInteger(sourceId) &&
    sourceId >= 0 &&
    sourceId < NO_SOUND_SOURCE
  );
}

function isObjectSoundAction(action: number): action is ObjectSoundAction {
  return (
    action === OBJECT_SOUND_ACTION_SHOWER_WATER ||
    action === OBJECT_SOUND_ACTION_STOVE_COOKING
  );
}

function growBytes(source: Uint8Array, capacity: number): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(capacity);
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
