//! The outer envelope selects current pool coordinates before bath rows attach.
use crate::{SaveError, Sim};
use terri_core::LegacyEditableWorldSnapshotV23;

pub(crate) fn capture(sim: &Sim) -> LegacyEditableWorldSnapshotV23 {
    let mut previous = super::editable_v22::capture_current_layer(sim);
    crate::pool::project_legacy_clock(
        &mut previous.previous.previous,
        &mut previous.pools,
        crate::pool::SavedPoolClock::Legacy,
    );
    LegacyEditableWorldSnapshotV23 {
        previous,
        baths: crate::bath::capture(sim.world()),
    }
}
pub(crate) fn restore(
    snapshot: LegacyEditableWorldSnapshotV23,
    content: &'static terri_data::ContentPack,
    mut carried: super::Carried,
) -> Result<Sim, SaveError> {
    carried.baths = None;
    let mut sim = super::editable_v22::restore_current_layer(snapshot.previous, content, carried)?;
    crate::bath::restore(sim.world_mut(), snapshot.baths)?;
    Ok(sim)
}
