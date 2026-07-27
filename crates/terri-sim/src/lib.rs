//! Simulation systems and scheduling. No web dependencies, ever.

pub mod systems;

use bevy_ecs::prelude::*;
use bevy_ecs::schedule::ExecutorKind;
use terri_core::SimClock;

/// Owns the ECS world and the tick schedule.
pub struct Sim {
    world: World,
    schedule: Schedule,
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
    /// expected to move.
    pub fn new() -> Self {
        let mut world = World::new();
        world.insert_resource(SimClock::default());
        // A placeholder lot so Res<TileGrid> never panics. Callers that
        // care about the lot use new_with_lot, which replaces this.
        world.insert_resource(terri_core::TileGrid::new(1, 1));

        // Register components eagerly. This is NOT optional bookkeeping:
        // World::try_query returns None if ANY component in the query is
        // unregistered, including one behind Option<&T>. Task 7's
        // world_hash uses try_query, so without this a world that never
        // spawned a Hunger would hash zero rows and the determinism test
        // would pass by comparing two empty hashes - green while testing
        // nothing. Later tasks must add their components here too.
        world.register_component::<terri_core::Position>();
        world.register_component::<terri_core::Agent>();
        world.register_component::<terri_core::Hunger>();
        world.register_component::<terri_core::SmartObject>();
        world.register_component::<terri_core::Reserved>();
        world.register_component::<terri_core::Path>();
        world.register_component::<terri_core::Target>();
        world.register_component::<terri_core::Eating>();

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
                systems::action::select_action,
                systems::movement::follow_path,
                systems::interact::tick_interactions,
            )
                .chain(),
        );

        Self { world, schedule }
    }

    /// Creates a sim with an empty walkable lot of the given size.
    pub fn new_with_lot(width: usize, height: usize) -> Self {
        let mut sim = Self::new();
        sim.world
            .insert_resource(terri_core::TileGrid::new(width, height));
        sim
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

    /// Hashes all simulation-visible state. Entities are sorted by index
    /// first, because ECS iteration order is an implementation detail and
    /// must not affect the result.
    pub fn world_hash(&self) -> u64 {
        use terri_core::{Hunger, Position};

        let mut hasher = terri_core::FnvHasher::default();
        hasher.write_u64(self.world.resource::<SimClock>().tick);

        // (entity index, x, y, hunger). Hunger is -1.0 for entities that
        // have none, which distinguishes "no need" from "starving".
        let mut rows: Vec<(u32, f32, f32, f32)> = Vec::new();
        if let Some(mut state) = self
            .world
            .try_query::<(Entity, &Position, Option<&Hunger>)>()
        {
            for (entity, pos, hunger) in state.iter(&self.world) {
                let hunger = hunger.map_or(-1.0, |h| h.0);
                rows.push((entity.index_u32(), pos.x, pos.y, hunger));
            }
        }
        // The sort is load-bearing: query iteration is archetype order,
        // not entity order, and archetype order shifts as components are
        // added and removed. `hash_ignores_archetype_layout_and_entity_history`
        // is what pins it; deleting this line must fail that test.
        rows.sort_by_key(|(index, _, _, _)| *index);

        for (index, x, y, hunger) in rows {
            hasher.write_u64(index as u64);
            hasher.write_f32(x);
            hasher.write_f32(y);
            hasher.write_f32(hunger);
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
mod determinism_tests {
    use super::*;
    use terri_core::{Agent, Eating, Hunger, Position, SmartObject};

    fn build_scenario() -> Sim {
        let mut sim = Sim::new_with_lot(24, 24);
        sim.world_mut().spawn((
            Position { x: 18.0, y: 14.0 },
            SmartObject {
                hunger_delta: 40.0,
                duration_ticks: 15,
                slots: 1,
            },
        ));
        for i in 0..8 {
            sim.world_mut().spawn((
                Agent,
                Position {
                    x: 1.0 + i as f32,
                    y: 1.0,
                },
                Hunger(30.0 + i as f32 * 5.0),
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
            .try_query::<(Entity, &Position, Option<&Hunger>)>()
            .expect("every component in the hash query must be registered");
        state
            .iter(sim.world())
            .map(|(entity, _, _)| entity.index_u32())
            .collect()
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

    #[test]
    fn identical_scenarios_produce_identical_world_hashes() {
        let mut a = build_scenario();
        let mut b = build_scenario();

        for _ in 0..500 {
            a.tick();
            b.tick();
        }

        // Guard against the empty-hash trap before asserting equality.
        // If any queried component were unregistered, try_query would
        // yield zero rows and this test would pass by comparing two
        // identical empty hashes - permanently green while testing
        // nothing. See lessons-learned [L3]. Any test that can pass on
        // empty input needs an assertion that the input was not empty.
        let empty = Sim::new_with_lot(24, 24);
        assert_ne!(
            a.world_hash(),
            empty.world_hash(),
            "world hash equals an empty world's; the hash is seeing no entities"
        );

        assert_eq!(
            a.world_hash(),
            b.world_hash(),
            "simulation diverged; determinism is broken"
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
        // the same logical state must hash the same even when they
        // reached it by different histories, because a peer that joined
        // late, or that saw entities die in a different order, has a
        // different archetype layout for identical state. This test
        // builds that difference deliberately and asserts the difference
        // exists at the moment the hashes are compared - without that
        // precondition the test would silently degrade into a second
        // copy of the one above.
        const TICKS: usize = 500;

        let mut a = build_scenario();
        let mut b = build_scenario();

        // b reaches the same tick count by a different route. A bystander
        // entity is born, lives one tick and dies, and one agent leaves
        // and re-enters its table. Neither changes what the simulation
        // computes: the bystander carries neither Agent nor SmartObject
        // nor Hunger nor Path, so no system's query matches it, and the
        // insert/remove pair is applied between ticks where no system can
        // observe it. Both change the order the ECS yields entities in,
        // because leaving an archetype swap-removes an entity from its
        // table and re-entering appends it at the back.
        let bystander = b.world_mut().spawn(Position { x: 23.0, y: 23.0 }).id();
        let victim = lowest_indexed_agent(&b);
        b.world_mut().entity_mut(victim).insert(Eating {
            remaining_ticks: 1,
            delta_per_tick: 0.0,
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
        let empty = Sim::new_with_lot(24, 24);
        assert_ne!(
            a.world_hash(),
            empty.world_hash(),
            "world hash equals an empty world's; the hash is seeing no entities"
        );

        assert_eq!(
            a.world_hash(),
            b.world_hash(),
            "identical state hashed differently because the two worlds got \
             there by different histories; the hash depends on archetype \
             order, which breaks state comparison across peers"
        );
    }
}
