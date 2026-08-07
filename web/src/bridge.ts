import type { SimHandle } from './wasm/terri_wasm.js';

/**
 * `SimCommand`'s variant indices, which are **wire format** rather than
 * an internal detail. They are the numbers postcard writes for the enum
 * declared in `crates/terri-core/src/command.rs`, in declaration order,
 * and the golden byte vector in that file's tests is where they are
 * pinned. Renumbering one here without renumbering it there would send
 * a command that decodes as a different command entirely.
 */
const VARIANT_SELECT = 0;
const VARIANT_USE_OBJECT = 1;
const VARIANT_CANCEL_INTENTS = 2;
const VARIANT_SET_SPEED = 3;
const VARIANT_TALK_TO = 4;

/** postcard's `Option` discriminant: one byte, 0 for none, 1 for some. */
const OPTION_NONE = 0;
const OPTION_SOME = 1;

/**
 * Whether `value` is something a postcard `u32` can hold.
 *
 * Checked before encoding rather than coerced, and the difference
 * matters: `value >>> 0` would turn `-1` into 4294967295 and `3.7` into
 * 3, so a caller's mistake would arrive at the simulation as a
 * perfectly well-formed command naming an entity it never meant. A
 * command that is refused is a bug someone can see.
 */
function isU32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

/**
 * Appends `value` as postcard's unsigned LEB128 varint: seven payload
 * bits per byte, low group first, high bit set on every byte but the
 * last. Callers check `isU32` first.
 */
function pushVarint(out: number[], value: number): void {
  let remaining = value >>> 0;
  while (remaining >= 0x80) {
    out.push((remaining & 0x7f) | 0x80);
    // Unsigned shift, so the 32nd bit does not sign-extend the way `>>`
    // would and a value above 2^31 still terminates.
    remaining >>>= 7;
  }
  out.push(remaining);
}

/**
 * Zero-copy view over simulation state living in WASM linear memory.
 *
 * CRITICAL: WASM memory can grow, and growth DETACHES every existing
 * typed-array view over the old ArrayBuffer. A detached view reads as
 * empty or throws. Views are therefore constructed fresh on every access
 * rather than cached. Constructing a typed-array view is a pointer-plus-
 * length operation with no copying, so this is cheap; caching them is
 * the classic bug in this pattern, not an optimisation.
 *
 * Three things must be re-read on every access, not two:
 *   1. `memory.buffer`, because growth replaces the ArrayBuffer and
 *      detaches the old one. The `WebAssembly.Memory` object itself is
 *      stable, which is why it is safe to hold; its `.buffer` is not.
 *   2. the pointer, because the underlying `Vec` reallocates on growth
 *      and moves.
 *   3. the length, because spawns change the entity count.
 * Caching any one of the three is the same bug wearing a different hat.
 *
 * The `WebAssembly.Memory` is injected rather than imported. wasm-pack
 * `--target web` emits a `_bg.wasm` that imports a `_bg.js` glue module
 * which only exists for `--target bundler`, so `import { memory } from
 * './wasm/terri_wasm_bg.wasm'` cannot resolve under Vite or Vitest.
 * Callers pass the `memory` field of the object `init()` resolves to.
 *
 * See ARCHITECTURE.md [D11] and risk [R1].
 */
export class SimBridge {
  constructor(
    private readonly handle: SimHandle,
    private readonly memory: WebAssembly.Memory,
  ) {}

  tick(): void {
    this.handle.tick();
  }

  /** Applies queued input while paused without advancing simulation time. */
  flushCommands(): void {
    this.handle.flush_commands();
  }

