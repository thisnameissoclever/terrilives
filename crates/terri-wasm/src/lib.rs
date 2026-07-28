//! The ONLY crate that knows JavaScript exists.
//! Nothing in here may contain simulation logic.

use terri_core::{Agent, NeedId, Needs, Position, SmartObject, NEED_MAX, NEED_MIN};
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
    use terri_core::SimClock;

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
