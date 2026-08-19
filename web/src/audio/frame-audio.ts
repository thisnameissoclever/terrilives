import { VISUAL_ACTION_WALK } from '../frame.js';
import { KIND_AGENT } from '../render/instances.js';

export interface FootstepFrameSource {
  readonly count: number;
  positions(): Float32Array;
  kinds(): Uint32Array;
  ids(): Uint32Array;
  visualActions(): Uint32Array;
  simIdOf(entityIndex: number): number | null;
}

export interface FootstepFrameSink {
  beginFootstepFrame(): void;
  observeFootstep(simId: number, x: number, y: number, walking: boolean): void;
  endFootstepFrame(): void;
}

const NO_SIM_ID = 0xffff_ffff;

/**
 * Stable identity lookup kept outside the fixed-tick hot path.
 *
 * `simIdOf` crosses into WASM and currently scans the simulation's Sim-id
 * components. Calling it once per rendered agent on every tick would become
 * quadratic as a town grows. Rebuild this typed lookup after startup and a
 * successful Load; the current simulation has no runtime birth or despawn
 * path. A future dynamic roster must rebuild it when topology changes.
 */
export class FootstepIdentityLookup {
  private entityIds = new Uint32Array(0);
  private simIds = new Uint32Array(0);
  private rows = 0;

  rebuild(source: FootstepFrameSource): void {
    const count = source.count;
    this.ensureCapacity(count);
    // `simIdOf` is another WASM call and may allocate. Copy these primitive
    // columns before it can grow memory and detach the zero-copy views halfway
    // through this rebuild. The bounded allocation occurs only at startup and
    // after Load, never in the fixed-tick sampler.
    const kinds = Uint32Array.from(source.kinds());
    const ids = Uint32Array.from(source.ids());
    for (let row = 0; row < count; row += 1) {
      const entityId = ids[row];
      this.entityIds[row] = entityId;
      if (kinds[row] !== KIND_AGENT) {
        this.simIds[row] = NO_SIM_ID;
        continue;
      }
      const simId = source.simIdOf(entityId);
      this.simIds[row] = simId ?? NO_SIM_ID;
    }
    this.rows = count;
  }

  simIdAt(row: number, entityId: number): number | null {
    if (row >= this.rows || this.entityIds[row] !== entityId) return null;
    const simId = this.simIds[row];
    return simId === NO_SIM_ID ? null : simId;
  }

  private ensureCapacity(required: number): void {
    if (required <= this.entityIds.length) return;
    let capacity = Math.max(16, this.entityIds.length);
    while (capacity < required) capacity *= 2;
    this.entityIds = new Uint32Array(capacity);
    this.simIds = new Uint32Array(capacity);
    this.simIds.fill(NO_SIM_ID);
  }
}

/**
 * Samples stable Sim identity and travelled world position after one fixed tick.
 *
 * This is deliberately columnar. It creates no per-Sim object or array, and it
 * re-reads every WASM-backed view after the tick that may have grown memory.
 * Stable ids come from the lookup built outside the hot path; using an entity
 * id or row as identity would swap footsteps between people after a Load.
 */
export function sampleFootstepsAfterTick(
  source: FootstepFrameSource,
  sink: FootstepFrameSink,
  identities: FootstepIdentityLookup,
): void {
  const count = source.count;
  const positions = source.positions();
  const kinds = source.kinds();
  const ids = source.ids();
  const visualActions = source.visualActions();

  sink.beginFootstepFrame();
  try {
    for (let row = 0; row < count; row += 1) {
      if (kinds[row] !== KIND_AGENT) continue;
      const simId = identities.simIdAt(row, ids[row]);
      if (simId === null) continue;
      sink.observeFootstep(
        simId,
        positions[row * 2],
        positions[row * 2 + 1],
        visualActions[row] === VISUAL_ACTION_WALK,
      );
    }
  } finally {
    sink.endFootstepFrame();
  }
}
