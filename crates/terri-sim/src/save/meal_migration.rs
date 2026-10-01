//! Map the old eating counter before validating stations in the expanded recipe.

use super::{bathtub, validate_snapshot, SaveError};
use terri_core::SaveSnapshotV1;
use terri_data::ContentPack;

pub(super) fn validate_source(
    snapshot: &SaveSnapshotV1,
    destination: &ContentPack,
) -> Result<(), SaveError> {
    if snapshot.content_fingerprint != terri_data::content_fingerprint(destination) {
        if let Some(source) = terri_data::pre_meals_content(destination) {
            // The bathtub bridge owns earlier geometry migrations and validates
            // the source before making them. Do not accept a digest on its own.
            bathtub::prepare(snapshot.clone(), &source)?;
            return Ok(());
        }
    }
    validate_snapshot(snapshot, destination)
}

pub(super) fn prepare(
    snapshot: SaveSnapshotV1,
    destination: &ContentPack,
) -> Result<(SaveSnapshotV1, bool), SaveError> {
    if snapshot.content_fingerprint == terri_data::content_fingerprint(destination) {
        return bathtub::prepare(snapshot, destination);
    }
    let Some(source) = terri_data::pre_meals_content(destination) else {
        return bathtub::prepare(snapshot, destination);
    };
    let (mut snapshot, renamed) = bathtub::prepare(snapshot, &source)?;
    for person in &mut snapshot.entities {
        if let Some(chain) = &mut person.chain {
            if chain.chain != "cook_dinner" {
                return Err(SaveError::InvalidContentReference);
            }
            if chain.step == 3 {
                chain.step = 5;
            }
        }
    }
    snapshot.content_fingerprint = terri_data::content_fingerprint(destination);
    validate_snapshot(&snapshot, destination)?;
    Ok((snapshot, renamed))
}