  /** Current fixed-step tick, converted from wasm-bindgen's u64 BigInt. */
  clockTick(): number {
    const tick = this.handle.sim_tick();
    const value = Number(tick);
    return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  /** Authored ticks per day, so the shell never hardcodes the calendar. */
  dayTicks(): number {
    return this.handle.day_ticks();
  }

  /** Versioned simulation bytes for browser-owned storage. */
  saveBytes(): Uint8Array {
    return this.handle.save_bytes();
  }

  /** Atomic restore. Rejected bytes leave the running simulation untouched. */
  loadBytes(bytes: Uint8Array): boolean {
    return this.handle.load_bytes(bytes);
  }

  get count(): number {
    return this.handle.entity_count();
  }

  positions(): Float32Array {
    return new Float32Array(
      this.memory.buffer,
      this.handle.positions_ptr(),
      this.count * 2,
    );
  }

  prevPositions(): Float32Array {
    return new Float32Array(
      this.memory.buffer,
      this.handle.prev_positions_ptr(),
      this.count * 2,
    );
  }

  kinds(): Uint32Array {
    return new Uint32Array(
      this.memory.buffer,
      this.handle.kinds_ptr(),
      this.count,
    );
  }

  /**
   * Compiled footprint width in lot tiles for each render row.
   * Re-create the view on every call because a sync may move the Rust vector
   * and WASM memory growth detaches the previous `ArrayBuffer`.
   */
  footprintWidths(): Uint32Array {
    return new Uint32Array(
      this.memory.buffer,
      this.handle.footprint_widths_ptr(),
      this.count,
    );
  }

  /** Compiled footprint depth in lot tiles. Same lifetime as widths. */
  footprintDepths(): Uint32Array {
    return new Uint32Array(
      this.memory.buffer,
      this.handle.footprint_depths_ptr(),
      this.count,
    );
  }

  /**
   * What each row is carrying, as pack item-kind indices with a
   * u32::MAX empty-hands sentinel - the chain's hands, made visible.
   * Read every frame like every other view; resolve names via
   * `itemKinds`.
   */
  carrying(): Uint32Array {
    return new Uint32Array(
      this.memory.buffer,
      this.handle.carrying_ptr(),
      this.count,
    );
  }

  /**
   * What each row is DOING, as the activity codes the render buffer
   * documents: 0 none, 1 walking, 2 waiting, 3 eating, 4 talking,
   * 5 sleeping, 6 at work. The [A-11] indicator column - a zero-copy view
   * like every accessor here, re-created per call for the growth hazard
   * the class doc explains.
   */
  activities(): Uint32Array {
    return new Uint32Array(
      this.memory.buffer,
      this.handle.activities_ptr(),
      this.count,
    );
  }

  /**
   * The authored body-pose category for each row: 0 none, 1 talk, 2 eat.
   *
   * Separate from `activities`: broad activity never invents a body pose, while
   * this column is emitted only from a validated visual contract. Re-create the
   * view on every call for the same memory-growth hazard as every other
   * render-buffer column.
   */
  visualActions(): Uint32Array {
    return new Uint32Array(
      this.memory.buffer,
      this.handle.visual_actions_ptr(),
      this.count,
    );
  }

  /**
   * The lot-axis direction in which each authored action faces: 0 none,
   * 1 positive x, 2 negative x, 3 positive y, 4 negative y.
   */
  facings(): Uint32Array {
    return new Uint32Array(
      this.memory.buffer,
      this.handle.facings_ptr(),
      this.count,
    );
  }

  /** Current activity code for one live entity, resolved through the row map. */
  activityOf(entityIndex: number): number | null {
    if (!isU32(entityIndex)) return null;
    const ids = this.ids();
    const activities = this.activities();
    for (let row = 0; row < this.count; row++) {
      if (ids[row] === entityIndex) return activities[row] ?? null;
    }
    return null;
  }

  /**
   * The atlas sprite index for each entity, resolved from content when
   * the pack was compiled.
   *
   * Same three-part re-read rule as every accessor here; see the class
   * comment. Nothing in TypeScript decides what an object looks like,
   * which is why this is a view over simulation memory rather than a
   * lookup table on this side.
   */
  sprites(): Uint32Array {
    return new Uint32Array(
      this.memory.buffer,
      this.handle.sprites_ptr(),
      this.count,
    );
  }

  /**
   * The raw entity index standing in each row.
   *
   * **A row number is not an entity index.** Rows are sorted by entity
   * index, so a row is that entity's rank among the live ones. The two
   * agree exactly while indices run 0..count with no gaps, which is every
   * world the game can currently produce - and that is precisely why this
   * exists rather than being assumed. Picking reads a row and then has to
   * name that entity in a `select` or `useObject` command; passing the row
   * number works right up until the first despawn leaves a hole, after
   * which clicks quietly resolve to the wrong entity.
   *
   * Same three-part re-read rule as every accessor here; see the class
   * comment.
   */
  ids(): Uint32Array {
    return new Uint32Array(
      this.memory.buffer,
      this.handle.ids_ptr(),
      this.count,
    );
  }

  /**
   * Every impassable tile inside the lot, interleaved `[x, y, ...]`.
   *
   * A **copy**, not a view, and called once at load: the renderer keeps
   * the result for the session, so a zero-copy view would have to
   * survive every later reallocation of WASM memory for no benefit. It
   * is also not per-frame data, so [D11] has nothing to say about it.
   */
  wallTiles(): Uint32Array {
    return this.handle.wall_tiles();
  }

  spawnAgent(x: number, y: number, hunger: number): void {
    this.handle.spawn_agent(x, y, hunger);
  }

  /**
   * Places the smart object `contentId` names, and returns whether it
   * was placed. `false` means the compiled content pack declares no
   * object with that id and nothing was spawned.
   *
   * The id is checked in Rust rather than here. A string arriving from
   * JavaScript is untrusted input at the FFI boundary, and this class is
   * not the boundary - anything that holds the `SimHandle` can call
   * `spawn_object` directly. The check belongs where the input enters,
   * which is `crates/terri-wasm/src/lib.rs`; see docs/testing-protocol.md
   * rule 8.
   *
   * Worth returning rather than swallowing: an unknown id is a silent
   * no-op otherwise, and [L17] records what a missing smart object costs
   * to diagnose from the rendered picture.
   */
  spawnObject(x: number, y: number, contentId: string): boolean {
    return this.handle.spawn_object(x, y, contentId);
  }

  /**
   * Stages one player command, already encoded as postcard bytes, and
   * returns whether the simulation accepted it.
   *
   * This is the **only** way the shell affects the simulation ([D-2]).
   * Nothing here reaches into the world; a command is data that
   * `drain_commands` applies first in a full tick or alone while paused.
   * Split and batched drains are equivalent for one ordered stream, which
   * keeps replay reproducible, gives the save-file command log something to
   * record, and leaves multiplayer possible - what you would send over a
   * wire is exactly these bytes.
   *
   * Two reasons it returns `false`, and the shell cannot tell them
   * apart on purpose, because the useful response to both is the same:
   * the bytes were malformed, or the staging queue is full. The cap is
   * `max_queued_commands` in `content/tuning.toml`.
   *
   * **The validation is in Rust, not here.** This class is not the
   * boundary - anything holding a `SimHandle` can call
   * `enqueue_command` directly - so the check belongs where the input
   * enters, which is `crates/terri-wasm/src/lib.rs`; see
   * docs/testing-protocol.md rule 8. The methods below encode; they do
   * not vet.
   */
  enqueueCommand(bytes: Uint8Array): boolean {
    return this.handle.enqueue_command(bytes);
  }

  /**
   * Selects the sim at `entityIndex`, or clears the selection with
   * `null`.
   *
   * The two are genuinely different commands rather than one with a
   * sentinel: an index that no longer resolves leaves the selection
   * alone, because a click on a sim that has just gone away should not
   * deselect the one the player is watching. Only `null` clears.
   *
   * Selection lives in the simulation, not here ([D-5]). Read it back
   * with `selectedIndex`.
   */
  select(entityIndex: number | null): boolean {
    if (entityIndex === null) {
      return this.enqueueCommand(
        new Uint8Array([VARIANT_SELECT, OPTION_NONE]),
      );
    }
    if (!isU32(entityIndex)) return false;
    const bytes = [VARIANT_SELECT, OPTION_SOME];
    pushVarint(bytes, entityIndex);
    return this.enqueueCommand(new Uint8Array(bytes));
  }

  /**
   * Directs `agent` to use one of `object`'s interactions, overriding
   * whatever it had chosen for itself ([D-3]).
   *
   * The first two are raw entity indices, because JavaScript cannot
   * construct the simulation's own entity type. A stale one is ignored by
   * the drain rather than resolved blindly, so this returning `true` means
   * the command was queued, not that either entity still exists.
   *
   * `interaction` indexes that object's own interaction list, which is the
   * order `interactionLabels` returns and the order the flyout draws its
   * rows in: row `n` is interaction `n`. A plain click and a ctrl-click
   * both send 0, which is the only interaction any shipped object has; a
   * menu row sends its own index.
   *
   * **Required rather than defaulted to 0.** A default would let a caller
   * that forgot the argument compile and silently send the first
   * interaction, which is the exact bug this parameter was added to
   * remove - and it is invisible today, because every shipped object's
   * first interaction is also its only one.
   *
   * An index the object does not have is NOT rejected here, and nor is it
   * rejected in Rust. It is a well-formed command, it is what a saved
   * command log replayed against a newer content pack looks like, and
   * `serve_intents` drops such an intent rather than indexing with it.
   */
  useObject(agent: number, object: number, interaction: number): boolean {
    if (!isU32(agent) || !isU32(object) || !isU32(interaction)) return false;
    const bytes = [VARIANT_USE_OBJECT];
    pushVarint(bytes, agent);
    pushVarint(bytes, object);
    // Last, because postcard writes a struct variant's fields in
    // declaration order and `interaction` is declared last in
    // `SimCommand::UseObject`. Emitting it before `object` would produce
    // bytes that decode without error into a command naming a different
    // object entirely.
    pushVarint(bytes, interaction);
    return this.enqueueCommand(new Uint8Array(bytes));
  }

  /**
   * Directs `agent` to start social interaction `interaction` (an index
   * into the pack's social vocabulary) with the sim `target`. Field
   * order matches `SimCommand::TalkTo`'s declaration, same discipline
   * as `useObject`; the Rust golden vector carries matching rows.
   */
  talkTo(agent: number, target: number, interaction: number): boolean {
    if (!isU32(agent) || !isU32(target) || !isU32(interaction)) return false;
    const bytes = [VARIANT_TALK_TO];
    pushVarint(bytes, agent);
    pushVarint(bytes, target);
    pushVarint(bytes, interaction);
    return this.enqueueCommand(new Uint8Array(bytes));
  }

  /**
   * One label per social-vocabulary entry, in the index order `talkTo`'s
   * `interaction` uses - the rows for a flyout over a fellow sim.
   */
  socialLabels(): string[] {
    return this.handle.social_labels();
  }

  /** Clears `agent`'s queued orders, returning it to autonomy. */
  cancelIntents(agent: number): boolean {
    if (!isU32(agent)) return false;
    const bytes = [VARIANT_CANCEL_INTENTS];
    pushVarint(bytes, agent);
    return this.enqueueCommand(new Uint8Array(bytes));
  }

  /**
   * Sets the tick multiplier: 0 pauses, 1 is real time, higher is
   * faster. Never changes `dt` ([D2]) - it changes how many times the
   * driver calls `tick` per frame.
   *
   * It travels as a command even though the simulation applies nothing
   * for it, and that is deliberate: the command log has to record it to
   * replay a session faithfully, and a second channel for "the one
   * player action that is not a command" is exactly the crack [D-2]
   * exists to close.
   *
   * A `u8`, so this is one raw byte rather than a varint.
   */
  setSpeed(ticksPerFrame: number): boolean {
    if (!Number.isInteger(ticksPerFrame)) return false;
    if (ticksPerFrame < 0 || ticksPerFrame > 0xff) return false;
    return this.enqueueCommand(
      new Uint8Array([VARIANT_SET_SPEED, ticksPerFrame]),
    );
  }

  /**
   * The seven need levels of the entity at `entityIndex`, in `NeedId`
   * index order, or an **empty array** when that index names nothing
   * live or names something with no needs - a smart object, or a sim
   * that despawned between the frame and the click.
   *
   * The need-bar panel calls this each frame for whichever sim is
   * selected and holds nothing of its own ([D-5]): the DOM renders
   * simulation state and never owns it, so there is no cached "the
   * selected sim's hunger" here for a replay to disagree with.
   *
   * A **copy**, not a view, unlike the render arrays: seven floats for
   * one entity is not per-frame bulk data, and a view would have to
   * survive every later reallocation of WASM memory for no benefit -
   * the same trade `wallTiles` makes.
   */
  needsOf(entityIndex: number): Float32Array {
    if (!isU32(entityIndex)) return new Float32Array(0);
    return this.handle.needs_of(entityIndex);
  }

  /**
   * The labels of the interactions the object at `entityIndex` offers, in
   * interaction-index order, or an **empty array** when that index names
   * nothing live or names something that is not a smart object - a sim, or
   * an object that despawned between the right click and the handler.
   *
   * The right-click flyout builds one row per entry and holds no list of
   * its own ([D-5]). A table of labels on this side would be a second copy
   * of every object's interaction list, kept in sync by nobody, and it
   * would fail the way a mislabelled need bar fails: every row drawn,
   * every click accepted, and the wording attached to the wrong verb.
   *
   * **The order is the interaction index**, so nothing here may sort or
   * filter it; row `n` is `Intent::interaction` `n`.
   *
   * A **copy**, not a view, like `wallTiles` and `needNames`: it is read on
   * a right click rather than per frame, so [D11] has nothing to say about
   * it.
   */
  interactionLabels(entityIndex: number): string[] {
    if (!isU32(entityIndex)) return [];
    return this.handle.interaction_labels(entityIndex);
  }

  /** Authored object name, or an empty string when the entity is not furniture. */
  objectName(entityIndex: number): string {
    if (!isU32(entityIndex)) return '';
    return this.handle.object_name_of(entityIndex);
  }

  /**
   * The display name of the sim at `entityIndex`, or the **empty string**
   * for anything else - an object, a stale index, or a stress-mode filler
   * agent, none of which have names to show. The needs panel treats empty
   * as "hide the caption" rather than telling the cases apart, because the
   * useful response to all of them is identical.
   *
   * Read on selection change and throttled with the bars, so the string
   * copy across the boundary is off every per-frame path.
   */
  simName(entityIndex: number): string {
    if (!isU32(entityIndex)) return '';
    return this.handle.sim_name(entityIndex);
  }

  /**
   * The sim's stable identity, or `null` for objects, stale indices and
   * bare agents. The boundary carries u32::MAX as the in-band absent
   * value; it is normalised to `null` here so no caller compares
   * against a sentinel.
   */
  simIdOf(entityIndex: number): number | null {
    if (!isU32(entityIndex)) return null;
    const id = this.handle.sim_id_of(entityIndex);
    return id === 0xffff_ffff ? null : id;
  }

  /**
   * The sim's accumulated satisfaction - the M2e second axis - or null
   * for anything without a ledger. The boundary's -1 is in-band the way
   * simIdOf's MAX is, and unreachable by a real ledger (it clamps at
   * zero). Read by both the debug overlay and the normal HUD.
   */
  satisfactionOf(entityIndex: number): number | null {
    if (!isU32(entityIndex)) return null;
    const value = this.handle.satisfaction_of(entityIndex);
    return value < 0 ? null : value;
  }

  /**
   * Fourteen floats, drain then satisfaction, or empty. A copy across
   * the boundary; debug-overlay read, never per-frame.
   */
  personalityOf(entityIndex: number): Float32Array {
    if (!isU32(entityIndex)) return new Float32Array(0);
    return this.handle.personality_of(entityIndex);
  }

  /**
   * Interleaved [simId, feeling, ...] pairs in key order, or empty.
   * Same copy-and-cadence contract as `personalityOf`.
   */
  relationshipsOf(entityIndex: number): Float32Array {
    if (!isU32(entityIndex)) return new Float32Array(0);
    return this.handle.relationships_of(entityIndex);
  }

  /**
   * Overall mood score followed by each active moodlet's score, or empty.
   * The aligned text half comes from `moodSummaryOf`; both are copies read
   * synchronously by the selected-person panel, with no tick between them.
   */
  moodSnapshotOf(entityIndex: number): Float32Array {
    if (!isU32(entityIndex)) return new Float32Array(0);
    return this.handle.mood_snapshot_of(entityIndex);
  }

  /**
   * Overall mood label followed by each active moodlet's label, or empty.
   * The simulation owns the score bands and wording; the shell validates and
   * renders the projection without recreating either rule.
   */
  moodSummaryOf(entityIndex: number): string[] {
    if (!isU32(entityIndex)) return [];
    return this.handle.mood_summary_of(entityIndex);
  }

  /** One name per pack item kind, in pack order. Read once, like needNames. */
  itemKinds(): string[] {
    return this.handle.item_kinds();
  }

  /**
   * The sim's mid-errand status line, or null when it is not on one -
   * the boundary's empty string is in-band the way simName's is.
   */
  chainStatusOf(entityIndex: number): string | null {
    if (!isU32(entityIndex)) return null;
    const status = this.handle.chain_status_of(entityIndex);
    return status === '' ? null : status;
  }

  /**
   * Why the sim is not acting - blocked, restless or both - or null
   * when nothing holds it back. The boundary's empty string is in-band
   * the way simName's is.
   */
  stallReasonOf(entityIndex: number): string | null {
    if (!isU32(entityIndex)) return null;
    const reason = this.handle.stall_reason_of(entityIndex);
    return reason === '' ? null : reason;
  }

  /** How many player orders the sim still has waiting; 0 for none. */
  queuedOrdersOf(entityIndex: number): number {
    if (!isU32(entityIndex)) return 0;
    return this.handle.queued_orders_of(entityIndex);
  }

  /** The household's money - E4. One number for the lot, not per sim. */
  funds(): number {
    return this.handle.funds();
  }

  /**
   * Interleaved [pack trait index, live state, ...] pairs, or empty.
   * Same copy-and-cadence contract as `personalityOf`; the indices
   * resolve against `traitLabels`/`traitKinds`.
   */
  traitsOf(entityIndex: number): Float32Array {
    if (!isU32(entityIndex)) return new Float32Array(0);
    return this.handle.traits_of(entityIndex);
  }

  /** One label per pack trait, in pack order. Read once, like needNames. */
  traitLabels(): string[] {
    return this.handle.trait_labels();
  }

  /** "disposition" | "capability" | "condition" per pack trait, aligned with traitLabels. */
  traitKinds(): string[] {
    return this.handle.trait_kinds();
  }

  /**
   * The label of the sim's career, or null for the unemployed and for
   * everything that is not a sim - the boundary's empty string is
   * in-band the way simName's is.
   */
  careerOf(entityIndex: number): string | null {
    if (!isU32(entityIndex)) return null;
    const label = this.handle.career_of(entityIndex);
    return label === '' ? null : label;
  }

  /**
   * The raw index of the selected sim, or `null` when nothing is
   * selected.
   *
   * Read from the simulation rather than remembered here, which is the
   * whole of [D-5]: selection is state a replay has to reproduce, so a
   * copy in the shell would be a second source of truth the simulation
   * could not see.
   *
   * `undefined` is normalised to `null` because that is what wasm-bindgen
   * produces for an absent `Option`, and a shell that tested `=== null`
   * against `undefined` would read "nothing selected" as "something
   * selected" - a `!= null` check is the only one that survives both,
   * and relying on every caller to remember that is the bug.
   */
  selectedIndex(): number | null {
    const index = this.handle.selected_index();
    return index === undefined ? null : index;
  }

  /**
   * The seven need names in `NeedId` index order, which is the order
   * `needsOf` returns levels in.
   *
   * The need bars label themselves from this rather than from a list in
   * TypeScript. Seven strings on this side would be a second copy of the
   * need list kept in sync by nobody, and it would fail in the worst
   * available way: every bar drawn, every number right, and the labels
   * shifted against them. See `SimHandle::need_names`.
   *
   * Called once at load, so the seven strings it allocates are not on
   * any per-frame path.
   */
  needNames(): string[] {
    return this.handle.need_names();
  }

  /**
   * The level a fully satisfied need sits at - the denominator every need
   * bar is drawn against.
   *
   * Across the boundary rather than a `100` in the panel, for the same
   * reason the labels are: a ceiling written here is the shell owning a
   * piece of the need model, and if it ever drifted every bar would be
   * drawn at the wrong scale with every number behind it still correct.
   */
  needMax(): number {
    return this.handle.need_max();
  }

  /**
   * How often the shell should re-read a selected sim's needs, in real
   * milliseconds. `need_bar_refresh_ms` in `content/tuning.toml`.
   *
   * A display rate, not a simulation one: it cannot change what the
   * simulation does, only how often the panel asks what it did. It comes
   * from the tuning file rather than a `const` here because that is where
   * a knob somebody tuning the game will look, and that rule has no
   * exception for the shell.
   */
  needBarRefreshMs(): number {
    return this.handle.need_bar_refresh_ms();
  }

  /**
   * The u64 world digest. Stays a bigint on purpose: coercing it through
   * `Number()` silently drops the low bits, which is exactly the part a
   * digest comparison depends on.
   */
  worldHash(): bigint {
    return this.handle.world_hash();
  }
}
