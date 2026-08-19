export interface HouseholdRosterSource {
  readonly count: number;
  ids(): Uint32Array;
  simIds(): Uint32Array;
  simName(entityIndex: number): string;
  selectedIndex(): number | null;
  select(entityIndex: number): boolean;
}

export interface HouseholdMember {
  /** Stable authored identity used to keep a button attached across loads. */
  readonly simId: number;
  /** Current ECS entity index used only when a selection command is sent. */
  readonly entity: number;
  readonly name: string;
}

export interface HouseholdRosterSurface {
  render(
    members: readonly HouseholdMember[],
    selectedSimId: number | null,
    onSelect: (simId: number) => void,
  ): void;
}

/**
 * Reads the authored household from the live render rows.
 *
 * The typed arrays are copied before any string crosses the WebAssembly
 * boundary. A string return may grow linear memory and detach earlier views;
 * walking a detached `ids` view is a delightful way to lose every person
 * after the first one.
 */
export function householdMembers(source: HouseholdRosterSource): HouseholdMember[] {
  const count = source.count;
  const ids = Array.from(source.ids().subarray(0, count));
  const simIds = Array.from(source.simIds().subarray(0, count));
  const members: HouseholdMember[] = [];

  for (let row = 0; row < Math.min(count, ids.length, simIds.length); row++) {
    const entity = ids[row];
    const simId = simIds[row];
    if (simId === 0xffff_ffff) continue;
    const name = source.simName(entity);
    if (name === '') continue;
    members.push({ simId, entity, name });
  }

  members.sort((left, right) => left.simId - right.simId);
  return members;
}

/** Renders the household at HUD cadence and sends selection through commands. */
export class HouseholdRoster {
  private lastReadMs: number | null = null;

  constructor(
    private readonly source: HouseholdRosterSource,
    private readonly surface: HouseholdRosterSurface,
    private readonly refreshMs: number,
    private readonly onSelectionFailed: () => void = () => {},
    private readonly onSelectionStaged: () => void = () => {},
  ) {
    if (!Number.isFinite(refreshMs) || refreshMs <= 0) {
      throw new Error('household roster refresh interval must be positive');
    }
  }

  update(nowMs: number, force = false): boolean {
    if (
      !force &&
      this.lastReadMs !== null &&
      nowMs - this.lastReadMs < this.refreshMs
    ) {
      return false;
    }
    this.lastReadMs = nowMs;

    const members = householdMembers(this.source);
    const selectedEntity = this.source.selectedIndex();
    const selectedSimId =
      members.find((member) => member.entity === selectedEntity)?.simId ?? null;
    this.surface.render(members, selectedSimId, (simId) => this.select(simId));
    return true;
  }

  private select(simId: number): void {
    // Resolve the stable identity against the live world at click time.
    // Loading swaps the world and may replace every entity index between a
    // button being drawn and being pressed.
    const member = householdMembers(this.source).find(
      (candidate) => candidate.simId === simId,
    );
    if (member === undefined || !this.source.select(member.entity)) {
      this.onSelectionFailed();
      return;
    }
    this.onSelectionStaged();
  }
}

/**
 * The DOM-only half. Buttons are keyed by stable SimId, so periodic redraws
 * update their state without stealing keyboard focus.
 */
export function createHouseholdRosterSurface(
  doc: Document,
  root: HTMLElement,
): HouseholdRosterSurface {
  const buttons = new Map<number, HTMLButtonElement>();
  let select: ((simId: number) => void) | null = null;

  return {
    render(members, selectedSimId, onSelect) {
      select = onSelect;
      const present = new Set(members.map((member) => member.simId));

      for (const [simId, button] of buttons) {
        if (present.has(simId)) continue;
        button.remove();
        buttons.delete(simId);
      }

      for (const [index, member] of members.entries()) {
        let button = buttons.get(member.simId);
        if (button === undefined) {
          button = doc.createElement('button');
          button.type = 'button';
          button.className = 'household-member';
          button.addEventListener('click', () => select?.(member.simId));
          buttons.set(member.simId, button);
        }
        button.textContent = member.name;
        button.setAttribute(
          'aria-pressed',
          String(member.simId === selectedSimId),
        );
        // Leave a correctly positioned node alone. Moving the focused button
        // on every HUD refresh risks blurring it in browsers even though the
        // node object survives. A changed roster still moves only the rows
        // whose actual DOM position disagrees with stable SimId order.
        const current = root.children.item(index);
        if (current !== button) root.insertBefore(button, current);
      }
    },
  };
}
