//! The ONLY crate that knows JavaScript exists.
//! Nothing in here may contain simulation logic.

use terri_core::{
    Agent, CommandQueue, NeedId, Needs, Position, SimCommand, SmartObject, TileGrid, NEED_MAX,
    NEED_MIN,
};
use terri_sim::{Content, Sim};
use wasm_bindgen::prelude::*;

/// The level a non-finite hunger argument is replaced with. Either end of
/// the range would do; what matters is that it is finite and in range.
/// `NEED_MAX` is chosen because it is the value the sim itself produces
/// for a fully fed agent, so nothing downstream sees a level it could not
/// have reached on its own.
const HUNGER_FOR_NON_FINITE: f32 = NEED_MAX;

/// The coordinate a non-finite position argument is replaced with. Tile
/// (0, 0) exists in every lot `Sim::new_with_lot` builds.
const COORD_FOR_NON_FINITE: f32 = 0.0;

/// Forces a caller-supplied hunger into `NEED_MIN..=NEED_MAX`.
///
/// This is a **trust boundary**, and it is the only one in the workspace.
/// `terri-core` and `terri-sim` are entitled to assume their inputs are
/// valid; JavaScript is not a caller that can be asked to guarantee that,
/// since every `f32` here arrives as an unconstrained JS number narrowed
/// on the way in. Two specific values are why this function exists:
///
/// 1. `-1.0` is `world_hash`'s in-band "this entity has no `Needs`"
///    sentinel. A level equal to it digests identically to a `Needs`-less
///    entity at the same position, so a JS caller could silently collapse
///    a real distinction the determinism hash depends on. `terri-sim`
///    guards that with a `debug_assert!`, which is **compiled out of the
///    release build** - and `wasm-pack build` produces a release build,
///    so on the only target that ships, the guard is not there.
///
///    **Since the `Hunger` to `Needs` migration this half is redundant**:
///    `Needs` holds a private array and `Needs::set` clamps, so a
///    negative level is no longer constructible at all. Kept because the
///    boundary should not depend on a callee's internals for a guarantee
///    it states itself, but note that removing the clamp here would no
///    longer be observable - see reason 2 for the half that would be.
/// 2. `f32::NAN` does not self-heal, and **nothing downstream catches
///    it**: `f32::clamp` propagates NaN rather than replacing it, so
///    `Needs::set` stores a NaN faithfully. `advertise.rs` documents
///    where it ends up: NaN loses every comparison, so the agent would
///    simply never choose to do anything, forever, with no panic and no
///    log. This branch is the only thing standing in the way.
fn sanitize_hunger(hunger: f32) -> f32 {
    if hunger.is_nan() {
        HUNGER_FOR_NON_FINITE
    } else {
        // Finite or infinite; clamp handles the infinities correctly and
        // only NaN needed the branch above.
        hunger.clamp(NEED_MIN, NEED_MAX)
    }
}

/// Replaces a non-finite caller-supplied coordinate with a finite one.
///
/// A NaN or infinite `Position` is not a value the sim can recover from:
/// pathfinding floors it into a tile index, the movement step arithmetic
/// keeps it non-finite forever, and `world_hash` faithfully reports a
/// digest for a world that can no longer do anything. Finite but
/// out-of-lot coordinates are deliberately left alone - they are a
/// legitimate thing to ask for and the sim already handles them.
fn sanitize_coord(value: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        COORD_FOR_NON_FINITE
    }
}

#[wasm_bindgen]
pub struct SimHandle {
    sim: Sim,
}

#[wasm_bindgen]
impl SimHandle {
    #[wasm_bindgen(constructor)]
    pub fn new(width: usize, height: usize) -> SimHandle {
        SimHandle {
            sim: Sim::new_with_lot(width, height),
        }
    }

    /// The shipped lot from `content/lot.toml`: sized, walled, and with
    /// every authored object already standing on it.
    ///
    /// This is how the game starts. The constructor above builds an empty
    /// room of a caller-chosen size and stays for tests and for anything
    /// that wants a blank lot; it is **not** what the page should use,
    /// because a hand-typed size and a hand-typed object list are a
    /// second copy of content that nothing keeps in sync ([L17] is what
    /// that costs to diagnose).
    ///
    /// No arguments, so nothing to sanitise: the lot comes from the
    /// compiled pack, which `build.rs` validated at build time.
    ///
    /// It syncs the render buffer, so the objects are visible to
    /// JavaScript before the first `tick`.
    pub fn from_lot() -> SimHandle {
        let mut handle = SimHandle {
            sim: Sim::new_from_shipped_lot(),
        };
        handle.sim.sync_render_buffer();
        handle
    }

    /// The lot's width in tiles. The page needs it to place the camera
    /// and to scale depth, and reading it back from the simulation is
    /// what stops those from being a second hand-maintained copy of the
    /// lot's dimensions.
    pub fn lot_width(&self) -> usize {
        self.sim.world().resource::<TileGrid>().width()
    }

    /// The lot's height in tiles. See [`SimHandle::lot_width`].
    pub fn lot_height(&self) -> usize {
        self.sim.world().resource::<TileGrid>().height()
    }

    /// Every impassable tile inside the lot, interleaved `[x0, y0, x1,
    /// y1, ...]`, so the renderer can draw the walls the sim paths
    /// around.
    ///
    /// Read off the `TileGrid` rather than off `pack().lot.walls`, and
    /// that is the point rather than an implementation detail: the grid
    /// is what `find_path` consults, so what this returns is what the
    /// simulation actually treats as solid. Reading the content list
    /// instead would let the two drift, and the drift would look like a
    /// sim detouring around nothing - which is exactly the class of
    /// confusion drawing walls exists to remove.
    ///
    /// It copies, unlike the render pointers, because it is called once
    /// at load and the caller keeps the result for the session. A zero-
    /// copy view would have to survive every later `Vec` reallocation
    /// for no benefit at all.
    ///
    /// The lot BOUNDARY is not in here and cannot be: `is_walkable`
    /// treats everything off the grid as blocked without any tile
    /// existing to report. The renderer draws that separately, from the
    /// lot's dimensions.
    pub fn wall_tiles(&self) -> Vec<u32> {
        let grid = self.sim.world().resource::<TileGrid>();
        let mut tiles = Vec::new();
        for y in 0..grid.height() {
            for x in 0..grid.width() {
                if !grid.is_walkable(x as i32, y as i32) {
                    tiles.push(x as u32);
                    tiles.push(y as u32);
                }
            }
        }
        tiles
    }

    /// Advances one fixed tick and refreshes the render buffer.
    pub fn tick(&mut self) {
        self.sim.tick();
        self.sim.sync_render_buffer();
    }

