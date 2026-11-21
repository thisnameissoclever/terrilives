//! Frozen private saves combine published V23 with explicit world and activity state.
use crate::{SaveError, Sim};
use super::ordinary_world::{self, CommuteEndpoints};
use terri_core::{SaveSnapshotV25, WorldSurfaces};

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV25 {
    SaveSnapshotV25 {
        previous: super::v23::capture(sim),
        surfaces: sim.world().resource::<WorldSurfaces>().clone(),
        commutes: super::ordinary_world::commutes(sim.world()),
        pools: crate::pool::capture(sim.world()),
        baths: crate::bath::capture(sim.world()),
    }
}

pub(crate) fn restore(
    snapshot: SaveSnapshotV25,
    content: &'static terri_data::ContentPack,
    mut carried: super::Carried,
) -> Result<Sim, SaveError> {
    let SaveSnapshotV25 {
        previous,
        surfaces,
        commutes,
        pools,
        baths,
    } = snapshot;
    ordinary_world::prepare_geometry(&previous.legacy.legacy.legacy, &surfaces, commutes, &mut carried)?;
    // Complete activity/order ownership is checked after all published queue layers.
    carried.pools = None;
    carried.baths = None;
    let mut candidate = super::v23::restore(previous, content, carried)?;
    crate::pool::restore_current(candidate.world_mut(), pools)?;
    crate::bath::restore(candidate.world_mut(), baths)?;
    ordinary_world::validate_restored(&candidate, &surfaces)?;
    ordinary_world::validate_commutes(candidate.world(), CommuteEndpoints::DepartureAndHome)?;
    Ok(candidate)
}
