//! Habituation decay - [S2].
//!
//! The rise lives in `interact::tick_interactions`, because it happens when an
//! interaction finishes. This is the other half: everything a sim is tired of
//! becomes slightly less so on every tick.

use bevy_ecs::prelude::*;
use terri_core::Habituation;

use crate::Content;

/// Decays every agent's habituation toward zero.
///
/// **Ordering does not matter for this system and that is worth saying**, since
/// almost every other system in the tick has a load-bearing position. It reads
/// and writes one component per agent, touches no shared state, and no other
/// system reads habituation in the same tick that this writes it: selection runs
/// before it in the schedule and sees the previous tick's values. Placing it
/// anywhere in the tick produces the same behaviour up to a one-tick offset.
///
/// Entries that reach zero are dropped rather than kept at zero, which keeps
/// `world_hash` a function of state that matters; see [`Habituation::decay`].
pub fn decay_habituation(content: Res<Content>, mut agents: Query<&mut Habituation>) {
    let amount = content.0.tuning.habituation_decay_per_tick;
    for mut habituation in &mut agents {
        // Skipped when there is nothing to decay, so an agent that has never
        // done anything does not get a change-detection tick every frame.
        if habituation.entries().is_empty() {
            continue;
        }
        habituation.decay(amount);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::systems::advertise;
    use crate::{test_content, Sim};
    use terri_core::{Agent, Eating, NeedId, Needs, Position, SmartObject, Target, NEED_MAX};

    const DURATION: u32 = 30;

    fn content() -> &'static terri_data::ContentPack {
        test_content::pack(vec![test_content::object(
            "telly",
            &[(NeedId::Fun, 40.0)],
            DURATION,
        )])
    }

    fn def(pack: &terri_data::ContentPack) -> terri_core::ObjectDefId {
        pack.find("telly").expect("the fixture declares it")
    }

    /// A world with one object and one bored agent standing beside it.
    fn scenario() -> (Sim, Entity, Entity) {
        let pack = content();
        let mut sim = test_content::sim_with(16, 16, pack);
        let object = sim
            .world_mut()
            .spawn((Position { x: 8.0, y: 8.0 }, SmartObject(def(pack))))
            .id();
        let mut needs = Needs::all_at(NEED_MAX);
        needs.set(NeedId::Fun, 5.0);
        let agent = sim
            .world_mut()
            .spawn((Agent, Position { x: 7.0, y: 8.0 }, needs))
            .id();
        (sim, object, agent)
    }

    fn habituation_of(sim: &Sim, agent: Entity) -> f32 {
        sim.world()
            .get::<Habituation>(agent)
            .map_or(0.0, |h| h.get(def(content()), 0))
    }

    /// **Habituation rises when an interaction FINISHES, and not before.**
    ///
    /// The two halves are one test because the interesting claim is the
    /// boundary: a sim halfway through watching television is not yet tired of
    /// it, and a mechanic that charged per tick would be a second duration
    /// penalty rather than a novelty one.
    #[test]
    fn finishing_an_interaction_raises_habituation_and_starting_one_does_not() {
        let (mut sim, _object, agent) = scenario();

        // Tick until the interaction is under way, then assert nothing has been
        // charged yet. Without this half, "it rose" is satisfied by a rise at
        // any point including the first tick.
        let mut started = false;
        for _ in 0..40 {
            sim.tick();
            if sim.world().get::<Eating>(agent).is_some() {
                started = true;
                break;
            }
        }
        assert!(started, "the agent must begin the interaction");
        assert!(
            sim.world().get::<Eating>(agent).unwrap().remaining_ticks > 2,
            "the interaction must have real time left, or 'not yet charged' is \
             satisfied by it being about to end anyway"
        );
        assert_eq!(
            habituation_of(&sim, agent),
            0.0,
            "an interaction in progress must not have been charged yet"
        );

        // Now run it out.
        for _ in 0..DURATION * 3 {
            sim.tick();
            if sim.world().get::<Eating>(agent).is_none() {
                break;
            }
        }
        let after = habituation_of(&sim, agent);
        let expected = test_content::tuning().habituation_per_use;
        // Decay has had a tick or two, so this is a band rather than an
        // equality - and the band is far from zero either way.
        assert!(
            after > expected * 0.9 && after <= expected,
            "finishing must charge about {expected}; got {after}"
        );
    }

    /// [OD-model] on the single-interaction path: `tick_interactions`, which
    /// television, showers and every other non-chain activity complete
    /// through, passes the tuned cap rather than 1. The agent is ordered to
    /// watch the `telly` again after every completion; its habituation
    /// passes 1, reaches the cap, and is never above it at any tick.
    ///
    /// A completion bumps before that tick's decay, so a capped completion
    /// reads one tick's decay below the cap.
    #[test]
    fn repeated_single_interactions_pass_one_and_stop_at_the_tuned_cap() {
        use terri_core::{CommandQueue, SimClock, SimCommand};

        let (mut sim, object, agent) = scenario();
        let tuning = test_content::tuning();
        let max = tuning.habituation_max;
        let decay = tuning.habituation_decay_per_tick;
        assert_eq!(content().tuning.habituation_max, max);
        let mut highest = 0.0_f32;
        let mut capped = 0;
        for watch in 1..=20 {
            sim.world_mut()
                .get_mut::<Needs>(agent)
                .unwrap()
                .set(NeedId::Fun, 5.0);
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObjectFirst {
                    agent: agent.index_u32(),
                    object: object.index_u32(),
                    interaction: 0,
                });
            let start = sim.world().resource::<SimClock>().tick;
            let before = habituation_of(&sim, agent);
            let mut ticks = 0_u64;
            let mut began = false;
            let mut finished = false;
            for _ in 0..DURATION * 4 {
                sim.tick();
                ticks += 1;
                let now = habituation_of(&sim, agent);
                assert!(now <= max, "watch {watch}: {now} is above the cap {max}");
                let eating = sim.world().get::<Eating>(agent).is_some();
                began |= eating;
                if began && !eating {
                    finished = true;
                    break;
                }
            }
            assert!(finished, "watch {watch} must finish within the bound");
            assert_eq!(
                sim.world().resource::<SimClock>().tick,
                start + ticks,
                "watch {watch}: one clock tick per loop tick"
            );
            let after = habituation_of(&sim, agent);
            let at_cap = (after - (max - decay)).abs() < 1e-4;
            // Below the cap every completion charges; at the cap a
            // completion lands exactly where the last one did.
            assert!(
                after > before || at_cap,
                "watch {watch} must charge habituation: {before} then {after}"
            );
            highest = highest.max(after);
            if at_cap {
                capped += 1;
            }
            if capped >= 2 {
                break;
            }
        }
        assert!(highest > 1.0, "repetition must pass 1; got {highest}");
        assert_eq!(
            capped, 2,
            "two completions reach the cap; highest {highest}"
        );
    }

    /// **An interrupted interaction charges nothing.**
    ///
    /// Same rule the intent queue uses: only what completed counts. Without it,
    /// a sim that keeps being redirected would accumulate habituation for
    /// things it never actually did.
    #[test]
    fn an_interrupted_interaction_charges_no_habituation() {
        let (mut sim, _object, agent) = scenario();
        for _ in 0..40 {
            sim.tick();
            if sim.world().get::<Eating>(agent).is_some() {
                break;
            }
        }
        assert!(
            sim.world().get::<Eating>(agent).is_some(),
            "the agent must be mid-interaction for this to interrupt anything"
        );

        // Yank it out from under the agent, as a cancel or a redirect would.
        sim.world_mut()
            .entity_mut(agent)
            .remove::<Eating>()
            .remove::<Target>();
        sim.tick();

        assert_eq!(
            habituation_of(&sim, agent),
            0.0,
            "an interaction that never finished must charge nothing"
        );
    }

    /// Decay runs, and an entry that reaches zero is REMOVED rather than kept.
    ///
    /// The removal is what keeps `world_hash` a function of state that matters:
    /// a zeroed entry behaves identically to an absent one, so keeping it would
    /// let two sims that will behave the same hash differently forever.
    #[test]
    fn habituation_decays_and_spent_entries_are_dropped() {
        let pack = content();
        let mut sim = test_content::sim_with(16, 16, pack);
        let agent = sim.world_mut().spawn((Agent, Needs::all_at(NEED_MAX))).id();

        let mut fresh = Habituation::default();
        fresh.bump(def(pack), 0, 0.05, pack.tuning.habituation_max);
        sim.world_mut().entity_mut(agent).insert(fresh);
        assert_eq!(
            sim.world()
                .get::<Habituation>(agent)
                .unwrap()
                .entries()
                .len(),
            1
        );

        let rate = test_content::tuning().habituation_decay_per_tick;
        assert!(rate > 0.0, "a zero rate could not decay anything");
        sim.tick();
        let after_one = habituation_of(&sim, agent);
        assert!(
            after_one < 0.05 && after_one > 0.0,
            "one tick must decay it a little, not to zero; got {after_one}"
        );

        for _ in 0..(0.05 / rate).ceil() as u32 + 2 {
            sim.tick();
        }
        assert_eq!(
            sim.world()
                .get::<Habituation>(agent)
                .unwrap()
                .entries()
                .len(),
            0,
            "a spent entry must be dropped, not held at zero"
        );
    }

    /// **An entry that lands EXACTLY on zero is dropped**, which the test
    /// above cannot see.
    ///
    /// It decays a 0.05 entry for `ceil(0.05 / rate) + 2` ticks, so the value
    /// sails past zero and goes negative - and a negative is dropped by
    /// `> 0.0` and by `>= 0.0` alike. The mutation is only observable on the
    /// one value where the two comparisons disagree, and no fixture in the
    /// workspace produced it: found by the M2b mutation sweep as a survivor
    /// in `Habituation::decay`.
    ///
    /// Landing on zero exactly is arranged rather than hoped for. `decay`
    /// subtracts the tuned rate, so an entry bumped to exactly that rate is
    /// at `rate - rate` after one tick, which is exactly 0.0 in IEEE
    /// arithmetic for any finite rate - no tolerance needed, and it does not
    /// depend on the rate's value.
    ///
    /// Kept at zero rather than dropped, a spent entry is a `world_hash`
    /// column that differs between two sims which will behave identically
    /// from now on, for ever.
    #[test]
    fn an_entry_that_decays_to_exactly_zero_is_dropped_rather_than_kept() {
        let pack = content();
        let mut sim = test_content::sim_with(16, 16, pack);
        let agent = sim.world_mut().spawn((Agent, Needs::all_at(NEED_MAX))).id();

        let rate = test_content::tuning().habituation_decay_per_tick;
        assert!(rate > 0.0, "a zero rate could not decay anything");

        let mut fresh = Habituation::default();
        fresh.bump(def(pack), 0, rate, pack.tuning.habituation_max);
        sim.world_mut().entity_mut(agent).insert(fresh);
        assert_eq!(
            habituation_of(&sim, agent),
            rate,
            "the entry must start at exactly the decay rate, or one tick              does not land on zero and this test is the one above"
        );

        sim.tick();

        assert_eq!(
            sim.world()
                .get::<Habituation>(agent)
                .unwrap()
                .entries()
                .len(),
            0,
            "an entry at exactly 0.0 must be dropped; holding it makes two              sims that behave identically hash differently for ever"
        );
    }

    /// **Habituation scales BENEFIT and never COST**, which is the one part of
    /// this mechanic that is easy to get backwards and impossible to notice.
    ///
    /// An interaction with a negative delta - the shower's `energy = -12` - must
    /// keep that cost at full strength however habituated the sim is. Scaling it
    /// toward zero alongside the benefit would make a thoroughly-repeated shower
    /// CHEAPER, and therefore more attractive the more you use it, which is the
    /// mechanic running in reverse.
    ///
    /// Two objects with identical positive deltas and identical durations, one
    /// of which also carries a cost. Both are habituated identically. If costs
    /// were scaled too, the costly one's score would rise relative to the free
    /// one; the assertion is that its shortfall is unchanged.
    #[test]
    fn habituation_scales_the_benefit_and_leaves_a_cost_at_full_strength() {
        const BENEFIT: f32 = 40.0;
        const COST: f32 = -12.0;
        const DIST: f32 = 3.0;
        let floor = test_content::tuning().habituation_floor;
        assert!(
            floor < 1.0,
            "a floor of 1 disables the mechanic and this test would prove nothing"
        );

        // Fully habituated: scale is the floor.
        let scale = floor;
        let deficit = 0.8;

        // What select_action computes for the free interaction.
        let free = advertise::score_advertisement(deficit, BENEFIT * scale, DURATION, DIST);
        // And for the costly one - the benefit scaled, the cost NOT.
        let costly = advertise::score_advertisement(deficit, BENEFIT * scale, DURATION, DIST)
            + advertise::score_advertisement(deficit, COST, DURATION, DIST);
        // The wrong version, scaling both.
        let costly_if_cost_were_scaled =
            advertise::score_advertisement(deficit, BENEFIT * scale, DURATION, DIST)
                + advertise::score_advertisement(deficit, COST * scale, DURATION, DIST);

        assert!(
            costly < free,
            "a cost must still reduce the score; {costly} vs {free}"
        );
        assert!(
            costly < costly_if_cost_were_scaled,
            "scaling the cost as well makes the costly interaction MORE              attractive, which is the bug this pins: {costly} vs              {costly_if_cost_were_scaled}"
        );
        // And the shortfall is exactly the unscaled cost's own contribution.
        let shortfall = free - costly;
        let unscaled_cost_term = -advertise::score_advertisement(deficit, COST, DURATION, DIST);
        assert!(
            (shortfall - unscaled_cost_term).abs() < 1e-6,
            "the shortfall must equal the cost at FULL strength; {shortfall} vs              {unscaled_cost_term}"
        );
    }

    /// The component's own arithmetic: capped at the tuned maximum ([OD-model]
    /// in `docs/specs/2026-10-06-overdoing-it.md`), keyed per interaction, and
    /// kept in sorted order because `world_hash` iterates it.
    #[test]
    fn habituation_caps_at_the_tuned_maximum_and_keeps_its_keys_sorted() {
        let cap = test_content::tuning().habituation_max;
        assert!(
            cap > 1.0,
            "a cap of 1 leaves nothing above saturation to test"
        );
        let mut h = Habituation::default();
        let a = terri_core::ObjectDefId(7);
        let b = terri_core::ObjectDefId(2);

        // Inserted out of order on purpose - the sort is the invariant.
        h.bump(a, 1, 0.4, cap);
        h.bump(b, 0, 0.4, cap);
        h.bump(a, 0, 0.4, cap);
        let keys: Vec<(u32, u32)> = h.entries().iter().map(|(o, i, _)| (o.0, *i)).collect();
        assert_eq!(
            keys,
            vec![(2, 0), (7, 0), (7, 1)],
            "entries must be sorted by (object, interaction) whatever the \
             insertion order, or the digest depends on history"
        );

        // Separate keys accumulate separately - the whole point of keying on the
        // interaction rather than the object or the need.
        assert_eq!(h.get(a, 0), 0.4);
        assert_eq!(h.get(a, 1), 0.4);

        // Past 1, which is overdoing rather than an error, and up to the cap
        // but never beyond it.
        h.bump(a, 0, 0.8, cap);
        assert!(
            (h.get(a, 0) - 1.2).abs() < 1e-6,
            "the cap is no longer 1; got {}",
            h.get(a, 0)
        );
        for _ in 0..(cap / 0.4).ceil() as u32 {
            h.bump(a, 0, 0.4, cap);
        }
        assert_eq!(h.get(a, 0), cap, "must cap at the tuned maximum");
        assert_eq!(
            h.get(a, 1),
            0.4,
            "and capping one key must not touch another"
        );

        // The insert path clamps too: a first use larger than the cap.
        let c = terri_core::ObjectDefId(5);
        h.bump(c, 0, cap + 1.0, cap);
        assert_eq!(h.get(c, 0), cap, "a fresh entry is clamped to the cap");

        assert_eq!(h.get(terri_core::ObjectDefId(99), 0), 0.0, "absent reads 0");
    }

    /// [OD-model]: appeal reads at most 1. The part of habituation above 1
    /// is overdoing, which costs mood and never pushes appeal below the
    /// floor. Golden values per [L55].
    #[test]
    fn benefit_scale_clamps_repetition_above_one() {
        assert_eq!(
            advertise::benefit_scale(1.5, 0.45),
            advertise::benefit_scale(1.0, 0.45)
        );
        assert_eq!(advertise::benefit_scale(3.0, 0.45), 0.45);
        assert_eq!(advertise::benefit_scale(-1.0, 0.45), 1.0);
    }

    /// [OD-evidence] item 1, played on the shipped lot: Tim is ordered to
    /// grab a snack at least nine times in a row. After each completion his
    /// snack row's habituation is the previous completion's value plus one
    /// use, less the decay of every tick since, capped at `habituation_max`;
    /// it is never above the cap at any tick; and the ninth snack fills
    /// hunger by exactly as much as the first, because need delivery never
    /// reads repetition.
    ///
    /// Back to back, a snack takes 70 to 106 ticks, so one completion nets
    /// about a quarter: nine reach about 2.3, not the cap. The orders go on
    /// past nine until two completions land on the cap, so the cap
    /// is exercised in play rather than only in the component test.
    ///
    /// The completing tick bumps before it decays: the snack chain's bump is
    /// a queued command that the chained schedule applies before
    /// `decay_habituation` runs. So the cap applies to the value that tick
    /// began with plus one use, and the completing tick's own decay comes
    /// after the cap.
    #[test]
    fn the_cap_holds_and_delivery_ignores_repetition() {
        use terri_core::{Career, ChainState, CommandQueue, SimClock, SimCommand, SimName};

        let mut sim = Sim::new_from_shipped_lot();
        let pack = sim.world().resource::<Content>().0;
        let tuning = pack.tuning;
        let decay = tuning.habituation_decay_per_tick;
        let tim = sim
            .world_mut()
            .query::<(Entity, &SimName)>()
            .iter(sim.world())
            .find(|(_, name)| name.0 == "Tim")
            .expect("Tim is in the shipped household")
            .0;
        // No shift to leave for, and no drain, so hunger moves only when a
        // snack delivers. Tim can cook, so no snack is fumbled.
        sim.world_mut().entity_mut(tim).remove::<Career>();
        sim.world_mut()
            .get_mut::<terri_core::Personality>(tim)
            .expect("Tim has a personality")
            .drain = [0.0; terri_core::NEED_COUNT];
        let fridge = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, object)| pack.object(object.0).id == "fridge")
            .expect("the shipped lot has a fridge")
            .0;
        let fridge_def = sim.world().get::<SmartObject>(fridge).unwrap().0;
        let row = pack
            .object(fridge_def)
            .interactions
            .iter()
            .position(|action| action.id == "grab_snack")
            .expect("the fridge offers a snack") as u32;
        let snack_chain = pack
            .chains
            .iter()
            .position(|chain| chain.id == crate::domestic::SNACK)
            .expect("the snack chain") as u32;
        let value = |sim: &Sim| {
            sim.world()
                .get::<Habituation>(tim)
                .map_or(0.0, |h| h.get(fridge_def, row))
        };

        const HUNGER: f32 = 30.0;
        let mut previous = 0.0_f32;
        let mut ticks_since_previous = 0_u32;
        let mut last = 0.0_f32;
        let mut refills = Vec::new();
        let mut capped = 0;
        for snack in 1..=16 {
            sim.world_mut()
                .get_mut::<Needs>(tim)
                .unwrap()
                .set(NeedId::Hunger, HUNGER);
            let before = sim.world().get::<Needs>(tim).unwrap().get(NeedId::Hunger);
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObjectFirst {
                    agent: tim.index_u32(),
                    object: fridge.index_u32(),
                    interaction: row,
                });
            let start = sim.world().resource::<SimClock>().tick;
            let mut ticks = 0_u64;
            let mut began = false;
            let mut completed = false;
            let mut finished = false;
            for _ in 0..2000 {
                sim.tick();
                ticks += 1;
                ticks_since_previous += 1;
                let now = value(&sim);
                assert!(
                    now <= tuning.habituation_max,
                    "snack {snack}: {now} is above the cap"
                );
                if now > last {
                    // An entry decayed to zero is dropped, so the previous
                    // value never decays below nothing.
                    let decay_during_wait = decay * (ticks_since_previous - 1) as f32;
                    let waited = (previous - decay_during_wait).max(0.0);
                    let expected =
                        (waited + tuning.habituation_per_use).min(tuning.habituation_max) - decay;
                    assert!(
                        (now - expected).abs() < 1e-4,
                        "snack {snack}: {now}, expected {expected}"
                    );
                    assert!(!completed, "snack {snack} completed once");
                    completed = true;
                    previous = now;
                    ticks_since_previous = 0;
                }
                last = now;
                let running = sim
                    .world()
                    .get::<ChainState>(tim)
                    .is_some_and(|state| state.chain == snack_chain);
                began |= running;
                if began && !running && completed {
                    finished = true;
                    break;
                }
            }
            assert!(finished, "snack {snack} must finish within the bound");
            assert_eq!(
                sim.world().resource::<SimClock>().tick,
                start + ticks,
                "snack {snack}: one clock tick per loop tick"
            );
            let after = sim.world().get::<Needs>(tim).unwrap().get(NeedId::Hunger);
            refills.push(after - before);
            if snack == 9 {
                assert!(
                    previous > 1.0,
                    "nine snacks in a row must reach overdoing; got {previous}"
                );
            }
            // A capped completion lands one tick's decay below the cap.
            if (previous - (tuning.habituation_max - decay)).abs() < 1e-4 {
                capped += 1;
            }
            if snack >= 9 && capped >= 2 {
                break;
            }
        }
        assert_eq!(capped, 2, "two completions reach the cap");
        assert!(refills[0] > 0.0, "a snack must fill hunger: {refills:?}");
        assert_eq!(
            refills[8], refills[0],
            "the ninth snack must fill hunger exactly as the first did: {refills:?}"
        );
        assert!(
            refills.iter().all(|refill| *refill == refills[0]),
            "every snack, at the cap too, fills hunger the same: {refills:?}"
        );
    }
}
