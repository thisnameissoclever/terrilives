// Test support for the activity log: twelve-word records built by field,
// and a source that hands them to a store the way the bridge does.

import { type ActivityLogSource, NONE, RECORD_WORDS } from '../src/ui/activity-log-store.js';

export interface RecordFields {
  seq: number;
  tick?: number;
  kind: number;
  triggers?: number;
  flags?: number;
  actor: number;
  other?: number;
  label?: number;
  label2?: number;
  parent?: number;
  values?: readonly number[];
}

export function record(fields: RecordFields): number[] {
  const values = fields.values ?? [];
  return [
    fields.seq,
    fields.tick ?? 0,
    (fields.kind & 0xff) | ((fields.triggers ?? 0) & 0xff) << 8 | (fields.flags ?? 0),
    fields.actor,
    fields.other ?? NONE,
    fields.label ?? NONE,
    fields.label2 ?? NONE,
    fields.parent ?? 0,
    ...[0, 1, 2, 3].map(slot => (values[slot] ?? 0) >>> 0),
  ];
}

/** Two signed sixteen-bit halves in one value word, low first, as the simulation packs them. */
export function pack(low: number, high: number): number {
  return ((low & 0xffff) | (high & 0xffff) << 16) | 0;
}

/** Hands queued records to the next drain, copying with the bridge's wrap. */
export class QueueSource implements ActivityLogSource {
  private queued: number[][] = [];

  push(...records: number[][]): this {
    this.queued.push(...records);
    return this;
  }

  takeActivityLog(into: Uint32Array, at: number): number {
    const slots = into.length / RECORD_WORDS;
    const records = this.queued;
    this.queued = [];
    records.forEach((words, offset) => into.set(words, ((at + offset) % slots) * RECORD_WORDS));
    return records.length;
  }
}
