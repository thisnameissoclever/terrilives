//! Seeded ordinary households: dirt coverage and actual cleaning workload.
use std::collections::BTreeSet;
use terri_core::{
    chores::{ChoreKind, SavedChores},
    save::SavedDomestic,
    Agent, Position, SimRng, TileGrid,
};
use terri_sim::Sim;

fn main() {
    println!("seed,cleanliness,ticks,peak_dirty_tiles,final_dirty_tiles,final_grime_units,floor_work_ticks,surface_work_ticks,unvisited_dirty_tiles");
    for seed in [72, 149] {
        for clean in [0.0, 0.5, 1.0] {
            let mut sim = Sim::new_from_shipped_lot();
            sim.world_mut().insert_resource(SimRng::from_seed(seed));
            let people: Vec<_> = sim
                .world_mut()
                .query_filtered::<terri_core::Entity, bevy_ecs::prelude::With<Agent>>()
                .iter(sim.world())
                .map(|e| e.index_u32())
                .collect();
            let domestic = SavedDomestic {
                cleanliness: people.iter().map(|p| (*p, clean)).collect(),
                ..Default::default()
            };
            sim.world_mut().insert_resource(domestic);
            let width = sim.world().resource::<TileGrid>().width() as u32;
            let ticks = sim
                .world()
                .resource::<terri_sim::Content>()
                .0
                .tuning
                .day_ticks
                * 3;
            let mut visited = BTreeSet::new();
            let mut peak = 0;
            let mut floor_ticks = 0;
            let mut surface_ticks = 0;
            for _ in 0..ticks {
                sim.tick();
                for pos in sim
                    .world_mut()
                    .query_filtered::<&Position, bevy_ecs::prelude::With<Agent>>()
                    .iter(sim.world())
                {
                    if pos.x >= 0.0 && pos.y >= 0.0 {
                        visited.insert(pos.y.round() as u32 * width + pos.x.round() as u32);
                    }
                }
                let state = sim.world().resource::<SavedChores>();
                peak = peak.max(state.floors.len());
                for task in &state.tasks {
                    if task.suspended || task.remaining == 0 {
                        continue;
                    }
                    if task.key.kind == ChoreKind::Floors {
                        floor_ticks += 1;
                    } else if task.key.kind.grouped() || task.key.kind == ChoreKind::Surfaces {
                        surface_ticks += 1;
                    }
                }
            }
            let state = sim.world().resource::<SavedChores>();
            let unvisited = state
                .floors
                .iter()
                .filter(|r| !visited.contains(&r.0))
                .count();
            assert_eq!(unvisited, 0, "unused tiles must stay clean");
            println!(
                "{seed},{clean},{ticks},{peak},{},{},{floor_ticks},{surface_ticks},{unvisited}",
                state.floors.len(),
                state.floors.iter().map(|r| u32::from(r.1)).sum::<u32>()
            );
        }
    }
}
