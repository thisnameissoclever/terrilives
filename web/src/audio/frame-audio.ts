import { VISUAL_ACTION_WALK } from '../frame.js';
export interface FootstepFrameSource {
  readonly count: number;
  positions(): Float32Array;
  simIds(): Uint32Array;
  visualActions(): Uint32Array;
}

export interface FootstepFrameSink {
  beginFootstepFrame(): void;
  observeFootstep(simId: number, x: number, y: number, walking: boolean): void;
  endFootstepFrame(): void;
}

const NO_SIM_ID = 0xffff_ffff;

/**
 * Samples stable Sim identity and travelled world position after one fixed tick.
 *
 * This is deliberately columnar. It creates no per-Sim object or array, and it
 * re-reads every WASM-backed view after the tick that may have grown memory.
 * Stable ids come from the render buffer's aligned identity column; using an
 * entity id or row as identity would swap footsteps between people after Load.
 */
export function sampleFootstepsAfterTick(
  source: FootstepFrameSource,
  sink: FootstepFrameSink,
): void {
  const count = source.count;
  const positions = source.positions();
  const simIds = source.simIds();
  const visualActions = source.visualActions();

  sink.beginFootstepFrame();
  try {
    for (let row = 0; row < count; row += 1) {
      const simId = simIds[row];
      if (simId === NO_SIM_ID) continue;
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
