/** The player-facing clock, household and selected-sim summary. */

export interface GameHudSource {
  selectedIndex(): number | null;
  satisfactionOf(entityIndex: number): number | null;
  careerOf(entityIndex: number): string | null;
  activityOf(entityIndex: number): number | null;
  chainStatusOf(entityIndex: number): string | null;
  stallReasonOf(entityIndex: number): string | null;
  queuedOrdersOf(entityIndex: number): number;
  funds(): number;
  clockTick(): number;
  dayTicks(): number;
}

export interface TextTarget {
  textContent: string | null;
  hidden?: boolean;
}

export interface GameHudRoots {
  readonly clock: TextTarget;
  readonly funds: TextTarget;
  readonly satisfaction: TextTarget;
  readonly careerRow: TextTarget;
  readonly career: TextTarget;
  readonly activity: TextTarget;
  readonly ordersRow: TextTarget;
  readonly orders: TextTarget;
}

const ACTIVITY_NAMES = [
  'Deciding what to do',
  'Walking',
  'Waiting',
  'Eating',
  'Talking',
  'Sleeping',
  'At work',
  'Using object',
  'Reading',
] as const;

export function formatActivity(
  activity: number | null,
  chain: string | null,
  stalled: string | null,
): string {
  if (chain !== null) return chain;
  if (stalled !== null) return `Waiting: ${stalled}`;
  if (activity === null) return 'Nothing selected';
  return ACTIVITY_NAMES[activity] ?? `Activity ${activity}`;
}

/** Formats the simulation clock without borrowing the player's wall clock. */
export function formatSimTime(tick: number, dayTicks: number): string {
  if (!Number.isFinite(tick) || !Number.isFinite(dayTicks) || dayTicks <= 0) {
    return 'Day and time unavailable';
  }
  const safeTick = Math.max(0, Math.floor(tick));
  const safeDayTicks = Math.max(1, Math.floor(dayTicks));
  const day = Math.floor(safeTick / safeDayTicks) + 1;
  const tickInDay = safeTick % safeDayTicks;
  const minute = Math.floor((tickInDay * 1440) / safeDayTicks);
  const hours = Math.floor(minute / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (minute % 60).toString().padStart(2, '0');
  return `Day ${day}, ${hours}:${minutes}`;
}

export function formatFunds(value: number): string {
  if (!Number.isFinite(value)) return 'unavailable';
  return Math.trunc(value).toLocaleString('en-US');
}

export function formatSatisfaction(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'unavailable' : value.toFixed(1);
}

/**
 * Reads the durable player-facing state at the existing HUD cadence.
 */
export class GameHud {
  private lastReadMs: number | null = null;

  constructor(
    private readonly roots: GameHudRoots,
    private readonly refreshMs: number,
  ) {
    if (!Number.isFinite(refreshMs) || refreshMs <= 0) {
      throw new Error('HUD refresh interval must be positive');
    }
  }

  update(nowMs: number, source: GameHudSource): boolean {
    if (this.lastReadMs !== null && nowMs - this.lastReadMs < this.refreshMs) {
      return false;
    }
    this.lastReadMs = nowMs;

    this.roots.clock.textContent = formatSimTime(
      source.clockTick(),
      source.dayTicks(),
    );
    this.roots.funds.textContent = formatFunds(source.funds());

    const selected = source.selectedIndex();
    const satisfaction =
      selected === null ? null : source.satisfactionOf(selected);
    this.roots.satisfaction.textContent = formatSatisfaction(satisfaction);

    const career = selected === null ? null : source.careerOf(selected);
    this.roots.careerRow.hidden = career === null;
    this.roots.career.textContent = career ?? '';

    const activity = selected === null ? null : source.activityOf(selected);
    const chain = selected === null ? null : source.chainStatusOf(selected);
    const stalled = selected === null ? null : source.stallReasonOf(selected);
    this.roots.activity.textContent = formatActivity(activity, chain, stalled);

    const queued = selected === null ? 0 : source.queuedOrdersOf(selected);
    this.roots.ordersRow.hidden = queued === 0;
    this.roots.orders.textContent = String(queued);
    return true;
  }
}
