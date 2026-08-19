import type { GameAudioEventSink } from './audio-controller.js';

export const FOOTSTEP_DISTANCE_TILES = 0.42;
export const MAX_FOOTSTEPS_PER_UPDATE = 2;
const INITIAL_TRACK_CAPACITY = 8;
const DISTANCE_EPSILON_SCALE = 1e-9;

/**
 * Converts travelled world distance into semantic footstep events.
 *
 * Tracks live in aligned typed arrays rather than per-Sim JavaScript objects.
 * `beginFrame`, `observe`, and `endFrame` allocate no per-Sim tracking object
 * or collection proportional to agent count in steady state. Emitted semantic
 * events remain ordinary short-lived values. Missing Sims are removed in
 * place, and a lifecycle reset makes the next observation an anchor. Render
 * count and wall time never enter the phase.
 */
export class FootstepScheduler {
  private readonly slotBySimId = new Map<number, number>();
  private simIds = new Float64Array(INITIAL_TRACK_CAPACITY);
  private x = new Float64Array(INITIAL_TRACK_CAPACITY);
  private y = new Float64Array(INITIAL_TRACK_CAPACITY);
  private distanceSinceStep = new Float64Array(INITIAL_TRACK_CAPACITY);
  private nextStepIndex = new Float64Array(INITIAL_TRACK_CAPACITY);
  private seenGeneration = new Float64Array(INITIAL_TRACK_CAPACITY);
  private wasWalking = new Uint8Array(INITIAL_TRACK_CAPACITY);
  private trackCount = 0;
  private generation = 0;
  private frameOpen = false;

  constructor(
    private readonly sink: GameAudioEventSink,
    private readonly stepDistance = FOOTSTEP_DISTANCE_TILES,
  ) {
    if (!Number.isFinite(stepDistance) || stepDistance <= 0) {
      throw new Error('footstep distance must be positive');
    }
  }

  beginFrame(): void {
    if (this.frameOpen) throw new Error('footstep frame is already open');
    this.frameOpen = true;
    if (this.generation >= Number.MAX_SAFE_INTEGER) {
      this.generation = 1;
      this.seenGeneration.fill(0, 0, this.trackCount);
    } else {
      this.generation += 1;
    }
  }

  observe(simId: number, x: number, y: number, walking: boolean): void {
    if (!this.frameOpen) throw new Error('footstep frame is not open');
    if (
      !Number.isSafeInteger(simId) ||
      simId < 0 ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return;
    }

    let slot = this.slotBySimId.get(simId);
    if (slot === undefined) {
      slot = this.addTrack(simId, x, y, walking);
      return;
    }
    if (this.seenGeneration[slot] === this.generation) {
      throw new Error(`duplicate footstep sample for Sim ${simId}`);
    }
    this.seenGeneration[slot] = this.generation;

    if (!walking) {
      this.x[slot] = x;
      this.y[slot] = y;
      this.distanceSinceStep[slot] = 0;
      this.wasWalking[slot] = 0;
      return;
    }

    // Presentation actions may project the displayed body to an object socket.
    // The first WALK sample can therefore jump back to the ECS path position
    // without the Sim having travelled that distance. Re-anchor on the state
    // transition; only a second walking sample can complete a stride.
    if (this.wasWalking[slot] === 0) {
      this.x[slot] = x;
      this.y[slot] = y;
      this.distanceSinceStep[slot] = 0;
      this.wasWalking[slot] = 1;
      return;
    }

    const travelled = Math.hypot(x - this.x[slot], y - this.y[slot]);
    const totalDistance = this.distanceSinceStep[slot] + travelled;
    const crossedSteps = Math.floor(
      (totalDistance + this.stepDistance * DISTANCE_EPSILON_SCALE) /
        this.stepDistance,
    );
    const emittedSteps = Math.min(crossedSteps, MAX_FOOTSTEPS_PER_UPDATE);
    const firstStepIndex = this.nextStepIndex[slot];

    for (let index = 0; index < emittedSteps; index += 1) {
      this.sink.emit({
        type: 'sim.footstep',
        simId,
        stepIndex: firstStepIndex + index,
      });
    }

    this.x[slot] = x;
    this.y[slot] = y;
    // Keep only the fractional stride. A skipped burst is discarded rather
    // than queued for later updates, which prevents delayed machine-gun feet.
    this.distanceSinceStep[slot] = Math.max(
      0,
      totalDistance - crossedSteps * this.stepDistance,
    );
    this.nextStepIndex[slot] = firstStepIndex + crossedSteps;
  }

  endFrame(): void {
    if (!this.frameOpen) throw new Error('footstep frame is not open');
    this.frameOpen = false;
    let slot = 0;
    while (slot < this.trackCount) {
      if (this.seenGeneration[slot] === this.generation) {
        slot += 1;
      } else {
        this.removeTrack(slot);
      }
    }
  }

  reset(): void {
    this.slotBySimId.clear();
    this.trackCount = 0;
    this.frameOpen = false;
  }

  private addTrack(simId: number, x: number, y: number, walking: boolean): number {
    this.ensureCapacity(this.trackCount + 1);
    const slot = this.trackCount;
    this.trackCount += 1;
    this.slotBySimId.set(simId, slot);
    this.simIds[slot] = simId;
    this.x[slot] = x;
    this.y[slot] = y;
    this.distanceSinceStep[slot] = 0;
    this.nextStepIndex[slot] = 0;
    this.seenGeneration[slot] = this.generation;
    this.wasWalking[slot] = walking ? 1 : 0;
    return slot;
  }

  private removeTrack(slot: number): void {
    const removedSimId = this.simIds[slot];
    const lastSlot = this.trackCount - 1;
    this.slotBySimId.delete(removedSimId);
    if (slot !== lastSlot) {
      const movedSimId = this.simIds[lastSlot];
      this.simIds[slot] = movedSimId;
      this.x[slot] = this.x[lastSlot];
      this.y[slot] = this.y[lastSlot];
      this.distanceSinceStep[slot] = this.distanceSinceStep[lastSlot];
      this.nextStepIndex[slot] = this.nextStepIndex[lastSlot];
      this.seenGeneration[slot] = this.seenGeneration[lastSlot];
      this.wasWalking[slot] = this.wasWalking[lastSlot];
      this.slotBySimId.set(movedSimId, slot);
    }
    this.trackCount = lastSlot;
  }

  private ensureCapacity(required: number): void {
    if (required <= this.simIds.length) return;
    const capacity = Math.max(required, this.simIds.length * 2);
    this.simIds = grow(this.simIds, capacity);
    this.x = grow(this.x, capacity);
    this.y = grow(this.y, capacity);
    this.distanceSinceStep = grow(this.distanceSinceStep, capacity);
    this.nextStepIndex = grow(this.nextStepIndex, capacity);
    this.seenGeneration = grow(this.seenGeneration, capacity);
    this.wasWalking = growBytes(this.wasWalking, capacity);
  }
}

function growBytes(source: Uint8Array, capacity: number): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(capacity);
  result.set(source);
  return result;
}

function grow(
  source: Float64Array<ArrayBufferLike>,
  capacity: number,
): Float64Array<ArrayBuffer> {
  const result = new Float64Array(capacity);
  result.set(source);
  return result;
}
