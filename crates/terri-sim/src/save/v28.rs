use super::{v26, v27, Carried, SaveError};
use crate::pool::SavedPoolClock;
use crate::Sim;
use terri_core::SaveSnapshotV28;

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV28 {
    SaveSnapshotV28 {
        editable: v26::capture(sim),
        need_mood: v27::rows(sim.world()),
    }
}

pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV28 {
    SaveSnapshotV28 {
        editable: v26::capture_without_commands(sim),
        need_mood: v27::rows(sim.world()),
    }
}

pub(crate) fn restore(
    snapshot: SaveSnapshotV28,
    content: &'static terri_data::ContentPack,
    carried: Carried,
) -> Result<Sim, SaveError> {
    restore_with_pool_clock(snapshot, content, carried, SavedPoolClock::Legacy)
}

pub(crate) fn restore_current(
    snapshot: SaveSnapshotV28,
    content: &'static terri_data::ContentPack,
    carried: Carried,
) -> Result<Sim, SaveError> {
    restore_with_pool_clock(snapshot, content, carried, SavedPoolClock::LongExit)
}

pub(crate) fn restore_forward_hop(
    snapshot: SaveSnapshotV28,
    content: &'static terri_data::ContentPack,
    carried: Carried,
) -> Result<Sim, SaveError> {
    restore_with_pool_clock(snapshot, content, carried, SavedPoolClock::ForwardHop)
}

fn restore_with_pool_clock(
    snapshot: SaveSnapshotV28,
    content: &'static terri_data::ContentPack,
    carried: Carried,
    clock: SavedPoolClock,
) -> Result<Sim, SaveError> {
    let SaveSnapshotV28 { editable, need_mood } = snapshot;
    v27::validate_rows(&need_mood)?;
    let mut candidate = v26::restore_with_pool_clock(editable, content, carried, clock)?;
    v27::install(candidate.world_mut(), need_mood)?;
    Ok(candidate)
}
