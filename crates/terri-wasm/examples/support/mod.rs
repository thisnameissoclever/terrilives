//! Complete current save ownership for scene-authoring tools.
use terri_core::{
    SaveSnapshotV19, SaveSnapshotV20, SaveSnapshotV5, SAVE_MAGIC, SAVE_SCHEMA_VERSION,
};
use terri_sim::{Content, Sim};

const _: () = assert!(SAVE_SCHEMA_VERSION == 20);

/// A field view keeps existing scene tools on V19 fields while retaining all V20 state.
#[derive(Clone, Debug, PartialEq)]
pub struct CurrentSnapshot(pub SaveSnapshotV20);
impl std::ops::Deref for CurrentSnapshot {
    type Target = SaveSnapshotV19;
    fn deref(&self) -> &Self::Target {
        &self.0.legacy
    }
}
impl std::ops::DerefMut for CurrentSnapshot {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0.legacy
    }
}
pub trait CurrentSnapshotViews {
    fn current_snapshot(&self) -> CurrentSnapshot;
    fn load_current_snapshot(
        &mut self,
        snapshot: CurrentSnapshot,
    ) -> Result<(), terri_sim::SaveError>;
}
impl CurrentSnapshotViews for Sim {
    fn current_snapshot(&self) -> CurrentSnapshot {
        CurrentSnapshot(self.save_snapshot_v20())
    }
    fn load_current_snapshot(
        &mut self,
        snapshot: CurrentSnapshot,
    ) -> Result<(), terri_sim::SaveError> {
        self.load_snapshot_v20(snapshot.0)
    }
}

pub fn v5_mut(snapshot: &mut CurrentSnapshot) -> &mut SaveSnapshotV5 {
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
        .legacy
}

pub fn capture(sim: &Sim) -> CurrentSnapshot {
    let snapshot = sim.current_snapshot();
    let mut restored = Sim::new_with_lot_and_content(1, 1, *sim.world().resource::<Content>());
    restored
        .load_current_snapshot(snapshot.clone())
        .expect("review scene must pass complete current validation");
    assert_eq!(
        restored.current_snapshot(),
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
    bytes.extend(postcard::to_allocvec(&snapshot.0).expect("current review scene serializes"));
    bytes
}
