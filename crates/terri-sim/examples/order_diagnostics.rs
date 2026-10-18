//! Reproducible native diagnostic costs, including a full retained history.
//! Run with `cargo run -p terri-sim --example order_diagnostics --profile test`.
use std::time::Instant;
use terri_core::{Agent, CommandQueue, SimCommand, SmartObject};
use terri_sim::{Content, Sim};

fn read_cost(sim: &Sim, cursor: u64, repetitions: usize) -> f64 {
    let start = Instant::now();
    for _ in 0..repetitions {
        std::hint::black_box(sim.action_events_since(cursor));
    }
    start.elapsed().as_secs_f64() * 1_000_000.0 / repetitions as f64
}

fn fixture_entities(sim: &mut Sim) -> (terri_core::Entity, terri_core::Entity) {
    let actor = sim
        .world_mut()
        .query_filtered::<terri_core::Entity, bevy_ecs::prelude::With<Agent>>()
        .iter(sim.world())
        .min_by_key(|entity| entity.index_u32())
        .expect("the shipped household has a person");
    let pack = sim.world().resource::<Content>().0;
    let object = sim
        .world_mut()
        .query::<(terri_core::Entity, &SmartObject)>()
        .iter(sim.world())
        .filter(|(_, object)| pack.object(object.0).id == "fridge")
        .map(|(entity, _)| entity)
        .min_by_key(|entity| entity.index_u32())
        .expect("the shipped house has a fridge");
    (actor, object)
}

fn main() {
    for count in [32, 256, 1024] {
        let mut batch_sim = Sim::new_from_shipped_lot();
        let (actor, object) = fixture_entities(&mut batch_sim);
        for _ in 0..count {
            batch_sim
                .world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObject {
                    agent: actor.index_u32(),
                    object: object.index_u32(),
                    interaction: 0,
                });
        }
        let started = Instant::now();
        batch_sim.flush_commands();
        println!(
            "enqueue_{count}_orders_ms={:.3}",
            started.elapsed().as_secs_f64() * 1000.0
        );
        println!("enqueue_{count}_gameplay_hash={}", batch_sim.world_hash());
        assert_eq!(batch_sim.queued_orders_of(actor.index_u32()), count);
    }
    if std::env::args().any(|argument| argument == "--admission-only") {
        return;
    }
    let mut sim = Sim::new_from_shipped_lot();
    let (actor, object) = fixture_entities(&mut sim);
    let start = Instant::now();
    for _ in 0..64 {
        for _ in 0..32 {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObject {
                    agent: actor.index_u32(),
                    object: object.index_u32(),
                    interaction: 0,
                });
        }
        sim.flush_commands();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::CancelIntents {
                agent: actor.index_u32(),
            });
        sim.flush_commands();
    }
    let capture_ms = start.elapsed().as_secs_f64() * 1000.0;
    let batch = sim.action_events_since(0);
    assert_eq!(batch.events.len(), 2048);
    assert!(batch.expired);
    let mut empty = Sim::new_from_shipped_lot();
    empty
        .load_snapshot_v17(sim.save_snapshot_v17())
        .expect("the same gameplay state restores");
    assert_eq!(
        sim.world_hash(),
        empty.world_hash(),
        "retained history is not gameplay state"
    );
    println!("capture_and_cancel_2048_orders_ms={capture_ms:.3}");
    println!(
        "empty_history_tail_read_us={:.3}",
        read_cost(&empty, 0, 10_000)
    );
    println!(
        "full_history_tail_read_us={:.3}",
        read_cost(&sim, batch.next_cursor, 10_000)
    );
    println!("copy_full_2048_history_us={:.3}", read_cost(&sim, 0, 100));
    for instance in [&mut sim, &mut empty] {
        for _ in 0..2 {
            instance
                .world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObject {
                    agent: actor.index_u32(),
                    object: object.index_u32(),
                    interaction: 0,
                });
        }
        instance.flush_commands();
    }
    assert_eq!(sim.world_hash(), empty.world_hash());
    for _ in 0..300 {
        sim.tick();
        empty.tick();
        assert_eq!(
            sim.world_hash(),
            empty.world_hash(),
            "diagnostics must not change later behavior"
        );
    }
    println!("identical_gameplay_ticks=300");
}
