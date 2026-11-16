//! Bounded lateness for critical needs, and Bladder relief at work (issue
//! 309, `docs/specs/2026-11-16-work-lateness.md`).
use crate::Content;
use bevy_ecs::prelude::*;
use terri_core::save_v17::SavedScheduledShift;
use terri_core::{AtWork, Eating, NeedId, Needs, NEED_MAX};
use terri_data::Tuning;

/// The needs whose neglect can keep a housemate home from work. Bladder is
/// not among them: it is relieved at work instead ([WL-bladder]).
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
/// the start tick, a remedy for one is still running. The caller has already decided that no
/// player order, reading journey or commute stands in the way; this is the
/// one predicate a later "go to work now" command bypasses.
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

/// Relieves the Bladder of every housemate at work whose level is below
/// `work_bladder_relief_threshold`, to full, so it never becomes critical
/// during a shift ([WL-bladder]). Runs after the tick's decay and after
/// arrival is recorded. A threshold of 0 relieves nobody.
pub(crate) fn relieve_bladder_at_work(world: &mut World) {
    let threshold = world
        .resource::<Content>()
        .0
        .tuning
        .work_bladder_relief_threshold;
    let mut workers = world.query_filtered::<&mut Needs, With<AtWork>>();
    for mut needs in workers.iter_mut(world) {
        if needs.get(NeedId::Bladder) < threshold {
            needs.set(NeedId::Bladder, NEED_MAX);
        }
    }
}

#[cfg(test)]
#[path = "lateness_tests.rs"]
mod tests;
