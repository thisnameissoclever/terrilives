/** Session diagnostics stay outside simulation time and saved gameplay state. */
export interface OrderEvent {
  sequence: string;
  tick: string;
  actor: number;
  counterpart: number | null;
  orderId: string;
  action: string;
  phase: string;
  reason: string | null;
  blockingState: string | null;
}
export interface OrderEventBatch { events: OrderEvent[]; nextCursor: string; expired: boolean }
export interface OrderEventSource {
  orderEventsSince(cursor: string): OrderEventBatch;
  simName(entity: number): string;
}
export interface ActionQueueRow {
  orderId: string | null;
  label: string;
  phase: string;
  role: string;
  counterpart: number | null;
  reason: string | null;
}
/** Incoming conversations belong to their initiator; an autonomous row has no order identity. */
export function hasClearablePlayerOrders(source: {
  selectedIndex(): number | null;
  queuedOrdersOf(entity: number): number;
  actionQueueRowsOf(entity: number, maxRows?: number): readonly ActionQueueRow[];
}): boolean {
  const entity = source.selectedIndex();
  return entity !== null && (source.queuedOrdersOf(entity) > 0 || source.actionQueueRowsOf(entity, 1)
    .some(row => row.role === 'initiator' && row.orderId !== null));
}
export function formatOrderHistory(events: readonly OrderEvent[], entity: number | null, expired: boolean): string {
  const lines = expired ? ['Earlier events have expired from this session.'] : [];
  for (const event of events) {
    if (entity !== null && event.actor !== entity && event.counterpart !== entity) continue;
    lines.push(`${event.sequence} tick ${event.tick} | actor ${event.actor} -> ${event.counterpart ?? 'none'} | #${event.orderId} ${event.action}: ${event.phase}${event.reason ? ` | ${event.reason}` : ''}${event.blockingState ? ` | blocked: ${event.blockingState}` : ''}`);
  }
  return lines.join('\n') || 'No order events for this person.';
}
export class OrderDiagnostics {
  private cursor = '0';
  private readonly failures = new Map<number, number>();
  private records: OrderEvent[] = [];
  private expired = false;
  private generation = 0;
  private readonly names = new Map<number, string>();
  constructor(private readonly status: {textContent: string | null; setAttribute(name: string, value: string): void},
    private readonly warn: (message: string, event: OrderEvent) => void = (message, event) => console.warn(message, event)) {}
  update(nowMs: number, source: OrderEventSource): void {
    const batch = source.orderEventsSince(this.cursor);
    const previous = BigInt(this.cursor);
    const events = batch.events.filter(event => BigInt(event.sequence) > previous);
    this.cursor = batch.nextCursor;
    this.expired ||= batch.expired;
    if (events.length === 0) return;
    this.expired ||= this.records.length + events.length > 2048;
    this.records = [...this.records, ...events].slice(-2048);
    this.generation++;
    for (const event of events) {
      for (const actor of [event.actor, event.counterpart]) {
        if (actor !== null && !this.names.has(actor)) {
          const name = source.simName(actor);
          if (name) this.names.set(actor, name);
        }
      }
      if (event.phase !== 'failed' && event.phase !== 'rejected') continue;
      if (event.phase === 'failed') this.failures.set(event.actor, nowMs + 3000);
      const outcome = event.phase === 'failed' ? 'failed' : 'was not added';
      const message = `${source.simName(event.actor) || `Person ${event.actor}`}: ${event.action} ${outcome}. ${event.reason || 'The order could not be completed.'}`;
      this.status.textContent = message;
      this.status.setAttribute('data-kind', 'error');
      this.warn(message, event);
    }
    const retained = new Set<number>();
    for (const event of this.records) {
      retained.add(event.actor);
      if (event.counterpart !== null) retained.add(event.counterpart);
    }
    for (const actor of this.names.keys()) if (!retained.has(actor)) this.names.delete(actor);
  }
  failedActors(nowMs: number): ReadonlySet<number> {
    for (const [actor, until] of this.failures) if (until <= nowMs) this.failures.delete(actor);
    return new Set(this.failures.keys());
  }
  history(entity: number | null): string { return formatOrderHistory(this.records, entity, this.expired); }
  events(entity: number | null): readonly OrderEvent[] {
    return this.records.filter(event => entity === null || event.actor === entity || event.counterpart === entity);
  }
  actorName(entity: number): string {return this.names.get(entity) || `Person ${entity}`;}
  get historyExpired(): boolean {return this.expired;}
  copyHistory(entity: number | null): string {
    return [this.expired ? 'Earlier events have expired from this session.' : '',
      ...this.events(entity).map(event => JSON.stringify(event, null, 2))].filter(Boolean).join('\n') || 'No order events.';
  }
  resetAfterLoad(cursor: string): void {
    this.cursor = cursor;
    this.records = [];
    this.failures.clear();
    this.names.clear();
    this.expired = false;
    this.generation++;
  }
  get revision(): number { return this.generation; }
}
