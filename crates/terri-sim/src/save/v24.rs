//! Restore the frozen private format with published shifts before bills.
use crate::{SaveError, Sim};
use super::ordinary_world::{self, CommuteEndpoints};
use terri_core::SaveSnapshotV24;

pub(crate) fn restore(
    snapshot: SaveSnapshotV24,
    content: &'static terri_data::ContentPack,
    mut carried: super::Carried,
) -> Result<Sim, SaveError> {
    let SaveSnapshotV24 {
        previous,
        surfaces,
        commutes,
        pools,
        baths,
    } = snapshot;
    ordinary_world::prepare_geometry(&previous.legacy, &surfaces, commutes, &mut carried)?;
    // Complete activity/order ownership is checked after all published queue layers.
    carried.pools = None;
    carried.baths = None;
    let mut candidate = super::v21::restore(previous, content, carried)?;
    crate::pool::restore_current(candidate.world_mut(), pools)?;
    crate::bath::restore(candidate.world_mut(), baths)?;
    ordinary_world::validate_restored(&candidate, &surfaces)?;
    ordinary_world::validate_commutes(candidate.world(), CommuteEndpoints::DepartureOnly)?;
    Ok(candidate)
}