    /// Arguments are sanitised here rather than trusted. See
    /// [`sanitize_hunger`] and [`sanitize_coord`] for what that means and
    /// why the sim crates are not the place to do it.
    pub fn spawn_agent(&mut self, x: f32, y: f32, hunger: f32) {
        let x = sanitize_coord(x);
        let y = sanitize_coord(y);
        let hunger = sanitize_hunger(hunger);
        // Hunger is the only need JavaScript can set, because it is the
        // only one anything advertises against. The other six start
        // satisfied, which is what keeps a spawned agent's behaviour
        // identical to the single-need version.
        self.sim.world_mut().spawn((
            Agent,
            Position { x, y },
            Needs::with(NeedId::Hunger, hunger),
        ));
        self.sim.sync_render_buffer();
    }

    /// Places the object `content_id` names. Returns `false`, having
    /// spawned nothing, when the content pack declares no such id.
    ///
    /// Coordinates are sanitised here rather than trusted; see
    /// [`sanitize_coord`]. The id is untrusted for the same reason and
    /// is handled differently, because the two failures are not alike:
    /// a non-finite coordinate has a sensible substitute, whereas
    /// guessing which object an unrecognised name meant would put an
    /// object the caller never asked for into the world. So the
    /// coordinate is repaired and the id is rejected.
    ///
    /// **Rejecting rather than panicking is the point of this
    /// signature.** A panic inside a `#[wasm_bindgen]` export unwinds
    /// into a JS exception and leaves the module trapped for the rest
    /// of the page's life, so one mistyped id would freeze the whole
    /// game instead of failing one call. The `expect` this replaced was
    /// safe only while the id was a literal in this file; the moment it
    /// became an argument from JavaScript it became a way for the
    /// caller to halt the simulation. That is the [L12] mistake pointed
    /// the other way: `debug_assert!` is a check that does not ship,
    /// and `expect` on caller input is a check that ships and overreacts.
    ///
    /// The pack is read through the sim's own `Content` resource rather
    /// than by calling `terri_data::pack()`, so the id resolves against
    /// the pack the running simulation will actually use.
    pub fn spawn_object(&mut self, x: f32, y: f32, content_id: &str) -> bool {
        let x = sanitize_coord(x);
        let y = sanitize_coord(y);
        // `ObjectDefId` is `Copy`, so the immutable borrow of the world
        // ends with this statement and `world_mut` below is free.
        let Some(def) = self.sim.world().resource::<Content>().0.find(content_id) else {
            return false;
        };
        self.sim
            .world_mut()
            .spawn((Position { x, y }, SmartObject(def)));
        self.sim.sync_render_buffer();
        true
    }

    pub fn entity_count(&self) -> usize {
        self.sim.render_buffer().count
    }

    /// Pointer into WASM linear memory. **Never cache it.**
    ///
    /// The rarer hazard is memory growth, which reallocates the `Vec` and
    /// moves it; see the detachment warning in web/src/bridge.ts. The
    /// constant one is `sync_render_buffer`, which begins with a
    /// `std::mem::swap` of `positions` and `prev_positions`. A swap
    /// exchanges the two `Vec`s' pointer/length/capacity triples, so
    /// **`positions_ptr()` and `prev_positions_ptr()` trade values on
    /// every single sync** - unconditionally, with no reallocation and no
    /// growth involved. Since `tick`, `spawn_agent` and every accepted
    /// `spawn_object` each sync, a pointer read before any of them is
    /// already stale afterwards and will be pointing at the other
    /// frame's data. A `spawn_object` that rejects its id does not sync,
    /// but treating that as a reason to keep a pointer would be relying
    /// on a failure path.
    ///
    /// Re-read both pointers on every access.
    pub fn positions_ptr(&self) -> *const f32 {
        self.sim.render_buffer().positions.as_ptr()
    }

    pub fn prev_positions_ptr(&self) -> *const f32 {
        self.sim.render_buffer().prev_positions.as_ptr()
    }

    pub fn kinds_ptr(&self) -> *const u32 {
        self.sim.render_buffer().kinds.as_ptr()
    }

    /// Atlas sprite index per row. Same caching hazard as every other
    /// pointer here; re-read it on every access.
    pub fn sprites_ptr(&self) -> *const u32 {
        self.sim.render_buffer().sprites.as_ptr()
    }

    /// Stages one player command, given as postcard bytes. Returns
    /// whether it was accepted.
    ///
    /// This is the **only** way the shell affects the simulation, which
    /// is the whole of [D-2]: JavaScript never touches the world, it
    /// enqueues serialisable data that `drain_commands` applies at one
    /// fixed point in the tick. That is what keeps a replay reproducible,
    /// gives [D8]'s save-file command log something to record, and leaves
    /// Layer 2 multiplayer possible - what you would send over a wire is
    /// exactly these bytes.
    ///
    /// # Why bytes rather than four typed exports
    ///
    /// A `select(id)` export would work today and would be a second
    /// encoding of the same commands, diverging from the one a save file
    /// replays. Sending the postcard bytes means the format is exercised
    /// on every single click rather than only when somebody saves.
    ///
    /// # Malformed input returns `false`, and that is the point of the
    /// signature
    ///
    /// Every byte here is attacker-controlled in principle and
    /// typo-controlled in practice. **A panic inside a `#[wasm_bindgen]`
    /// export leaves the module trapped for the rest of the page's life**,
    /// so from the player's side one bad frame of input is the entire game
    /// freezing with no recovery short of a reload. `unwrap` on the decode
    /// would compile, ship, and survive `--release`, which is what makes
    /// it worse than the [L12] `debug_assert!` rather than better. Four
    /// shapes of bad input reach this and all four return `false`:
    ///
    /// - **empty** - no variant index at all;
    /// - **an unknown variant index** - a byte past the four `SimCommand`
    ///   declares, which is also what an OLDER shell sending a NEWER
    ///   format looks like;
    /// - **a truncated payload** - a variant index with its fields
    ///   missing, which is what a partial write or a sliced buffer looks
    ///   like;
    /// - **trailing bytes** - a valid command followed by junk, rejected
    ///   rather than silently ignored. That one is a deliberate strictness
    ///   choice: `take_from_bytes` is used rather than `from_bytes` so
    ///   this crate decides the rule instead of inheriting whatever a
    ///   postcard upgrade decides. A buffer holding one command plus
    ///   anything else is not a message this side wrote, and accepting the
    ///   prefix would make the wire format ambiguous the day someone
    ///   concatenates two commands and expects both to run.
    ///
    /// A stale or invented entity index is NOT rejected here, and that is
    /// also deliberate: it is a perfectly well-formed command, and
    /// `drain_commands` already resolves indices against live entities and
    /// ignores the ones that resolve to nothing. Rejecting it here would
    /// mean this crate holding a second, weaker copy of that rule.
    ///
    /// # The cap is the bound on the queue itself
    ///
    /// `max_queued_intents` bounds what one sim can be told to do, and
    /// nothing reaches it except a `UseObject` that resolved to a live
    /// agent. Everything else a player can send - every `Select`, every
    /// `SetSpeed`, every command naming an index that no longer exists -
    /// lands in the staging queue and never touches an intent queue at
    /// all, so a JavaScript loop could grow this without limit. It is also
    /// the queue that does not drain while the game is PAUSED, since
    /// nothing calls `tick`. `max_queued_commands` in
    /// `content/tuning.toml` carries the burst budget and why the overflow
    /// refuses the newest rather than evicting the oldest.
    pub fn enqueue_command(&mut self, bytes: &[u8]) -> bool {
        // `take_from_bytes` rather than `from_bytes`, so the trailing-byte
        // rule is this crate's rather than postcard's; see above.
        let Ok((command, rest)) = postcard::take_from_bytes::<SimCommand>(bytes) else {
            return false;
        };
        if !rest.is_empty() {
            return false;
        }

        // Read before the queue is borrowed mutably. `Tuning` is `Copy`
        // behind a `&'static ContentPack`, so this is a load rather than
        // a clone.
        let cap = self
            .sim
            .world()
            .resource::<Content>()
            .0
            .tuning
            .max_queued_commands as usize;
        let mut queue = self.sim.world_mut().resource_mut::<CommandQueue>();
        if queue.len() >= cap {
            return false;
        }
        queue.push(command);
        true
    }

