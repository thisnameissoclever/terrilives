//! The ONLY crate that knows JavaScript exists.
//! Nothing in here may contain simulation logic.

use terri_core::{Agent, Hunger, Position, SmartObject, NEED_MAX, NEED_MIN};
use terri_sim::Sim;
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
/// 1. `-1.0` is `world_hash`'s in-band "this entity has no Hunger"
///    sentinel. `Hunger(-1.0)` digests identically to a Hunger-less
///    entity at the same position, so a JS caller could silently collapse
///    a real distinction the determinism hash depends on. `terri-sim`
///    guards that with a `debug_assert!`, which is **compiled out of the
///    release build** - and `wasm-pack build` produces a release build,
///    so on the only target that ships, the guard is not there.
/// 2. `f32::NAN` does not self-heal. `f32::clamp` propagates NaN rather
///    than replacing it, and `advertise.rs` documents where a NaN need
///    ends up: NaN loses every comparison, so the agent would simply
///    never choose to do anything, forever, with no panic and no log.
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
        self.sim
            .world_mut()
            .spawn((Agent, Position { x, y }, Hunger(hunger)));
        self.sim.sync_render_buffer();
    }

    /// Coordinates are sanitised here rather than trusted. See
    /// [`sanitize_coord`].
    pub fn spawn_object(&mut self, x: f32, y: f32) {
        let x = sanitize_coord(x);
        let y = sanitize_coord(y);
        self.sim.world_mut().spawn((
            Position { x, y },
            SmartObject {
                hunger_delta: 40.0,
                duration_ticks: 15,
                slots: 1,
            },
        ));
        self.sim.sync_render_buffer();
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
    /// growth involved. Since `tick`, `spawn_agent` and `spawn_object`
    /// each sync, a pointer read before any of them is already stale
    /// afterwards and will be pointing at the other frame's data.
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

    /// Hunger levels as the ECS actually stored them.
    fn stored_hungers(handle: &SimHandle) -> Vec<f32> {
        let world = handle.sim.world();
        let mut state = world
            .try_query::<&Hunger>()
            .expect("Hunger is registered eagerly in Sim::new");
        state.iter(world).map(|hunger| hunger.0).collect()
    }

    /// Positions as the ECS actually stored them.
    fn stored_positions(handle: &SimHandle) -> Vec<(f32, f32)> {
        let world = handle.sim.world();
        let mut state = world
            .try_query::<&Position>()
            .expect("Position is registered eagerly in Sim::new");
        state.iter(world).map(|pos| (pos.x, pos.y)).collect()
    }

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
            handle.spawn_object(poison, poison);
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
        handle.spawn_object(3.5, 6.25);
        assert_eq!(stored_positions(&handle), vec![(3.5, 6.25)]);
    }

    #[test]
    fn hunger_from_js_cannot_alias_the_world_hash_no_hunger_sentinel() {
        // The causal form, and the finding this whole boundary exists for.
        // `world_hash` encodes "this entity has no Hunger" as the in-band
        // value -1.0, so an unsanitised `Hunger(-1.0)` hashes exactly like
        // a Hunger-less entity at the same position. Measured before the
        // fix: both worlds below digested to 0x06ef64bc902dd05f.
        //
        // Everything except the hunger term is held constant, per [L7]:
        // both handles are built by the same constructor, both spawn
        // exactly one entity as their first spawn (so the entity indices
        // match), neither ticks (so the clock term matches), and both sit
        // at the same position. `world_hash` reads only the clock, the
        // entity index, the position and the hunger, so the hunger term is
        // the only thing that can move the digest.
        let mut agent_at_sentinel_hunger = SimHandle::new(8, 8);
        agent_at_sentinel_hunger.spawn_agent(1.0, 2.0, -1.0);

        let mut entity_with_no_hunger = SimHandle::new(8, 8);
        entity_with_no_hunger.spawn_object(1.0, 2.0);

        assert_ne!(
            agent_at_sentinel_hunger.world_hash(),
            entity_with_no_hunger.world_hash(),
            "Hunger(-1.0) arriving from JavaScript hashed identically to an \
             entity with no Hunger at all; world_hash's in-band sentinel is \
             reachable across the boundary and terri-sim's debug_assert \
             guard is compiled out of the release wasm build that ships"
        );
    }
}
