import { MAX_ARCHITECTURE_FINISH_SLOT } from '../src/render/instances.js';

/** Shared CPU/GPU witnesses. Values are representable f32 inputs, including nonfinite bits. */
export const architectureModeVectors = [
  { label: 'zero', mode: 0, floor: null, slot: 0 },
  { label: 'negative zero', mode: -0, floor: null, slot: 0 },
  { label: 'footprint', mode: -1, floor: null, slot: 0 },
  { label: 'wall mask', mode: 15, floor: null, slot: 0 },
  { label: 'default wall', mode: -6, floor: false, slot: 0 },
  { label: 'default floor', mode: -7, floor: true, slot: 0 },
  { label: 'door surface', mode: -2, floor: null, slot: 0 },
  { label: 'dining background', mode: -3, floor: null, slot: 0 },
  { label: 'reserved four', mode: -4, floor: null, slot: 0 },
  { label: 'reserved five', mode: -5, floor: null, slot: 0 },
  { label: 'active wall', mode: -10, floor: false, slot: 1 },
  { label: 'active floor', mode: -15, floor: true, slot: 2 },
  { label: 'max wall', mode: -6 - 4 * MAX_ARCHITECTURE_FINISH_SLOT, floor: false, slot: MAX_ARCHITECTURE_FINISH_SLOT },
  { label: 'max floor', mode: -7 - 4 * MAX_ARCHITECTURE_FINISH_SLOT, floor: true, slot: MAX_ARCHITECTURE_FINISH_SLOT },
  { label: 'one past wall', mode: -6 - 4 * (MAX_ARCHITECTURE_FINISH_SLOT + 1), floor: null, slot: 0 },
  { label: 'one past floor', mode: -7 - 4 * (MAX_ARCHITECTURE_FINISH_SLOT + 1), floor: null, slot: 0 },
  { label: 'fractional wall', mode: -2.5, floor: null, slot: 0 },
  { label: 'fractional floor', mode: -3.25, floor: null, slot: 0 },
  { label: 'fraction below max', mode: -7.5 - 4 * MAX_ARCHITECTURE_FINISH_SLOT, floor: null, slot: 0 },
  { label: 'NaN', mode: NaN, floor: null, slot: 0 },
  { label: 'positive infinity', mode: Infinity, floor: null, slot: 0 },
  { label: 'negative infinity', mode: -Infinity, floor: null, slot: 0 },
] as const;