    /// The seven need levels of the entity carrying `entity_index`, in
    /// `NeedId` index order, or an EMPTY array when nothing live carries
    /// that index or what does has no needs.
    ///
    /// The panel reads this every frame for whichever sim is selected and
    /// holds nothing of its own ([D-5]): the DOM renders simulation state,
    /// it never owns it. An empty array is therefore a normal answer
    /// rather than an error - it is what a deselected panel, a
    /// just-despawned sim and a click that landed on a fridge all look
    /// like, and all three should draw no bars.
    ///
    /// A copy rather than a pointer into linear memory, unlike the render
    /// arrays. Seven floats for one entity at a throttled rate is not
    /// per-frame bulk data, and a view would have to survive every later
    /// reallocation for no benefit at all - the same trade `wall_tiles`
    /// makes.
    pub fn needs_of(&self, entity_index: u32) -> Vec<f32> {
        self.sim
            .needs_of(entity_index)
            .map(|levels| levels.to_vec())
            .unwrap_or_default()
    }

    /// The raw index of the selected sim, or `None` when nothing is
    /// selected.
    ///
    /// Selection is simulation state, not shell state ([D-5]). The shell
    /// asks for a change with `SimCommand::Select` and reads the result
    /// back here, so a replay reproduces what the player had selected
    /// rather than depending on what the DOM happened to remember.
    pub fn selected_index(&self) -> Option<u32> {
        self.sim.selected_index()
    }

    pub fn world_hash(&self) -> u64 {
        self.sim.world_hash()
    }
}

#[cfg(test)]
mod boundary_tests {
    //! Everything JavaScript can hand this crate that Rust could not.
    //!
    //! These run natively, but the behaviour they pin only matters in the
    //! `--release` wasm build that `wasm-pack` ships, because the guard
    //! they replace (`debug_assert!` in `terri_sim::Sim::world_hash`) is
    //! compiled out there. Asserting on the sanitiser's return value would
    //! only test the sanitiser; every test below reads the component back
    //! out of the world it was spawned into.

    use super::*;
    use terri_core::{SimClock, NEED_COUNT};

    /// Hunger levels as the ECS actually stored them.
    fn stored_hungers(handle: &SimHandle) -> Vec<f32> {
        let world = handle.sim.world();
        let mut state = world
            .try_query::<&Needs>()
            .expect("Needs is registered eagerly in Sim::new");
        state
            .iter(world)
            .map(|needs| needs.get(NeedId::Hunger))
            .collect()
    }

    /// Positions as the ECS actually stored them.
    fn stored_positions(handle: &SimHandle) -> Vec<(f32, f32)> {
        let world = handle.sim.world();
        let mut state = world
            .try_query::<&Position>()
            .expect("Position is registered eagerly in Sim::new");
        state.iter(world).map(|pos| (pos.x, pos.y)).collect()
    }

    /// The two clamp tests below assert an **end-to-end property** - a
    /// level arriving from JavaScript is stored in range - which is now
    /// enforced twice over: by `sanitize_hunger` here and by
    /// `Needs::set`'s own clamp in terri-core. Deleting either one alone
    /// therefore leaves them green.
    ///
    /// That is stated rather than hidden, because a test that cannot
    /// detect the mechanism it appears to name is the failure mode
    /// docs/testing-protocol.md exists to prevent. They are kept because
    /// the property is worth pinning and because defence in depth at a
    /// trust boundary is deliberate, not because they still isolate
    /// `sanitize_hunger`. The half of that function nothing else covers
    /// is NaN, and `spawn_agent_replaces_non_finite_hunger_with_a_finite_level`
    /// is the test that isolates it.
    #[test]
    fn spawn_agent_clamps_hunger_up_to_the_need_floor() {
        let mut handle = SimHandle::new(8, 8);
        handle.spawn_agent(1.0, 1.0, -50.0);
        assert_eq!(stored_hungers(&handle), vec![NEED_MIN]);
    }

    #[test]
    fn spawn_agent_clamps_hunger_down_to_the_need_ceiling() {
        let mut handle = SimHandle::new(8, 8);
        handle.spawn_agent(1.0, 1.0, 1_000.0);
        assert_eq!(stored_hungers(&handle), vec![NEED_MAX]);
    }

    #[test]
    fn spawn_agent_leaves_an_in_range_hunger_untouched() {
        // The other clamp tests would all pass if the sanitiser returned a
        // constant. This is what stops that.
        let mut handle = SimHandle::new(8, 8);
        handle.spawn_agent(1.0, 1.0, 37.5);
        assert_eq!(stored_hungers(&handle), vec![37.5]);
    }

