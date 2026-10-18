//! Each person's job search rides the published player-order save: issue
//! 297 (`docs/specs/2026-10-18-job-search-per-person.md`, [JS-save]).
use super::SaveError;
use crate::Sim;
use terri_core::SaveSnapshotV18;

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV18 {
    with_search(sim, super::v17::capture(sim))
}

/// Capture a transaction baseline while leaving the live input queue intact.
pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV18 {
    with_search(sim, super::v17::capture_without_commands(sim))
}

/// The list carries each person's setting, so the older household field
/// inside the envelope is written on.
fn with_search(sim: &Sim, mut legacy: terri_core::SaveSnapshotV17) -> SaveSnapshotV18 {
    legacy.legacy.legacy.legacy.careers.autonomous_search = true;
    SaveSnapshotV18 {
        legacy,
        job_search_off: crate::careers::saved_search_off(sim.world()),
    }
}

/// The schema-seventeen part restores first, so each listed person can be
/// checked against the living household. This schema always writes the
/// older household search field on; a payload that turns it off has two
/// answers for one setting and refuses the load.
pub(crate) fn restore(
    snapshot: SaveSnapshotV18,
    content: &'static terri_data::ContentPack,
    carried: super::Carried,
) -> Result<Sim, SaveError> {
    if !snapshot
        .legacy
        .legacy
        .legacy
        .legacy
        .careers
        .autonomous_search
    {
        return Err(SaveError::InvalidValue);
    }
    let mut candidate = super::v17::restore(snapshot.legacy, content, carried)?;
    crate::careers::restore_search_off(candidate.world_mut(), snapshot.job_search_off)?;
    Ok(candidate)
}
