//! The Relationships tab's edits ([AP-e-rel]). Arrives with [T6].
use super::AdminRefusal;
use bevy_ecs::prelude::*;
use terri_core::admin::AdminEdit;

pub(super) fn validate(_: &World, _: &AdminEdit) -> Result<(), AdminRefusal> {
    Err(AdminRefusal::UnknownContent)
}

pub(super) fn apply(_: &mut World, _: &AdminEdit) {
    unreachable!("only a validated edit is applied, and none validates yet")
}
