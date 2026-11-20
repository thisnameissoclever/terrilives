//! The bills ride schema twenty-one: issue 298
//! (`docs/specs/2026-10-18-wages-and-bills.md`, [WB-save]).
use super::SaveError;
use crate::Sim;
use terri_core::SaveSnapshotV22;

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV22 {
    SaveSnapshotV22 {
        legacy: super::v21::capture(sim),
        bills: crate::bills::saved(sim.world()),
    }
}

/// Capture a transaction baseline while leaving the live input queue intact.
pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV22 {
    SaveSnapshotV22 {
        legacy: super::v21::capture_without_commands(sim),
        bills: crate::bills::saved(sim.world()),
    }
}

/// The schema-twenty-one part restores first, so the bills can be checked
/// against the restored clock, grid and content. A schema-twenty-two save
/// already pays the new wages, so whatever `carried` says, nothing it holds
/// is migrated.
pub(crate) fn restore(
    snapshot: SaveSnapshotV22,
    content: &'static terri_data::ContentPack,
    mut carried: super::Carried,
) -> Result<Sim, SaveError> {
    carried.wage_migration = false;
    let mut candidate = super::v21::restore(snapshot.legacy, content, carried)?;
    crate::bills::validate_saved(candidate.world(), &snapshot.bills)?;
    crate::bills::restore(candidate.world_mut(), snapshot.bills);
    Ok(candidate)
}

#[cfg(test)]
#[path = "v22_tests.rs"]
mod tests;
