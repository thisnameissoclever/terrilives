//! Map the old eating counter before validating stations in the expanded recipe.

use super::{bathtub, ActorReferences, SaveError};
use terri_core::SaveSnapshotV1;
use terri_data::ContentPack;

pub(super) fn validate_source(
    snapshot: &SaveSnapshotV1,
    destination: &ContentPack,
) -> Result<(), SaveError> {
    validate_source_with_actor_refs(snapshot, destination, ActorReferences::Household)
}

pub(super) fn validate_source_with_actor_refs(
    snapshot: &SaveSnapshotV1,
    destination: &ContentPack,
    references: ActorReferences,
) -> Result<(), SaveError> {
    if !terri_data::content_fingerprint_has_current_recipe(
        destination,
        snapshot.content_fingerprint,
    ) {
        if let Some(source) = terri_data::pre_meals_content(destination) {
            // The bathtub bridge owns earlier geometry migrations and validates
            // the source before making them. Do not accept a digest on its own.
            prepare_bathtub(snapshot.clone(), &source, references)?;
            return Ok(());
        }
    }
    references.validate(snapshot, destination)
}

pub(super) fn prepare(
    snapshot: SaveSnapshotV1,
    destination: &ContentPack,
) -> Result<(SaveSnapshotV1, bool), SaveError> {
    prepare_with_actor_refs(snapshot, destination, ActorReferences::Household)
}

pub(super) fn prepare_with_actor_refs(
    snapshot: SaveSnapshotV1,
    destination: &ContentPack,
    references: ActorReferences,
) -> Result<(SaveSnapshotV1, bool), SaveError> {
    if terri_data::content_fingerprint_has_current_recipe(destination, snapshot.content_fingerprint)
    {
        return prepare_bathtub(snapshot, destination, references);
    }
    let Some(source) = terri_data::pre_meals_content(destination) else {
        return prepare_bathtub(snapshot, destination, references);
    };
    let (mut snapshot, renamed) = prepare_bathtub(snapshot, &source, references)?;
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
    references.validate(&snapshot, destination)?;
    Ok((snapshot, renamed))
}

fn prepare_bathtub(
    snapshot: SaveSnapshotV1,
    destination: &ContentPack,
    references: ActorReferences,
) -> Result<(SaveSnapshotV1, bool), SaveError> {
    match references {
        ActorReferences::Household => bathtub::prepare(snapshot, destination),
        mode => bathtub::prepare_with_actor_refs(snapshot, destination, mode),
    }
}
