//! Simulation systems and scheduling. No web dependencies, ever.

pub mod render_buffer;
pub mod systems;
#[cfg(test)]
pub mod test_content;

use bevy_ecs::prelude::*;
use bevy_ecs::schedule::ExecutorKind;
use terri_core::SimClock;

/// The content pack, as a resource so systems can resolve object ids and
/// decay rates. Holds a `&'static` because the pack is embedded at build
/// time and deserialised once.
///
/// Systems read this rather than calling `terri_data::pack()` directly,
/// which is what lets a test point a world at a pack of its own.
#[derive(Resource, Debug, Clone, Copy)]
pub struct Content(pub &'static terri_data::ContentPack);

/// Owns the ECS world and the tick schedule.
pub struct Sim {
    world: World,
    schedule: Schedule,
    render: render_buffer::RenderBuffer,
}

impl Sim {
    /// Creates a sim with a **1x1 placeholder lot**, so only tile (0, 0)
    /// is walkable.
    ///
    /// Only suitable for worlds that never path: need decay, clock, and
    /// component-level tests. Any world built with `Sim::new` or
    /// `Sim::default` that contains a smart object will have every
    /// `find_path` return `None` on every tick, so agents silently never
    /// go anywhere - no panic, no log, and the sim looks alive because
    /// needs still decay. Use [`Sim::new_with_lot`] whenever agents are
    /// expected to move, or [`Sim::new_from_lot`] to load an authored
    /// lot with its walls and objects.
    pub fn new() -> Self {
        let mut world = World::new();
        world.insert_resource(SimClock::default());
        // A placeholder lot so Res<TileGrid> never panics. Callers that
        // care about the lot use new_with_lot, which replaces this.
        world.insert_resource(terri_core::TileGrid::new(1, 1));
        world.insert_resource(Content(terri_data::pack()));
        // The simulation PRNG, as a world resource per [D-3]. Randomness
        // must not mean nondeterminism: the golden hashes, replay, the
        // save-file command log and the planned multiplayer all rest on
        // the simulation being bit-reproducible, so every draw comes from
        // here and the seed is content rather than a wall clock.
        //
        // Seeded from the pack, which means from `content/tuning.toml`.
        // A test that installs its own pack must reseed to match - see
        // `test_content::sim_with`, which does.
        world.insert_resource(terri_core::SimRng::from_seed(
            terri_data::pack().tuning.rng_seed,
        ));

        // Register components eagerly. This is NOT optional bookkeeping:
        // World::try_query returns None if ANY component in the query is
        // unregistered, including one behind Option<&T>. Task 7's
        // world_hash uses try_query, so without this a world that never
        // spawned a Needs would hash zero rows and the determinism test
        // would pass by comparing two empty hashes - green while testing
        // nothing. Later tasks must add their components here too.
        world.register_component::<terri_core::Position>();
        world.register_component::<terri_core::Agent>();
        world.register_component::<terri_core::Needs>();
        world.register_component::<terri_core::SmartObject>();
        world.register_component::<terri_core::Reserved>();
        world.register_component::<terri_core::Path>();
        world.register_component::<terri_core::Target>();
        world.register_component::<terri_core::Eating>();
        world.register_component::<terri_core::Restless>();
        world.register_component::<terri_core::Wander>();
        // M1b Task 4's two. Neither is in `world_hash`'s query today, so
        // an unregistered one would not silently empty the digest the way
        // [L3] describes - but `try_query` is what every determinism test
        // in this file reaches for, and a component missing from this
        // list turns those into panics for a reason that has nothing to
        // do with what they test.
        // `the_components_m1b_added_are_registered_before_any_system_runs`
        // is what fails if either line goes.
        world.register_component::<terri_core::Selected>();
        world.register_component::<terri_core::IntentQueue>();

        let mut schedule = Schedule::default();
        // M0 runs single-threaded on purpose. Parallelism is [A9]/[D4]
        // and requires the commutativity rule; keeping it off now makes
        // determinism trivially safe.
        schedule.set_executor_kind(ExecutorKind::SingleThreaded);
        // Order matches the tick pipeline in ARCHITECTURE.md [D5],
        // reduced to the systems M0 needs.
        schedule.add_systems(
            (
                advance_clock,
                systems::needs::decay_needs,
                // Strictly before selection, because a player-issued
                // intent overrides autonomy rather than competing with
                // it - [D-3]. Running it first means the object is
                // already `Reserved` and the agent already has a
                // `Target` by the time `select_action` looks, so no
                // other agent can be handed the thing the player just
                // asked for.
                //
                // It also sees agents that are mid-walk or mid-meal,
                // which `select_action` deliberately does not, because
                // an intent PREEMPTS a running interaction. See that
                // function's docs for why that is the choice.
                systems::action::serve_intents,
                systems::action::select_action,
                // Strictly after selection and strictly before movement,
                // and both halves matter. After, because it reads the
                // `Restless` marker selection has just written, so a sim
                // that found something worth doing this tick never gets
                // as far as considering a stroll. Before, because a
                // wander path is then walked on the tick it is chosen,
                // exactly like a path to an object - a wander that had
                // to wait a tick would read as a hesitation.
                systems::idle::wander,
                systems::movement::follow_path,
                systems::interact::tick_interactions,
            )
                .chain(),
        );

        Self {
            world,
            schedule,
            render: render_buffer::RenderBuffer::default(),
        }
    }

    /// Creates a sim with an empty walkable lot of the given size.
    pub fn new_with_lot(width: usize, height: usize) -> Self {
        let mut sim = Self::new();
        sim.world
            .insert_resource(terri_core::TileGrid::new(width, height));
        sim
    }

    /// Creates a sim holding a compiled lot: the grid sized to it, its
    /// walls marked unwalkable, and every placed object spawned.
    ///
    /// This is what makes `content/lot.toml` reach the game. Everything
    /// it reads is post-validation, so nothing here re-checks it:
    /// `terri-data`'s `compile` rejects a wall or a placement outside the
    /// lot, and `build.rs` runs that validation over the shipped content
    /// at build time, so a pack that exists cannot hold either. That is
    /// what lets `set_blocked` be called without a bounds test - it
    /// asserts, and an assertion firing here would mean the content gate
    /// had been removed rather than that this function needs a guard.
    ///
    /// The lot is passed in rather than read from `terri_data::pack()` so
    /// a test can build one, for the same reason [`Content`] is a
    /// resource rather than a direct call into the content crate.
    pub fn new_from_lot(lot: &terri_data::CompiledLot) -> Self {
        let mut sim = Self::new();

        let mut grid = terri_core::TileGrid::new(lot.width as usize, lot.height as usize);
        for &(x, y) in &lot.walls {
            grid.set_blocked(x as usize, y as usize, true);
        }
        sim.world.insert_resource(grid);

        for placement in &lot.placements {
            sim.world.spawn((
                terri_core::Position {
                    x: placement.x,
                    y: placement.y,
                },
                terri_core::SmartObject(placement.object),
            ));
        }

        sim
    }

    /// The lot the game ships, compiled from `content/lot.toml`.
    ///
    /// A convenience over [`Sim::new_from_lot`] for callers that do not
    /// depend on `terri-data` themselves. `terri-wasm` is the one that
    /// matters: it is the boundary crate, and keeping the content crate
    /// out of its manifest keeps its dependency list as small as the [D1]
    /// purity rule can make it.
    pub fn new_from_shipped_lot() -> Self {
        Self::new_from_lot(&terri_data::pack().lot)
    }

    pub fn tick(&mut self) {
        self.schedule.run(&mut self.world);
    }

    pub fn world(&self) -> &World {
        &self.world
    }

    pub fn world_mut(&mut self) -> &mut World {
        &mut self.world
    }

    /// Copies render-relevant state into the struct-of-arrays buffer that
    /// JavaScript views directly. Called once per tick, before the
    /// renderer reads.
    ///
    /// Entities are sorted by index so an entity keeps its slot between
    /// frames. This is load-bearing rather than tidiness: the renderer
    /// interpolates slot `i` of `prev_positions` towards slot `i` of
    /// `positions` and assumes both belong to the same entity. Query
    /// iteration is archetype order, which shifts every time any entity
    /// gains or loses a component, so without the sort entities would
    /// smear across each other's positions whenever an agent started or
    /// stopped eating. `entity_slots_survive_archetype_churn` pins it;
    /// deleting the sort must fail that test.
    pub fn sync_render_buffer(&mut self) {
        use terri_core::{Agent, Position, SmartObject};

        std::mem::swap(&mut self.render.prev_positions, &mut self.render.positions);
        self.render.positions.clear();
        self.render.kinds.clear();
        self.render.sprites.clear();

        // Read before the query, because `Content` is a resource and the
        // query below borrows the world. `ContentPack` is behind a
        // &'static so this is a pointer copy, not a clone.
        let content = self.world.resource::<Content>().0;

        // World::query (not try_query) registers components on demand and
        // cannot fail, so there is no Option to handle here. It returns an
        // owned QueryState, which ends the &mut borrow immediately and
        // leaves self.render free to write below.
        let mut state = self
            .world
            .query::<(Entity, &Position, Has<Agent>, Option<&SmartObject>)>();
        let mut rows: Vec<(u32, f32, f32, u32, u32)> = Vec::new();
        for (entity, pos, is_agent, object) in state.iter(&self.world) {
            let kind = if is_agent { 0 } else { 1 };
            // An entity that is neither an agent nor a smart object has
            // no sprite of its own; the sim's is the only sensible
            // stand-in, and nothing in M1b spawns one. `world_hash`'s
            // bystander fixture is the only thing that ever has.
            let sprite =
                object.map_or(content.sim_sprite, |placed| content.object(placed.0).sprite);
            rows.push((entity.index_u32(), pos.x, pos.y, kind, sprite));
        }
        rows.sort_by_key(|(index, _, _, _, _)| *index);

        for (_, x, y, kind, sprite) in &rows {
            self.render.positions.push(*x);
            self.render.positions.push(*y);
            self.render.kinds.push(*kind);
            self.render.sprites.push(*sprite);
        }
        self.render.count = rows.len();

        // On the first sync there is no previous frame, and a changed
        // row count invalidates the slot mapping wholesale, so seed prev
        // from the current frame to avoid interpolating from garbage or
        // from another entity's coordinates.
        //
        // Read the guard as what it is: a length check, not a membership
        // check. **An unchanged count does not imply an unchanged entity
        // set.** It catches pure additions and pure removals, because
        // those move the length. It does NOT catch one addition and one
        // removal between the same two syncs: `bevy_ecs` reuses freed
        // entity indices, so the new entity can land on the departed
        // one's index, keep its sorted slot, and change only the occupant.
        // Task 12 would then interpolate that slot from the dead entity's
        // last position to the new entity's first one and draw something
        // streaking across the lot in a single frame.
        //
        // Unreachable in M0 - nothing despawns - which is why this is a
        // comment and not a fix. The fix, for whoever first adds a
        // despawn: keep the previous frame's sorted index list alongside
        // `prev_positions` and reseed whenever the new list differs from
        // it, rather than whenever the lengths differ.
        if self.render.prev_positions.len() != self.render.positions.len() {
            self.render.prev_positions = self.render.positions.clone();
        }
    }

    pub fn render_buffer(&self) -> &render_buffer::RenderBuffer {
        &self.render
    }

    /// Hashes all simulation-visible state. Entities are sorted by index
    /// first, because ECS iteration order is an implementation detail and
    /// must not affect the result.
    pub fn world_hash(&self) -> u64 {
        use terri_core::{Needs, Position, NEED_COUNT};

        let mut hasher = terri_core::FnvHasher::default();
        hasher.write_u64(self.world.resource::<SimClock>().tick);

        // (entity index, x, y, all seven need levels). Every level is
        // NO_NEEDS for entities carrying no `Needs` at all, which
        // distinguishes "no needs" from "desperate on all of them".
        //
        // All seven are hashed. The shape was fixed while only hunger
        // moved, deliberately: the digest is a published format across
        // the WASM boundary, so settling it once cost one golden-vector
        // update instead of one per need as the others came alive. Task 7
        // made all seven decay and moved the vector's VALUE without
        // touching its shape, which is the payoff.
        const NO_NEEDS: f32 = -1.0;

        let mut rows: Vec<(u32, f32, f32, [f32; NEED_COUNT])> = Vec::new();
        if let Some(mut state) = self
            .world
            .try_query::<(Entity, &Position, Option<&Needs>)>()
        {
            for (entity, pos, needs) in state.iter(&self.world) {
                // The sentinel is in-band, so a real level equal to it
                // would hash as if the component were absent. `Needs`
                // holds a private array and every mutator clamps to
                // NEED_MIN = 0.0, so today the type system prevents it
                // outright - but that is a property of terri-core's
                // implementation, invisible from here, so pin it. If
                // needs ever go negative, this sentinel must move out of
                // band.
                debug_assert!(
                    needs.is_none_or(|n| n.as_slice().iter().all(|&l| l != NO_NEEDS)),
                    "a need level of {NO_NEEDS} aliases world_hash's no-Needs sentinel"
                );
                let levels = needs.map_or([NO_NEEDS; NEED_COUNT], |n| *n.as_slice());
                rows.push((entity.index_u32(), pos.x, pos.y, levels));
            }
        }
        // The sort is load-bearing: query iteration is archetype order,
        // not entity order, and archetype order shifts as components are
        // added and removed. `hash_ignores_archetype_layout_and_entity_history`
        // is what pins it; deleting this line must fail that test.
        rows.sort_by_key(|(index, _, _, _)| *index);

        for (index, x, y, levels) in rows {
            hasher.write_u64(index as u64);
            hasher.write_f32(x);
            hasher.write_f32(y);
            for level in levels {
                hasher.write_f32(level);
            }
        }

        hasher.finish()
    }
}

impl Default for Sim {
    fn default() -> Self {
        Self::new()
    }
}

fn advance_clock(mut clock: ResMut<SimClock>) {
    clock.advance();
}

#[cfg(test)]
mod lot_tests {
    //! `Sim::new_from_lot` is a three-part mapping - grid size, wall
    //! tiles, placed objects - and each part is checked separately, per
    //! [L7] rule 3. The fixture is deliberately asymmetric everywhere it
    //! can be: a non-square lot, walls whose transposes are not walls,
    //! and placements whose object ids differ from their own positions in
    //! the list. [L26] is the recorded instance of a tidy fixture hiding
    //! an index-to-slot bug one layer down, and [L29] is the one where a
    //! fixture whose candidates agreed on the field being read made the
    //! read untestable.

    use super::*;
    use terri_core::{Position, SmartObject, TileGrid};
    use terri_data::{CompiledLot, CompiledPlacement, ObjectDefId};

    /// A 6x4 lot: wider than it is tall, so a transposed `TileGrid::new`
    /// is visible; walls whose transposes and cross products are free, so
    /// a single-coordinate or swapped `set_blocked` is visible; and two
    /// placements at distinct positions carrying distinct definitions, so
    /// a definition collapsed to zero or a coordinate pair swapped is
    /// visible.
    fn a_lot() -> CompiledLot {
        CompiledLot {
            width: 6,
            height: 4,
            walls: vec![(3, 2), (1, 0)],
            placements: vec![
                CompiledPlacement {
                    object: ObjectDefId(2),
                    x: 2.5,
                    y: 1.25,
                },
                CompiledPlacement {
                    object: ObjectDefId(0),
                    x: 4.0,
                    y: 3.5,
                },
            ],
        }
    }

    /// Every (position, definition) pair in the world, sorted by entity
    /// index so the assertion can be exact.
    fn placed_objects(sim: &Sim) -> Vec<(f32, f32, ObjectDefId)> {
        let mut state = sim
            .world()
            .try_query::<(Entity, &Position, &SmartObject)>()
            .expect("Position and SmartObject are registered eagerly in Sim::new");
        let mut rows: Vec<(u32, f32, f32, ObjectDefId)> = state
            .iter(sim.world())
            .map(|(entity, pos, placed)| (entity.index_u32(), pos.x, pos.y, placed.0))
            .collect();
        rows.sort_by_key(|(index, _, _, _)| *index);
        rows.into_iter().map(|(_, x, y, def)| (x, y, def)).collect()
    }

    #[test]
    fn new_from_lot_sizes_the_grid_to_the_lot_rather_than_transposing_it() {
        let sim = Sim::new_from_lot(&a_lot());
        let grid = sim.world().resource::<TileGrid>();

        assert_eq!(grid.width(), 6);
        assert_eq!(grid.height(), 4);
        // The same claim through behaviour, so the two accessors above
        // cannot both be satisfied by a grid that is actually 4 by 6.
        assert!(grid.is_walkable(5, 3), "(5, 3) is the far corner of 6x4");
        assert!(!grid.is_walkable(3, 5), "(3, 5) is outside a 6x4 lot");
    }

    #[test]
    fn new_from_lot_blocks_every_declared_wall_and_only_those() {
        let lot = a_lot();
        let sim = Sim::new_from_lot(&lot);
        let grid = sim.world().resource::<TileGrid>();

        assert!(!lot.walls.is_empty(), "a lot with no walls blocks nothing");
        for &(x, y) in &lot.walls {
            assert!(
                !grid.is_walkable(x as i32, y as i32),
                "the declared wall at ({x}, {y}) must be unwalkable"
            );
        }
        // The transposes and the cross products of the two declared
        // walls, none of which is a wall. Without these, blocking
        // `(y, x)` or blocking a whole row or column would pass.
        for (x, y, why) in [
            (2, 3, "(2, 3) is (3, 2) transposed"),
            (0, 1, "(0, 1) is (1, 0) transposed"),
            (3, 0, "x alone must not block a tile"),
            (1, 2, "y alone must not block a tile"),
        ] {
            assert!(grid.is_walkable(x, y), "{why}");
        }
    }

    #[test]
    fn new_from_lot_spawns_each_placement_at_its_own_position_and_definition() {
        assert_eq!(
            placed_objects(&Sim::new_from_lot(&a_lot())),
            vec![(2.5, 1.25, ObjectDefId(2)), (4.0, 3.5, ObjectDefId(0))],
            "each placement must reach the world with its own coordinates \
             and its own definition; a shared definition means the id is \
             not being carried, and swapped coordinates mean x and y are \
             transposed on the way in"
        );
    }

    #[test]
    fn the_shipped_lot_loads_its_walls_its_doorway_and_all_of_its_objects() {
        // The synthetic fixture above pins the mapping; this pins that
        // the mapping is applied to the content the game actually ships,
        // which is the whole reason this function exists. It reads the
        // lot rather than restating it, so it stays true when the lot is
        // re-authored - but the counts and the doorway are asserted
        // against numbers, because a lot that compiled to nothing would
        // satisfy any purely self-referential check.
        //
        // It goes through `new_from_shipped_lot`, which is the entry
        // point `terri-wasm` calls, so that thin wrapper is constrained
        // by something rather than being an untested public function.
        let lot = &terri_data::pack().lot;
        let sim = Sim::new_from_shipped_lot();
        let grid = sim.world().resource::<TileGrid>();

        assert_eq!(
            (grid.width(), grid.height()),
            (lot.width as usize, lot.height as usize)
        );
        assert_eq!(
            placed_objects(&sim).len(),
            lot.placements.len(),
            "every placement in the shipped lot must be spawned"
        );
        assert!(
            placed_objects(&sim).len() >= 8,
            "[D-6] calls for roughly eight objects; got {}",
            placed_objects(&sim).len()
        );

        // The bathroom's west wall is solid at y = 1 and y = 3 and OPEN at
        // y = 2. That gap is the doorway, and it is the property the whole
        // lot turns on: without it the bathroom is sealed and the shower
        // and toilet are unreachable, which is a silent behaviour change
        // rather than a visible one ([L17]).
        //
        // These coordinates are deliberately literal rather than derived
        // from the content, so that editing the lot fails this test and
        // forces someone to look at whether the room still works. It has
        // already done that job once, when the lot shrank from 24x18 to
        // 14x10.
        assert!(!grid.is_walkable(9, 1), "the bathroom wall must be solid");
        assert!(!grid.is_walkable(9, 3), "the bathroom wall must be solid");
        assert!(grid.is_walkable(9, 2), "the doorway at (9, 2) must be open");

        // And the bathroom is genuinely reachable from the living space,
        // stated as a path rather than as a hole in a wall, because that
        // is the thing the game depends on.
        assert!(
            grid.find_path((2, 2), (11, 1)).is_some(),
            "the shower must be reachable from the kitchen"
        );
    }
}

#[cfg(test)]
mod determinism_tests {
    use super::*;
    use crate::test_content::shipped_fridge;
    use terri_core::{Agent, Eating, NeedId, Needs, Position};

    fn build_scenario() -> Sim {
        let mut sim = Sim::new_with_lot(24, 24);
        // The shipped fridge, deliberately: the golden vector below is
        // only a statement about the game if the scenario is built out of
        // the content the game ships.
        sim.world_mut()
            .spawn((Position { x: 18.0, y: 14.0 }, shipped_fridge()));
        for i in 0..8 {
            sim.world_mut().spawn((
                Agent,
                Position {
                    x: 1.0 + i as f32,
                    y: 1.0,
                },
                Needs::with(NeedId::Hunger, 30.0 + i as f32 * 5.0),
            ));
        }
        sim
    }

    /// The entity indices `world_hash`'s query yields in raw ECS order,
    /// with no sorting applied. This is precisely the order the hash must
    /// NOT be sensitive to, so comparing it between two worlds is how the
    /// layout test below proves it is exercising a real ordering
    /// difference rather than passing decoratively.
    fn raw_iteration_order(sim: &Sim) -> Vec<u32> {
        let mut state = sim
            .world()
            .try_query::<(Entity, &Position, Option<&Needs>)>()
            .expect("every component in the hash query must be registered");
        state
            .iter(sim.world())
            .map(|(entity, _, _)| entity.index_u32())
            .collect()
    }

    /// An entity-free world advanced to `ticks`, for the guards below.
    ///
    /// Ticking it is load-bearing. `world_hash` writes the clock before
    /// the entity rows, so an *unticked* empty world differs from any
    /// ticked world by the clock term alone: the guard would then pass
    /// even if the row block emitted nothing at all, which is the exact
    /// failure it was written to prevent. See lessons-learned [L7].
    fn empty_world_at(ticks: usize) -> Sim {
        let mut sim = Sim::new_with_lot(24, 24);
        for _ in 0..ticks {
            sim.tick();
        }
        sim
    }

    /// Asserts `sim`'s hash is not simply an empty world's, holding
    /// every other term in the digest constant so only the entity rows
    /// can account for the difference. Guards the [L3] trap: if any
    /// queried component were unregistered, `try_query` would yield zero
    /// rows and the equality tests would pass by comparing two identical
    /// empty hashes - permanently green while testing nothing.
    fn assert_hash_sees_entities(sim: &Sim, ticks: usize) {
        let empty = empty_world_at(ticks);
        assert_eq!(
            sim.world().resource::<SimClock>().tick,
            empty.world().resource::<SimClock>().tick,
            "the empty world must sit at the same tick, or the clock term \
             alone makes this guard pass and it checks nothing"
        );
        assert_ne!(
            sim.world_hash(),
            empty.world_hash(),
            "world hash equals an empty world's at the same tick; the hash \
             is seeing no entities"
        );
    }

    fn lowest_indexed_agent(sim: &Sim) -> Entity {
        let mut state = sim
            .world()
            .try_query_filtered::<Entity, With<Agent>>()
            .expect("Agent must be registered");
        state
            .iter(sim.world())
            .min_by_key(|entity| entity.index_u32())
            .expect("the scenario spawns agents")
    }

    /// The world's PRNG exists and is seeded from `content/tuning.toml`,
    /// which is the [D-3] claim that "randomness must not mean
    /// nondeterminism" rests on. A generator seeded from a wall clock, or
    /// from a constant somebody typed, would satisfy every other test in
    /// this module.
    ///
    /// Read through `Sim::new_with_lot` rather than by reaching into
    /// `Sim::new`, because that is what every caller uses.
    ///
    /// The `assert_ne` is the vacuity guard: comparing against the tuned
    /// seed alone would also be satisfied by a generator seeded from
    /// literally anything, if the comparison were computed the same wrong
    /// way twice. A second seed that must NOT match is what excludes it.
    #[test]
    fn the_worlds_prng_is_seeded_from_the_tuned_rng_seed() {
        use terri_core::SimRng;

        let sim = Sim::new_with_lot(8, 8);
        let mut world_rng = sim.world().resource::<SimRng>().clone();
        let seed = terri_data::pack().tuning.rng_seed;

        let mut tuned = SimRng::from_seed(seed);
        let mut other = SimRng::from_seed(seed.wrapping_add(1));
        let from_world: Vec<u32> = (0..4).map(|_| world_rng.next_u32()).collect();

        assert_ne!(
            from_world[0], from_world[1],
            "a frozen generator would satisfy the rest of this test"
        );
        assert_ne!(
            from_world,
            (0..4).map(|_| other.next_u32()).collect::<Vec<_>>(),
            "the world's generator must not agree with a DIFFERENT seed, \
             or this test cannot tell the tuned value from any other"
        );
        assert_eq!(
            from_world,
            (0..4).map(|_| tuned.next_u32()).collect::<Vec<_>>(),
            "the world's generator must be the one content/tuning.toml's \
             rng_seed produces, and must not have been advanced before any \
             system ran"
        );
    }

    /// The two components M1b Task 4 added are registered by `Sim::new`
    /// itself, before any system has run.
    ///
    /// **This world is deliberately never ticked**, which is the whole
    /// mechanism: running the schedule initialises every system's query
    /// and registers their components as a side effect, so a ticked world
    /// would report success no matter what `Sim::new` did. `try_query` is
    /// the read that cares - it returns `None` on any unregistered
    /// component rather than registering on demand, which is [L3] - and
    /// several fixtures in this crate `expect` it.
    ///
    /// `Selected` has no reader at all until Task 5's command drain, so
    /// this is the only thing constraining its registration line.
    #[test]
    fn the_components_m1b_added_are_registered_before_any_system_runs() {
        use terri_core::{IntentQueue, Selected};

        let sim = Sim::new_with_lot(8, 8);
        assert!(
            sim.world()
                .try_query_filtered::<Entity, With<Selected>>()
                .is_some(),
            "Selected is not registered, so try_query returns None and \
             every fixture that reads it panics for the wrong reason"
        );
        assert!(
            sim.world()
                .try_query_filtered::<Entity, With<IntentQueue>>()
                .is_some(),
            "IntentQueue is not registered"
        );
        // The guard on the guard: a component this world has genuinely
        // never heard of must come back None, or `try_query` is not the
        // discriminating read this test assumes it is and both assertions
        // above would hold for an empty registration list.
        #[derive(Component)]
        struct NeverRegistered;
        assert!(
            sim.world()
                .try_query_filtered::<Entity, With<NeverRegistered>>()
                .is_none(),
            "try_query answered for a component nothing ever registered, \
             so it cannot tell a registered component from an unregistered \
             one and this test proves nothing"
        );
    }

    #[test]
    fn identical_scenarios_produce_identical_world_hashes() {
        const TICKS: usize = 500;

        let mut a = build_scenario();
        let mut b = build_scenario();

        for _ in 0..TICKS {
            a.tick();
            b.tick();
        }

        // Guard against the empty-hash trap before asserting equality.
        // Any test that can pass on empty input needs an assertion that
        // the input was not empty. See lessons-learned [L3] and [L7].
        assert_hash_sees_entities(&a, TICKS);

        assert_eq!(
            a.world_hash(),
            b.world_hash(),
            "simulation diverged; determinism is broken"
        );
    }

    #[test]
    fn hash_observes_entity_state_not_only_the_clock() {
        // The other tests all move the clock, and world_hash writes the
        // clock as well as the entity rows, so a digest difference there
        // never isolates which term produced it. This test never ticks:
        // the clock is frozen, the entity set is frozen, and the only
        // thing that changes is one field on one entity. That makes it
        // the only test in the suite that can see the row block at all.
        //
        // Mutation-verified: without this, deleting the whole row
        // collection from world_hash, or just the two position writes,
        // or just the need writes, leaves every other test green.
        //
        // It checks that SOME need reaches the digest.
        // `hash_observes_every_need_not_only_hunger` below is what checks
        // that all seven do.
        let mut sim = build_scenario();
        let baseline = sim.world_hash();
        let agent = lowest_indexed_agent(&sim);

        sim.world_mut().get_mut::<Position>(agent).unwrap().x += 1.0;
        assert_ne!(baseline, sim.world_hash(), "world_hash ignores Position.x");
        sim.world_mut().get_mut::<Position>(agent).unwrap().x -= 1.0;
        assert_eq!(
            baseline,
            sim.world_hash(),
            "restoring state must restore the digest"
        );

        sim.world_mut().get_mut::<Position>(agent).unwrap().y += 1.0;
        assert_ne!(baseline, sim.world_hash(), "world_hash ignores Position.y");
        sim.world_mut().get_mut::<Position>(agent).unwrap().y -= 1.0;
        assert_eq!(
            baseline,
            sim.world_hash(),
            "restoring state must restore the digest"
        );

        let hunger = sim.world().get::<Needs>(agent).unwrap().get(NeedId::Hunger);
        sim.world_mut()
            .get_mut::<Needs>(agent)
            .unwrap()
            .set(NeedId::Hunger, hunger + 1.0);
        assert_ne!(baseline, sim.world_hash(), "world_hash ignores Needs");
    }

    #[test]
    fn hash_observes_every_need_not_only_hunger() {
        // Written when hunger was the only need that decayed, the only
        // one an interaction filled and the only one selection scored, so
        // that every other test in the workspace would have stayed green
        // with the other six levels absent from the digest. Task 7 made
        // all seven decay, so the golden vector would now move if a level
        // went missing - but only for a need whose rate is non-zero, and
        // only in that one scenario. This test still isolates each level
        // one at a time, on a frozen clock, which is the only thing here
        // that can name WHICH one stopped reaching the digest.
        //
        // Causal rather than comparative, per docs/testing-protocol.md
        // rule 3: perturb exactly one level, require the digest to move,
        // restore it, and require the digest to come back. Restoring is
        // what rules out a hash that merely reacts to being touched.
        let mut sim = build_scenario();
        let baseline = sim.world_hash();
        let agent = lowest_indexed_agent(&sim);

        for id in NeedId::ALL {
            let before = sim.world().get::<Needs>(agent).unwrap().get(id);
            // Downwards, so a need already sitting at NEED_MAX moves
            // instead of being clamped back to where it started.
            sim.world_mut()
                .get_mut::<Needs>(agent)
                .unwrap()
                .set(id, before - 1.0);
            assert_ne!(
                baseline,
                sim.world_hash(),
                "world_hash ignores the {} level",
                id.as_str()
            );
            sim.world_mut()
                .get_mut::<Needs>(agent)
                .unwrap()
                .set(id, before);
            assert_eq!(
                baseline,
                sim.world_hash(),
                "restoring the {} level must restore the digest",
                id.as_str()
            );
        }
    }

    /// The golden vector. Everything else in this module compares two
    /// digests computed by the same binary, which pins reproducibility
    /// but says nothing about the value itself. From Task 8 onward
    /// `world_hash` is exported across the WASM boundary and JavaScript
    /// depends on it, so the digest is a published format: a change to
    /// the hash's encoding, to the field order, to the FNV constants, or
    /// to what the simulation computes over 100 ticks would otherwise be
    /// completely invisible to the suite.
    ///
    /// **If this number changes, that is a finding, not a rebase
    /// artifact.** Update it only when you can name the simulation
    /// behaviour change that moved it, and say so in the commit message.
    /// An unexplained change means the sim is no longer computing what it
    /// computed before, which is exactly the bug this vector exists to
    /// surface.
    ///
    /// It covers **one** platform pair for free: CI runs on Linux and
    /// this machine is Windows, so a divergence in float arithmetic or
    /// iteration order between those two shows up here.
    ///
    /// It does **not** cover the platform pair Task 8 actually created,
    /// which is native versus wasm32. This test runs natively on both
    /// sides of the Linux/Windows comparison, so wasm is not among them.
    /// That gap is concrete rather than theoretical: `write_f32` calls
    /// `f32::round`, which is round-half-away-from-zero in Rust and does
    /// not map to wasm's round-half-to-even `f32.nearest`, so rustc emits
    /// a different code path there - and every position and every one of
    /// the seven need levels in this digest passes through it.
    ///
    /// The boundary is covered by
    /// `reproduces the native golden world hash across the wasm boundary`
    /// in web/tests/bridge.test.ts, which rebuilds this exact scenario
    /// through the JavaScript API and compares against the same constant.
    /// Measured: the two agree. **If you change `GOLDEN` here, change it
    /// there too, or the boundary check silently stops being one.**
    #[test]
    fn world_hash_matches_its_golden_vector() {
        const TICKS: usize = 100;
        // Moved deliberately at Task 7's content-driven decay, and this
        // time it is a SIMULATION change rather than an encoding one.
        // Every need now drains at the rate `content/tuning.toml`
        // declares for it, so the six levels that used to sit pinned at
        // their spawn value for all 100 ticks now fall - six of the seven
        // per-entity f32s in every agent's row move, on every tick. The
        // digest's shape is untouched.
        //
        // Positions and hunger are unchanged: the fridge advertises
        // hunger only, so nothing the other six do can reach scoring, and
        // the same eight agents still eat at the same ticks. Only the
        // levels moved.
        //
        // Previous values: 0x6C37_57F1_8481_75C1 (Task 6, at the
        // Hunger-to-Needs encoding change), 0xEF60_1D50_4790_5825 before
        // that.
        //
        // Measured on wasm32 as well as natively, per [L13], rather than
        // assumed to carry across: the two agree. The boundary copy lives
        // in web/tests/bridge.test.ts.
        //
        // **M1b Task 3b did NOT move it, and that is worth knowing rather
        // than reassuring.** Selection changed from Euclidean distance to
        // A* path length, which is a real behaviour change, and this
        // scenario cannot see it: one object means there is nothing to
        // rank, and the only agent that ever claims it is still walking
        // its 30 tiles at tick 100 - movement always used A*, so its
        // position is identical either way. The metric is pinned by
        // `an_object_behind_a_wall_loses_to_a_further_one_the_agent_can_walk_to`
        // instead. Recorded as [L36]; do not read this vector as covering
        // how candidates are ordered.
        //
        // **M1c Task 3 did not move it either, for the same reason, and
        // that was predicted to be otherwise.** Selection became a
        // softmax-weighted draw rather than an argmax - the milestone's
        // central change - and this scenario still cannot see it. There
        // is one object, so every agent that gets a candidate at all gets
        // exactly one, and a one-candidate draw has one answer at every
        // temperature and every seed. `sample_softmax` even computes the
        // same weight for it, `exp(0.0)`, which is exactly 1.0 on every
        // target.
        //
        // That last sentence is load-bearing rather than trivia: it is
        // why this vector stays safe to compare across native and wasm32
        // now that selection calls `exp`. A scenario with two live
        // candidates would put a libm result inside the digest's causal
        // chain, and `f32::exp` is a platform call with no cross-target
        // bit-identity guarantee - the same hazard `score_advertisement`
        // avoids by refusing `powf`. **Anybody adding a second object to
        // this scenario is changing what this vector is exposed to, not
        // just what it covers.** Weighted selection is pinned by
        // `a_higher_scoring_object_is_chosen_more_often_and_a_lower_one_still_sometimes`
        // and by the two tie tests, all of which are robust to a
        // last-bit difference.
        //
        // **M1c Task 4 did not move it either, and this time for a
        // SECOND, independent reason worth knowing.** [D-4] made every
        // interaction's length a sampled value and put a 25-tick floor
        // under it, which raises the fridge's snack from 15 ticks. This
        // scenario cannot see that because **no agent ever eats in it**:
        // the fridge sits 30 tiles from the nearest agent, movement
        // covers 0.25 tiles a tick, so arrival is at tick ~121 and this
        // vector stops at 100. Measured, not deduced - a probe over the
        // 100 ticks found no `Eating` component at any point and exactly
        // one agent still walking at the end.
        //
        // So the scenario is blind to durations AND to the PRNG draw
        // durations consume, on top of being blind to how candidates are
        // ranked. Read together with the two paragraphs above, that is a
        // statement about this fixture rather than about the milestone:
        // one object 30 tiles away exercises decay, movement and the
        // digest, and nothing else. **Anyone who wants this vector to
        // cover selection or duration has to change the scenario**, and
        // the paragraph above sets out what a second object would cost.
        //
        // **M1c Task 5 DID move it, and this is the first M1c change that
        // this scenario could see.** [D-5] sends a sim with nothing worth
        // doing for a stroll instead of leaving it standing still, and
        // seven of these eight agents have nothing worth doing from tick
        // one: the single fridge is claimed by the lowest-indexed agent
        // and every other agent skips a reserved object, so its best
        // score is nothing at all and it is marked restless. Those seven
        // now wander. Fourteen of the sixteen coordinates in the digest
        // move, on almost every tick.
        //
        // That is a behaviour change and it is the intended one. It also
        // means this vector now covers the seeded PRNG for the first
        // time, because a wander destination is drawn from it - so a
        // change to `SimRng`, to the draw ORDER, or to the wander
        // roll will now surface here rather than only in the unit tests.
        //
        // Previous value: 0x2FC6_69EF_A725_4F2D (Task 7's content-driven
        // decay, unmoved by M1b Task 3b and by M1c Tasks 3 and 4).
        //
        // Measured on wasm32 as well as natively, per [L13], rather than
        // assumed to carry across: the two agree. The boundary copy lives
        // in web/tests/bridge.test.ts.
        const GOLDEN: u64 = 0x5A49_3BA9_F7FB_F23B;

        let mut sim = build_scenario();
        for _ in 0..TICKS {
            sim.tick();
        }

        assert_hash_sees_entities(&sim, TICKS);
        assert_eq!(
            sim.world_hash(),
            GOLDEN,
            "the world hash of a fixed scenario at tick {TICKS} changed; \
             either the digest encoding moved or the simulation no longer \
             computes what it did. Do not update the constant without \
             naming which"
        );
    }

    #[test]
    fn hash_changes_as_the_world_evolves() {
        let mut sim = build_scenario();
        let before = sim.world_hash();
        for _ in 0..50 {
            sim.tick();
        }
        assert_ne!(before, sim.world_hash());
    }

    #[test]
    fn hash_ignores_archetype_layout_and_entity_history() {
        // The test above runs two identical scenarios in one process, so
        // both share an archetype layout and cannot disagree about
        // ordering by construction - lessons-learned [L5] is three
        // recorded instances of exactly that shape being permanently
        // green. It proves the hash is REPRODUCIBLE. It does not prove
        // the hash is CORRECT.
        //
        // What Layer 2 multiplayer needs is stronger: two worlds holding
        // the same logical state, **and having allocated the same entity
        // indices for it**, must hash the same even when their ECS
        // layouts got there by different routes, because entities that
        // lived and died in a different order leave a different
        // archetype layout behind. This test builds that difference
        // deliberately and asserts the difference exists at the moment
        // the hashes are compared - without that precondition the test
        // would silently degrade into a second copy of the one above.
        //
        // The index clause is a real limit, not pedantry. world_hash
        // keys rows on Entity::index_u32(), which is itself allocation
        // history, so a peer that joined late and allocated different
        // indices for the same logical entities hashes differently. What
        // this test pins is layout-insensitivity, not history- or
        // index-insensitivity. Entity generation is unhashed as well, so
        // a despawn/respawn that reuses an index aliases with the
        // original. Both are known M0 limits; Layer 2 will need a stable
        // network id in place of the raw index.
        const TICKS: usize = 500;

        let mut a = build_scenario();
        let mut b = build_scenario();

        // b reaches the same tick count by a different route. A bystander
        // entity is born, lives one tick and dies, and one agent leaves
        // and re-enters its table. Neither changes what the simulation
        // computes: the bystander carries neither Agent nor SmartObject
        // nor Needs nor Path, so no system's query matches it, and the
        // insert/remove pair is applied between ticks where no system can
        // observe it. Both change the order the ECS yields entities in,
        // because leaving an archetype swap-removes an entity from its
        // table and re-entering appends it at the back.
        let bystander = b.world_mut().spawn(Position { x: 23.0, y: 23.0 }).id();
        let victim = lowest_indexed_agent(&b);
        b.world_mut().entity_mut(victim).insert(Eating {
            object: shipped_fridge().0,
            interaction: 0,
            remaining_ticks: 1,
        });
        b.world_mut().entity_mut(victim).remove::<Eating>();

        a.tick();
        b.tick();
        assert!(
            b.world_mut().despawn(bystander),
            "the bystander must actually be despawned or b holds an extra row"
        );

        for _ in 1..TICKS {
            a.tick();
            b.tick();
        }

        // Preconditions. Without these the test can pass while proving
        // nothing at all.
        let order_a = raw_iteration_order(&a);
        let order_b = raw_iteration_order(&b);
        assert_ne!(
            order_a, order_b,
            "the two worlds must iterate in different orders or this test \
             cannot detect an ordering dependency; got {order_a:?}"
        );
        let mut sorted_a = order_a.clone();
        let mut sorted_b = order_b.clone();
        sorted_a.sort_unstable();
        sorted_b.sort_unstable();
        assert_eq!(
            sorted_a, sorted_b,
            "the two worlds must hold the same entities; only their order \
             may differ"
        );
        assert_eq!(
            a.world().resource::<SimClock>().tick,
            b.world().resource::<SimClock>().tick,
            "both runs must have advanced the same number of ticks"
        );
        assert_hash_sees_entities(&a, TICKS);

        assert_eq!(
            a.world_hash(),
            b.world_hash(),
            "identical state hashed differently because the two worlds got \
             there by different histories; the hash depends on archetype \
             order, which breaks state comparison across peers"
        );
    }
}
