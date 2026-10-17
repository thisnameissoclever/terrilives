//! The careers ride the schema-thirteen envelope - issue 249, rule 16.
use super::SaveError;
use crate::{careers::Careers, Sim};
use terri_core::SaveSnapshotV14;

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV14 {
    SaveSnapshotV14 {
        legacy: super::v13::capture(sim),
        careers: sim
            .world()
            .get_resource::<Careers>()
            .map(Careers::to_saved)
            .unwrap_or_else(|| Careers::default().to_saved()),
    }
}

/// The schema-thirteen part restores first, so every record can be
/// checked against the living people and the jobs they hold; a record or
/// a moodlet the loaded world cannot account for refuses the whole save.
pub(crate) fn restore(
    snapshot: SaveSnapshotV14,
    content: &'static terri_data::ContentPack,
    portals: super::Carried,
) -> Result<Sim, SaveError> {
    let mut candidate = super::v13::restore(snapshot.legacy, content, portals)?;
    crate::careers::validate_saved(candidate.world(), &snapshot.careers)?;
    candidate
        .world_mut()
        .insert_resource(Careers::from_saved(snapshot.careers));
    Ok(candidate)
}
