//! Deterministic month-scale observation of the shipped household.
use bevy_ecs::prelude::Entity;
use terri_core::{Satisfaction, SimName};

fn main() {
    let mut sim = terri_sim::Sim::new_from_shipped_lot();
    let days = [0, 1, 7, 30, 90, 180, 365];
    println!("day,name,satisfaction,mood");
    let mut elapsed = 0;
    for day in days {
        while elapsed < day * 1440 {
            sim.tick();
            elapsed += 1;
        }
        let mut query = sim
            .world()
            .try_query::<(Entity, &SimName, &Satisfaction)>()
            .unwrap();
        let mut rows: Vec<_> = query
            .iter(sim.world())
            .map(|(entity, name, score)| {
                let mood = sim.mood_of(entity.index_u32()).unwrap().overall_score;
                (name.0.clone(), score.value(), mood)
            })
            .collect();
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        for (name, score, mood) in rows {
            println!("{day},{name},{score:.3},{mood:.3}");
        }
    }
}
