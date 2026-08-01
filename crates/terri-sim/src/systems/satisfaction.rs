//! The second axis's two writers that run on a clock or a completion -
//! [E1]/[E2] in `docs/specs/2026-08-01-m2e-satisfaction-hobbies-career-design.md`.
//!
//! The PAYOUT is not a system: completions happen inside
//! `tick_interactions` and `tick_social`, and both call [`hobby_payout`]
//! at their own completion points so the "on completion only" rule is
//! enforced by the same code path that enforces it for habituation and
//! relationships. What lives here is the arithmetic they share and the
//! one writer with its own clock, the neglect bleed.

use bevy_ecs::prelude::*;
use terri_core::{Hobbies, NeedId, Needs, Satisfaction};

use crate::Content;

/// What one completed activity pays toward a life well lived: the
/// content's base yield, multiplied by `multiplier` when any of the
/// activity's tags is one of the sim's hobbies ([E2]).
///
/// Zero base pays zero regardless of love - most activities are chores,
/// and loving "cooking" does not make washing up profound. The absent
/// component reads as "no hobbies": bare test agents and any future
/// hobby-less sim take the base like anyone else.
pub fn hobby_payout(base: f32, tags: &[String], hobbies: Option<&Hobbies>, multiplier: f32) -> f32 {
    if base <= 0.0 {
        return 0.0;
    }
    let loved = hobbies.is_some_and(|h| h.loves_any(tags));
    base * if loved { multiplier } else { 1.0 }
}

