//! Schema thirty-one and remembered topic preferences: issue 359.
use super::*;
use crate::save::MAX_LIST_ENTRIES;
use crate::topic_memory::{Memory, TopicMemory};
use crate::Sim;
use terri_core::{save_v31::SavedTopicMemory, SimClock, SimId};

const NOW: u64 = 40;

fn row(knower: u32, other: u32, tag: &str, preference: f32, tick: u64) -> SavedTopicMemory {
    SavedTopicMemory {
        knower,
        other,
        tag: tag.into(),
        preference,
        tick,
    }
}

/// The shipped household at tick 40 with three memories, two held by
/// person 1 and one by person 2.
fn remembering() -> Sim {
    let mut sim = Sim::new_from_shipped_lot();
    sim.world_mut().resource_mut::<SimClock>().tick = NOW;
    let mut memory = sim.world_mut().resource_mut::<TopicMemory>();
    for (knower, other, tag, preference, tick) in [
        (2, 1, "reading", 0.25, 30),
        (1, 2, "subject:work", -0.75, 12),
        (1, 2, "exercise", 0.5, NOW),
    ] {
        memory.remember(
            Memory {
                knower: SimId(knower),
                other: SimId(other),
                tag: tag.into(),
                preference,
                tick,
            },
            100,
        );
    }
    sim
}

/// Schema thirty-one carries every memory through a save and load, in
/// knower, other and tag order, with the world digest unchanged, and the two
/// worlds run on alike.
#[test]
fn schema_thirty_one_round_trips_the_memories() {
    let mut sim = remembering();
    let snapshot = sim.save_snapshot_v31();
    assert_eq!(
        snapshot.topic_memory,
        vec![
            row(1, 2, "exercise", 0.5, NOW),
            row(1, 2, "subject:work", -0.75, 12),
            row(2, 1, "reading", 0.25, 30),
        ],
        "ascending by knower, other and tag"
    );
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v31(snapshot.clone()).expect("loads");
    assert_eq!(
        restored.world().resource::<TopicMemory>(),
        sim.world().resource::<TopicMemory>()
    );
    assert_eq!(restored.save_snapshot_v31(), snapshot);
    assert_eq!(restored.world_hash(), sim.world_hash());
    for _ in 0..240 {
        sim.tick();
        restored.tick();
    }
    assert_eq!(restored.world_hash(), sim.world_hash());
    assert_eq!(restored.save_snapshot_v31(), sim.save_snapshot_v31());
}

/// A schema-thirty save has no place for memories, so it loads with
/// nothing remembered, even into a world that remembers things, and hashes
/// as a world without memories does.
#[test]
fn a_schema_thirty_save_loads_with_nothing_remembered() {
    let sim = remembering();
    let without = {
        let mut copy = Sim::new_from_shipped_lot();
        copy.load_snapshot_v31(sim.save_snapshot_v31()).unwrap();
        copy.world_mut().insert_resource(TopicMemory::default());
        copy.world_hash()
    };
    let older = sim.save_snapshot_v30();
    let mut live = remembering();
    assert!(!live.world().resource::<TopicMemory>().is_empty());
    live.load_snapshot_v30(older).expect("loads");
    assert!(live.world().resource::<TopicMemory>().is_empty());
    assert_eq!(live.world_hash(), without);
    assert_ne!(live.world_hash(), sim.world_hash());
    assert!(live.save_snapshot_v31().topic_memory.is_empty());
}

/// Every bad row refuses the whole save and leaves the live world as it
/// was.
#[test]
fn the_loader_refuses_bad_rows() {
    let sim = remembering();
    let good = sim.save_snapshot_v31();
    let refused = |change: &dyn Fn(&mut Vec<SavedTopicMemory>), expected: SaveError| {
        let mut snapshot = good.clone();
        change(&mut snapshot.topic_memory);
        let mut live = remembering();
        let before = live.world_hash();
        assert_eq!(live.load_snapshot_v31(snapshot), Err(expected));
        assert_eq!(live.world_hash(), before);
    };
    // Order and duplicates.
    refused(&|rows| rows.swap(0, 2), SaveError::InvalidValue);
    refused(&|rows| rows.swap(0, 1), SaveError::InvalidValue);
    refused(
        &|rows| rows.insert(1, rows[0].clone()),
        SaveError::InvalidValue,
    );
    // Too many rows for the list cap, each otherwise good.
    refused(
        &|rows| {
            rows.clear();
            rows.extend(
                (0..=MAX_LIST_ENTRIES as u32).map(|at| row(1, 2, &format!("t{at:06}"), 0.0, 1)),
            );
        },
        SaveError::InvalidValue,
    );
    // Somebody nobody knows, either side.
    refused(
        &|rows| rows[2].knower = 999,
        SaveError::InvalidEntityReference,
    );
    refused(
        &|rows| rows[2].other = 999,
        SaveError::InvalidEntityReference,
    );
    // Remembering oneself.
    refused(&|rows| rows[2].other = 2, SaveError::InvalidValue);
    // A preference that is not a finite number from -1 to 1.
    for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 1.0625, -1.0625] {
        refused(
            &move |rows| rows[0].preference = bad,
            SaveError::InvalidValue,
        );
    }
    // A memory learned after the saved tick.
    refused(&|rows| rows[0].tick = NOW + 1, SaveError::InvalidValue);
    // An empty tag.
    refused(&|rows| rows[0].tag.clear(), SaveError::InvalidValue);

    // The boundaries load: a memory from this very tick and preferences of
    // exactly -1 and 1.
    let mut edge = good.clone();
    edge.topic_memory[0].preference = 1.0;
    edge.topic_memory[1].preference = -1.0;
    edge.topic_memory[2].tick = NOW;
    let mut live = Sim::new_from_shipped_lot();
    live.load_snapshot_v31(edge).expect("boundaries load");
}
