//! Pool continuation wraps V21 without changing any earlier payload layout.
use crate::{SaveError, Sim};
use terri_core::LegacyEditableWorldSnapshotV22;

pub(crate) fn capture_current_layer(sim: &Sim) -> LegacyEditableWorldSnapshotV22 {
    LegacyEditableWorldSnapshotV22 {
        previous: super::editable_v21::capture(sim),
        pools: crate::pool::capture(sim.world()),
    }
}
pub(crate) fn restore(
    snapshot: LegacyEditableWorldSnapshotV22,
    content: &'static terri_data::ContentPack,
    mut carried: super::Carried,
) -> Result<Sim, SaveError> {
    // Current rows attach after all explicit player-order state has been restored.
    carried.pools = None;
    let mut sim = super::editable_v21::restore(snapshot.previous, content, carried)?;
    crate::pool::restore_historical_v22(sim.world_mut(), snapshot.pools)?;
    if crate::pool::migrate_v22(sim.world_mut())? {
        super::architecture::validate_edge_world(
            &super::capture(&sim),
            sim.world().resource::<terri_core::TileGrid>(),
            content,
            sim.world(),
        )?;
    }
    crate::pool::migrate_legacy_clock(sim.world_mut(), crate::pool::SavedPoolClock::Legacy);
    Ok(sim)
}

/// The outer V23 envelope supplies current coordinate meaning explicitly.
pub(crate) fn restore_current_layer(
    snapshot: LegacyEditableWorldSnapshotV22,
    content: &'static terri_data::ContentPack,
    mut carried: super::Carried,
) -> Result<Sim, SaveError> {
    carried.pools = None;
    let mut sim = super::editable_v21::restore(snapshot.previous, content, carried)?;
    crate::pool::restore(
        sim.world_mut(),
        snapshot.pools,
        crate::pool::SavedPoolClock::Legacy,
    )?;
    Ok(sim)
}
