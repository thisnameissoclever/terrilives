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
///
/// The arity allow is for the seventh query: delivery writes two sims'
/// needs, reads two personalities, two identities and two relationship
/// sets, and watches the partner's reservation - each a disjoint borrow
/// bevy wants declared separately. Bundling them into fewer, wider
/// queries would create exactly the borrow conflicts the split avoids.
#[allow(clippy::too_many_arguments)]
pub fn tick_social(
    mut commands: Commands,
    content: Res<Content>,
    mut talking: Query<(Entity, &mut Socialising)>,
    mut needs: Query<&mut Needs>,
    personalities: Query<&Personality>,
    sim_ids: Query<&SimId>,
    mut relationships: Query<&mut Relationships>,
    partners: Query<(Has<Reserved>, Has<Target>), With<terri_core::Agent>>,
) {
    let tuning = content.0.tuning;

    let mut initiators: Vec<Entity> = talking.iter().map(|(entity, _)| entity).collect();
    initiators.sort_by_key(|entity| entity.index());

    for initiator in initiators {
        let Ok((_, mut socialising)) = talking.get_mut(initiator) else {
            continue;
        };
        let partner = socialising.partner;

        // **A conversation checks its partner is still IN it, every tick,
        // rather than trusting nothing to disturb it.** Two disturbances
        // are reachable today, both via a player command: the partner is
        // redirected (it gains a Target and walks off, still wearing this
        // talk's Reserved), or a future system despawns it outright. In
        // either case the talk ends now, with no delivery this tick and
        // NO impression - the same completion-only rule an interrupted
        // meal follows for habituation - and the initiator releases its
        // claim so the partner is not stuck wearing a stale reservation
        // after its errand.
        let disturbed = match partners.get(partner) {
            Ok((reserved, has_own_target)) => !reserved || has_own_target,
            Err(_) => true,
        };
        if disturbed {
            commands
                .entity(initiator)
                .remove::<Socialising>()
                .remove::<Target>();
            commands.entity(partner).try_remove::<Reserved>();
            continue;
        }

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
                // nothing. `try_insert`, because this Err arm cannot tell
                // "no component yet" from "entity is gone", and a plain
                // insert on a despawned participant routes to the command
                // error handler and panics - the exact hazard the
                // try_remove below names.
                Err(_) => {
                    let mut fresh = Relationships::default();
                    fresh.bump(other_id, tuning.relationship_gain_per_talk);
                    commands.entity(me).try_insert(fresh);
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

    /// [H10]'s "stands still", the WANDER half, on the one input that can
    /// see it: a partner with a LIVE `Restless` marker. The marker only
    /// exists if the partner ran its own selection BEFORE being claimed,
    /// which means the partner must be the LOWER-indexed sim - so it is
    /// spawned first here, with every need full so its own selection
    /// finds nothing and marks it restless on the very tick the
    /// higher-indexed initiator claims it. From then on `select_action`
    /// never sees the reserved partner again, the stale `Restless`
    /// persists, and the `Without<Reserved>` filter on `wander` is the
    /// ONLY thing between the partner and a stroll every remaining tick
    /// of the walk. Delete that filter and this fixture's partner moves.
    #[test]
    fn a_reserved_sim_stands_still_instead_of_wandering_off() {
        let mut sim = test_content::sim_with(8, 8, chat_pack());
        // Partner FIRST: lower entity index, so its selection turn - the
        // one that writes Restless - happens before the initiator's claim
        // in the same tick's loop.
        let target = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                Position { x: 4.0, y: 1.0 },
                Needs::all_at(NEED_MAX),
            ))
            .id();
        let lonely = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                Position { x: 1.0, y: 1.0 },
                Needs::with(NeedId::Social, 20.0),
            ))
            .id();

        // Twelve ticks covers the three-tile walk but the talk has not
        // started; every one of them is a tick a restless, unguarded
        // partner would use to stroll.
        for _ in 0..12 {
            sim.tick();
        }
        assert!(
            sim.world().get::<Restless>(target).is_some(),
            "precondition: the partner carries the stale Restless marker \
             this test exists to make dangerous; without it the wander \
             filter is unreachable and the test proves nothing"
        );
        assert!(
            sim.world().get::<Reserved>(target).is_some()
                || sim.world().get::<Socialising>(lonely).is_some(),
            "precondition: the partner is spoken for (or already talking)"
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
    }

    /// The WITHIN-TICK half of standing still: `Reserved` is a deferred
    /// command, so on the claiming tick itself the only thing stopping
    /// the freshly-claimed partner from choosing something of its own is
    /// the `claimed` list guard at the top of the agent loop. This
    /// fixture gives the partner something it genuinely wants - a fridge
    /// it would decisively pick if unclaimed - so deleting that guard
    /// hands it a Target and this goes red; the two-sim fixtures cannot
    /// see it, because their partner has nothing else to choose ([L41]).
    #[test]
    fn a_sim_claimed_this_tick_does_not_choose_anything_of_its_own() {
        let pack = test_content::pack_with_social(
            vec![test_content::object(
                "fridge",
                &[(NeedId::Hunger, 30.0)],
                18,
            )],
            vec![test_content::interaction(
                "chat",
                &[(NeedId::Social, 30.0)],
                40,
            )],
            test_content::tuning(),
        );
        let fridge_def = pack.find("fridge").expect("the fixture declares it");
        let mut sim = test_content::sim_with(10, 8, pack);
        // The initiator wants only company; its hunger is full, so the
        // fridge scores zero for it and cannot contaminate its choice.
        let lonely = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                Position { x: 1.0, y: 1.0 },
                Needs::with(NeedId::Social, 20.0),
            ))
            .id();
        // The partner wants only food; its social is full, so without
        // the claim it would pick the fridge this very tick.
        let partner = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                Position { x: 4.0, y: 1.0 },
                Needs::with(NeedId::Hunger, 40.0),
            ))
            .id();
        let _fridge = sim
            .world_mut()
            .spawn((
                Position { x: 7.0, y: 1.0 },
                terri_core::SmartObject(fridge_def),
            ))
            .id();

        sim.tick();

        assert_eq!(
            sim.world().get::<Target>(lonely).map(|t| t.object),
            Some(partner),
            "precondition: the initiator claimed the partner this tick"
        );
        assert!(
            sim.world().get::<Target>(partner).is_none()
                && sim.world().get::<Path>(partner).is_none(),
            "the partner was claimed WITHIN this tick, before Reserved \
             could land; only the claimed-list guard can hold it still, \
             and it must - a partner walking to the fridge while its \
             initiator walks to the partner is two sims conversing from \
             opposite ends of the house"
        );
    }

    /// [H8]'s DELIVERY half, pinned by magnitude: a completed talk fills
    /// a warm initiator by exactly `relationship_scale` more than a
    /// stranger. The scoring half has its own tests; without this one,
    /// hardcoding the delivery scale to 1.0 survives the whole suite -
    /// it did, measured, before this test existed.
    #[test]
    fn delivery_fills_a_warm_initiator_by_the_relationship_scale() {
        // Zero duration variance so both talks run exactly 40 ticks and
        // the delivered totals are arithmetic rather than draws.
        let pack = test_content::pack_with_social(
            vec![],
            vec![test_content::interaction(
                "chat",
                &[(NeedId::Social, 30.0)],
                40,
            )],
            terri_data::Tuning {
                duration_variance: 0.0,
                ..test_content::tuning()
            },
        );

        let run = |feeling: f32, satisfaction: f32| -> f32 {
            let mut sim = test_content::sim_with(8, 8, pack);
            let mut feelings = Relationships::default();
            if feeling != 0.0 {
                feelings.bump(SimId(1), feeling);
            }
            let mut personality = terri_core::Personality::neutral();
            personality.satisfaction[NeedId::Social.index()] = satisfaction;
            let initiator = sim
                .world_mut()
                .spawn((
                    Agent,
                    SimId(0),
                    Position { x: 1.0, y: 1.0 },
                    Needs::with(NeedId::Social, 20.0),
                    feelings,
                    personality,
                ))
                .id();
            let partner = sim
                .world_mut()
                .spawn((
                    Agent,
                    SimId(1),
                    Position { x: 2.0, y: 1.0 },
                    Needs::with(NeedId::Social, 60.0),
                    Reserved,
                ))
                .id();
            // The conversation is installed directly rather than chosen,
            // because this test is about DELIVERY: what selection would
            // have picked is the other tests' business.
            sim.world_mut().entity_mut(initiator).insert((
                Socialising {
                    interaction: 0,
                    partner,
                    remaining_ticks: 40,
                },
                Target {
                    object: partner,
                    interaction: 0,
                },
            ));
            // Exactly the conversation's own 40 ticks: delivery runs on
            // each of them including the completing one. A 41st tick
            // would let selection start a SECOND chat (the pair is still
            // standing together, and 50 social clears the threshold),
            // and one tick of its delivery already smears the golden
            // values below - measured.
            for _ in 0..40 {
                sim.tick();
            }
            social_of(&sim, initiator)
        };

        // ABSOLUTE golden values, not only differences, and the choice is
        // what makes the compose mutants die: `scale * satisfaction`
        // mutated to `+` shifts BOTH runs by the same amount, so the
        // warm-minus-stranger gap alone stayed green under it - measured.
        // 40 ticks of social decay ride along in every expectation.
        let leak = 40.0 * test_content::decay_per_tick(NeedId::Social);
        let stranger = run(0.0, 1.0);
        assert!(
            (stranger - (20.0 + 30.0 - leak)).abs() < 0.01,
            "a stranger's talk must deliver exactly its authored 30: \
             scale 1.0 times satisfaction 1.0; got {stranger}"
        );
        // Halving satisfaction must HALVE the fill - `scale / satisfaction`
        // would double it instead, and at satisfaction 1.0 that mutant is
        // arithmetically invisible, which is why this run exists.
        let half_hearted = run(0.0, 0.5);
        assert!(
            (half_hearted - (20.0 + 15.0 - leak)).abs() < 0.01,
            "half the satisfaction must be half the fill; got {half_hearted}"
        );
        // 30 delivered at scale 1.0 against 30 * 1.5 at scale 1.5: the
        // gap is 15, minus the sliver the warm feeling's own decay
        // shaves off its scale across 40 ticks.
        let warm = run(1.0, 1.0);
        assert!(
            (warm - stranger - 15.0).abs() < 0.1,
            "a full-warmth initiator must receive exactly \
             relationship_scale(1.0, 0.5) = 1.5x a stranger's fill: \
             stranger ended at {stranger}, warm at {warm}"
        );
    }

    /// The SCORING compose for people, `scale * satisfaction`, pinned
    /// from the satisfaction side: a sim whose personality barely enjoys
    /// company must not cross the room for it, because the multiplier
    /// puts its best chat under the action threshold. Both `*` mutants
    /// invert that - `+` reads 0.1 as a bonus and `/` as a tenfold
    /// amplifier - and each sends the sim over. The control pins that
    /// only the satisfaction stands between this sim and the chat.
    #[test]
    fn a_sim_that_barely_enjoys_company_stays_put() {
        let run = |satisfaction: f32| -> Option<Entity> {
            let mut sim = test_content::sim_with(8, 8, chat_pack());
            let mut personality = terri_core::Personality::neutral();
            personality.satisfaction[NeedId::Social.index()] = satisfaction;
            let chooser = sim
                .world_mut()
                .spawn((
                    Agent,
                    SimId(0),
                    Position { x: 1.0, y: 1.0 },
                    Needs::with(NeedId::Social, 20.0),
                    personality,
                ))
                .id();
            let _company = sim
                .world_mut()
                .spawn((
                    Agent,
                    SimId(1),
                    Position { x: 4.0, y: 1.0 },
                    Needs::all_at(NEED_MAX),
                ))
                .id();
            sim.tick();
            sim.world().get::<Target>(chooser).map(|t| t.object)
        };

        assert!(
            run(0.1).is_none(),
            "at satisfaction 0.1 the chat scores 0.03 against a threshold \
             of 0.05; choosing it means the multiplier ran as something \
             other than a product"
        );
        assert!(
            run(1.0).is_some(),
            "the control: at neutral satisfaction the same sim must chat, \
             or the assertion above says nothing about the multiplier"
        );
    }

    /// The within-vocabulary winner rule, both boundaries - the social
    /// twin of `a_tied_later_interaction_cannot_displace_an_earlier_one
    /// _on_the_same_object`, and unreachable by every one-entry fixture:
    /// the comparison only runs once a first interaction holds `best`.
    #[test]
    fn social_interactions_resolve_ties_to_the_earlier_and_wins_to_the_better() {
        let run = |vocabulary: Vec<terri_data::CompiledInteraction>| -> u32 {
            let pack = test_content::pack_with_social(vec![], vocabulary, test_content::tuning());
            let mut sim = test_content::sim_with(8, 8, pack);
            let chooser = sim
                .world_mut()
                .spawn((
                    Agent,
                    SimId(0),
                    Position { x: 1.0, y: 1.0 },
                    Needs::with(NeedId::Social, 20.0),
                ))
                .id();
            let _company = sim
                .world_mut()
                .spawn((
                    Agent,
                    SimId(1),
                    Position { x: 4.0, y: 1.0 },
                    Needs::all_at(NEED_MAX),
                ))
                .id();
            sim.tick();
            sim.world()
                .get::<Target>(chooser)
                .expect("something must clear the threshold")
                .interaction
        };

        // Two identical entries: the tie must resolve to the EARLIER, or
        // which chat a sim opens with starts depending on declaration
        // order in social.toml with nothing saying so.
        assert_eq!(
            run(vec![
                test_content::interaction("chat", &[(NeedId::Social, 30.0)], 40),
                test_content::interaction("chat_again", &[(NeedId::Social, 30.0)], 40),
            ]),
            0,
            "a tied later social interaction must not displace an earlier one"
        );
        // A genuinely better second entry must win - which is what stops
        // the tie rule above passing under a comparison that never
        // displaces anything.
        assert_eq!(
            run(vec![
                test_content::interaction("nod", &[(NeedId::Social, 8.0)], 40),
                test_content::interaction("chat", &[(NeedId::Social, 30.0)], 40),
            ]),
            1,
            "a better later social interaction must displace a worse earlier one"
        );
    }

    /// The social threshold comparison is `score > action_threshold`,
    /// and the only input that can tell `>` from `>=` is a score landing
    /// exactly on the tuned value. The same bit-exact construction as
    /// `a_score_exactly_at_the_action_threshold_selects_nothing` in
    /// action.rs, with a PERSON where the object stood: hunger decays to
    /// exactly 50.0, urgency 0.125; the person is three tiles away so
    /// the walk is two tiles (eight ticks), duration 7 plus 1 makes the
    /// denominator exactly 16; 0.125 * 6.4 / 16 is 0.05f32 with no
    /// rounding anywhere. The vocabulary advertising HUNGER is a fixture
    /// liberty: nothing in the pack format ties a social entry to the
    /// social need, and hunger is the one need whose decay lands on an
    /// exact binary32 level.
    #[test]
    fn a_social_score_exactly_at_the_threshold_selects_nothing() {
        let run = |delta: f32| -> bool {
            let pack = test_content::pack_with_social(
                vec![],
                vec![test_content::interaction(
                    "boundary_chat",
                    &[(NeedId::Hunger, delta)],
                    7,
                )],
                test_content::tuning(),
            );
            let mut sim = test_content::sim_with(16, 16, pack);
            // Decay runs before selection, so start one tick's worth
            // above the level the arithmetic assumes.
            let chooser = sim
                .world_mut()
                .spawn((
                    Agent,
                    SimId(0),
                    Position { x: 5.0, y: 5.0 },
                    Needs::with(
                        NeedId::Hunger,
                        50.0 + test_content::decay_per_tick(NeedId::Hunger),
                    ),
                ))
                .id();
            let _company = sim
                .world_mut()
                .spawn((
                    Agent,
                    SimId(1),
                    Position { x: 8.0, y: 5.0 },
                    Needs::all_at(NEED_MAX),
                ))
                .id();
            sim.tick();

            // The bit-equality precondition the object twin demands: the
            // moment this relaxes, the test stops telling `>` from `>=`.
            let hunger = sim
                .world()
                .get::<Needs>(chooser)
                .expect("still simmed")
                .get(NeedId::Hunger);
            assert_eq!(
                hunger.to_bits(),
                50.0f32.to_bits(),
                "the fixture must land hunger on exactly 50.0 or the \
                 score is not exactly the threshold; got {hunger}"
            );
            sim.world().get::<Target>(chooser).is_some()
        };

        assert!(
            !run(6.4),
            "a chat scoring exactly action_threshold must not be chosen: \
             the comparison is strictly greater"
        );
        assert!(run(6.5), "just above the threshold must be chosen");
        assert!(!run(6.3), "just below must not");
    }

    /// The [F1]-shaped regression: a player command issued to a sim
    /// MID-CONVERSATION must preempt the talk cleanly. Before the fix,
    /// the orphaned `Socialising` ticked on, its completion destroyed
    /// the player's Target, and the sim was left holding an unservable
    /// intent against a fridge it had itself reserved forever - both
    /// sims starving in a fully-furnished house.
    #[test]
    fn a_command_during_a_conversation_preempts_it_instead_of_bricking_the_sim() {
        let pack = test_content::pack_with_social(
            vec![test_content::object(
                "fridge",
                &[(NeedId::Hunger, 30.0)],
                18,
            )],
            vec![test_content::interaction(
                "chat",
                &[(NeedId::Social, 30.0)],
                40,
            )],
            test_content::tuning(),
        );
        let fridge_def = pack.find("fridge").expect("the fixture declares it");
        let mut sim = test_content::sim_with(10, 8, pack);
        let lonely = sim
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
                Position { x: 4.0, y: 1.0 },
                Needs::with(NeedId::Social, 60.0),
            ))
            .id();
        let fridge = sim
            .world_mut()
            .spawn((
                Position { x: 7.0, y: 1.0 },
                terri_core::SmartObject(fridge_def),
            ))
            .id();

        // Walk over and start talking.
        let mut talking = false;
        for _ in 0..40 {
            sim.tick();
            if sim.world().get::<Socialising>(lonely).is_some() {
                talking = true;
                break;
            }
        }
        assert!(talking, "precondition: the conversation must have begun");

        // The right-click, mid-sentence.
        sim.world_mut()
            .entity_mut(lonely)
            .insert(terri_core::IntentQueue::from_intents(vec![
                terri_core::Intent {
                    object: fridge,
                    interaction: 0,
                },
            ]));

        // One tick is all serve_intents needs; the preemption must be
        // checked HERE, because a healthy sim finishes its meal and may
        // legitimately be back in a new conversation by the end.
        sim.tick();
        assert!(
            sim.world().get::<Socialising>(lonely).is_none(),
            "the conversation must have been preempted the moment the \
             intent was served"
        );
        assert_eq!(
            sim.world().get::<Target>(lonely).map(|t| t.object),
            Some(fridge),
            "the player's target must be the one standing, not destroyed \
             by an orphaned conversation's completion"
        );
        assert!(
            sim.world().get::<Reserved>(partner).is_none(),
            "the abandoned partner must be released immediately"
        );

        // Observed directly rather than inferred from a need level,
        // because the level is confounded by decay across however long
        // the walk took: the sim must actually EAT at the commanded
        // fridge.
        let mut ate = false;
        for _ in 0..80 {
            sim.tick();
            if sim
                .world()
                .get::<terri_core::Eating>(lonely)
                .is_some_and(|e| e.object == fridge_def)
            {
                ate = true;
            }
        }
        assert!(
            ate,
            "the commanded meal must actually have happened; a sim that \
             never reaches Eating is waiting on a reservation it leaked \
             itself, which is the measured deadlock"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_none(),
            "the fridge must have been used and released, not leaked"
        );
        assert!(
            sim.world()
                .get::<terri_core::IntentQueue>(lonely)
                .is_none_or(|q| q.is_empty()),
            "the intent must have been served and popped, not held forever"
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
        // Runs its own control, per the intent_tests convention: the
        // same fixture with the bar LOW must produce a Target, or the
        // negative half cannot distinguish "the filled need brakes
        // chatting" from "sims never chat at all".
        let run = |social: f32| -> Option<Entity> {
            let mut sim = test_content::sim_with(8, 8, chat_pack());
            let chooser = sim
                .world_mut()
                .spawn((
                    Agent,
                    SimId(0),
                    Position { x: 1.0, y: 1.0 },
                    Needs::with(NeedId::Social, social),
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
            sim.world().get::<Target>(chooser).map(|t| t.object)
        };

        assert!(
            run(NEED_MAX).is_none(),
            "a full social bar must score every chat at zero, and zero \
             does not clear action_threshold"
        );
        assert!(
            run(20.0).is_some(),
            "the control: the identical sim with a low bar must chat, or \
             the assertion above is green because sims never chat at all"
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
        // EXACTLY one hundred rates, within f32 accumulation error - a
        // window twice that wide was green with the rate halved and with
        // a decay that ran once instead of per tick, which is testing
        // protocol rule 7's degenerate alternative wearing a tolerance.
        assert!(
            (cooled - (0.5 - 100.0 * rate)).abs() < 1e-5,
            "one hundred unattended ticks must cool 0.5 by exactly one \
             hundred rates ({rate}); got {cooled}"
        );
    }

    /// The other half of preemption - the [F2] shape: the command lands
    /// on the PARTNER, who walks off with a Target while still wearing
    /// the talk's Reserved. The disturbed guard's `!reserved ||
    /// has_own_target` must fire on the second clause; mutated to `&&`
    /// the talk keeps running at whatever distance the partner walks to,
    /// which is exactly what this asserts cannot happen.
    #[test]
    fn a_partner_pulled_away_by_a_command_ends_the_conversation_unremembered() {
        let pack = test_content::pack_with_social(
            vec![test_content::object(
                "fridge",
                &[(NeedId::Hunger, 30.0)],
                18,
            )],
            vec![test_content::interaction(
                "chat",
                &[(NeedId::Social, 30.0)],
                40,
            )],
            test_content::tuning(),
        );
        let fridge_def = pack.find("fridge").expect("the fixture declares it");
        let mut sim = test_content::sim_with(10, 8, pack);
        let lonely = sim
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
                Position { x: 4.0, y: 1.0 },
                Needs::with(NeedId::Social, 60.0),
            ))
            .id();
        let fridge = sim
            .world_mut()
            .spawn((
                Position { x: 7.0, y: 1.0 },
                terri_core::SmartObject(fridge_def),
            ))
            .id();

        let mut talking = false;
        for _ in 0..40 {
            sim.tick();
            if sim.world().get::<Socialising>(lonely).is_some() {
                talking = true;
                break;
            }
        }
        assert!(talking, "precondition: the conversation must have begun");

        // The command lands on the PARTNER this time.
        sim.world_mut()
            .entity_mut(partner)
            .insert(terri_core::IntentQueue::from_intents(vec![
                terri_core::Intent {
                    object: fridge,
                    interaction: 0,
                },
            ]));
        sim.tick();

        assert_eq!(
            sim.world().get::<Target>(partner).map(|t| t.object),
            Some(fridge),
            "precondition: the partner was pulled away and is still \
             wearing the talk's reservation when tick_social looks"
        );
        assert!(
            sim.world().get::<Socialising>(lonely).is_none(),
            "a conversation whose partner walked off must end on the \
             spot, not keep delivering across the room"
        );
        assert!(
            sim.world().get::<Reserved>(partner).is_none(),
            "the guard must release the walker's stale reservation, or \
             it wears it through its errand and cannot be chosen after"
        );
        assert!(
            sim.world()
                .get::<Relationships>(lonely)
                .is_none_or(|r| r.feeling(SimId(1)) == 0.0),
            "an interrupted conversation leaves no impression"
        );
    }

    fn social_of(sim: &Sim, who: Entity) -> f32 {
        sim.world()
            .get::<Needs>(who)
            .expect("the fixture gave every sim needs")
            .get(NeedId::Social)
    }
}
