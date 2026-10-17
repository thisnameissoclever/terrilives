use super::{Carried, SaveError};
use crate::Sim;
use terri_core::{rooms::SavedRooms, SaveSnapshotV15};

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV15 {
    SaveSnapshotV15 {
        legacy: super::v14::capture(sim),
        rooms: sim
            .world()
            .get_resource::<SavedRooms>()
            .cloned()
            .expect("current save requires initialized room identities"),
    }
}

/// Project persistent household state without pending input. Command references
/// participate in the action manifest, so derive it again from the projection.
pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV15 {
    let mut snapshot = capture(sim);
    let ten = &mut snapshot.legacy.legacy.legacy.legacy.legacy;
    ten.command_order.clear();
    let six = &mut ten.legacy;
    six.command_order.clear();
    six.legacy.world.queued_commands.clear();
    six.actions = super::action_refs::capture_origins(
        &six.legacy,
        sim.world().resource::<crate::Content>().0,
        &six.chain_origins,
    );
    snapshot
}

#[cfg(test)]
#[path = "command_projection_tests.rs"]
mod command_projection_tests;

pub(crate) fn restore(
    snapshot: SaveSnapshotV15,
    content: &'static terri_data::ContentPack,
    carried: Carried,
) -> Result<Sim, SaveError> {
    snapshot
        .rooms
        .validate()
        .map_err(|_| SaveError::InvalidValue)?;
    let candidate = super::v14::restore(
        snapshot.legacy,
        content,
        Carried {
            rooms: Some(snapshot.rooms),
            room_mode: crate::rooms::RoomReferenceMode::Stable,
            ..carried
        },
    )?;
    for command in candidate
        .world()
        .resource::<terri_core::CommandQueue>()
        .as_slice()
    {
        if let terri_core::SimCommand::CleanChore { key, .. }
        | terri_core::SimCommand::CleanChoreFirst { key, .. } = command
        {
            if (key.kind == terri_core::chores::ChoreKind::Floors || key.kind.grouped())
                && !crate::rooms::reference_valid(candidate.world(), key.target)
            {
                return Err(SaveError::InvalidValue);
            }
        }
    }
    crate::chores::validate_current_work(candidate.world())?;
    Ok(candidate)
}
