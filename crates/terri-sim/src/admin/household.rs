//! The Household tab's edits ([AP-e-house]). Arrives with [T7].
use super::edits::Touched;
use super::AdminRefusal;
use bevy_ecs::prelude::*;
use terri_core::admin::AdminEdit;

pub(super) fn validate(_: &World, _: &AdminEdit) -> Result<(), AdminRefusal> {
    Err(AdminRefusal::UnknownContent)
}

pub(super) fn apply(_: &mut World, _: &AdminEdit) {
    unreachable!("only a validated edit is applied, and none validates yet")
}

pub(super) fn post_condition(_: &World, _: &Touched) -> Result<(), ()> {
    Ok(())
}
