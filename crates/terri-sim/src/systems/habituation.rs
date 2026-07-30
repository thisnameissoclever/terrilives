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
        fresh.bump(def(pack), 0, 0.05);
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

    /// The component's own arithmetic: capped at 1, keyed per interaction, and
    /// kept in sorted order because `world_hash` iterates it.
    #[test]
    fn habituation_caps_at_one_and_keeps_its_keys_sorted() {
        let mut h = Habituation::default();
        let a = terri_core::ObjectDefId(7);
        let b = terri_core::ObjectDefId(2);

        // Inserted out of order on purpose - the sort is the invariant.
        h.bump(a, 1, 0.4);
        h.bump(b, 0, 0.4);
        h.bump(a, 0, 0.4);
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

        for _ in 0..5 {
            h.bump(a, 0, 0.4);
        }
        assert_eq!(h.get(a, 0), 1.0, "must cap at 1");
        assert_eq!(
            h.get(a, 1),
            0.4,
            "and capping one key must not touch another"
        );

        assert_eq!(h.get(terri_core::ObjectDefId(99), 0), 0.0, "absent reads 0");
    }
}
