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

        let mut schedule = Schedule::default();
        // M0 runs single-threaded on purpose. Parallelism is [A9]/[D4]
        // and requires the commutativity rule; keeping it off now makes
        // determinism trivially safe.
        schedule.set_executor_kind(ExecutorKind::SingleThreaded);
        schedule.add_systems((advance_clock, systems::needs::decay_needs).chain());

        Self { world, schedule }
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
