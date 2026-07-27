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
}

impl Default for Sim {
    fn default() -> Self {
        Self::new()
    }
}

fn advance_clock(mut clock: ResMut<SimClock>) {
    clock.advance();
}
