//! Issue 315: a toilet, shower or bath used for its full duration fills its
//! need to 100. The rules are in `docs/specs/2026-11-15-full-bathroom-use.md`.
//!
//! Only the three bathroom activities fill, identified by their compiled
//! activity as hand washing's ceiling is. A use of one of them lasts until
//! its need is full at the rate the fixture and the person give it, not for
//! a length drawn around the authored duration. The rate is untouched: it is
//! still the authored delta over the authored duration, scaled by the
//! person's satisfaction multiplier, so a better model that authors a higher
//! rate fills in fewer ticks with no new field.
//!
//! The length is found by running the same arithmetic the simulation will
//! run, one tick at a time, rather than by a closed form: the same
//! [`Needs`] methods, the same [`ordinary_rate`] and the same drain
//! [`drain_amount`] give, so the use ends on the tick the need reaches 100
//! exactly and float rounding cannot leave it at 99.9. The loop is bounded
//! by `need_fill_max_ticks` and runs once, at arrival.
use terri_core::{NeedId, Needs, Personality, NEED_MAX};
use terri_data::{CompiledActivity, CompiledInteraction, ContentPack};

/// The need a use of this action fills to 100, if it is one of the three
/// bathroom activities. Hand washing is not one of them: it stops at its
/// own ceiling and cannot clean the whole body.
pub(crate) fn fill_need(act: &CompiledInteraction) -> Option<NeedId> {
    match act.activity? {
        CompiledActivity::UsingToilet => Some(NeedId::Bladder),
        CompiledActivity::Showering | CompiledActivity::Bathing => Some(NeedId::Hygiene),
        _ => None,
    }
}

/// How many ticks a use of this action lasts for a person whose needs are
/// `needs` at the moment they start it, if it fills; `None` when it does not,
/// or when the person's net rate for the need is not positive, so that the
/// use keeps its drawn length instead of holding the room for the limit.
///
/// The arrival tick delivers without a drain before it, because that tick's
/// drain ran before the person arrived; every later tick drains and then
/// delivers, which is the order of `decay_needs` and `tick_interactions`.
/// The result is at least `min_interaction_ticks`, so a nearly full person
/// still visibly uses the fixture, and at most `need_fill_max_ticks`, so a
/// very low satisfaction multiplier cannot hold the room for hours.
///
/// `fumble` is the delta scale of a fumbled attempt, 1 for a clean one.
pub(crate) fn fill_ticks(
    pack: &ContentPack,
    act: &CompiledInteraction,
    needs: &Needs,
    personality: Option<&Personality>,
    fumble: f32,
) -> Option<u32> {
    let need = fill_need(act)?;
    let satisfaction = personality.map_or(1.0, |p| p.satisfaction[need.index()]);
    let rates: Vec<f32> = act
        .advertises
        .iter()
        .filter(|(index, _)| usize::from(*index) == need.index())
        .map(|(_, delta)| {
            super::physical::ordinary_rate(*delta, satisfaction, fumble, 1., act.duration_ticks)
        })
        .collect();
    let drain =
        crate::systems::needs::drain_amount(&pack.decay_per_tick, need, personality, 1., 1.);
    let delivered: f32 = rates.iter().sum();
    // Written as a negated `>` so a NaN rate falls back to the drawn length.
    #[allow(clippy::neg_cmp_op_on_partial_ord)]
    if !(delivered > drain) {
        return None;
    }
    let floor = pack.tuning.min_interaction_ticks;
    let cap = pack.tuning.need_fill_max_ticks;
    let mut level = *needs;
    for tick in 1..=cap {
        if tick > 1 {
            level.drain(need, drain);
        }
        for rate in &rates {
            level.fill(need, *rate);
        }
        if level.get(need) >= NEED_MAX {
            return Some(tick.max(floor));
        }
    }
    Some(cap)
}

/// The length of a use that a decision forecast plans for: the fill length
/// when the action fills, so a forecast and the delivery it predicts agree,
/// and the authored duration otherwise. `needs` are the person's needs when
/// they would start the use, after any travel.
pub(crate) fn planned_ticks(
    pack: &ContentPack,
    act: &CompiledInteraction,
    needs: &Needs,
    personality: Option<&Personality>,
) -> u32 {
    fill_ticks(pack, act, needs, personality, 1.).unwrap_or(act.duration_ticks)
}

/// Whether this fill action's need is full, so a use with more than the
/// minimum length still to run can end on the tick it filled.
pub(crate) fn is_full(act: &CompiledInteraction, needs: &Needs) -> bool {
    fill_need(act).is_some_and(|need| needs.get(need) >= NEED_MAX)
}

/// [`planned_ticks`] for a person who starts the use after `travel` ticks of
/// walking, with their needs `needs` now: the needs they arrive with are the
/// ones the fill length is found from.
pub(crate) fn planned_ticks_after(
    pack: &ContentPack,
    act: &CompiledInteraction,
    needs: &Needs,
    personality: &Personality,
    travel: u32,
) -> u32 {
    if fill_need(act).is_none() {
        return act.duration_ticks;
    }
    let arrived = crate::systems::critical_choices::after_decay(pack, needs, personality, travel);
    planned_ticks(pack, act, &arrived, Some(personality))
}
