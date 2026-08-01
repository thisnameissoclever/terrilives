/**
 * The developer stats overlay - every sim's hidden state on one panel.
 *
 * Asked for in the [A-11] play report as "background details for all of
 * the Sims, just for developer debugging type stuff", and it earns its
 * place beyond debugging: personalities and relationships are invisible
 * in ordinary play precisely because they are multipliers on decisions
 * rather than pictures, so this panel is where "Nadia's social drains
 * 1.4x" stops being a claim in a TOML comment.
 *
 * Same shape as the needs panel and for its reasons: a structural
 * source interface so the formatting is testable in Node without a
 * bridge, one throttle timestamp as the only state, and every read
 * going back to the source per [D-5]. The whole report renders into one
 * text node per refresh - at three sims that is cheaper than managing
 * rows, and there is nothing to get wrong.
 */

/** What the panel reads. `SimBridge` satisfies it structurally. */
export interface DebugSource {
  readonly count: number;
  kinds(): Uint32Array;
  ids(): Uint32Array;
  activities(): Uint32Array;
  simName(entityIndex: number): string;
  simIdOf(entityIndex: number): number | null;
  /** The M2e second axis, or null for a sim with no ledger. */
  satisfactionOf(entityIndex: number): number | null;
  needsOf(entityIndex: number): Float32Array;
  personalityOf(entityIndex: number): Float32Array;
  relationshipsOf(entityIndex: number): Float32Array;
  needNames(): readonly string[];
}

/** The one DOM dependency, structural like the needs panel's. */
export interface DebugRoot {
  hidden: boolean;
  textContent: string | null;
}

const KIND_AGENT = 0;

const ACTIVITY_NAMES = [
  'idle',
  'walking',
  'waiting',
  'eating',
  'talking',
  'sleeping',
] as const;

/**
 * The whole report as text. Pure, so the tests pin every branch - the
 * unknown-SimId fallback, the pair decoding, the odd-tail tolerance -
 * without a document.
 */
export function formatDebugReport(source: DebugSource): string {
  const kinds = source.kinds();
  const ids = source.ids();
  const activities = source.activities();

  // First pass: who exists, so relationships can print names instead of
  // raw SimIds. An id nothing live carries - a stale feeling about the
  // departed - prints as `sim#<id>` rather than being dropped, because
  // a debug panel that hides data is worse than none.
  const agents: number[] = [];
  const nameBySimId = new Map<number, string>();
  for (let row = 0; row < source.count; row++) {
    if (kinds[row] !== KIND_AGENT) continue;
    agents.push(row);
    const simId = source.simIdOf(ids[row]);
    if (simId !== null) {
      nameBySimId.set(simId, source.simName(ids[row]) || `sim#${simId}`);
    }
  }

  const needNames = source.needNames();
  const lines: string[] = [];
  for (const row of agents) {
    const entity = ids[row];
    const simId = source.simIdOf(entity);
    const name = source.simName(entity) || `entity ${entity}`;
    lines.push(
      `${name}  (entity ${entity}, SimId ${simId ?? 'none'})  ${
        ACTIVITY_NAMES[activities[row]] ?? `activity ${activities[row]}`
      }`,
    );

    // The second axis, right under the identity line: it is the number
    // the whole M2e loop is ABOUT, and burying it under seven need bars
    // would make the overlay say the background is the game. "life
    // satisfaction" rather than bare "satisfaction", because the
    // personality block below already uses that word for its refill
    // multipliers and a debug panel must not make its reader guess
    // which sense a line means.
    const satisfaction = source.satisfactionOf(entity);
    if (satisfaction !== null) {
      lines.push(`  life satisfaction: ${satisfaction.toFixed(1)}`);
    }

    const needs = source.needsOf(entity);
    const needsLine = Array.from(needs)
      .map((level, i) => `${needNames[i] ?? `need${i}`} ${level.toFixed(1)}`)
      .join('  ');
    if (needsLine) lines.push(`  needs: ${needsLine}`);

    const personality = source.personalityOf(entity);
    if (personality.length === needNames.length * 2) {
      const half = needNames.length;
      const fmt = (values: Float32Array | number[]): string =>
        Array.from(values)
          .map((v, i) => `${needNames[i]} ${Number(v).toFixed(2)}`)
          .join('  ');
      lines.push(`  drain: ${fmt(personality.subarray(0, half))}`);
      lines.push(`  satisfaction: ${fmt(personality.subarray(half))}`);
    }

    const pairs = source.relationshipsOf(entity);
    const feelings: string[] = [];
    // An odd trailing element is ignored rather than crashing the
    // panel: the interleaving is a boundary contract, and a debug tool
    // must survive the exact bugs it exists to reveal.
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const otherId = pairs[i];
      const toward = nameBySimId.get(otherId) ?? `sim#${otherId}`;
      const feeling = pairs[i + 1];
      feelings.push(`${toward} ${feeling >= 0 ? '+' : ''}${feeling.toFixed(2)}`);
    }
    lines.push(feelings.length ? `  feels: ${feelings.join(', ')}` : '  feels: nobody yet');
    lines.push('');
  }
  return lines.join('\n');
}

/** The panel: a throttle around `formatDebugReport`, nothing more. */
export class DebugPanel {
  private lastReadMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly source: DebugSource,
    private readonly root: DebugRoot,
    private readonly refreshMs: number,
  ) {}

  toggle(): void {
    this.root.hidden = !this.root.hidden;
    // A panel opened after a quiet stretch shows NOW, not the stale
    // report from before it was hidden.
    this.lastReadMs = Number.NEGATIVE_INFINITY;
  }

  update(nowMs: number): void {
    if (this.root.hidden) return;
    if (nowMs - this.lastReadMs < this.refreshMs) return;
    this.lastReadMs = nowMs;
    this.root.textContent = formatDebugReport(this.source);
  }
}
