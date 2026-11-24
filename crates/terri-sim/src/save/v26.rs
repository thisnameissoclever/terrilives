//! Current saves compose published careers and explicit world/activity continuation.
use crate::{SaveError, Sim};
use crate::pool::SavedPoolClock;
use super::ordinary_world::{self, CommuteEndpoints};
use terri_core::{SaveSnapshotV26, WorldSurfaces};

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV26 {
    SaveSnapshotV26 {
        previous: super::v24::capture(sim),
        surfaces: sim.world().resource::<WorldSurfaces>().clone(),
        commutes: super::ordinary_world::commutes(sim.world()),
        pools: crate::pool::capture(sim.world()),
        baths: crate::bath::capture(sim.world()),
        manual_work_trips: crate::attendance::capture_manual_work_trips(sim.world()),
        open_shift_base_pay: crate::attendance::capture_open_base_pay(sim.world()),
        career_input_sources: super::v24::capture_sources(sim.world()),
    }
}

pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV26 {
    SaveSnapshotV26 {
        previous: super::v24::capture_without_commands(sim),
        surfaces: sim.world().resource::<WorldSurfaces>().clone(),
        commutes: super::ordinary_world::commutes(sim.world()),
        pools: crate::pool::capture(sim.world()),
        baths: crate::bath::capture(sim.world()),
        manual_work_trips: crate::attendance::capture_manual_work_trips(sim.world()),
        open_shift_base_pay: crate::attendance::capture_open_base_pay(sim.world()),
        career_input_sources: super::v24::capture_sources(sim.world()),
    }
}

pub(crate) fn project_legacy_clock(snapshot: &mut SaveSnapshotV26, clock: SavedPoolClock) {
    crate::pool::project_legacy_clock(
        &mut snapshot.previous.legacy.legacy.legacy.legacy,
        &mut snapshot.pools,
        clock,
    );
}

pub(crate) fn restore(
    snapshot: SaveSnapshotV26,
    content: &'static terri_data::ContentPack,
    carried: super::Carried,
) -> Result<Sim, SaveError> {
    restore_with_pool_clock(snapshot, content, carried, SavedPoolClock::Legacy)
}

pub(super) fn restore_with_pool_clock(
    snapshot: SaveSnapshotV26,
    content: &'static terri_data::ContentPack,
    mut carried: super::Carried,
    clock: SavedPoolClock,
) -> Result<Sim, SaveError> {
    let SaveSnapshotV26 {
        previous,
        surfaces,
        commutes,
        pools,
        baths,
        manual_work_trips,
        open_shift_base_pay,
        career_input_sources,
    } = snapshot;
    ordinary_world::prepare_geometry(&previous.legacy.legacy.legacy.legacy, &surfaces, commutes, &mut carried)?;
    // Complete activity/order ownership is checked after all published queue layers.
    carried.pools = None;
    carried.baths = None;
    carried.manual_work_trips = Some(manual_work_trips);
    let mut candidate = super::v24::restore_with_sources(previous, content, carried, career_input_sources)?;
    crate::attendance::restore_open_base_pay(candidate.world_mut(), open_shift_base_pay)?;
    crate::pool::restore(candidate.world_mut(), pools, clock)?;
    crate::bath::restore(candidate.world_mut(), baths)?;
    crate::attendance::validate_manual_work_trip_activities(candidate.world())?;
    ordinary_world::validate_restored(&candidate, &surfaces)?;
    ordinary_world::validate_commutes(candidate.world(), CommuteEndpoints::DepartureAndHome)?;
    Ok(candidate)
}
