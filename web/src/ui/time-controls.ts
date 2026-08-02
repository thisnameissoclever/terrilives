/**
 * Pause, 1x, 2x and 3x.
 *
 * Like the need bars, this owns nothing ([D-5]). Picking a speed does two
 * things and neither of them is remembering anything here:
 *
 *  1. it sends `SetSpeed` across the boundary as a serialised command
 *     ([D-2]), because a replay has to reproduce a session's pauses and
 *     fast-forwards as faithfully as its clicks - and a second channel for
 *     "the one player action that is not a command" is exactly the crack
 *     [D-2] exists to close;
 *  2. it sets the driver's tick multiplier, which is what actually changes
 *     how fast the world runs.
 *
 * **The multiplier lives in the driver rather than in the simulation.**
 * Speed is the rate at which the shell asks for full steps, not a property
 * of the world. While paused, the shell runs only the command-drain phase so
 * selection and order controls remain responsive; no clock or gameplay system
 * advances. Unpausing changes the driver immediately, and its serialised speed
 * command drains at the next full tick.
 *
 * The `<input type="radio">` group holds which button looks pressed. That
 * is a widget's own state rather than a cache of simulation state: the DOM
 * is the only thing that reads it, and losing it would cost a highlight
 * rather than a replay.
 */

/** One button. */
export interface SpeedOption {
  /** The tick multiplier this option asks for. 0 pauses. */
  readonly ticksPerFrame: number;
  readonly label: string;
}

/**
 * The four speeds [D-8] names.
 *
 * These are a DESIGN decision rather than a tuning knob, which is why
 * they are here and not in `content/tuning.toml`: the milestone's
 * definition of done says "pause, 1x, 2x, 3x", so changing the list
 * changes what the milestone shipped rather than how it feels. Contrast
 * `need_bar_refresh_ms`, which is a number somebody balancing the game
 * would want to turn and therefore lives in the tuning file.
 *
 * There is no upper bound worth adding beyond 3. `MAX_TICKS_PER_FRAME` in
 * `main.ts` clamps the driver's per-frame work regardless, so a speed
 * high enough to exhaust it degrades into dropped backlog rather than
 * into a frozen tab.
 */
export const SPEED_OPTIONS: readonly SpeedOption[] = [
  { ticksPerFrame: 0, label: 'Pause' },
  { ticksPerFrame: 1, label: '1x' },
  { ticksPerFrame: 2, label: '2x' },
  { ticksPerFrame: 3, label: '3x' },
];

/** What a button does when picked. */
export type SpeedSink = (ticksPerFrame: number) => void;

/**
 * Builds the speed buttons and wires each to `onSelect`.
 *
 * `initial` decides which button starts pressed; it is not applied by
 * calling `onSelect`, because the caller already knows what it started
 * the driver at and a synthetic call would send a `SetSpeed` command
 * before the player has touched anything.
 *
 * Browser-only wiring, in the sense `main.ts` is. Every decision worth a
 * test is in `FixedStepDriver`.
 */
export function buildTimeControls(
  doc: Document,
  root: HTMLElement,
  initial: number,
  onSelect: SpeedSink,
): void {
  // One name for the group, so the browser enforces that exactly one is
  // chosen. Two panels on one page would need two names; there is one.
  const groupName = 'terri-speed';
  for (const option of SPEED_OPTIONS) {
    const id = `speed-${option.ticksPerFrame}`;

    const input = doc.createElement('input');
    input.type = 'radio';
    input.name = groupName;
    input.id = id;
    input.value = String(option.ticksPerFrame);
    input.checked = option.ticksPerFrame === initial;
    input.addEventListener('change', () => {
      if (input.checked) onSelect(option.ticksPerFrame);
    });

    const label = doc.createElement('label');
    label.htmlFor = id;
    label.textContent = option.label;

    root.appendChild(input);
    root.appendChild(label);
  }
}
