//! The outer envelope selects current pool coordinates before bath rows attach.
use crate::{SaveError, Sim};
use terri_core::SaveSnapshotV23;

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV23 {
    SaveSnapshotV23 { previous: super::v22::capture_current_layer(sim), baths: crate::bath::capture(sim.world()) }
}
pub(crate) fn restore(snapshot: SaveSnapshotV23, content: &'static terri_data::ContentPack,
    mut carried: super::Carried) -> Result<Sim, SaveError> {
    carried.baths = None;
    let mut sim = super::v22::restore_current_layer(snapshot.previous, content, carried)?;
    crate::bath::restore(sim.world_mut(), snapshot.baths)?;
    Ok(sim)
}
