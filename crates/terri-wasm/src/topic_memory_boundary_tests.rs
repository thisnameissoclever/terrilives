//! Remembered topic preferences across the browser boundary: issue 359.
use super::*;
use crate::current_test_snapshot::{CurrentV5View, CURRENT_CATALOGUE_FINGERPRINT};
use terri_core::{SaveSnapshotV30, SaveSnapshotV31, SaveSnapshotV33};
use terri_sim::topic_memory::TopicMemory;

const EVENING: &[u8] =
    include_bytes!("../tests/fixtures/topic-memory-v30/new-game-two-days-evening.sav");
const SUNDAY: &[u8] =
    include_bytes!("../tests/fixtures/topic-memory-v30/new-game-sunday-evening.sav");

/// Main's schema-30 saves, which have no place for memories, load with
/// nothing remembered, preserve the schema-30 state with the current
/// catalogue fingerprint, and resume identically after another load.
#[test]
fn main_schema_thirty_saves_load_with_nothing_remembered_and_save_current() {
    for (name, bytes) in [("evening", EVENING), ("sunday", SUNDAY)] {
        assert_eq!(&bytes[8..10], &30u16.to_le_bytes(), "{name}");
        let (original, tail) =
            postcard::take_from_bytes::<SaveSnapshotV30>(&bytes[SAVE_HEADER_BYTES..]).unwrap();
        assert!(tail.is_empty(), "{name}");
        let original = CurrentV5View(SaveSnapshotV33 {
            previous: SaveSnapshotV31 {
                current: original,
                topic_memory: vec![],
            },
            hobby_mood: vec![],
        });
        assert_eq!(original.world.content_fingerprint, 0xf7e3_a71d_c98e_ff9d);
        let mut migrated = SimHandle::from_lot();
        assert!(migrated.load_bytes(bytes), "{name}");
        assert!(
            migrated.sim.world().resource::<TopicMemory>().is_empty(),
            "{name}: an older save remembers nothing"
        );
        let current = migrated.save_bytes();
        assert_eq!(
            &current[8..10],
            &SAVE_SCHEMA_VERSION.to_le_bytes(),
            "{name}"
        );
        let mut saved = CurrentV5View(decode_current(&current));
        assert!(saved.0.topic_memory.is_empty(), "{name}");
        assert_eq!(
            saved.world.content_fingerprint,
            CURRENT_CATALOGUE_FINGERPRINT
        );
        saved.world.content_fingerprint = original.world.content_fingerprint;
        assert_eq!(saved.0.current, original.0.current, "{name}");

        let mut resumed = SimHandle::from_lot();
        assert!(resumed.load_bytes(&current), "{name}");
        assert_eq!(resumed.save_bytes(), current, "{name}");
        for tick in 0..1440 {
            migrated.tick();
            resumed.tick();
            assert_eq!(
                migrated.world_hash(),
                resumed.world_hash(),
                "{name}: diverged {tick} ticks after load"
            );
        }
        assert_eq!(migrated.save_bytes(), resumed.save_bytes(), "{name}");
    }
}

/// A household that remembers chats saves them in the current schema, and
/// a reload carries them on unchanged.
#[test]
fn memories_cross_the_boundary_through_a_save() {
    let mut handle = SimHandle::from_lot();
    assert!(handle.load_bytes(SUNDAY));
    // Two game days: the first after this save, a Monday, happens to leave
    // no remembered chat.
    for _ in 0..2 * 1440 {
        handle.tick();
    }
    let bytes = handle.save_bytes();
    let saved = decode_current(&bytes);
    assert!(
        !saved.topic_memory.is_empty(),
        "two days of chats leave memories"
    );
    let mut reloaded = SimHandle::from_lot();
    assert!(reloaded.load_bytes(&bytes));
    assert_eq!(
        reloaded.sim.world().resource::<TopicMemory>(),
        handle.sim.world().resource::<TopicMemory>()
    );
    assert_eq!(reloaded.world_hash(), handle.world_hash());
}
