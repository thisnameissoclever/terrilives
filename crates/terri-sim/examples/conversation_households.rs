//! Release measurement of ordinary household survival, company and argument balance.
//! Run: cargo run --release -p terri-sim --example conversation_households -- 1 31 20
use bevy_ecs::prelude::*;
use terri_core::{
    chores::SavedChores, save::SavedMortality, Agent, NeedId, Needs, Relationships, SimId, SimRng,
};
use terri_sim::{relationship_effects::RelationshipCause, Content, Sim};

fn main() {
    let args: Vec<_> = std::env::args().collect();
    let first: u64 = args.get(1).map_or(1, |s| s.parse().expect("first seed"));
    let last: u64 = args.get(2).map_or(31, |s| s.parse().expect("last seed"));
    let days: u64 = args.get(3).map_or(20, |s| s.parse().expect("game days"));
    assert!(first <= last && days > 0);
    println!("seed,days,initial_people,living_people,deaths,first_death_tick,completed_fights,conversation_opinion_events,mean_mood,hostile_samples,opinion_samples,maximum_deprivation,mean_hunger,mean_energy,mean_hygiene,mean_bladder,mean_social,mean_fun,mean_comfort,critical_hunger_minutes,critical_energy_minutes,critical_hygiene_minutes,critical_bladder_minutes,critical_social_minutes,critical_fun_minutes,critical_comfort_minutes,daily_roundtrips");
    for seed in first..=last {
        let mut sim = Sim::new_from_shipped_lot();
        sim.world_mut().insert_resource(SimRng::from_seed(seed));
        if let Some(mut chores) = sim.world_mut().get_resource_mut::<SavedChores>() {
            chores.rng = Some(SimRng::from_seed(seed ^ 0x4348_4f52_4553));
        }
        sim.world_mut().resource_mut::<SavedMortality>().enabled = true;
        let day = u64::from(sim.world().resource::<Content>().0.tuning.day_ticks);
        let initial = sim
            .world_mut()
            .query_filtered::<&SimId, With<Agent>>()
            .iter(sim.world())
            .count();
        let mut sums = [0f64; 7];
        let mut critical = [0u64; 7];
        let mut samples = 0u64;
        let mut fights = 0u64;
        let mut chats = 0u64;
        let mut mood = 0f64;
        let mut mood_samples = 0u64;
        let mut hostile = 0u64;
        let mut opinions = 0u64;
        let mut deprivation = 0u32;
        let mut roundtrips = 0u64;
        for elapsed in 1..=day * days {
            sim.tick();
            fights += sim
                .relationship_effects()
                .iter()
                .filter(|e| e.cause == RelationshipCause::Fight)
                .count() as u64;
            chats += sim
                .relationship_effects()
                .iter()
                .filter(|e| e.cause == RelationshipCause::Conversation)
                .count() as u64;
            let people: Vec<_> = sim
                .world_mut()
                .query_filtered::<(Entity, &SimId, &Needs), With<Agent>>()
                .iter(sim.world())
                .map(|(e, id, n)| (e, *id, *n))
                .collect();
            for (entity, _, needs) in &people {
                for need in NeedId::ALL {
                    let index = need.index();
                    sums[index] += f64::from(needs.get(need));
                    critical[index] += u64::from(needs.get(need) <= 20.);
                }
                samples += 1;
                deprivation = deprivation.max(sim.deprivation_ticks(entity.index_u32()));
                if elapsed % 60 == 0 {
                    if let Some(value) = sim.mood_of(entity.index_u32()) {
                        mood += f64::from(value.overall_score);
                        mood_samples += 1;
                    }
                    for (_, other, _) in &people {
                        if sim.world().get::<SimId>(*entity) == Some(other) {
                            continue;
                        }
                        let feeling = sim
                            .world()
                            .get::<Relationships>(*entity)
                            .map_or(0., |r| r.feeling(*other));
                        hostile += u64::from(feeling <= -0.5);
                        opinions += 1;
                    }
                }
            }
            if elapsed % day == 0 {
                let saved = sim.save_snapshot_v20();
                let hash = sim.world_hash();
                let mut loaded = Sim::new_from_shipped_lot();
                loaded
                    .load_snapshot_v20(saved.clone())
                    .unwrap_or_else(|error| {
                        panic!("seed {seed}, tick {elapsed}: current daily save refused: {error:?}")
                    });
                assert_eq!(
                    loaded.world_hash(),
                    hash,
                    "seed {seed}, tick {elapsed}: daily save changes behavior"
                );
                assert_eq!(
                    loaded.save_snapshot_v20(),
                    saved,
                    "seed {seed}, tick {elapsed}: daily save changes records"
                );
                roundtrips += 1;
            }
        }
        let living = sim
            .world_mut()
            .query_filtered::<&SimId, With<Agent>>()
            .iter(sim.world())
            .count();
        let first_death = sim.death_records().first().map_or(0, |r| r.tick);
        print!("{seed},{days},{initial},{living},{},{first_death},{},{},{:.6},{hostile},{opinions},{deprivation}", sim.death_records().len(), fights / 2, chats, mood / mood_samples.max(1) as f64);
        for value in sums {
            print!(",{:.6}", value / samples.max(1) as f64);
        }
        for value in critical {
            print!(",{value}");
        }
        println!(",{roundtrips}");
    }
}
