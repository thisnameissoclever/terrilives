//! Conversations, and the relationships they leave behind - [H4]/[H5].
//!
//! One conversation is one [`Socialising`] record on the INITIATOR;
//! the partner carries only `Reserved`, exactly as a fridge in use does.
//! This module ticks the record, delivers to both participants, moves
//! both relationships when it completes, and drifts every relationship
//! toward zero once a tick.

use bevy_ecs::prelude::*;
use terri_core::{NeedId, Needs, Personality, Relationships, Reserved, SimId, Socialising, Target};

use super::advertise::{relationship_scale, scaled_delta};
use crate::Content;

/// Advances every conversation by one tick, delivering to BOTH
/// participants, and completes it: relationships move only when the talk
/// finishes, mirroring `tick_interactions`' rule that an interrupted
/// interaction costs no habituation.
///
/// # Both sides receive, each through its own multipliers
///
/// The deltas apply to initiator and partner alike - a conversation is
/// the one interaction where the "object" gets as much out of being used
/// as the user - but each side's benefit is scaled by its OWN
/// satisfaction and its OWN feeling toward the other ([H8]). For the
/// initiator that is exactly what scoring promised, which is the
/// one-mechanism rule; for the partner it means being talked at by
/// someone they dislike fills less, which is the asymmetry ordered pairs
/// exist to express.
///
/// # Iteration order
///
/// Sorted by entity index like every system that writes shared state.
/// No draw happens here, but relationship bumps write into OTHER
/// entities' components, and "who bumps first" must be a function of
/// world state the day two conversations share a participant - today's
/// reservation rules make that unreachable, and unreachable is exactly
/// when an ordering bug becomes invisible ([L5]).
#[allow(clippy::type_complexity)]
pub fn tick_social(
    mut commands: Commands,
    content: Res<Content>,
    mut talking: Query<(Entity, &mut Socialising)>,
    mut needs: Query<&mut Needs>,
    personalities: Query<&Personality>,
    sim_ids: Query<&SimId>,
    mut relationships: Query<&mut Relationships>,
) {
    let tuning = content.0.tuning;

    let mut initiators: Vec<Entity> = talking.iter().map(|(entity, _)| entity).collect();
    initiators.sort_by_key(|entity| entity.index());

    for initiator in initiators {
        let Ok((_, mut socialising)) = talking.get_mut(initiator) else {
            continue;
        };
        let partner = socialising.partner;
        let act = &content.0.social[socialising.interaction as usize];
        let duration = act.duration_ticks as f32;

        // Delivery, both directions. `delta / duration` per tick against
        // the CONTENT duration, exactly as `tick_interactions` does and
        // for the reason its doc gives: the advert's promise is the
        // content number, so the per-tick rate comes from it even though
        // the sampled length decides how long the delivery runs.
        for (me, other) in [(initiator, partner), (partner, initiator)] {
            let Ok(mut my_needs) = needs.get_mut(me) else {
                // A participant without Needs cannot receive; the talk
                // still runs its course so the reservation still ends.
                continue;
            };
            let satisfaction_of =
                |need: usize| personalities.get(me).map_or(1.0, |p| p.satisfaction[need]);
            // My feeling about THEM scales what I get - which for the
            // initiator is exactly the number scoring used, and for the
            // partner is their own side of the ordered pair.
            let feeling = other_sim_id(&sim_ids, other)
                .and_then(|id| relationships.get(me).ok().map(|r| r.feeling(id)))
                .unwrap_or(0.0);
            let scale = relationship_scale(feeling, tuning.relationship_delta_scale);

            for (need_index, delta) in &act.advertises {
                let delta = scaled_delta(*delta, scale * satisfaction_of(*need_index as usize));
                let id = NeedId::ALL[*need_index as usize];
                my_needs.fill(id, delta / duration);
            }
        }

        socialising.remaining_ticks = socialising.remaining_ticks.saturating_sub(1);
        if socialising.remaining_ticks > 0 {
            continue;
        }

        // Completion. The relationship moves HERE and only here,
        // mirroring habituation's completion-only bump: an interrupted
        // conversation leaves no impression, by the same rule that an
        // interrupted meal leaves no habituation.
        for (me, other) in [(initiator, partner), (partner, initiator)] {
            let Some(other_id) = other_sim_id(&sim_ids, other) else {
                continue;
            };
            match relationships.get_mut(me) {
                Ok(mut mine) => mine.bump(other_id, tuning.relationship_gain_per_talk),
                // First feeling this sim has ever had: the component is
                // created on demand, like Habituation on first
                // completion, so a sim who has met nobody carries
                // nothing.
                Err(_) => {
                    let mut fresh = Relationships::default();
                    fresh.bump(other_id, tuning.relationship_gain_per_talk);
                    commands.entity(me).insert(fresh);
                }
            }
        }

        commands
            .entity(initiator)
            .remove::<Socialising>()
            .remove::<Target>();
        // `try_remove`, matching `tick_interactions`' release: the
        // command must not panic if the partner despawned mid-talk.
        commands.entity(partner).try_remove::<Reserved>();
    }
}

