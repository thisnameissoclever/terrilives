/** Simulation-owned activity context, independent of the selected person's labels. */
export interface ActivityStatus {
  readonly code: number;
  readonly partner: number | null;
  readonly needs: number;
}

export function decodeActivityStatus(values: Uint32Array): ActivityStatus | null {
  if (values.length !== 3 || values[0] > 8 || values[2] > 127) return null;
  return { code: values[0], partner: values[1] === 0xffffffff ? null : values[1], needs: values[2] };
}

export function activityStatusLabel(status: ActivityStatus, partnerName: string, needNames: readonly string[] = []): string | null {
  const name = partnerName || 'another Sim';
  switch (status.code) {
    case 1: return `Walking to talk to ${name}`;
    case 2: return `Waiting to talk to ${name}`;
    case 3: return `Waiting for ${name} to return from work`;
    case 4: return `Waiting outside to talk to ${name}`;
    case 5: return `No route to ${name}`;
    case 6: {
      const needs = needNames.filter((_, index) => (status.needs & (1 << index)) !== 0);
      return needs.length ? `No available relief for ${needs.join(', ')}` : 'No available relief for a critical need';
    }
    case 7: return 'Pausing between walks';
    case 8: return 'Idle';
    default: return null;
  }
}
