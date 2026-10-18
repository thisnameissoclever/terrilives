//! Complete current save ownership for scene-authoring tools.
use terri_core::{SaveSnapshotV18, SaveSnapshotV5, SAVE_MAGIC, SAVE_SCHEMA_VERSION};
use terri_sim::{Content, Sim};

const _: () = assert!(SAVE_SCHEMA_VERSION == 18);

pub fn v5_mut(snapshot: &mut SaveSnapshotV18) -> &mut SaveSnapshotV5 {
    &mut snapshot
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
}

pub fn capture(sim: &Sim) -> SaveSnapshotV18 {
    let snapshot = sim.save_snapshot_v18();
    let mut restored = Sim::new_with_lot_and_content(1, 1, *sim.world().resource::<Content>());
    restored
        .load_snapshot_v18(snapshot.clone())
        .expect("review scene must pass complete current validation");
    assert_eq!(
        restored.save_snapshot_v18(),
        snapshot,
        "review scene must round-trip completely"
    );
    snapshot
}

/// Refuse an inconsistent authored scene before writing any output bytes.
pub fn encode(sim: &Sim) -> Vec<u8> {
    let snapshot = capture(sim);
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend(SAVE_SCHEMA_VERSION.to_le_bytes());
    bytes.extend(postcard::to_allocvec(&snapshot).expect("current review scene serializes"));
    bytes
}
