use terri_sim::Sim;
fn main() {
    let output = std::env::args().nth(1).expect("fixture output directory");
    let mut sim = Sim::new_from_shipped_lot();
    for tick in [0, 400, 1200] {
        while sim.world().resource::<terri_core::SimClock>().tick < tick {
            sim.tick();
        }
        let snapshot = sim.save_snapshot_v9();
        let mut bytes = terri_core::SAVE_MAGIC.to_vec();
        bytes.extend(terri_core::SAVE_SCHEMA_VERSION.to_le_bytes());
        bytes.extend(postcard::to_allocvec(&snapshot).unwrap());
        assert_eq!(&bytes[8..10], &[9, 0]);
        std::fs::write(format!("{output}/main-social-{tick}.sav"), bytes).unwrap();
        println!(
            "captured main V9 tick {tick}: {} topics, {} communal, {} waiting",
            snapshot.social.topics.len(),
            snapshot.social.communal.len(),
            snapshot.social.rendezvous.len()
        );
    }
    let mut sim = Sim::new_from_shipped_lot();
    let people: Vec<_> = sim
        .save_snapshot()
        .entities
        .iter()
        .filter(|e| e.agent)
        .map(|e| e.index)
        .collect();
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::TalkTo {
            agent: people[0],
            target: people[1],
            interaction: 0,
        });
    sim.flush_commands();
    let mut captured = false;
    for _ in 0..5000 {
        sim.tick();
        let snapshot = sim.save_snapshot_v9();
        if !snapshot.social.topics.is_empty() {
            let mut bytes = terri_core::SAVE_MAGIC.to_vec();
            bytes.extend(terri_core::SAVE_SCHEMA_VERSION.to_le_bytes());
            bytes.extend(postcard::to_allocvec(&snapshot).unwrap());
            std::fs::write(format!("{output}/main-social-active.sav"), bytes).unwrap();
            println!(
                "captured active main V9 conversation at tick {}",
                snapshot.legacy.legacy.world.tick
            );
            captured = true;
            break;
        }
    }
    assert!(
        captured,
        "commanded conversation must produce a topic fixture"
    );
}
