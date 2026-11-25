//! Frozen private editable-world V21; generic header21 belongs to published shifts.
use super::ordinary_world::{self, CommuteEndpoints};
use crate::{world_geometry::WorldSurfaces, SaveError, Sim};
use terri_core::LegacyEditableWorldSnapshotV21;

pub(crate) fn capture(sim: &Sim) -> LegacyEditableWorldSnapshotV21 {
    LegacyEditableWorldSnapshotV21 {
        previous: super::v20::capture(sim),
        surfaces: sim.world().resource::<WorldSurfaces>().clone(),
        commutes: super::ordinary_world::commutes(sim.world()),
    }
}

pub(crate) fn restore(
    snapshot: LegacyEditableWorldSnapshotV21,
    content: &'static terri_data::ContentPack,
    mut carried: super::Carried,
) -> Result<Sim, SaveError> {
    ordinary_world::prepare_geometry(
        &snapshot.previous,
        &snapshot.surfaces,
        snapshot.commutes,
        &mut carried,
    )?;
    let mut sim = super::v20::restore(snapshot.previous, content, carried)?;
    ordinary_world::validate_restored(&sim, &snapshot.surfaces)?;
    crate::world_geometry::revalidate_legacy_commutes(sim.world_mut());
    ordinary_world::validate_commutes(sim.world(), CommuteEndpoints::DepartureOnly)?;
    Ok(sim)
}
