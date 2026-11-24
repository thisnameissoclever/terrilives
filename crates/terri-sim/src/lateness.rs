//! Bounded lateness for critical Hunger and Energy (issue 309).
use crate::Content;
use bevy_ecs::prelude::*;
use terri_core::save_v17::SavedScheduledShift;
use terri_core::{Eating, NeedId, Needs};
use terri_data::Tuning;

/// Hunger and Energy can keep a housemate home. Bladder is
/// handled during a shift by workplace need care.
pub(crate) const COUNTED_NEEDS: [NeedId; 2] = [NeedId::Hunger, NeedId::Energy];

/// The bit mask of [`COUNTED_NEEDS`], bit `n` for the need with index `n`.
pub(crate) fn counted_mask() -> u8 {
    COUNTED_NEEDS
        .iter()
        .fold(0, |mask, need| mask | (1 << need.index()))
}

/// What a late housemate's choices are told: how far up the ramp they are,
/// which needs count, and the largest share their remedies may take.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lateness {
    /// 0 at the scheduled start, 1 from `work_lateness_ramp_ticks` on.
    pub progress: f32,
    /// Bit `n` is set for each need whose relief counts as a remedy.
    pub counted: u8,
    /// `work_lateness_remedy_share`.
    pub remedy_share: f32,
}

/// How many ticks past its scheduled start `shift` is, while the lateness
/// allowance lasts: from the start up to, not including, the start plus
/// `work_lateness_limit_ticks`, and never at or after the shift's end.
/// `None` before the start, after the allowance, once the shift has
/// settled, and always when the limit is 0 ([WL-limit]).
pub(crate) fn late_ticks(shift: &SavedScheduledShift, now: u64, tuning: &Tuning) -> Option<u64> {
    if shift.settled || now < shift.start_tick || now >= shift.end_tick {
        return None;
    }
    let late = now - shift.start_tick;
    (late < u64::from(tuning.work_lateness_limit_ticks)).then_some(late)
}

/// Whether a reader's book return has run out of time for the open shift
/// of `sim` ([LB-cap], `docs/specs/2026-11-19-late-book-returns.md`): the
/// shift has started, is not settled and `now` is at or past its start plus
/// `work_lateness_limit_ticks`. The same allowance bounds a critical need,
/// so nobody leaves later than the limit for either reason. A limit of 0
/// never caps, so a world built from a pack published before the knob
/// returns its books as it always did.
pub(crate) fn book_return_cap_reached(world: &World, sim: terri_core::SimId, now: u64) -> bool {
    let limit = u64::from(
        world
            .resource::<Content>()
            .0
            .tuning
            .work_lateness_limit_ticks,
    );
    limit > 0
        && world
            .resource::<crate::attendance::Attendance>()
            .shifts
            .get(&sim)
            .is_some_and(|shift| {
                !shift.settled && now < shift.end_tick && now >= shift.start_tick + limit
            })
}

/// Whether any counted need is critical, at or under the critical level
/// every other crisis rule uses (`mood_critical_need_level`).
fn counted_critical(needs: &Needs, tuning: &Tuning) -> bool {
    COUNTED_NEEDS
        .iter()
        .any(|&need| needs.get(need) <= tuning.mood_critical_need_level)
}

/// What the choice of a person with this open `shift` is told at `now`
/// ([WL-ramp]): `Some` while the allowance lasts and a counted need is
/// critical, with the progress along the ramp. It reads only saved facts
/// and draws nothing.
pub(crate) fn for_choice(
    shift: &SavedScheduledShift,
    needs: &Needs,
    now: u64,
    tuning: &Tuning,
) -> Option<Lateness> {
    let late = late_ticks(shift, now, tuning)?;
    if !counted_critical(needs, tuning) {
        return None;
    }
    Some(Lateness {
        progress: (late as f32 / tuning.work_lateness_ramp_ticks as f32).min(1.0),
        counted: counted_mask(),
        remedy_share: tuning.work_lateness_remedy_share,
    })
}

/// Whether `actor`, at home with `shift` open, is still running something
/// that raises a counted need, so the departure waits for it to finish
/// ([Q4] (a)): an ordinary interaction advertising Hunger or Energy.
fn running_remedy(world: &World, actor: Entity) -> bool {
    let Some(eating) = world.get::<Eating>(actor) else {
        return false;
    };
    let pack = world.resource::<Content>().0;
    pack.object(eating.object)
        .interactions
        .get(eating.interaction as usize)
        .is_some_and(|action| {
            action.advertises.iter().any(|&(need, delta)| {
                delta > 0. && COUNTED_NEEDS.iter().any(|n| n.index() == usize::from(need))
            })
        })
}

/// Whether the departure for `shift` waits at `now` ([WL-depart]): the
/// allowance has not run out and either a counted need is critical or, after
/// the start tick, a remedy for one is still running. The caller has already
/// decided that no player order, reading journey or commute stands in the
/// way; this is the one predicate a later "go to work now" command bypasses.
pub(crate) fn waits_for_needs(
    world: &World,
    actor: Entity,
    shift: &SavedScheduledShift,
    now: u64,
) -> bool {
    let tuning = &world.resource::<Content>().0.tuning;
    if late_ticks(shift, now, tuning).is_none() {
        return false;
    }
    // A running remedy holds the person back only after the start tick. A
    // person still at home on a later tick was kept there by a critical need
    // (or an order or journey, which end the question first), so finishing
    // what that need set going is part of the same lateness. On the start
    // tick itself only a critical need counts, so a person who happens to be
    // mid-meal or asleep with nothing critical leaves on time, as before.
    // This reads no saved state, so a save mid-lateness loads identically.
    world
        .get::<Needs>(actor)
        .is_some_and(|needs| counted_critical(needs, tuning))
        || (now > shift.start_tick && running_remedy(world, actor))
}

#[cfg(test)]
#[path = "lateness_tests.rs"]
mod tests;
