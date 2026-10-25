//! Each person's held shift, the shift stream and the queued shift commands
//! ride schema twenty: issue 296
//! (`docs/specs/2026-10-18-shifts-and-careers.md`, [WS-save]).
use super::SaveError;
use crate::Sim;
use terri_core::save_v21::{SaveSnapshotV21, SavedQueuedShiftCommand};
use terri_core::{CommandQueue, SimCommand};

fn saved_command(command: &SimCommand) -> Option<SavedQueuedShiftCommand> {
    match *command {
        SimCommand::AssignCareerShift { agent, path, shift } => {
            Some(SavedQueuedShiftCommand::AssignCareerShift { agent, path, shift })
        }
        SimCommand::ChangeShift { agent, shift } => {
            Some(SavedQueuedShiftCommand::ChangeShift { agent, shift })
        }
        _ => None,
    }
}

fn live_command(command: SavedQueuedShiftCommand) -> SimCommand {
    match command {
        SavedQueuedShiftCommand::AssignCareerShift { agent, path, shift } => {
            SimCommand::AssignCareerShift { agent, path, shift }
        }
        SavedQueuedShiftCommand::ChangeShift { agent, shift } => {
            SimCommand::ChangeShift { agent, shift }
        }
    }
}

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV21 {
    let queued_shift_commands = sim
        .world()
        .resource::<CommandQueue>()
        .as_slice()
        .iter()
        .enumerate()
        .filter_map(|(position, command)| saved_command(command).map(|row| (position as u32, row)))
        .collect();
    SaveSnapshotV21 {
        legacy: super::v20::capture(sim),
        shifts: crate::careers::saved_shifts(sim.world()),
        queued_shift_commands,
    }
}

/// Capture a transaction baseline while leaving the live input queue intact.
pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV21 {
    SaveSnapshotV21 {
        legacy: super::v20::capture_without_commands(sim),
        shifts: crate::careers::saved_shifts(sim.world()),
        queued_shift_commands: Vec::new(),
    }
}

/// The schema-twenty part restores first, so each listed person can be
/// checked against the living household and their level. The queued shift
/// commands return to their positions among the commands it restored.
pub(crate) fn restore(
    snapshot: SaveSnapshotV21,
    content: &'static terri_data::ContentPack,
    carried: super::Carried,
) -> Result<Sim, SaveError> {
    let mut candidate = super::v20::restore(snapshot.legacy, content, carried)?;
    crate::careers::restore_shifts(candidate.world_mut(), snapshot.shifts)?;
    super::v18::place_by_position(
        &mut candidate,
        snapshot
            .queued_shift_commands
            .into_iter()
            .map(|(position, row)| (position, live_command(row)))
            .collect(),
        content,
    )?;
    Ok(candidate)
}

#[cfg(test)]
#[path = "v21_tests.rs"]
mod tests;
