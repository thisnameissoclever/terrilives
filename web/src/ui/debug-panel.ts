/**
 * The developer stats overlay - every sim's hidden state on one panel.
 *
 * Asked for in the [A-11] play report as "background details for all of
 * the Sims, just for developer debugging type stuff", and it earns its
 * place beyond debugging: personalities remain invisible in ordinary play,
 * while this still shows every sim's exact relationship floats rather than
 * the normal People panel's qualitative bands. It is where "Casey's social
 * drains 1.4x" stops being a claim in a TOML comment.
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
  /** The household's money - E4. World state, printed once at the top. */
  funds(): number;
  /** Interleaved [pack trait index, state, ...] pairs, or empty - E3. */
  traitsOf(entityIndex: number): Float32Array;
  /** One label per pack trait, aligned with traitKinds. */
  traitLabels(): string[];
  /** "disposition" | "capability" | "condition" per pack trait. */
  traitKinds(): string[];
  /** The sim's job label, or null for the unemployed - E4. */
  careerOf(entityIndex: number): string | null;
  /** The sim's mid-errand status line, or null when it is not on one - K4. */
  chainStatusOf(entityIndex: number): string | null;
  /** Why the sim is not acting, or null when nothing holds it back. */
  stallReasonOf(entityIndex: number): string | null;
  /** How many player orders the sim still has waiting; 0 for none. */
  queuedOrdersOf(entityIndex: number): number;
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
  'at work',
] as const;

/** How a trait's mutable state is worded, by kind. A disposition's 0 is
 * meaningless (it carries no state) and prints nothing. */
function traitStateLabel(kind: string, state: number): string {
  if (kind === 'capability') return `, level ${state.toFixed(2)}`;
  if (kind === 'condition') return `, severity ${state.toFixed(2)}`;
  return '';
}

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
  const traitLabels = source.traitLabels();
  const traitKinds = source.traitKinds();
  const lines: string[] = [];
  // Household state before anybody's: the money is the lot's, and a
  // reader scanning for it should not have to pick a sim first.
  lines.push(`household funds: ${source.funds()}`);
  lines.push('');
  for (const row of agents) {
    const entity = ids[row];
    const simId = source.simIdOf(entity);
    const name = source.simName(entity) || `entity ${entity}`;
    // "doing: walking" rather than a bare "walking" hanging off the
    // identity - every value in this panel carries a label saying what
    // it is, including this one.
    lines.push(
      `${name}  (entity ${entity}, SimId ${simId ?? 'none'})  doing: ${
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

    // The job, then the outfit - the two M2e PR 3 reads, between the
    // axis they act on and the needs they compete with.
    const career = source.careerOf(entity);
    if (career !== null) {
      lines.push(`  career: ${career}`);
    }
    const chain = source.chainStatusOf(entity);
    if (chain !== null) {
      lines.push(`  chain: ${chain}`);
    }
    const worn = source.traitsOf(entity);
    for (let i = 0; i + 1 < worn.length; i += 2) {
      const which = worn[i];
      const label = traitLabels[which] ?? `trait#${which}`;
      const kind = traitKinds[which] ?? 'unknown';
      lines.push(
        `  traits: ${label} (${kind}${traitStateLabel(kind, worn[i + 1])})`,
      );
    }

    // Why a stalled sim is stalled - the owner's Tim-at-the-door
    // report: "idle" with hunger at 2 is a question, and this is the
    // panel answering it instead of the reader guessing. The pending
    // orders ride their own line: an order is what a sim is about to
    // DO, not a reason it is stuck, and one label covering both is
    // what made the first version of this line meaningless.
    const stalled = source.stallReasonOf(entity);
    if (stalled !== null) {
      lines.push(`  stalled reason: ${stalled}`);
    }
    const orders = source.queuedOrdersOf(entity);
    if (orders > 0) {
      lines.push(`  player orders waiting: ${orders}`);
    }

    const needs = source.needsOf(entity);
    const needsLine = Array.from(needs)
      .map((level, i) => `${needNames[i] ?? `need${i}`} ${level.toFixed(1)}`)
      .join('  ');
    if (needsLine) lines.push(`  needs: ${needsLine}`);

    // Personality MULTIPLIERS, shown as deviations only: seven
    // columns of neutral 1.00 read as broken stats (the owner read
    // them exactly that way), while "drains: fun x1.30" says what the
    // number does. A sim with a flat personality shows neither line.
    const personality = source.personalityOf(entity);
    if (personality.length === needNames.length * 2) {
      const half = needNames.length;
      const deviations = (values: Float32Array | number[]): string =>
        Array.from(values)
          .map((v, i) => ({ need: needNames[i], v: Number(v) }))
          .filter(({ v }) => Math.abs(v - 1) > 0.0001)
          .map(({ need, v }) => `${need} x${v.toFixed(2)}`)
          .join(', ');
      // "need decay" and "need refill" rather than bare "drains" and
      // "refills": the multiplier applies to a need's decay rate and to
      // what an activity gives back, and the label should say which.
      const decay = deviations(personality.subarray(0, half));
      const refill = deviations(personality.subarray(half));
      if (decay) lines.push(`  need decay: ${decay}`);
      if (refill) lines.push(`  need refill: ${refill}`);
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
    lines.push(
      feelings.length
        ? `  relationships: ${feelings.join(', ')}`
        : '  relationships: nobody yet',
    );
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
