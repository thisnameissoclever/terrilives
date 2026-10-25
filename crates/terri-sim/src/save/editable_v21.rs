//! Frozen private editable-world V21; generic header21 belongs to published shifts.
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
    super::ordinary_world::prepare_geometry(&snapshot.previous, &snapshot.surfaces, snapshot.commutes, &mut carried)?;
    let sim = super::v20::restore(snapshot.previous, content, carried)?;
    super::ordinary_world::validate_restored(&sim, &snapshot.surfaces)?;
    Ok(sim)
}
