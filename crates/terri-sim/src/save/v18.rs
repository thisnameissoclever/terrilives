//! Each person's job search rides the published player-order save: issue
//! 297 (`docs/specs/2026-10-18-job-search-per-person.md`, [JS-save]).
use super::SaveError;
use crate::Sim;
use terri_core::{save_v18::SavedQueuedSetting, CommandQueue, SaveSnapshotV18, SimCommand};

/// Whether `command` is a settings command schema eighteen carries beside
/// its queue position. The older schemas' command records leave it out, so
/// their confirmed-order positions count only the commands they hold.
pub(crate) fn is_queued_setting(command: &SimCommand) -> bool {
    matches!(
        command,
        SimCommand::SetJobSearch { .. } | SimCommand::SetCareerChange { .. }
    )
}

/// Whether `command` is a shift command (issue 296), which no schema up to
/// twenty can record. Every writer up to schema twenty leaves them out of
/// the queue it saves and out of the positions it counts, so the rest of
/// the queue still loads in order; schema twenty-one carries them.
pub(crate) fn is_shift_command(command: &SimCommand) -> bool {
    matches!(
        command,
        SimCommand::AssignCareerShift { .. } | SimCommand::ChangeShift { .. }
    )
}

/// Whether the schema-seventeen envelope leaves `command` out of its
/// command records: a queued setting, which schema eighteen places by
/// position, or a shift command.
pub(crate) fn left_out_of_records(command: &SimCommand) -> bool {
    is_queued_setting(command) || is_shift_command(command)
}

fn saved_setting(command: &SimCommand) -> Option<SavedQueuedSetting> {
    match *command {
        SimCommand::SetJobSearch { agent, search } => {
            Some(SavedQueuedSetting::JobSearch { agent, search })
        }
        SimCommand::SetCareerChange { change } => Some(SavedQueuedSetting::CareerChange { change }),
        _ => None,
    }
}

fn live_setting(setting: SavedQueuedSetting) -> SimCommand {
    match setting {
        SavedQueuedSetting::JobSearch { agent, search } => {
            SimCommand::SetJobSearch { agent, search }
        }
        SavedQueuedSetting::CareerChange { change } => SimCommand::SetCareerChange { change },
    }
}

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV18 {
    let queued_settings = sim
        .world()
        .resource::<CommandQueue>()
        .as_slice()
        .iter()
        .filter(|command| !is_shift_command(command))
        .enumerate()
        .filter_map(|(position, command)| {
            saved_setting(command).map(|setting| (position as u32, setting))
        })
        .collect();
    with_search(sim, super::v17::capture(sim), queued_settings)
}

/// Capture a transaction baseline while leaving the live input queue intact.
pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV18 {
    with_search(sim, super::v17::capture_without_commands(sim), Vec::new())
}

/// The list carries each person's setting, so the older household field
/// inside the envelope is written on.
fn with_search(
    sim: &Sim,
    mut legacy: terri_core::SaveSnapshotV17,
    queued_settings: Vec<(u32, SavedQueuedSetting)>,
) -> SaveSnapshotV18 {
    legacy.legacy.legacy.legacy.careers.autonomous_search = true;
    SaveSnapshotV18 {
        legacy,
        job_search_off: crate::careers::saved_search_off(sim.world()),
        queued_settings,
    }
}

/// The schema-seventeen part restores first, so each listed person can be
/// checked against the living household. This schema always writes the
/// older household search field on; a payload that turns it off has two
/// answers for one setting and refuses the load. The queued settings
/// return to their positions among the commands the envelope restored.
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
    place_by_position(
        &mut candidate,
        snapshot
            .queued_settings
            .into_iter()
            .map(|(position, setting)| (position, live_setting(setting)))
            .collect(),
        content,
    )?;
    Ok(candidate)
}

/// Returns `settings`, each a command with its position in the whole
/// command queue, to those positions among the commands the candidate's
/// queue already holds, which keep their order. Positions must ascend and
/// fall inside the merged queue, and the merged queue must fit the limit.
pub(crate) fn place_by_position(
    candidate: &mut Sim,
    settings: Vec<(u32, SimCommand)>,
    content: &terri_data::ContentPack,
) -> Result<(), SaveError> {
    if settings.is_empty() {
        return Ok(());
    }
    let others: Vec<SimCommand> = candidate
        .world_mut()
        .resource_mut::<CommandQueue>()
        .drain()
        .collect();
    let count = others
        .len()
        .checked_add(settings.len())
        .ok_or(SaveError::TooManyCommands)?;
    if super::exceeds_limit(count, content.tuning.max_queued_commands as usize) {
        return Err(SaveError::TooManyCommands);
    }
    if settings.windows(2).any(|pair| pair[0].0 >= pair[1].0)
        || settings
            .iter()
            .any(|(position, _)| *position as usize >= count)
    {
        return Err(SaveError::InvalidValue);
    }
    let mut settings = settings.into_iter().peekable();
    let mut others = others.into_iter();
    for position in 0..count {
        let command = match settings.next_if(|row| row.0 as usize == position) {
            Some((_, command)) => command,
            None => others.next().ok_or(SaveError::InvalidValue)?,
        };
        candidate
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(command);
    }
    Ok(())
}

/// The published schema-seventeen projection of a schema-eighteen save,
/// as the live writer makes it: the household field off only while every
/// living person's search is off. Queued settings have no place there.
pub(crate) fn project_v17(snapshot: &SaveSnapshotV18) -> terri_core::SaveSnapshotV17 {
    let mut legacy = snapshot.legacy.clone();
    let five = &legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy;
    let mut living: Vec<u32> = five
        .world
        .entities
        .iter()
        .filter(|entity| entity.agent)
        .filter_map(|entity| entity.sim_id)
        .collect();
    living.sort_unstable();
    let everyone_off = !living.is_empty() && living == snapshot.job_search_off;
    legacy.legacy.legacy.legacy.careers.autonomous_search = !everyone_off;
    legacy
}