/// The partner's stable identity, if it still has one. A helper rather
/// than an inline chain because both the delivery and the completion
/// loops need it and the borrow shapes differ around them.
fn other_sim_id(sim_ids: &Query<&SimId>, entity: Entity) -> Option<SimId> {
    sim_ids.get(entity).ok().copied()
}

/// Drifts every relationship toward zero - [H9]. Runs unconditionally,
/// like `decay_habituation`, and for the same one-way-ratchet reason:
/// a friendship that needs no maintenance only ever rises, and a grudge
/// that never fades makes the first bad day permanent.
pub fn decay_relationships(content: Res<Content>, mut relationships: Query<&mut Relationships>) {
    let rate = content.0.tuning.relationship_decay_per_tick;
    for mut feelings in &mut relationships {
        feelings.decay(rate);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_content;
    use crate::Sim;
    use terri_core::{Agent, Path, Position, Restless, Wander, NEED_MAX};

    /// Long enough that a conversation of duration 40 completes even at
    /// the top of the variance band (40 * 1.4 = 56), plus the longest
    /// plausible walk in these fixtures.
    const SESSION: u32 = 200;

    /// The one vocabulary these tests speak: chat, social 30 over 40
    /// ticks - the shipped shape without the shipped file, so a content
    /// retune cannot silently move these assertions.
    fn chat_pack() -> &'static terri_data::ContentPack {
        test_content::pack_with_social(
            vec![],
            vec![test_content::interaction(
                "chat",
                &[(NeedId::Social, 30.0)],
                40,
            )],
            test_content::tuning(),
        )
    }

    /// Two sims three tiles apart: `lonely` wants company, `content_sim`
    /// wants nothing. Spawned lonely-first so the initiator is the
    /// lower-indexed agent and claims its partner before the partner's
    /// own selection runs.
    fn household_of_two(pack: &'static terri_data::ContentPack) -> (Sim, Entity, Entity) {
        let mut sim = test_content::sim_with(8, 8, pack);
        let lonely = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                Position { x: 1.0, y: 1.0 },
                Needs::with(NeedId::Social, 20.0),
            ))
            .id();
        // Social at 60 rather than full, and the number is doing two
        // jobs: it leaves HEADROOM so the partner's received half of the
        // delivery is visible instead of vanishing against the 100 cap,
        // and it is high enough that the partner neither initiates a
        // chat of its own (deficit 0.4 cubed puts its best score under
        // action_threshold) nor matters if briefly restless - the
        // initiator claims it on the very first tick.
        let target = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                Position { x: 4.0, y: 1.0 },
                Needs::with(NeedId::Social, 60.0),
            ))
            .id();
        (sim, lonely, target)
    }

    /// The whole [H4] loop, end to end through the running schedule: a
    /// lonely sim chooses a person, walks over, both are filled, and the
    /// completed conversation leaves a relationship on BOTH sides.
    ///
    /// Which mutation each half kills: the Target assertion dies if the
    /// people loop never runs or `find_path_adjacent_to_tile` is not
    /// called; the two social-level assertions die if delivery fills
    /// only the initiator (the partner side of the delivery loop
    /// deleted); the two feeling assertions die if the completion bump
    /// runs one way, never runs, or runs per tick instead of on
    /// completion (per-tick would overshoot the range's top end).
    #[test]
    fn a_lonely_sim_talks_to_its_housemate_and_both_sides_remember_it() {
        let (mut sim, lonely, target) = household_of_two(chat_pack());

        sim.tick();
        let chosen = sim
            .world()
            .get::<Target>(lonely)
            .expect("a lonely sim with a reachable housemate must choose it");
        assert_eq!(chosen.object, target, "the person IS the target entity");
        assert!(
            sim.world().get::<Reserved>(target).is_some(),
            "the initiator must reserve its partner exactly as it reserves \
             a fridge"
        );

        for _ in 0..SESSION {
            sim.tick();
        }

        assert!(
            sim.world().get::<Socialising>(lonely).is_none(),
            "the conversation must complete inside the session"
        );
        assert!(
            sim.world().get::<Reserved>(target).is_none(),
            "completion must release the partner"
        );
        assert!(
            social_of(&sim, lonely) > 20.0,
            "the initiator's social must have been filled; got {}",
            social_of(&sim, lonely)
        );
        // 70 splits the two worlds cleanly: with delivery the partner
        // ends at 72.8 even at the SHORTEST sampled duration (60 + 24
        // ticks * 0.75/tick - 5.2 of decay), and without it decay-only
        // arithmetic tops out at 54.8.
        assert!(
            social_of(&sim, target) > 70.0,
            "the partner must RECEIVE too; got {}",
            social_of(&sim, target)
        );

        // Both ordered pairs moved by one or two talks' worth of gain -
        // TWO is legal, not slop: the first chat lifts the initiator's
        // social to the mid-forties, which still clears the threshold in
        // a world where this partner is the only thing to want, so a
        // second conversation can start and finish inside the session.
        // The bounds still kill what they must: never-bumped reads 0,
        // one-way bumping fails the partner's iteration, and a PER-TICK
        // bump saturates to the 1.0 clamp, far above two gains.
        let gain = test_content::tuning().relationship_gain_per_talk;
        for (who, other, label) in [(lonely, 1, "initiator"), (target, 0, "partner")] {
            let feeling = sim
                .world()
                .get::<Relationships>(who)
                .unwrap_or_else(|| panic!("the {label} must have a Relationships component"))
                .feeling(SimId(other));
            assert!(
                feeling > gain * 0.9 && feeling <= 2.0 * gain,
                "the {label}'s feeling must be one or two completed talks' \
                 worth; got {feeling} against a gain of {gain}"
            );
        }
    }

    /// [H10]'s "stands still", both halves: the reserved partner never
    /// chooses anything of its own and never wanders off the tile the
    /// initiator's path was planned against.
    ///
    /// The fixture makes the partner WANT to move: it is restless (all
    /// needs full means nothing clears `idle_threshold`), so without the
    /// `Without<Reserved>` filter on `wander` it strolls on the very
    /// tick it is claimed, and the initiator arrives beside an empty
    /// tile.
    #[test]
    fn a_reserved_sim_stands_still_instead_of_wandering_off() {
        let (mut sim, lonely, target) = household_of_two(chat_pack());

        // Enough ticks for the walk to be well underway but not done:
        // three tiles at 0.25/tick is twelve ticks.
        for _ in 0..8 {
            sim.tick();
        }
        assert!(
            sim.world().get::<Reserved>(target).is_some(),
            "precondition: the partner is spoken for during the walk"
        );
        assert!(
            sim.world().get::<Path>(target).is_none()
                && sim.world().get::<Wander>(target).is_none(),
            "a reserved sim must not wander: the initiator's path was \
             planned against its tile"
        );
        assert!(
            sim.world().get::<Target>(target).is_none(),
            "a reserved sim must not choose anything of its own"
        );
        let pos = sim.world().get::<Position>(target).expect("still placed");
        assert_eq!(
            (pos.x, pos.y),
            (4.0, 1.0),
            "standing still means the tile does not move"
        );
        // And the initiator really is closing in - the freeze is not a
        // whole-world freeze.
        let walker = sim.world().get::<Position>(lonely).expect("still placed");
        assert!(
            walker.x > 1.0,
            "the initiator must be walking toward its partner"
        );
    }

    /// The relationship changes WHO is chosen, not just how it feels -
    /// [H8]'s scoring half. Two candidates at exactly equal distance and
    /// need value differ only in the initiator's feeling toward them;
    /// at a decisive temperature the friend must win every draw.
    ///
    /// Kills the mutant that drops `relationship_scale` from the people
    /// loop (both candidates then tie, and the tie resolves by entity
    /// index to the STRANGER, who is spawned first on purpose).
    #[test]
    fn a_friend_outranks_a_stranger_at_equal_distance() {
        let pack = test_content::pack_with_social(
            vec![],
            vec![test_content::interaction(
                "chat",
                &[(NeedId::Social, 30.0)],
                40,
            )],
            terri_data::Tuning {
                choice_temperature: 0.0001,
                ..test_content::tuning()
            },
        );
        let mut sim = test_content::sim_with(12, 12, pack);
        let chooser = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                Position { x: 5.0, y: 5.0 },
                Needs::with(NeedId::Social, 20.0),
            ))
            .id();
        // The stranger first, so a tie - the no-relationship mutant -
        // hands the first probability bucket to the WRONG sim and the
        // assertion below goes red rather than passing by accident.
        let _stranger = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                Position { x: 2.0, y: 5.0 },
                Needs::all_at(NEED_MAX),
            ))
            .id();
        let friend = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(2),
                Position { x: 8.0, y: 5.0 },
                Needs::all_at(NEED_MAX),
            ))
            .id();
        let mut feelings = Relationships::default();
        feelings.bump(SimId(2), 1.0);
        sim.world_mut().entity_mut(chooser).insert(feelings);

        sim.tick();

        let chosen = sim
            .world()
            .get::<Target>(chooser)
            .expect("someone must be worth talking to")
            .object;
        assert_eq!(
            chosen, friend,
            "at equal distance and equal deltas, the relationship is the \
             only difference, and it must decide the winner"
        );
    }

    /// [H7]'s brake: a sim whose social bar is FULL scores a chat at
    /// zero (cubed urgency of a zero deficit), so nobody chooses a
    /// conversation out of boredom with company. The fixture would pass
    /// with any need below threshold; social exactly full is the case
    /// the decision names.
    #[test]
    fn a_sim_with_a_full_social_bar_does_not_choose_to_talk() {
        let pack = chat_pack();
        let mut sim = test_content::sim_with(8, 8, pack);
        let contented = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                Position { x: 1.0, y: 1.0 },
                Needs::all_at(NEED_MAX),
            ))
            .id();
        let _company = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                Position { x: 3.0, y: 1.0 },
                Needs::all_at(NEED_MAX),
            ))
            .id();

        sim.tick();

        assert!(
            sim.world().get::<Target>(contented).is_none(),
            "a full social bar must score every chat at zero, and zero \
             does not clear action_threshold"
        );
    }

    /// The initiator is claimed the moment it chooses, so a later-indexed
    /// sim cannot plan a conversation with someone already walking away -
    /// [H10] applied within one tick, where the `Without<Target>` filter
    /// cannot see the deferred command.
    ///
    /// Three lonely sims: the first picks one partner decisively (the
    /// other is much further away), and the third - whose only unclaimed
    /// option is the pair's leftovers, namely nobody - must wait WITHOUT
    /// being marked restless, because the people it saw were worth
    /// wanting ([C3] applied to persons).
    #[test]
    fn a_sim_whose_company_is_all_spoken_for_waits_instead_of_wandering() {
        let pack = test_content::pack_with_social(
            vec![],
            vec![test_content::interaction(
                "chat",
                &[(NeedId::Social, 30.0)],
                40,
            )],
            terri_data::Tuning {
                choice_temperature: 0.0001,
                ..test_content::tuning()
            },
        );
        let mut sim = test_content::sim_with(24, 8, pack);
        // First chooser beside its partner; the odd one out far away, so
        // the first pick is decisive and the odd one's own candidates
        // are exactly the two claimed sims.
        let first = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                Position { x: 1.0, y: 1.0 },
                Needs::with(NeedId::Social, 20.0),
            ))
            .id();
        let partner = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                Position { x: 3.0, y: 1.0 },
                Needs::with(NeedId::Social, 90.0),
            ))
            .id();
        let odd_one_out = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(2),
                Position { x: 20.0, y: 1.0 },
                Needs::with(NeedId::Social, 20.0),
            ))
            .id();

        sim.tick();

        assert_eq!(
            sim.world().get::<Target>(first).map(|t| t.object),
            Some(partner),
            "precondition: the first sim must have claimed the partner \
             decisively, or the third sim's options are not what this \
             test says they are"
        );
        assert!(
            sim.world().get::<Target>(odd_one_out).is_none(),
            "both possible partners were claimed this very tick - one as \
             a target, one as an initiator - so the third sim must have \
             nobody to talk to"
        );
        assert!(
            sim.world().get::<Restless>(odd_one_out).is_none(),
            "the third sim SAW people worth talking to; being outbid must \
             read as waiting, not as a boring house - [C3] for persons"
        );
    }

    /// [H9]'s decay, through the running schedule: feelings drift toward
    /// zero every tick with nobody talking. Kills the mutant that turns
    /// the decay rate read into a constant zero as well as the one that
    /// deletes the system from the schedule.
    #[test]
    fn an_unattended_friendship_cools_tick_by_tick() {
        let pack = chat_pack();
        let mut sim = test_content::sim_with(8, 8, pack);
        let mut feelings = Relationships::default();
        feelings.bump(SimId(1), 0.5);
        let loner = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                Position { x: 1.0, y: 1.0 },
                Needs::all_at(NEED_MAX),
                feelings,
            ))
            .id();

        for _ in 0..100 {
            sim.tick();
        }

        let cooled = sim
            .world()
            .get::<Relationships>(loner)
            .expect("the component outlives the feeling")
            .feeling(SimId(1));
        let rate = test_content::tuning().relationship_decay_per_tick;
        assert!(
            cooled < 0.5 && cooled > 0.5 - 200.0 * rate,
            "one hundred unattended ticks must cool 0.5 by about one \
             hundred rates ({rate}); got {cooled}"
        );
    }

    fn social_of(sim: &Sim, who: Entity) -> f32 {
        sim.world()
            .get::<Needs>(who)
            .expect("the fixture gave every sim needs")
            .get(NeedId::Social)
    }
}
