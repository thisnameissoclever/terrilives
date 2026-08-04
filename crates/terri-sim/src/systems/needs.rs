use bevy_ecs::prelude::*;
use bevy_ecs::query::Has;
use terri_core::{NeedId, Needs, Personality};

use crate::Content;

/// Every need decays, each at the rate `content/tuning.toml` declares
/// for it.
///
/// The rates moved there from `needs.toml` at M1c, per [D-1]: a decay
/// rate is system BALANCE rather than part of a need's identity, and
/// every knob a designer tunes lives in one file. `needs.toml` still
/// declares which needs exist, and the compile step checks the two
/// files agree.
///
/// The rates used to be a `HUNGER_DECAY_PER_TICK` constant here as well
/// as rows in the content file: two copies of one number with nothing
/// asserting they agreed. The content file is now the only copy, and it
/// is the only place a rate can be changed.
///
/// The lookup is `decay_per_tick[id.index()]` rather than a fixed slot,
/// and the rates in content are pairwise distinct, so a need drained at
/// another need's rate is visible. `needs_decay_at_different_rates` is
/// what keeps that precondition true; see [L26] for the one-layer-down
/// version of the same trap, where a uniform fixture hid
/// `decay[id.index()]` becoming `decay[0]`.
///
/// A sim's `Personality` multiplies each rate - [H3]'s `drain` array. An
/// introvert's social falls slowly; a comfort creature's comfort aches
/// fast. `Option` because objects and every pre-M2c fixture carry no
/// personality, and absent must mean all-ones: that is the contract that
/// keeps the world-hash golden vectors still, since their scenarios spawn
/// bare agents whose behaviour must not have moved.
///
/// The multiplication is here rather than baked into a per-sim rate table
/// at spawn, because a rate that can change - a condition lifting, a
/// trait mutating, which is M2e - has to be computed from its sources on
/// read or the copy goes stale.
/// A sim AT WORK decays at `at_work_decay_scale` of the rate - [X2].
///
/// The rabbit hole put a sim somewhere it could reach nothing, and
/// `decay_needs` went on draining it at the full rate: measured over
/// 25 game days of the shipped lot, the household's only worker hit
/// zero on six of her seven needs and spent 27.3% of her life with
/// hunger at or under 5, while the two sims without jobs spent none.
/// An office is a building with a toilet and a kettle in it.
///
/// `Commuting` is deliberately NOT included. Walking to your own front
/// door is ordinary life, and a sim still on the lot can be served.
///
/// The career's price is unchanged and is the TIME - see [E4], and
/// [A-14] which measured it. This knob only stops that price being
/// starvation.
///
/// A sim ASLEEP decays at `asleep_decay_scale` of the rate, and the
/// reasoning is the same shape one rung down. Sleeping is the longest
/// thing a sim does - the double bed runs 210 ticks against the fridge's
/// 15 - so at the full rate those hours cost more hunger, hygiene and
/// bladder than anything else in the game. The sim that finally goes to
/// bed wakes starving and filthy, punished for doing the one thing every
/// other system was pushing it toward, which reads as the game being
/// unfair rather than as a rate being wrong.
///
/// Not zero, and the knob is validated in `[0, 1]` rather than merely
/// non-negative: a bed that suspended the simulation would be a place to
/// hide from it, and eight hours of nothing happening is the failure a
/// needs game has to avoid most. A sleeping sim still gets hungry, just
/// more slowly than one who is up.
///
/// **The two scales MULTIPLY rather than compete**, which costs nothing
/// to write and is the only answer that stays sane if a sim is ever both.
/// It cannot be today - `AtWork` removes a sim from the lot and there is
/// no bed at the office - and writing `if at_work { .. } else if asleep`
/// would bake that into arithmetic instead of leaving it where it lives.
/// What `decay_needs` reads per entity: the needs to drain, the
/// personality whose drains scale them, and the two states that slow
/// them. Named because clippy counts the tuple's arms, and because the
/// list is the whole input to the one system that moves every need.
type DecayRow<'a> = (
    &'a mut Needs,
    Option<&'a Personality>,
    Has<terri_core::AtWork>,
    Option<&'a terri_core::Eating>,
);

