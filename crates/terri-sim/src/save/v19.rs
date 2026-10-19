use super::SaveError;
use crate::Sim;
use terri_core::SaveSnapshotV19;

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV19 {
    SaveSnapshotV19 {
        legacy: super::v18::capture(sim),
        neglect: crate::neglect::snapshot(sim.world()),
    }
}
pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV19 {
    SaveSnapshotV19 {
        legacy: super::v18::capture_without_commands(sim),
        neglect: crate::neglect::snapshot(sim.world()),
    }
}
pub(crate) fn restore(
    snapshot: SaveSnapshotV19,
    content: &'static terri_data::ContentPack,
    carried: super::Carried,
) -> Result<Sim, SaveError> {
    let mut candidate = super::v18::restore(snapshot.legacy, content, carried)?;
    crate::neglect::restore(candidate.world_mut(), snapshot.neglect)?;
    Ok(candidate)
}