    #[test]
    fn spawn_agent_replaces_non_finite_hunger_with_a_finite_level() {
        // f32::clamp PROPAGATES NaN rather than replacing it, so the
        // clamp alone does not cover this case and a test that only
        // asserted "in range" would pass on NaN as well: every comparison
        // against NaN is false, including the range assertions a careless
        // test would write. Assert finiteness explicitly.
        //
        // The NaN case is what still isolates `sanitize_hunger`, and it
        // is the only one that does. `Needs::set` clamps, so it handles
        // the two infinities on its own; it propagates NaN, so this
        // branch here is the only thing between a JS `NaN` and an agent
        // that never chooses to do anything again.
        for poison in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut handle = SimHandle::new(8, 8);
            handle.spawn_agent(1.0, 1.0, poison);
            let stored = stored_hungers(&handle);
            assert_eq!(stored.len(), 1, "the agent must have been spawned");
            assert!(
                stored[0].is_finite(),
                "spawn_agent({poison}) stored a non-finite hunger: {}; a NaN \
                 need loses every comparison, so the agent would never \
                 choose to do anything again, with no panic and no log",
                stored[0]
            );
            assert!(
                (NEED_MIN..=NEED_MAX).contains(&stored[0]),
                "spawn_agent({poison}) stored {} outside {NEED_MIN}..={NEED_MAX}",
                stored[0]
            );
        }
    }

    #[test]
    fn spawn_agent_replaces_non_finite_coordinates_with_finite_ones() {
        for poison in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut handle = SimHandle::new(8, 8);
            handle.spawn_agent(poison, poison, 50.0);
            let stored = stored_positions(&handle);
            assert_eq!(stored.len(), 1, "the agent must have been spawned");
            assert!(
                stored[0].0.is_finite() && stored[0].1.is_finite(),
                "spawn_agent stored a non-finite position from {poison}: {:?}",
                stored[0]
            );
        }
    }

    #[test]
    fn spawn_object_replaces_non_finite_coordinates_with_finite_ones() {
        for poison in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut handle = SimHandle::new(8, 8);
            assert!(handle.spawn_object(poison, poison, "fridge"));
            let stored = stored_positions(&handle);
            assert_eq!(stored.len(), 1, "the object must have been spawned");
            assert!(
                stored[0].0.is_finite() && stored[0].1.is_finite(),
                "spawn_object stored a non-finite position from {poison}: {:?}",
                stored[0]
            );
        }
    }

    #[test]
    fn spawn_leaves_finite_coordinates_untouched() {
        // Same role as the in-range hunger test: without it, a sanitiser
        // that returned 0.0 unconditionally would satisfy every assertion
        // above.
        let mut handle = SimHandle::new(8, 8);
        assert!(handle.spawn_object(3.5, 6.25, "fridge"));
        assert_eq!(stored_positions(&handle), vec![(3.5, 6.25)]);
    }

    #[test]
    fn spawning_an_unknown_content_id_is_rejected_rather_than_panicking() {
        // The mutation this is written against: resolve the id with
        // `expect` (or `unwrap`) instead of returning `false`. That
        // compiles, ships, and survives `--release` - which is exactly
        // what makes it worse than the [L12] `debug_assert!`, not
        // better. A panic in a `#[wasm_bindgen]` export leaves the
        // module trapped for the life of the page, so a single bad id
        // from JavaScript freezes the game rather than failing one call.
        let mut sim = SimHandle::new(16, 16);
        assert!(sim.spawn_object(4.0, 5.0, "fridge"));
        assert!(!sim.spawn_object(4.0, 6.0, "no_such_object"));
        assert_eq!(sim.entity_count(), 1);

        // `entity_count` reads the render buffer, which only refreshes
        // on a successful spawn, so on its own it cannot tell "nothing
        // was spawned" from "something was spawned and never synced".
        // Reading the ECS directly is what distinguishes them, and the
        // position pins that the entity present is the accepted one.
        assert_eq!(
            stored_positions(&sim),
            vec![(4.0, 5.0)],
            "the rejected spawn must leave nothing behind in the world"
        );

        // A rejection must not poison the handle either: the boundary's
        // job is to fail one call, not to end the session.
        assert!(sim.spawn_object(7.0, 8.0, "fridge"));
        assert_eq!(sim.entity_count(), 2);
    }

    #[test]
    fn a_need_level_from_js_cannot_alias_the_world_hash_no_needs_sentinel() {
        // The finding this whole boundary exists for, in its causal form.
        // `world_hash` encodes "this entity has no `Needs`" as the in-band
        // value -1.0 in every slot, so a component actually holding -1.0
        // hashed exactly like a `Needs`-less entity at the same position.
        // Measured before the fix, back when the component was
        // `Hunger(pub f32)`: both worlds below digested to
        // 0x06ef64bc902dd05f.
        //
        // **What now enforces it has changed, and saying so is the point.**
        // `Needs` holds a private array and every mutator clamps at
        // NEED_MIN = 0.0, so -1.0 is no longer constructible however this
        // crate behaves. `sanitize_hunger` is therefore no longer the
        // mechanism this test isolates; the type is. Kept as a regression
        // pin on `world_hash`'s sentinel encoding, which it does still
        // detect: drop the need levels from the digest and the two worlds
        // below collapse to the same value again.
        //
        // Everything except the need term is held constant, per [L7]:
        // both handles are built by the same constructor, both spawn
        // exactly one entity as their first spawn (so the entity indices
        // match), neither ticks (so the clock term matches), and both sit
        // at the same position. `world_hash` reads only the clock, the
        // entity index, the position and the seven levels, so the levels
        // are the only thing that can move the digest.
        let mut agent_at_sentinel_level = SimHandle::new(8, 8);
        agent_at_sentinel_level.spawn_agent(1.0, 2.0, -1.0);

        let mut entity_with_no_needs = SimHandle::new(8, 8);
        assert!(entity_with_no_needs.spawn_object(1.0, 2.0, "fridge"));

        assert_ne!(
            agent_at_sentinel_level.world_hash(),
            entity_with_no_needs.world_hash(),
            "a need level of -1.0 arriving from JavaScript hashed \
             identically to an entity with no Needs at all; world_hash's \
             in-band sentinel is reachable across the boundary and \
             terri-sim's debug_assert guard is compiled out of the release \
             wasm build that ships"
        );
    }

    // The rest of this module exists because `cargo mutants` reported
    // these four exports as the only survivors in this crate: `tick`
    // replaced with `()`, and each pointer accessor replaced with
    // `Default::default()`, which for a raw pointer is null. Raised in
    // review on #4, where the crate was also added to the CI sweep.
    //
    // A survivor is behaviour nothing constrains, and every one of these
    // is on the path JavaScript drives every frame. The `()` mutant is
    // the one that matters: a boundary tick that does nothing renders a
    // frozen world with no panic, no log, and a green suite.

    /// The clock term, read from the world rather than from the buffer.
    fn clock_tick(handle: &SimHandle) -> u64 {
        handle.sim.world().resource::<SimClock>().tick
    }

    /// The `len` elements an exported pointer addresses.
    ///
    /// Null is checked **before** the read. `from_raw_parts` requires a
    /// non-null aligned pointer even at zero length, and null is exactly
    /// what the mutants these tests kill return, so reading first would
    /// trade a named assertion for undefined behaviour. Every call site
    /// derives `len` from `entity_count`.
    fn addressed<T: Copy>(ptr: *const T, len: usize, what: &str) -> Vec<T> {
        assert!(
            !ptr.is_null(),
            "{what} handed JavaScript a null pointer; the view built on it \
             would read from address zero"
        );
        // SAFETY: non-null is asserted above, `handle` owns the buffer and
        // outlives this call, and `len` is the row count that same buffer
        // was built with.
        unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec()
    }

    #[test]
    fn from_lot_hands_javascript_the_shipped_objects_without_a_tick_first() {
        // Two mechanisms, and they fail differently.
        //
        // The SPAWN half is `Sim::new_from_lot`, pinned in terri-sim. The
        // half that only exists here is the `sync_render_buffer` call: the
        // render buffer is the only thing JavaScript can see, and without
        // that call `entity_count` reads zero and the first frame draws an
        // empty lot. The page would then look exactly like a lot that
        // failed to load, which is [L17]'s diagnosis cost again.
        //
        // Nothing ticks, so the sync under test is the one `from_lot`
        // does rather than the one `tick` does.
        let handle = SimHandle::from_lot();

        let placed = stored_positions(&handle);
        assert!(
            placed.len() >= 8,
            "[D-6] calls for roughly eight authored objects; got {}",
            placed.len()
        );
        assert_eq!(
            handle.entity_count(),
            placed.len(),
            "every object in the world must be in the render buffer before \
             the first tick; a count of 0 means from_lot never synced and \
             the page would draw an empty lot"
        );
        assert_eq!(
            addressed(
                handle.positions_ptr(),
                handle.entity_count() * 2,
                "positions_ptr"
            )
            .len(),
            placed.len() * 2,
            "the exported pointer must address the same rows entity_count \
             promises"
        );
    }

    #[test]
    fn lot_width_and_lot_height_report_the_lot_in_that_order() {
        // The shipped lot is NOT square, which is what makes a transposed
        // pair of accessors visible here at all. Asserted rather than
        // assumed, because a future lot that happens to be square would
        // silently turn this test into a tautology - the [L34] shape,
        // where the input domain rather than the assertion is what fails.
        let handle = SimHandle::from_lot();
        let (width, height) = (handle.lot_width(), handle.lot_height());

        assert_ne!(
            width, height,
            "the lot must not be square or these two accessors are \
             interchangeable and this test proves nothing"
        );
        // The page derives its camera and its depth scale from these, so
        // they have to be the lot's own numbers rather than a default.
        //
        // There was a `width >= 16 && height >= 8` bound here. It was a
        // magic number that said nothing about correctness and broke the
        // moment the lot was legitimately resized from 24x18 to 14x10.
        // Asserting against `terri_data` instead would mean giving this
        // crate a dependency it does not otherwise need, to strengthen a
        // sanity check that was never where the teeth are: transposition
        // is caught by `assert_ne!` above, and whether these are the
        // LOT's numbers rather than some other grid's is established
        // behaviourally by `moves_from` below, which drops an agent on a
        // tile and watches whether it can walk.
        assert!(width > 1 && height > 1, "got {width}x{height}");

        /// Whether a hungry agent dropped on `tile` of the SHIPPED lot
        /// moves at all in ten ticks.
        ///
        /// An agent standing outside the lot is a silent no-op:
        /// `find_path` refuses an unwalkable origin, so it never gets a
        /// target and stands still forever with nothing logged ([L17]).
        /// Nothing else in the world moves, so the whole position array
        /// is a sound thing to compare.
        ///
        /// The world comes from `from_lot`, NOT from a lot rebuilt out of
        /// the two numbers under test. That is the load-bearing part: a
        /// helper that constructed its own lot from `width` and `height`
        /// would be self-consistent under a swap of the pair and could
        /// not see it.
        fn moves_from(tile: (f32, f32)) -> bool {
            let mut handle = SimHandle::from_lot();
            handle.spawn_agent(tile.0, tile.1, 20.0);
            let start = stored_positions(&handle);
            for _ in 0..10 {
                handle.tick();
            }
            stored_positions(&handle) != start
        }

        // The claim through behaviour, so the pair cannot both be
        // satisfied by a lot that is really height by width. On a
        // non-square lot the far corner is inside and its transpose is
        // outside, and only the correct orientation makes these two runs
        // disagree.
        let far_corner = ((width - 1) as f32, (height - 1) as f32);
        let transposed = ((height - 1) as f32, (width - 1) as f32);
        assert!(
            moves_from(far_corner),
            "{far_corner:?} must be inside the lot, so a hungry sim \
             standing there can path somewhere"
        );
        assert!(
            !moves_from(transposed),
            "{transposed:?} must be OUTSIDE a {width}x{height} lot; a sim \
             that walks from there too means lot_width and lot_height are \
             swapped"
        );
    }

    #[test]
    fn tick_advances_the_world_clock() {
        // Isolates the `self.sim.tick()` half of `SimHandle::tick`.
        let mut handle = SimHandle::new(8, 8);
        handle.spawn_agent(1.0, 1.0, 80.0);
        assert_eq!(
            clock_tick(&handle),
            0,
            "spawning must not advance the clock, or the assertion below \
             cannot attribute the movement to the tick"
        );

        handle.tick();

        assert_eq!(
            clock_tick(&handle),
            1,
            "the boundary tick did not advance the simulation; JavaScript \
             would drive a frozen world and have nothing to show for it"
        );
    }

    #[test]
    fn tick_refreshes_the_render_buffer() {
        // Isolates the `self.sim.sync_render_buffer()` half. Spawning
        // through the ECS directly rather than through `spawn_agent` is
        // what makes the two halves separable: `spawn_agent` syncs on its
        // own, so an entity added behind its back reaches the renderer
        // only if `tick` is what syncs.
        let mut handle = SimHandle::new(8, 8);
        handle.spawn_agent(1.0, 1.0, 80.0);
        assert_eq!(handle.entity_count(), 1);

        handle.sim.world_mut().spawn((
            Agent,
            Position { x: 2.0, y: 3.0 },
            Needs::with(NeedId::Hunger, 50.0),
        ));
        assert_eq!(
            handle.entity_count(),
            1,
            "the direct spawn must not be visible before a sync, or this \
             test cannot tell a refreshed buffer from a stale one"
        );

        handle.tick();

        assert_eq!(
            handle.entity_count(),
            2,
            "the boundary tick advanced the world without refreshing the \
             render buffer; JavaScript would redraw the previous frame \
             forever while the simulation ran on without it"
        );
    }

    #[test]
    fn positions_ptr_addresses_the_current_frame_coordinates() {
        let mut handle = SimHandle::new(16, 16);
        handle.spawn_agent(3.5, 6.25, 50.0);

        assert_eq!(
            addressed(
                handle.positions_ptr(),
                handle.entity_count() * 2,
                "positions_ptr"
            ),
            vec![3.5, 6.25],
            "positions_ptr must address the interleaved x, y pairs of the \
             current frame"
        );
    }

    #[test]
    fn kinds_ptr_addresses_the_entity_kind_tags() {
        // One of each kind, because an all-agent lot tags every row 0 and
        // could not distinguish the real array from a zeroed one.
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(1.0, 1.0, "fridge"));
        handle.spawn_agent(2.0, 2.0, 50.0);

        assert_eq!(
            addressed(handle.kinds_ptr(), handle.entity_count(), "kinds_ptr"),
            vec![1, 0],
            "kinds_ptr must address the 0 = agent, 1 = smart object tags, \
             sorted by entity index, so the object spawned first comes first"
        );
    }

    #[test]
    fn sprites_ptr_addresses_the_content_resolved_atlas_indices() {
        // One object and one agent, because an all-object lot would tag
        // every row the same and could not distinguish the real array
        // from a constant. The expectations are read out of the pack so
        // a re-skin does not break this, and asserted to differ so that
        // reading them out cannot make the comparison vacuous.
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(1.0, 1.0, "sofa"));
        handle.spawn_agent(2.0, 2.0, 50.0);

        // Through the sim's own `Content` resource rather than by
        // depending on `terri-data`. This crate deliberately does not
        // name that crate in its manifest, and it does not have to:
        // inherent methods on `ContentPack` are callable without naming
        // the type.
        let pack = handle.sim.world().resource::<Content>().0;
        let sofa = pack.object(pack.find("sofa").expect("shipped content has a sofa"));
        assert_ne!(
            sofa.sprite, pack.sim_sprite,
            "the sofa and the sim must draw differently or this proves nothing"
        );

        assert_eq!(
            addressed(handle.sprites_ptr(), handle.entity_count(), "sprites_ptr"),
            vec![sofa.sprite, pack.sim_sprite],
            "sprites_ptr must address the atlas index per row, sorted by \
             entity index, so the object spawned first comes first"
        );
    }

    #[test]
    fn wall_tiles_reports_the_blocked_tiles_of_the_shipped_lot_and_only_those() {
        // The shipped lot, because the point of this export is that the
        // page draws the walls the simulation actually paths around.
        let handle = SimHandle::from_lot();
        let tiles = handle.wall_tiles();

        assert_eq!(tiles.len() % 2, 0, "the pairs must be interleaved x, y");
        let pairs: Vec<(u32, u32)> = tiles.chunks_exact(2).map(|c| (c[0], c[1])).collect();
        assert!(
            !pairs.is_empty(),
            "the shipped lot has interior walls; an empty result means the \
             page would draw none of them"
        );

        // Against the grid rather than against `lot.toml`, because the
        // grid is what `find_path` consults and therefore what the
        // renderer has to agree with.
        let grid = handle.sim.world().resource::<TileGrid>();
        let mut blocked = 0;
        for y in 0..grid.height() {
            for x in 0..grid.width() {
                let listed = pairs.contains(&(x as u32, y as u32));
                assert_eq!(
                    listed,
                    !grid.is_walkable(x as i32, y as i32),
                    "({x}, {y}) is {} in the grid and {} in wall_tiles",
                    if grid.is_walkable(x as i32, y as i32) {
                        "walkable"
                    } else {
                        "blocked"
                    },
                    if listed { "listed" } else { "absent" }
                );
                if listed {
                    blocked += 1;
                }
            }
        }
        assert_eq!(blocked, pairs.len(), "wall_tiles must not repeat a tile");

        // The doorway, stated positively as well. A wall list that
        // included it would draw the bathroom sealed while the sim walked
        // straight through the picture of a wall.
        assert!(
            !pairs.contains(&(9, 2)),
            "the doorway at (9, 2) is walkable and must not be drawn as a wall"
        );
        assert!(pairs.contains(&(9, 1)) && pairs.contains(&(9, 3)));
    }

    // ---- Player commands ----------------------------------------------
    //
    // Everything below is about `enqueue_command`, which is where the
    // shell stops being a renderer and starts being an input. The bytes
    // are written as LITERALS rather than produced by `postcard::
    // to_allocvec`, and that is the load-bearing part rather than a
    // stylistic one: encoding with the same library that decodes is a
    // round trip, and a round trip is self-consistent under any encoding
    // at all ([L33]). What crosses this boundary in the browser is bytes
    // JavaScript wrote by hand, so bytes written by hand are what these
    // send. They match the golden vector in `terri_core::command`, which
    // is the one place the format is stated.

    /// `SimCommand::Select(Some(index))`: variant 0, `Option` tag 1, then
    /// the index as a varint. Single-byte indices only, which is all any
    /// of these fixtures uses.
    fn select_bytes(index: u32) -> Vec<u8> {
        assert!(index < 128, "the varint below is one byte only");
        vec![0x00, 0x01, index as u8]
    }

    /// `SimCommand::UseObject { agent, object }`: variant 1, then two
    /// varints.
    fn use_object_bytes(agent: u32, object: u32) -> Vec<u8> {
        assert!(agent < 128 && object < 128, "one-byte varints only");
        vec![0x01, agent as u8, object as u8]
    }

    /// How many commands are staged and not yet drained.
    fn staged(handle: &SimHandle) -> usize {
        handle.sim.world().resource::<CommandQueue>().len()
    }

    /// The staging cap the boundary actually enforces, read from the same
    /// content it read rather than restated as a literal. A number here
    /// would leave the cap test green while silently no longer testing
    /// the shipped value, from the first time anybody tunes it.
    fn command_cap(handle: &SimHandle) -> usize {
        handle
            .sim
            .world()
            .resource::<Content>()
            .0
            .tuning
            .max_queued_commands as usize
    }

    /// Spawns an agent through the ECS rather than through
    /// `spawn_agent`, because these tests need its raw index and the
    /// export does not return one. Same fixture shape `spawn_agent`
    /// builds: hunger set, the other six satisfied.
    fn spawn_agent_at(handle: &mut SimHandle, x: f32, y: f32, hunger: f32) -> u32 {
        handle
            .sim
            .world_mut()
            .spawn((
                Agent,
                Position { x, y },
                Needs::with(NeedId::Hunger, hunger),
            ))
            .id()
            .index_u32()
    }

    #[test]
    fn a_well_formed_command_reaches_the_simulation() {
        // **The counterfactual for every rejection test below.** Without
        // it, `enqueue_command` returning `false` unconditionally - or
        // staging the command and never letting the drain see it - would
        // satisfy all of them, and the boundary would be closed rather
        // than open. This is the test that says it is open.
        //
        // Selection is what it checks, because selection is the one
        // command whose whole effect is observable through another
        // export: the shell asks with `Select` and reads back with
        // `selected_index`, which is [D-5]'s round trip.
        let mut handle = SimHandle::new(8, 8);
        let agent = spawn_agent_at(&mut handle, 1.0, 1.0, 80.0);
        assert_eq!(
            handle.selected_index(),
            None,
            "nothing is selected until a command says so, or the \
             assertion below cannot attribute the selection to the command"
        );

        assert!(
            handle.enqueue_command(&select_bytes(agent)),
            "a well-formed Select must be accepted"
        );
        assert_eq!(
            staged(&handle),
            1,
            "an accepted command must be STAGED rather than applied; \
             applying it here would be JavaScript mutating the world, \
             which is the one thing [D-2] forbids"
        );
        assert_eq!(
            handle.selected_index(),
            None,
            "and it must not have taken effect before the tick that \
             drains it"
        );

        handle.tick();

        assert_eq!(
            handle.selected_index(),
            Some(agent),
            "the command must reach the simulation on the tick that \
             drains it"
        );
        assert_eq!(staged(&handle), 0, "and the drain must empty the queue");
    }

    #[test]
    fn malformed_command_bytes_are_rejected_rather_than_trapping_the_module() {
        // **The mutation this is written against: `unwrap` or `expect` on
        // the decode.** That compiles, ships, and survives `--release` -
        // which is what makes it worse than the [L12] `debug_assert!`
        // rather than better. A panic inside a `#[wasm_bindgen]` export
        // unwinds into a JS exception AND leaves the module trapped for
        // the rest of the page's life, so one malformed frame of input is
        // the whole game freezing rather than one click failing.
        //
        // Six shapes, because they fail at different points in the
        // decoder and a guard could plausibly catch some and not others.
        let mut handle = SimHandle::new(8, 8);
        let agent = spawn_agent_at(&mut handle, 1.0, 1.0, 80.0);
        handle.enqueue_command(&select_bytes(agent));
        handle.tick();
        let baseline = handle.world_hash();

        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("empty - no variant index at all", vec![]),
            (
                "variant index 4, one past the four SimCommand declares; \
                 also what an older shell sending a newer format looks like",
                vec![0x04, 0x00],
            ),
            ("variant index 0xFF", vec![0xFF]),
            (
                "Select with its Option tag but no payload - a truncated \
                 write, or a sliced buffer",
                vec![0x00, 0x01],
            ),
            ("UseObject missing its second field", vec![0x01, 0x03]),
            (
                "a valid SetSpeed(2) followed by junk; accepting the \
                 prefix would make the format ambiguous",
                vec![0x03, 0x02, 0xAA, 0xBB],
            ),
        ];

        for (what, bytes) in cases {
            assert!(
                !handle.enqueue_command(&bytes),
                "enqueue_command accepted {what}: {bytes:02X?}"
            );
            assert_eq!(
                staged(&handle),
                0,
                "a rejected command must leave nothing staged ({what})"
            );
        }

        assert_eq!(
            handle.world_hash(),
            baseline,
            "a rejected command must change nothing at all"
        );

        // **A rejection must not poison the handle.** On a genuinely
        // trapped module every later call throws rather than returning,
        // so these two are what tell a returned `false` apart from a
        // trap - the same role the follow-up spawn plays in
        // `spawning_an_unknown_content_id_is_rejected_rather_than_panicking`.
        assert!(
            handle.enqueue_command(&select_bytes(agent)),
            "the boundary's job is to fail one call, not to end the session"
        );
        handle.tick();
        assert_eq!(handle.selected_index(), Some(agent));
    }

    #[test]
    fn the_staging_queue_is_capped_at_the_tuned_depth_rather_than_growing_without_bound() {
        // Nothing downstream bounds this queue. `max_queued_intents`
        // bounds one sim's orders and is only ever reached by a
        // `UseObject` that resolved to a live agent; every `Select`,
        // every `SetSpeed` and every command naming an index that no
        // longer exists lands here and touches no intent queue at all.
        // The commands below are deliberately of the kind that could
        // never reach the intent cap, so a test that passed because THAT
        // cap fired would be visible as a failure here.
        //
        // The queue is also what does not drain while the game is paused,
        // since nothing calls `tick`. Nothing ticks in this test for
        // exactly that reason.
        //
        // Three past the cap rather than one, so a cap off by one in
        // either direction is still visible.
        let mut handle = SimHandle::new(8, 8);
        let cap = command_cap(&handle);
        assert!(cap >= 1, "a cap of zero is rejected at build time");

        let mut accepted = 0;
        for _ in 0..cap + 3 {
            if handle.enqueue_command(&select_bytes(9)) {
                accepted += 1;
            }
        }

        assert_eq!(
            accepted,
            cap,
            "exactly the first {cap} commands must be accepted; \
             {} were issued",
            cap + 3
        );
        assert_eq!(
            staged(&handle),
            cap,
            "the queue must stop at the tuned cap rather than growing \
             with every click"
        );

        // And the cap is a bound on the QUEUE rather than a latch on the
        // handle: draining makes room again. Without this, refusing every
        // command after the first burst forever would pass everything
        // above and make the game unplayable after six seconds of
        // clicking.
        handle.tick();
        assert_eq!(staged(&handle), 0, "the tick must have drained it");
        assert!(
            handle.enqueue_command(&select_bytes(9)),
            "a drained queue must accept commands again"
        );
    }

    #[test]
    fn needs_of_reports_the_seven_levels_of_the_entity_the_index_names() {
        // The need-bar panel's whole input. [D-5] says the DOM renders
        // simulation state and owns none of it, so this is read every
        // frame rather than cached, and it has to be readable for an
        // arbitrary raw index because a raw index is all the shell has.
        //
        // The levels are made pairwise DISTINCT before the read, so an
        // implementation returning a constant array, or one need's level
        // seven times, is visible. A fixture where every level agreed
        // could not tell those apart ([L34]).
        let mut handle = SimHandle::new(16, 16);
        let mut needs = Needs::all_at(NEED_MAX);
        for (offset, id) in NeedId::ALL.into_iter().enumerate() {
            needs.set(id, 10.0 + offset as f32);
        }
        let agent = handle
            .sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, needs))
            .id()
            .index_u32();

        let levels = handle.needs_of(agent);
        assert_eq!(
            levels.len(),
            NEED_COUNT,
            "all seven levels must cross, in NeedId index order"
        );
        for (offset, _) in NeedId::ALL.into_iter().enumerate() {
            assert_eq!(
                levels[offset],
                10.0 + offset as f32,
                "slot {offset} must carry the need at that NeedId index; \
                 a transposed or constant array is what this catches"
            );
        }
    }

    #[test]
    fn needs_of_returns_an_empty_array_for_an_index_with_no_needs_to_report() {
        // Three ways an index can have nothing to show, and all three
        // must answer the same harmless way rather than panicking: the
        // panel draws no bars. A stale index is the hostile one - it is
        // what a click on a sim that despawned between the frame and the
        // handler looks like - and an object index is the ordinary one,
        // because a fridge has no needs and the shell cannot tell a
        // fridge from a sim by its number alone.
        //
        // The live agent is asserted non-empty in the same test, so
        // "returns empty" cannot be satisfied by an accessor that returns
        // empty for everything.
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(2.0, 2.0, "fridge"));
        let agent = spawn_agent_at(&mut handle, 1.0, 1.0, 40.0);
        let object = agent - 1;

        assert_eq!(
            handle.needs_of(agent).len(),
            NEED_COUNT,
            "the live sim must report levels, or every assertion below is \
             satisfied by an accessor that reports nothing for anything"
        );
        assert!(
            handle.needs_of(object).is_empty(),
            "a smart object has no needs; the panel must draw nothing \
             rather than seven zeroes, which would read as a desperate sim"
        );
        assert!(
            handle.needs_of(9_999).is_empty(),
            "an index past anything ever allocated must be ignored"
        );
        assert!(
            handle.needs_of(u32::MAX).is_empty(),
            "and so must u32::MAX, which is where a clamp or a wrap would \
             show"
        );
    }

    #[test]
    fn selected_index_tracks_the_selection_the_simulation_holds() {
        // [D-5]'s round trip in full: the shell asks with a command and
        // reads the answer back out of the simulation, so a replay
        // reproduces the selection rather than the DOM remembering it.
        //
        // TWO agents, because an accessor returning "the first agent" or
        // "the only agent" would satisfy a single-agent fixture. And the
        // clear is asserted as well, because `Select(None)` is a separate
        // arm from a stale index and the two must not be conflated - one
        // clears, the other leaves the selection alone.
        let mut handle = SimHandle::new(16, 16);
        let first = spawn_agent_at(&mut handle, 1.0, 1.0, 80.0);
        let second = spawn_agent_at(&mut handle, 3.0, 1.0, 80.0);
        assert_ne!(first, second);

        assert!(handle.enqueue_command(&select_bytes(second)));
        handle.tick();
        assert_eq!(
            handle.selected_index(),
            Some(second),
            "the sim the command named must be the one reported, not \
             whichever the query yields first"
        );

        assert!(handle.enqueue_command(&select_bytes(first)));
        handle.tick();
        assert_eq!(
            handle.selected_index(),
            Some(first),
            "and selecting another must move it rather than leaving two \
             marked, which is a state the shell cannot render"
        );

        // `Select(None)`: variant 0, Option tag 0, no payload.
        assert!(handle.enqueue_command(&[0x00, 0x00]));
        handle.tick();
        assert_eq!(
            handle.selected_index(),
            None,
            "Select(None) must clear, or the player cannot deselect at all"
        );
    }

    #[test]
    fn a_directed_sim_overrides_what_it_would_have_chosen_for_itself() {
        // **The end-to-end claim of the whole milestone, measured through
        // the boundary rather than inside the simulation.** [D-3] says a
        // player-issued intent beats autonomy, and the simulation-side
        // test for that lives in `terri_sim::systems::command`. This one
        // exists because that test cannot see the boundary: every
        // assertion it makes would still hold with `enqueue_command`
        // returning `false` for every byte it is given.
        //
        // The sim is HUNGRY and the two objects advertise different
        // needs, so autonomy has an unambiguous preference for the
        // fridge. Directing it at the BED is therefore an instruction it
        // would never have given itself - a script whose commands agree
        // with autonomy proves nothing ([L36]).
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(2.0, 8.0, "bed"));
        assert!(handle.spawn_object(11.0, 8.0, "fridge"));
        let bed = 0;
        let agent = spawn_agent_at(&mut handle, 8.0, 8.0, 20.0);
        assert_eq!(
            (bed, agent),
            (0, 2),
            "the assertions below read the render buffer by row, and rows \
             are sorted by entity index"
        );

        // What the sim does when nothing tells it otherwise, measured
        // rather than assumed. Without this the assertion below could be
        // describing autonomy's own choice.
        let mut autonomous = SimHandle::new(16, 16);
        assert!(autonomous.spawn_object(2.0, 8.0, "bed"));
        assert!(autonomous.spawn_object(11.0, 8.0, "fridge"));
        spawn_agent_at(&mut autonomous, 8.0, 8.0, 20.0);
        autonomous.tick();
        let undirected = autonomous.world_hash();

        assert!(handle.enqueue_command(&use_object_bytes(agent, bed)));
        handle.tick();

        assert_ne!(
            handle.world_hash(),
            undirected,
            "the directed run must reach a different world from the \
             undirected one; equal digests mean the command never reached \
             the simulation and this test would pass with the whole \
             boundary sealed shut"
        );

        // And it walks WEST, towards the bed, rather than east towards
        // the fridge autonomy wanted. The digest inequality above cannot
        // say which way it went; this can.
        for _ in 0..20 {
            handle.tick();
        }
        assert_eq!(handle.entity_count(), 3);
        let rows = addressed(
            handle.positions_ptr(),
            handle.entity_count() * 2,
            "positions_ptr",
        );
        let x = rows[agent as usize * 2];
        assert!(
            x < 8.0,
            "a sim directed at the bed at x=2 must move towards it; it is \
             at x={x}, which is towards the fridge it would have chosen \
             for itself"
        );
    }

    #[test]
    fn prev_positions_ptr_addresses_the_frame_before_the_last_sync() {
        // Two frames with DIFFERENT coordinates. On a first sync prev is
        // seeded from the current frame, so a single-frame test would be
        // unable to tell `prev_positions_ptr` from `positions_ptr` - both
        // hypotheses predict the same numbers, per testing-protocol rule 7.
        //
        // The second frame is produced by syncing directly rather than by
        // ticking, which keeps this test about the pointer instead of
        // about what the systems do to an idle agent.
        let mut handle = SimHandle::new(16, 16);
        handle.spawn_agent(1.0, 1.0, 80.0);

        let mut state = handle.sim.world_mut().query::<&mut Position>();
        for mut position in state.iter_mut(handle.sim.world_mut()) {
            position.x = 5.0;
            position.y = 7.0;
        }
        handle.sim.sync_render_buffer();

        let rows = handle.entity_count() * 2;
        assert_eq!(
            addressed(handle.prev_positions_ptr(), rows, "prev_positions_ptr"),
            vec![1.0, 1.0],
            "prev_positions_ptr must address the frame before the last sync; \
             the renderer interpolates from it towards the current frame"
        );
        assert_eq!(
            addressed(handle.positions_ptr(), rows, "positions_ptr"),
            vec![5.0, 7.0],
            "the two pointers must address different buffers; aliasing them \
             would interpolate every entity from itself and freeze motion"
        );
    }
}