pub fn decay_needs(content: Res<Content>, mut query: Query<DecayRow>) {
    let rates = &content.0.decay_per_tick;
    for (mut needs, personality, at_work, eating) in &mut query {
        let away = if at_work {
            content.0.tuning.at_work_decay_scale
        } else {
            1.0
        };
        let asleep = if super::circadian::is_asleep(content.0, eating) {
            content.0.tuning.asleep_decay_scale
        } else {
            1.0
        };
        for id in NeedId::ALL {
            let multiplier = personality.map_or(1.0, |p| p.drain[id.index()]);
            needs.drain(id, rates[id.index()] * multiplier * away * asleep);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Sim;
    use terri_core::{Agent, SimClock};

    /// **A sleeping sim's needs decay slower, and an eating one's do
    /// not.**
    ///
    /// Two agents, identical except that one is mid-interaction on a
    /// sleep-TAGGED object and the other on an untagged one of the same
    /// shape. After the same ticks the sleeper must be strictly less
    /// drained on every need, and by exactly `asleep_decay_scale`.
    ///
    /// Both sims carry an `Eating` component, which is the point: the
    /// comparison is between two sims doing something, so what separates
    /// them is the tag rather than the mere fact of being busy. A fixture
    /// with one idle sim would pass for a rule that slowed decay for
    /// anybody mid-interaction, which is not the rule.
    #[test]
    fn a_sleeping_sim_decays_slower_and_a_busy_one_does_not() {
        use terri_core::{Eating, ObjectDefId};
        const TICKS: usize = 40;

        let mut bed = crate::test_content::interaction("lie_down", &[(NeedId::Energy, 100.0)], 200);
        bed.tags = vec!["sleep".to_string()];
        let content = crate::test_content::pack(vec![
            crate::test_content::object_offering("bed", vec![bed]),
            crate::test_content::object("desk", &[(NeedId::Fun, 20.0)], 200),
        ]);
        let scale = content.tuning.asleep_decay_scale;
        assert!(
            (0.0..1.0).contains(&scale),
            "a scale of 1 would make every assertion below vacuous; got {scale}"
        );

        let mut sim = crate::test_content::sim_with(8, 8, content);
        let busy = |object: u32| Eating {
            object: ObjectDefId(object),
            interaction: 0,
            remaining_ticks: 10_000,
        };
        let sleeper = sim
            .world_mut()
            .spawn((Agent, Needs::all_at(terri_core::NEED_MAX), busy(0)))
            .id();
        let worker = sim
            .world_mut()
            .spawn((Agent, Needs::all_at(terri_core::NEED_MAX), busy(1)))
            .id();

        for _ in 0..TICKS {
            sim.tick();
        }

        let slept = *sim.world().get::<Needs>(sleeper).unwrap();
        let worked = *sim.world().get::<Needs>(worker).unwrap();
        let rates = terri_data::pack().decay_per_tick;
        for id in NeedId::ALL {
            // Energy is excluded: both sims are mid-interaction and the
            // bed REFILLS it, so that column is measuring delivery rather
            // than decay.
            if id == NeedId::Energy {
                continue;
            }
            assert!(
                rates[id.index()] > 0.0,
                "a zero rate for {id:?} would make its assertion vacuous"
            );
            let slept_lost = terri_core::NEED_MAX - slept.get(id);
            let worked_lost = terri_core::NEED_MAX - worked.get(id);
            assert!(
                slept_lost < worked_lost,
                "{id:?}: the sleeper lost {slept_lost} and the worker {worked_lost}"
            );
            assert!(
                (slept_lost - worked_lost * scale).abs() < 1e-3,
                "{id:?}: sleeping must cost exactly {scale} of waking; \
                 got {slept_lost} against {worked_lost}"
            );
        }
    }

    /// **The rule is the TAG, not "this restores energy".**
    ///
    /// The object here is a coffee machine in all but name: a big
    /// positive energy advert and no sleep tag. Under the inference this
    /// replaced - whether the biggest positive advert was energy - it
    /// would have counted as sleep, drawn a Zzz over the sim's head and
    /// slowed its hunger while it drank.
    #[test]
    fn restoring_energy_is_not_the_same_as_sleeping() {
        use terri_core::{Eating, ObjectDefId};
        let content = crate::test_content::pack(vec![crate::test_content::object(
            "coffee",
            &[(NeedId::Energy, 60.0)],
            20,
        )]);
        let eating = Eating {
            object: ObjectDefId(0),
            interaction: 0,
            remaining_ticks: 10,
        };
        assert!(
            !crate::systems::circadian::is_asleep(content, Some(&eating)),
            "an untagged energy interaction is a coffee, not a bed"
        );
        assert!(
            !crate::systems::circadian::is_asleep(content, None),
            "a sim doing nothing at all is not asleep"
        );
    }

    /// **A personality's drain multiplier scales decay per need, and a sim
    /// with no personality decays at exactly the content rate.**
    ///
    /// Two agents in one world, one bare and one wearing a personality
    /// whose fun drains at 2.5x - deliberately not 1.0, not 0.0, and
    /// unequal to any shipped multiplier. Comparing the two after the same
    /// ticks pins three things at once: the multiplier is READ (the worn
    /// sim's fun differs), it applies to THAT need only (the other six
    /// stay equal between the two sims), and absence means neutral - the
    /// contract that keeps the world-hash golden vectors still, since
    /// their scenarios spawn bare agents.
    #[test]
    fn a_personality_drain_multiplier_scales_one_need_and_absence_means_neutral() {
        use terri_core::Personality;
        const TICKS: usize = 50;
        const MULTIPLIER: f32 = 2.5;

        let mut sim = Sim::new();
        let bare = sim
            .world_mut()
            .spawn((Agent, Needs::all_at(terri_core::NEED_MAX)))
            .id();
        let mut personality = Personality::neutral();
        personality.drain[NeedId::Fun.index()] = MULTIPLIER;
        let worn = sim
            .world_mut()
            .spawn((Agent, Needs::all_at(terri_core::NEED_MAX), personality))
            .id();

        for _ in 0..TICKS {
            sim.tick();
        }

        let bare_needs = *sim.world().get::<Needs>(bare).unwrap();
        let worn_needs = *sim.world().get::<Needs>(worn).unwrap();
        let rates = terri_data::pack().decay_per_tick;
        assert!(
            rates[NeedId::Fun.index()] > 0.0,
            "a zero fun rate would make the multiplied assertion vacuous"
        );

        for id in NeedId::ALL {
            if id == NeedId::Fun {
                let expected = terri_core::NEED_MAX - rates[id.index()] * MULTIPLIER * TICKS as f32;
                assert!(
                    (worn_needs.get(id) - expected).abs() < 1e-3,
                    "fun must drain at {MULTIPLIER}x for the worn sim; got {} against {expected}",
                    worn_needs.get(id)
                );
            } else {
                assert_eq!(
                    worn_needs.get(id),
                    bare_needs.get(id),
                    "{} carries no multiplier and must match the bare sim exactly",
                    id.as_str()
                );
            }
        }
    }

    /// Replaces `hunger_decays_at_the_rate_content_declares`, which
    /// asserted the OPPOSITE of this for the other six needs: that they
    /// hold at their spawn level, because only hunger had a rate applied.
    /// That assertion was correct and deliberate until Task 7, and it
    /// failed loudly here, which is what it was for.
    ///
    /// Everything it pinned is carried over below, over all seven needs
    /// instead of one: the rate read from content rather than restated as
    /// a literal, the vacuity guard against a zero rate, and the seam
    /// between the clock and the schedule.
    #[test]
    fn every_need_decays_at_its_content_rate() {
        const TICKS: usize = 100;

        let mut sim = Sim::new();
        let id = sim
            .world_mut()
            .spawn((Agent, Needs::all_at(terri_core::NEED_MAX)))
            .id();

        for _ in 0..TICKS {
            sim.tick();
        }

        let needs = *sim.world().get::<Needs>(id).unwrap();
        let rates = terri_data::pack().decay_per_tick;
        for need in NeedId::ALL {
            let rate = rates[need.index()];
            // Vacuity guard. At a rate of zero the expected level is the
            // spawn level, so the assertion below would be satisfied by a
            // need the simulation never touches - which is exactly the
            // regression this test exists to catch. Zero is legal content
            // ([L27]), so this is reachable by a TOML edit rather than
            // only by a bug.
            //
            // Measured, per testing-protocol rule 1 applied to the guard
            // and not only to the mechanism: set comfort's rate to 0.0 in
            // content/tuning.toml and it is THIS line that fails, with
            // "comfort decays at zero". The level assertion below stays
            // green, because 100.0 - 0.0 * 100 is where comfort already
            // sits.
            assert!(
                rate > 0.0,
                "{} decays at zero, so its assertion below proves nothing",
                need.as_str()
            );
            let expected = terri_core::NEED_MAX - rate * TICKS as f32;
            assert!(
                (needs.get(need) - expected).abs() < 0.001,
                "{} expected ~{expected}, got {}",
                need.as_str(),
                needs.get(need)
            );
        }

        // Covers the seam between the clock and the schedule. Inherited
        // from `hunger_decays_at_the_rate_content_declares`, which this
        // test replaces - but its stated reason has expired and is not
        // repeated here. That comment claimed dropping `advance_clock`
        // from `add_systems` would otherwise leave the whole workspace
        // green, which was true when it was written and stopped being
        // true once `world_hash` began hashing the tick.
        //
        // Measured: removing `advance_clock` fails this assertion AND
        // `world_hash_matches_its_golden_vector`. The reason to keep it
        // is what it says rather than whether it is alone - this one
        // reports `0` against `100` and names the clock, where the golden
        // vector reports two 64-bit digests and could mean any change to
        // anything the simulation computes.
        assert_eq!(
            sim.world().resource::<SimClock>().tick,
            TICKS as u64,
            "the schedule must advance the clock; decay ran but the tick \
             did not move"
        );
    }

    /// **A sim at work decays at `at_work_decay_scale`, and one on the
    /// lot at the full rate** - [X2].
    ///
    /// The rabbit hole put a sim where it could reach nothing while
    /// `decay_needs` drained it at full speed: measured over 25 game
    /// days of the shipped lot, the household's only worker hit zero
    /// on six of her seven needs and spent 27.3% of her life with
    /// hunger at or under 5, against zero crisis ticks for the two
    /// sims without jobs.
    ///
    /// Two agents in one world, alike but for `AtWork`, compared after
    /// the same ticks. That pins three things a single agent could
    /// not: the scale is READ (the working sim keeps more), it applies
    /// to EVERY need rather than to hunger alone, and its absence
    /// means neutral - the contract the world-hash goldens rest on,
    /// since their scenarios spawn bare agents.
    ///
    /// The expected values are computed from content rather than
    /// written down, so a balance pass moves them without touching
    /// this test - and a scale of exactly 1 would make the two sims
    /// equal, which the inequality assertion catches.
    #[test]
    fn a_sim_at_work_decays_at_the_scaled_rate_and_absence_means_full_rate() {
        const TICKS: usize = 40;

        let mut sim = Sim::new();
        let scale = sim
            .world()
            .resource::<Content>()
            .0
            .tuning
            .at_work_decay_scale;
        let home = sim
            .world_mut()
            .spawn((Agent, Needs::all_at(terri_core::NEED_MAX)))
            .id();
        let away = sim
            .world_mut()
            .spawn((
                Agent,
                Needs::all_at(terri_core::NEED_MAX),
                terri_core::AtWork {
                    remaining_ticks: TICKS as u32 * 2,
                },
            ))
            .id();

        sim.world_mut().insert_resource(SimClock::default());
        for _ in 0..TICKS {
            sim.world_mut()
                .run_system_cached(decay_needs)
                .expect("runs");
        }

        for id in NeedId::ALL {
            let rate = sim.world().resource::<Content>().0.decay_per_tick[id.index()];
            let at_home = sim.world().get::<Needs>(home).expect("needs").get(id);
            let at_work = sim.world().get::<Needs>(away).expect("needs").get(id);

            let expected_home = terri_core::NEED_MAX - TICKS as f32 * rate;
            let expected_work = terri_core::NEED_MAX - TICKS as f32 * rate * scale;
            assert!(
                (at_home - expected_home).abs() < 0.01,
                "{id:?} at home: read {at_home}, expected {expected_home}"
            );
            assert!(
                (at_work - expected_work).abs() < 0.01,
                "{id:?} at work: read {at_work}, expected {expected_work}"
            );
            assert!(
                at_work > at_home,
                "{id:?}: the shift must cost LESS than the same time at home, \
                 read {at_work} at work against {at_home} at home"
            );
        }
    }

    #[test]
    fn needs_decay_at_different_rates() {
        // A single shared rate applied to all seven would satisfy
        // `every_need_decays_at_its_content_rate` if the content happened
        // to declare one rate for every need, so pin that it does not.
        //
        // Stronger than "some rate differs from the first": the rates
        // must be PAIRWISE distinct. `decay_needs` maps a need onto a
        // slot, and a mapping that swaps two needs sharing a rate is
        // invisible to any test built on that content - the same trap
        // [L26] recorded one layer down, where `decay[id.index()]`
        // becoming `decay[0]` survived twelve tests because every fixture
        // gave all seven needs the same rate.
        //
        // If a future balance pass gives two needs the same rate this
        // fails, and that failure is correct: it is the moment
        // `every_need_decays_at_its_content_rate` quietly stops being
        // able to tell those two apart.
        //
        // Measured: setting energy's rate to hunger's 0.104 fails here
        // with "hunger and energy decay at the same rate", and leaves
        // `every_need_decays_at_its_content_rate` green - which is the
        // whole point of having this test as well as that one.
        let rates = terri_data::pack().decay_per_tick;
        for a in NeedId::ALL {
            for b in NeedId::ALL {
                if a != b {
                    assert_ne!(
                        rates[a.index()],
                        rates[b.index()],
                        "{} and {} decay at the same rate, so no test can \
                         tell their slots apart",
                        a.as_str(),
                        b.as_str()
                    );
                }
            }
        }
    }

    #[test]
    fn no_need_goes_negative() {
        // Was `hunger_never_goes_negative`, over hunger alone. Decay now
        // drains all seven, so the floor has to hold for all seven: a
        // clamp applied per need rather than to the whole array would
        // leave six of them running to -100 and below, which every
        // deficit, every score and both world-hash digests would then
        // read as a valid level.
        //
        // Every need starts at 1.0, so the slowest rate in content still
        // crosses zero long before the loop ends.
        //
        // The widening is load-bearing rather than tidiness, and it was
        // measured. Make `Needs::drain` clamp only hunger and write the
        // other six straight into the array: this test is the ONLY thing
        // in the workspace that fails, at `energy fell past the floor,
        // left: -68.0002`.
        //
        // Note where that failure lands. The loop reaches ENERGY, so
        // hunger's own assertion passed - and hunger's assertion is the
        // whole of what `hunger_never_goes_negative` used to check, so
        // the version this replaces was green under that mutation. So
        // were both world-hash golden vectors, because their 100-tick
        // scenario never drives a need below zero in the first place.
        // See [L31].
        let mut sim = Sim::new();
        let id = sim.world_mut().spawn((Agent, Needs::all_at(1.0))).id();

        for _ in 0..1000 {
            sim.tick();
        }

        let needs = *sim.world().get::<Needs>(id).unwrap();
        for need in NeedId::ALL {
            assert_eq!(
                needs.get(need),
                0.0,
                "{} fell past the floor",
                need.as_str()
            );
        }
    }
}