/// Bleeds satisfaction from every sim with a NEGLECTED need - one below
/// `neglect_floor` - at `neglect_bleed_per_tick` PER crisis, because
/// three crises are worse than one ([E1] writer 2).
///
/// The counterpart of the payout and deliberately its inverse in shape:
/// the payout fires on completions and only ever adds, this fires on
/// the clock and only ever subtracts. Together they are the whole of
/// what moves the axis until PR 2's conditions scale the accrual.
///
/// Runs unconditionally like `decay_relationships`, and its position in
/// the schedule is genuinely free for the same reason: it reads `Needs`
/// (which nothing later in the tick writes) and writes `Satisfaction`
/// (which nothing else reads mid-tick).
pub fn bleed_neglect(content: Res<Content>, mut ledgers: Query<(&Needs, &mut Satisfaction)>) {
    let floor = content.0.tuning.neglect_floor;
    let bleed = content.0.tuning.neglect_bleed_per_tick;
    // Zero disables, per the knob's contract; skipping the loop keeps
    // "disabled" from meaning "iterate everyone and add 0.0", which
    // would still dirty change detection for every sim every tick.
    if bleed <= 0.0 {
        return;
    }
    for (needs, mut satisfaction) in &mut ledgers {
        let crises = NeedId::ALL
            .into_iter()
            .filter(|id| needs.get(*id) < floor)
            .count();
        if crises > 0 {
            satisfaction.add(-(crises as f32) * bleed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_content;
    use crate::Sim;
    use terri_core::{Agent, Position, NEED_MAX};

    // ---- hobby_payout, the pure arithmetic ---------------------------

    fn reader() -> Hobbies {
        Hobbies(vec!["reading".to_string()])
    }

    #[test]
    fn a_loved_tag_multiplies_and_an_unloved_one_pays_base() {
        let tags = vec!["reading".to_string(), "puttering".to_string()];
        // Loved through EITHER tag: the question is any-overlap, and a
        // multi-tagged activity is loved if any tag is.
        assert_eq!(hobby_payout(3.0, &tags, Some(&reader()), 4.0), 12.0);
        // Same activity, a sim who loves none of it: base.
        let cook = Hobbies(vec!["cooking".to_string()]);
        assert_eq!(hobby_payout(3.0, &tags, Some(&cook), 4.0), 3.0);
    }

    #[test]
    fn no_hobbies_component_reads_as_no_hobbies() {
        // Bare test agents and hobby-less sims take the base - the same
        // absent-is-neutral contract Personality carries, and what keeps
        // every pre-M2e fixture meaning what it meant.
        let tags = vec!["reading".to_string()];
        assert_eq!(hobby_payout(3.0, &tags, None, 4.0), 3.0);
    }

    #[test]
    fn a_zero_base_pays_zero_even_when_loved() {
        // Loving "cooking" does not make washing up profound: the base
        // is the content's claim that an activity feeds a life at all,
        // and the multiplier only amplifies a claim that exists.
        let tags = vec!["reading".to_string()];
        assert_eq!(hobby_payout(0.0, &tags, Some(&reader()), 4.0), 0.0);
    }

    // ---- bleed_neglect, through the running schedule ------------------

    /// One tick's worth of bleed for a sim with exactly TWO needs in
    /// crisis: per-crisis stacking is the claim, so the fixture needs a
    /// crisis count other than one ([L34] - at one crisis, "per crisis"
    /// and "flat while any" agree on every observation).
    #[test]
    fn each_neglected_need_bleeds_separately() {
        let pack = test_content::pack_tuned(
            vec![test_content::object(
                "fridge",
                &[(terri_core::NeedId::Hunger, 30.0)],
                18,
            )],
            terri_data::Tuning {
                neglect_floor: 20.0,
                neglect_bleed_per_tick: 0.5,
                ..test_content::tuning()
            },
        );
        let mut sim = test_content::sim_with(8, 8, pack);
        let mut needs = terri_core::Needs::all_at(NEED_MAX);
        needs.set(terri_core::NeedId::Fun, 5.0);
        needs.set(terri_core::NeedId::Comfort, 10.0);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                needs,
                terri_core::Satisfaction::default(),
            ))
            .id();
        // Seed the ledger so the bleed has something to take: the
        // component clamps at zero, and a bleed measured against an
        // empty ledger would be invisible.
        sim.world_mut()
            .get_mut::<terri_core::Satisfaction>(agent)
            .unwrap()
            .add(10.0);

        sim.tick();

        let after = sim
            .world()
            .get::<terri_core::Satisfaction>(agent)
            .unwrap()
            .value();
        // Two crises at 0.5 each: exactly 1.0 gone. A flat-rate bleed
        // leaves 9.5 here and a per-need one 9.0, which is the whole
        // difference the fixture exists to see. No decay confound:
        // satisfaction has no clock of its own.
        assert_eq!(after, 9.0);
    }

    #[test]
    fn a_sim_above_the_floor_bleeds_nothing() {
        let pack = test_content::pack_tuned(
            vec![test_content::object(
                "fridge",
                &[(terri_core::NeedId::Hunger, 30.0)],
                18,
            )],
            terri_data::Tuning {
                neglect_floor: 20.0,
                neglect_bleed_per_tick: 0.5,
                ..test_content::tuning()
            },
        );
        let mut sim = test_content::sim_with(8, 8, pack);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                terri_core::Needs::all_at(NEED_MAX),
                terri_core::Satisfaction::default(),
            ))
            .id();
        sim.world_mut()
            .get_mut::<terri_core::Satisfaction>(agent)
            .unwrap()
            .add(10.0);

        sim.tick();

        assert_eq!(
            sim.world()
                .get::<terri_core::Satisfaction>(agent)
                .unwrap()
                .value(),
            10.0,
            "competence is the baseline: a well-kept sim neither earns \
             nor bleeds by existing"
        );
    }

    #[test]
    fn the_ledger_clamps_at_zero_rather_than_going_negative() {
        // A life cannot owe. The clamp lives in Satisfaction::add, and
        // this is the one input on which it decides anything: a bleed
        // larger than the balance.
        let mut ledger = Satisfaction::default();
        ledger.add(0.3);
        ledger.add(-5.0);
        assert_eq!(ledger.value(), 0.0);
    }

    // ---- The payout, end to end through the running schedule ----------

    /// A pack whose one object is a tagged, paying hobby activity: fun
    /// 30 over 18 ticks, tag "whittling", base 2.0.
    fn hobby_pack() -> &'static terri_data::ContentPack {
        let mut act = test_content::interaction("whittle", &[(terri_core::NeedId::Fun, 30.0)], 18);
        act.tags = vec!["whittling".to_string()];
        act.satisfaction = 2.0;
        test_content::pack_tuned(
            vec![test_content::object_offering("bench", vec![act])],
            terri_data::Tuning {
                hobby_multiplier: 3.0,
                // Zero variance, so "one completion" is a countable
                // claim rather than a band.
                duration_variance: 0.0,
                ..test_content::tuning()
            },
        )
    }

    /// Two sims complete the SAME activity; only the one who loves it is
    /// paid triple. One fixture, both branches, so "multiplied" and
    /// "base" cannot each pass against a broken other half ([L34]).
    #[test]
    fn a_completed_hobby_pays_triple_and_a_mere_pleasure_pays_base() {
        for (hobbies, expected) in [
            (vec!["whittling".to_string()], 6.0_f32),
            (vec!["philately".to_string()], 2.0),
        ] {
            let mut sim = test_content::sim_with(8, 8, hobby_pack());
            let bench_def = hobby_pack().find("bench").expect("fixture");
            sim.world_mut().spawn((
                Position { x: 3.0, y: 1.0 },
                terri_core::SmartObject(bench_def),
            ));
            let mut needs = terri_core::Needs::all_at(NEED_MAX);
            needs.set(terri_core::NeedId::Fun, 20.0);
            let agent = sim
                .world_mut()
                .spawn((
                    Agent,
                    Position { x: 2.0, y: 1.0 },
                    needs,
                    terri_core::Satisfaction::default(),
                    terri_core::Hobbies(hobbies.clone()),
                ))
                .id();

            let mut completed = false;
            for _ in 0..80 {
                sim.tick();
                let ledger = sim
                    .world()
                    .get::<terri_core::Satisfaction>(agent)
                    .unwrap()
                    .value();
                if ledger > 0.0 {
                    assert_eq!(
                        ledger, expected,
                        "hobbies {hobbies:?} must pay exactly {expected} on \
                         the first completion - base 2.0, multiplier 3.0"
                    );
                    completed = true;
                    break;
                }
            }
            assert!(completed, "the activity must complete inside the run");
        }
    }

    /// Nothing pays MID-interaction: the ledger stays zero until the
    /// completion tick. Interrupted-pays-nothing follows from the same
    /// site (the payout lives in the completion block beside
    /// habituation's bump), and this is the half a test can see without
    /// arranging an interruption.
    #[test]
    fn the_payout_lands_on_completion_and_never_per_tick() {
        let mut sim = test_content::sim_with(8, 8, hobby_pack());
        let bench_def = hobby_pack().find("bench").expect("fixture");
        sim.world_mut().spawn((
            Position { x: 3.0, y: 1.0 },
            terri_core::SmartObject(bench_def),
        ));
        let mut needs = terri_core::Needs::all_at(NEED_MAX);
        needs.set(terri_core::NeedId::Fun, 20.0);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 1.0 },
                needs,
                terri_core::Satisfaction::default(),
                terri_core::Hobbies(vec!["whittling".to_string()]),
            ))
            .id();

        let mut mid_interaction_reads = 0;
        for _ in 0..80 {
            sim.tick();
            let eating = sim.world().get::<terri_core::Eating>(agent);
            let ledger = sim
                .world()
                .get::<terri_core::Satisfaction>(agent)
                .unwrap()
                .value();
            match eating {
                // Mid-interaction with time still to run: a per-tick
                // payout would already show here.
                Some(e) if e.remaining_ticks > 1 => {
                    assert_eq!(ledger, 0.0, "nothing may pay before completion");
                    mid_interaction_reads += 1;
                }
                _ => {
                    if ledger > 0.0 {
                        assert_eq!(ledger, 6.0, "one completion, one payout");
                        assert!(
                            mid_interaction_reads > 2,
                            "the run must have OBSERVED mid-interaction ticks, \
                             or the per-tick assertion above never fired"
                        );
                        return;
                    }
                }
            }
        }
        panic!("the activity never completed");
    }

    /// A completed chat pays BOTH sides, each by their OWN hobbies: the
    /// initiator who loves company collects triple while the cornered
    /// housemate collects base - from one conversation.
    #[test]
    fn a_chat_pays_each_participant_by_their_own_hobbies() {
        let pack = test_content::pack_with_social(
            vec![],
            vec![{
                let mut chat =
                    test_content::interaction("chat", &[(terri_core::NeedId::Social, 30.0)], 40);
                chat.tags = vec!["socialising".to_string()];
                chat.satisfaction = 2.0;
                chat
            }],
            terri_data::Tuning {
                hobby_multiplier: 3.0,
                ..test_content::tuning()
            },
        );
        let mut sim = test_content::sim_with(8, 8, pack);
        let lonely = sim
            .world_mut()
            .spawn((
                Agent,
                terri_core::SimId(0),
                Position { x: 1.0, y: 1.0 },
                terri_core::Needs::with(terri_core::NeedId::Social, 20.0),
                terri_core::Satisfaction::default(),
                terri_core::Hobbies(vec!["socialising".to_string()]),
            ))
            .id();
        let cornered = sim
            .world_mut()
            .spawn((
                Agent,
                terri_core::SimId(1),
                Position { x: 4.0, y: 1.0 },
                terri_core::Needs::with(terri_core::NeedId::Social, 60.0),
                terri_core::Satisfaction::default(),
                terri_core::Hobbies(vec![]),
            ))
            .id();

        let ledger = |sim: &Sim, who| {
            sim.world()
                .get::<terri_core::Satisfaction>(who)
                .unwrap()
                .value()
        };
        for _ in 0..200 {
            sim.tick();
            if ledger(&sim, lonely) > 0.0 {
                // The FIRST completed conversation: 3x for the lover of
                // company, 1x for the cornered. Checked the moment the
                // initiator's ledger moves, before a second chat can
                // muddy the totals.
                assert_eq!(ledger(&sim, lonely), 6.0);
                assert_eq!(ledger(&sim, cornered), 2.0);
                return;
            }
        }
        panic!("no conversation completed inside the session");
    }
}
