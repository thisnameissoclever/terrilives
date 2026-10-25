//! Current saves compose published shifts and explicit world/activity continuation.
use crate::{SaveError, Sim};
use terri_core::{SaveSnapshotV24, WorldSurfaces};

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV24 {
    SaveSnapshotV24 {
        previous: super::v21::capture(sim),
        surfaces: sim.world().resource::<WorldSurfaces>().clone(),
        commutes: super::ordinary_world::commutes(sim.world()),
        pools: crate::pool::capture(sim.world()),
        baths: crate::bath::capture(sim.world()),
    }
}

pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV24 {
    SaveSnapshotV24 {
        previous: super::v21::capture_without_commands(sim),
        surfaces: sim.world().resource::<WorldSurfaces>().clone(),
        commutes: super::ordinary_world::commutes(sim.world()),
        pools: crate::pool::capture(sim.world()),
        baths: crate::bath::capture(sim.world()),
    }
}

pub(crate) fn restore(
    snapshot: SaveSnapshotV24,
    content: &'static terri_data::ContentPack,
    mut carried: super::Carried,
) -> Result<Sim, SaveError> {
    let SaveSnapshotV24 { previous, surfaces, commutes, pools, baths } = snapshot;
    super::ordinary_world::prepare_geometry(&previous.legacy, &surfaces, commutes, &mut carried)?;
    // Complete activity/order ownership is checked after all published queue layers.
    carried.pools = None;
    carried.baths = None;
    let mut candidate = super::v21::restore(previous, content, carried)?;
    crate::pool::restore_current(candidate.world_mut(), pools)?;
    crate::bath::restore(candidate.world_mut(), baths)?;
    super::ordinary_world::validate_restored(&candidate, &surfaces)?;
    Ok(candidate)
}
