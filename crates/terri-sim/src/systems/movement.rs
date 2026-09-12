use bevy_ecs::prelude::*;
use terri_core::{
    Agent, ConversationVoice, Eating, Path, Position, SimRng, SmartObject, Socialising, Target,
};

use super::advertise::TILES_PER_TICK;
use super::interact::sample_duration;
use crate::Content;

/// Tiles travelled per tick. Imported rather than redeclared so the
/// scoring function's travel estimate cannot silently drift out of step
/// with actual movement.
const SPEED: f32 = TILES_PER_TICK;

/// Draws the two voice clips a conversation will be made of, or `None` when
/// the pack has no voice.
///
/// # Why two distinct clips
///
/// A conversation is an exchange, so the second half has to sound like a
/// reply rather than a repeat. Drawing independently would play the same clip
/// twice about one time in twelve, which reads as the audio glitching rather
/// than as two people talking.
///
/// The second draw is taken from a space one smaller and then stepped over
/// the first, which is uniform across all `n * (n - 1)` ordered pairs and
/// costs exactly two `range` calls whatever it draws.
///
/// A reject-and-retry loop would also have been deterministic, and the
/// earlier version of this comment was wrong to claim otherwise: a retry loop
/// is a function of the seed like anything else, and replays of one save
/// cannot diverge from it. `range` itself already retries internally to
/// debias its modulo. Two fixed calls is simply the smaller and steadier
/// thing, not the only correct one.
///
/// # Fewer than two clips
///
/// `None`, and the caller falls back to the ordinary sampled duration. One
/// clip is treated as none rather than as a set of one, because a single clip
/// cannot make a pair and playing it twice is the thing the distinctness rule
/// above exists to prevent.
fn draw_voice_pair(clip_count: usize, rng: &mut SimRng) -> Option<ConversationVoice> {
    if clip_count < 2 {
        return None;
    }
    let first = rng.range(clip_count);
    let mut second = rng.range(clip_count - 1);
    if second >= first {
        second += 1;
    }
    Some(ConversationVoice {
        first: first as u32,
        second: second as u32,
    })
}

/// Advances agents along their path. On arrival, converts the target
/// into an in-progress interaction - or, for a path with no target at
/// all, simply ends the walk.
///
/// # A path without a target is a wander, not a bug
///
/// `Target` is `Option` here because [D-5] gave an idle sim somewhere to
/// go without giving it anything to do when it gets there. **Wandering
/// deliberately reuses this system rather than moving sims of its own**:
/// one mover means one place where speed, arrival and interpolation are
/// decided, and it means a player-issued command that overwrites `Path`
/// overrides a stroll exactly the way it overrides a walk to the fridge.
/// A separate wander-mover would be a second copy of all of that, drifting.
///
/// # The iteration order is load-bearing, because this system DRAWS
///
/// Agents are visited in entity-index order rather than in query order.
/// Query iteration is archetype order, which shifts every time any agent
/// gains or loses a component - and since [D-4] this system takes a draw
/// from the shared `SimRng` on arrival, so the order decides WHICH agent
/// gets WHICH draw. Two arrivals on the same tick would otherwise be
/// assigned durations according to which of the two happened to have
/// eaten more recently, which is a silent determinism break of exactly
/// the class [D-3] and [L5] are about.
///
/// It is latent rather than live today: the shipped lot has one agent, so
/// two arrivals cannot coincide. That is precisely why it is worth
/// sorting now, while the reason is visible.
/// `arrival_draws_follow_entity_order_not_archetype_order` pins it.
// The type_complexity allow is the standing one from select_action and
// drain_commands: the query tuple is what pushes past clippy's
// threshold, and a type alias would only move it somewhere less
// readable. It grew a fifth member when the capability roll arrived.
#[allow(clippy::type_complexity)]
pub fn follow_path(
    mut commands: Commands,
    content: Res<Content>,
    mut rng: ResMut<SimRng>,
    mut agents: Query<(
        Entity,
        &mut Position,
        &mut Path,
        Option<&Target>,
        Option<&terri_core::Traits>,
        Option<&mut terri_core::ChainState>,
    )>,
    objects: Query<&SmartObject>,
    sims: Query<(), With<Agent>>,
) {
    let mut walking: Vec<Entity> = agents
        .iter()
        .map(|(entity, _, _, _, _, _)| entity)
        .collect();
    walking.sort_by_key(|entity| entity.index());

    for entity in walking {
        // Infallible: the list was just collected from this query and
        // nothing between here and there removes a component.
        let Ok((_, mut pos, mut path, target, traits, mut chain_state)) = agents.get_mut(entity)
        else {
            continue;
        };
        let Some((tx, ty)) = path.next_step() else {
            // Path exhausted. With no target this was a wander, so the
            // walk simply ends and the agent goes back to being idle.
            let Some(target) = target else {
                commands.entity(entity).remove::<Path>();
                continue;
            };
            // Begin the interaction. What kind depends on what the
            // target IS: a placed object starts a meal, a fellow sim
            // starts a conversation - [H4]. The checks are by component
            // rather than by a flag on `Target`, because the component
            // is the ground truth the flag would be a copy of.
            //
            // **A chain walk arrives first** - [K4]. The CHAIN_STEP
            // sentinel plus the walker's own counter names the step;
            // the duration draw and the capability roll happen exactly
            // where an interaction's do, from the same generator in
            // the same entity order, so PRNG consumption stays a
            // function of world state. A fumble rolled here RIDES to
            // the terminal delivery.
            let tuning = &content.0.tuning;
            if target.interaction == super::chain::CHAIN_STEP {
                let Some(chain_state) = chain_state.as_deref_mut() else {
                    // A chain target with no counter is a preemption
                    // artefact (the cancel removed the chain but the
                    // walk survived a tick); the walk just ends.
                    commands.entity(entity).remove::<Path>().remove::<Target>();
                    continue;
                };
                let chain = &content.0.chains[chain_state.chain as usize];
                let step = &chain.steps[chain_state.step as usize];
                let remaining_ticks = sample_duration(
                    step.duration_ticks,
                    tuning.duration_variance,
                    tuning.min_interaction_ticks,
                    &mut rng,
                );
                // The roll writes into the COUNTER, not into Fumbled:
                // a ruined dinner must stay ruined through the
                // preemptions that clear the transient marker. The
                // worst roll wins if two tagged steps both fail.
                if !step.tags.is_empty() {
                    if let Some(traits) = traits {
                        if let Some(delta_scale) = super::trait_effects::roll_fumble(
                            traits, content.0, &step.tags, &mut rng,
                        ) {
                            chain_state.fumble_scale = chain_state.fumble_scale.min(delta_scale);
                        }
                    }
                }
                commands
                    .entity(entity)
                    .remove::<Path>()
                    .insert(terri_core::StepWork { remaining_ticks });
            } else if let Ok(placed) = objects.get(target.object) {
                // Both indices are in range by construction: `select_action`
                // read them out of this same pack when it scored the advert,
                // and the pack is fixed at build time.
                let act = &content.0.object(placed.0).interactions[target.interaction as usize];
                // The content duration is a CENTRE, per [D-4]. This is the
                // one place the actual length of an interaction is decided,
                // so it is the one place that draws for it - and it draws
                // from the world's seeded generator like every other
                // decision, which is what keeps a replay a replay.
                //
                // The draw happens here rather than at selection on purpose.
                // Scoring weighs an interaction by its content duration
                // because that is what an advert can honestly promise; the
                // sim only finds out how long this particular meal took by
                // sitting through it.
                let remaining_ticks = sample_duration(
                    act.duration_ticks,
                    tuning.duration_variance,
                    tuning.min_interaction_ticks,
                    &mut rng,
                );
                // **The capability roll, at the attempt's start** - [E3].
                // Rolled here beside the duration draw, from the same
                // generator and in the same entity order, so PRNG
                // consumption stays a function of world state. A fumble
                // rides as its own component: the whole attempt then
                // delivers `fail_delta_scale` of its benefits and pays
                // no satisfaction, while still teaching at completion.
                if let Some(traits) = traits {
                    if let Some(delta_scale) =
                        super::trait_effects::roll_fumble(traits, content.0, &act.tags, &mut rng)
                    {
                        commands
                            .entity(entity)
                            .insert(terri_core::Fumbled { delta_scale });
                    }
                }
                commands.entity(entity).remove::<Path>().insert(Eating {
                    object: placed.0,
                    interaction: target.interaction,
                    remaining_ticks,
                });
            } else if sims.get(target.object).is_ok() {
                // A conversation's length is drawn the same way a meal's
                // is, from the same generator, for the same replay
                // reason. The initiator carries the whole record; the
                // partner stays as it was - standing, `Reserved` - until
                // `tick_social` releases it on completion.
                let act = &content.0.social[target.interaction as usize];
                // The voice clips decide the length when the pack has them,
                // and the ordinary draw decides it when it does not. Both
                // read the same generator in the same place, so a pack with
                // no recordings behaves exactly as this did before they
                // existed.
                let voice = draw_voice_pair(content.0.voice_clips.len(), &mut rng);
                let remaining_ticks = match voice {
                    Some(pair) => {
                        content.0.voice_clips[pair.first as usize].duration_ticks
                            + content.0.voice_clips[pair.second as usize].duration_ticks
                    }
                    None => sample_duration(
                        act.duration_ticks,
                        tuning.duration_variance,
                        tuning.min_interaction_ticks,
                        &mut rng,
                    ),
                };
                let mut talker = commands.entity(entity);
                talker.remove::<Path>().insert(Socialising {
                    interaction: target.interaction,
                    partner: target.object,
                    remaining_ticks,
                });
                match voice {
                    Some(pair) => {
                        talker.insert(pair);
                    }
                    // Cleared rather than left alone. A pack with no voice
                    // must not inherit a pair from a save written by a pack
                    // that had one: the render buffer would publish clips
                    // whose lengths had nothing to do with this
                    // conversation's `remaining_ticks`, which is exactly the
                    // desync the clip-driven duration exists to remove.
                    None => {
                        talker.remove::<ConversationVoice>();
                    }
                }
            } else {
                // Neither an object nor a sim: the target lost its
                // defining component mid-walk. Known leak - see the
                // reclamation note in `tick_interactions` - the walk
                // ends and the stale reservation is the recorded cost.
                commands.entity(entity).remove::<Path>().remove::<Target>();
            }
            continue;
        };

        let dx = tx as f32 - pos.x;
        let dy = ty as f32 - pos.y;
        let dist = (dx * dx + dy * dy).sqrt();

        if dist <= SPEED {
            pos.x = tx as f32;
            pos.y = ty as f32;
            path.cursor += 1;
        } else {
            pos.x += dx / dist * SPEED;
            pos.y += dy / dist * SPEED;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_content;
    use crate::Sim;
    use terri_core::{Agent, NeedId, Needs, Relationships, SimIdAllocator};
    use terri_data::ContentPack;

    /// A centre far above the interaction floor and wide enough that two
    /// consecutive draws are all but certain to differ, which is what
    /// makes the two agents below distinguishable at all.
    const CENTRE: u32 = 400;

    /// The order this system's query yields agents in, with no sorting
    /// applied - precisely the order the draw must NOT depend on.
    ///
    /// The fetch matches `follow_path`'s query exactly, so it reports the
    /// order that system would see rather than a different query's order
    /// that happens to agree today. Modelled on `raw_object_order` in
    /// action.rs and `raw_iteration_order` in lib.rs, which do the same
    /// job for selection and for the world hash.
    #[allow(clippy::type_complexity)]
    fn raw_walking_order(sim: &Sim) -> Vec<u32> {
        let mut state = sim
            .world()
            .try_query::<(Entity, &Position, &Path, Option<&Target>)>()
            .expect("every component in the movement query is registered in Sim::new");
        state
            .iter(sim.world())
            .map(|(entity, _, _, _)| entity.index_u32())
            .collect()
    }

    /// Two agents standing on two objects, each with an exhausted path,
    /// so both begin their interaction on the very next tick and both
    /// draw a duration from the shared generator on that one tick.
    ///
    /// `late_first` decides which agent is given its `Path` and `Target`
    /// first, and therefore which of them the ECS lists first in the
    /// archetype those components create. It is the only difference
    /// between the two worlds this returns: same entities, same indices,
    /// same components, same values.
    fn two_arrivals(late_first: bool) -> (Sim, Entity, Entity) {
        let content = test_content::pack(vec![test_content::object(
            "spot",
            &[(NeedId::Hunger, 40.0)],
            CENTRE,
        )]);
        let spot = content.find("spot").expect("the fixture declares it");
        let mut sim = test_content::sim_with(16, 16, content);

        let first_object = sim
            .world_mut()
            .spawn((Position { x: 2.0, y: 2.0 }, SmartObject(spot)))
            .id();
        let second_object = sim
            .world_mut()
            .spawn((Position { x: 4.0, y: 4.0 }, SmartObject(spot)))
            .id();
        let first = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 2.0 },
                Needs::with(NeedId::Hunger, 20.0),
            ))
            .id();
        let second = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 4.0 },
                Needs::with(NeedId::Hunger, 20.0),
            ))
            .id();

        let mut arrivals = vec![(first, first_object), (second, second_object)];
        if late_first {
            arrivals.reverse();
        }
        for (agent, object) in arrivals {
            sim.world_mut().entity_mut(agent).insert((
                Target {
                    object,
                    interaction: 0,
                },
                Path {
                    steps: Vec::new(),
                    cursor: 0,
                },
            ));
        }

        (sim, first, second)
    }

    fn duration_of(sim: &Sim, agent: Entity) -> u32 {
        sim.world()
            .get::<Eating>(agent)
            .expect("the agent must have begun its interaction")
            .remaining_ticks
    }

    #[test]
    fn arrival_draws_follow_entity_order_not_archetype_order() {
        // Since [D-4] this system takes a draw from the shared `SimRng`
        // whenever an agent arrives, so **the order it visits agents in
        // decides which agent gets which draw.** Query iteration is
        // archetype order, which is allocation history rather than
        // simulation state, so without the sort two sims arriving on the
        // same tick would be dealt their durations according to which of
        // them had most recently gained or lost a component. That is a
        // silent determinism break of the class [D-3] and [L5] are about,
        // and it is invisible in the shipped lot, which has one sim.
        //
        // The two worlds hold identical state and differ only in the
        // order the ECS lists two agents in. The precondition below
        // asserts that difference exists at the moment of comparison -
        // without it this degrades into running the same world twice,
        // which is exactly the permanently-green shape [L5] records three
        // instances of.
        let (mut ordered, first_a, second_a) = two_arrivals(false);
        let (mut churned, first_b, second_b) = two_arrivals(true);
        assert_eq!(
            (first_a.index_u32(), second_a.index_u32()),
            (first_b.index_u32(), second_b.index_u32()),
            "the two worlds must allocate the same entity indices, or a \
             difference in durations says nothing about ordering"
        );
        assert_ne!(
            raw_walking_order(&ordered),
            raw_walking_order(&churned),
            "the two worlds must iterate their walking agents in \
             different orders, or this test cannot detect an ordering \
             dependency; got {:?}",
            raw_walking_order(&ordered)
        );

        ordered.tick();
        churned.tick();

        // Rule 5 in its causal form: with the two durations equal, every
        // assignment of draws to agents looks the same and the test is
        // green for a reason that has nothing to do with ordering.
        assert_ne!(
            duration_of(&ordered, first_a),
            duration_of(&ordered, second_a),
            "the two draws must differ, or a swapped assignment would be \
             indistinguishable from the correct one"
        );

        assert_eq!(
            duration_of(&ordered, first_a),
            duration_of(&churned, first_b),
            "the lower-indexed agent got a different duration in a world \
             whose only difference is archetype layout; the draw order \
             must be a function of entity index, not of allocation history"
        );
        assert_eq!(
            duration_of(&ordered, second_a),
            duration_of(&churned, second_b),
            "the higher-indexed agent got a different duration in a world \
             whose only difference is archetype layout"
        );
    }

    #[test]
    fn a_path_with_no_target_ends_the_walk_instead_of_being_ignored() {
        // [D-5]'s wander reuses this system, and a wander has no target.
        // Before that, `&Target` was a required term in the query, so a
        // path without one was not merely ended - the agent was not moved
        // at ALL, which would have made every wander a sim standing on
        // the spot with an invisible route it never walked.
        //
        // Both halves are asserted, because they are separate mutations:
        // the agent must MOVE while the path lasts, and the path must be
        // REMOVED when it runs out rather than left behind for the wander
        // system to keep skipping over forever.
        let content = test_content::pack(vec![test_content::object(
            "spot",
            &[(NeedId::Hunger, 40.0)],
            CENTRE,
        )]);
        let mut sim = test_content::sim_with(16, 16, content);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 2.0 },
                Needs::all_at(terri_core::NEED_MAX),
                Path {
                    steps: vec![(3, 2)],
                    cursor: 0,
                },
            ))
            .id();

        sim.tick();
        let after_one = *sim
            .world()
            .get::<Position>(agent)
            .expect("the agent must still have a Position");
        assert_ne!(
            (after_one.x, after_one.y),
            (2.0, 2.0),
            "an agent with a path and no target must still be moved along it"
        );

        // Four ticks at 0.25 tiles each cover the one-tile step, and the
        // fifth is the tick on which the exhausted path is dropped.
        for _ in 0..4 {
            sim.tick();
        }
        assert!(
            sim.world().get::<Path>(agent).is_none(),
            "a finished targetless path must be removed, or the sim never \
             becomes eligible to wander again"
        );
        assert!(
            sim.world().get::<Eating>(agent).is_none(),
            "a targetless walk must not start an interaction; there is \
             nothing to interact with"
        );
    }

    /// The distinctness rule, over every clip count a real library could have
    /// and enough draws that a biased implementation cannot hide.
    ///
    /// Mutating `second >= first` to `>` makes `second == first` reachable,
    /// which the inequality catches directly. Deleting the step-over entirely
    /// strands the last index, which the coverage assertion catches.
    #[test]
    fn a_drawn_voice_pair_is_always_two_different_clips() {
        for clip_count in 2..=12usize {
            let mut rng = SimRng::from_seed(0xC0FFEE);
            let mut seen_first = vec![false; clip_count];
            let mut seen_second = vec![false; clip_count];
            for _ in 0..4000 {
                let pair = draw_voice_pair(clip_count, &mut rng)
                    .expect("two or more clips must yield a pair");
                assert_ne!(
                    pair.first, pair.second,
                    "a conversation must not play the same clip twice (clip_count {clip_count})"
                );
                assert!(
                    (pair.first as usize) < clip_count,
                    "first index out of range"
                );
                assert!(
                    (pair.second as usize) < clip_count,
                    "second index out of range"
                );
                seen_first[pair.first as usize] = true;
                seen_second[pair.second as usize] = true;
            }
            // Every clip must be reachable in BOTH positions. The step-over is
            // the part most likely to be silently wrong, and getting it wrong
            // strands either index 0 or the last index.
            assert!(
                seen_first.iter().all(|hit| *hit),
                "every clip must be reachable as the first half (clip_count {clip_count})"
            );
            assert!(
                seen_second.iter().all(|hit| *hit),
                "every clip must be reachable as the second half (clip_count {clip_count})"
            );
        }
    }

    /// A pack that cannot make a pair has no voice, and asks for no draws.
    ///
    /// The draw count is half the point. If an empty library consumed a draw,
    /// adding recordings to the game would shift every later decision in a run
    /// that contains no conversations at all.
    #[test]
    fn fewer_than_two_clips_is_no_voice_and_consumes_no_draws() {
        for clip_count in 0..2usize {
            let mut rng = SimRng::from_seed(7);
            let mut untouched = SimRng::from_seed(7);
            assert!(
                draw_voice_pair(clip_count, &mut rng).is_none(),
                "{clip_count} clips cannot make a pair"
            );
            assert_eq!(
                rng.next_u32(),
                untouched.next_u32(),
                "a pack with no voice must not consume a draw ({clip_count} clips)"
            );
        }
    }

    /// Both orders of a pair occur, so the draw is ordered rather than a
    /// sorted pair wearing two field names.
    ///
    /// Sorting would halve the library: clip 5 followed by clip 2 would never
    /// be heard, and the reply would always be the higher-numbered recording.
    #[test]
    fn a_voice_pair_is_ordered_rather_than_sorted() {
        let mut rng = SimRng::from_seed(99);
        let mut ascending = false;
        let mut descending = false;
        for _ in 0..2000 {
            let pair = draw_voice_pair(12, &mut rng).expect("pair");
            if pair.first < pair.second {
                ascending = true;
            } else {
                descending = true;
            }
        }
        assert!(
            ascending && descending,
            "both clip orders must occur; a sorted pair would halve the library"
        );
    }

    /// Walks one sim up to another and returns the conversation it started,
    /// against a pack whose clips have the given lengths.
    ///
    /// An empty `clip_ticks` gives a pack with no voice, which is how the
    /// fallback case is reached without a second fixture.
    /// A centre a sim will actually choose.
    ///
    /// Separate from `CENTRE` because that one is 400, and scoring divides
    /// by the duration: at 400 ticks a chat scores about 0.037 against the
    /// 0.05 action threshold, so nobody ever walks over and the fixture
    /// deadlocks. 40 is the value the shipped content carried before the
    /// voice clips took the duration over.
    const SOCIAL_CENTRE: u32 = 40;

    fn start_a_conversation(clip_ticks: &[u32]) -> (Sim, Entity, &'static ContentPack) {
        let chat = test_content::interaction("chat", &[(NeedId::Social, 30.0)], SOCIAL_CENTRE);
        let content = test_content::pack_with_voice(
            Vec::new(),
            vec![chat],
            test_content::tuning(),
            clip_ticks,
        );
        let mut sim = test_content::sim_with(8, 8, content);

        // **Both sims need a `SimId`, and the initiator needs
        // `Relationships`.** A social target is a PERSON rather than merely
        // an agent: selection resolves the initiator's feeling toward the
        // partner by id to scale the benefit, so a bare `Agent` is not a
        // candidate and a target pointing at one is dropped on the next tick.
        // Without these the initiator simply wanders off, which is what this
        // fixture did before the components were added.
        // Issued through the allocator rather than written as literals.
        // A snapshot cross-checks the two, and hand-numbered sims leave it
        // insisting none were ever issued.
        let first_id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
        let second_id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
        let initiator = sim
            .world_mut()
            .spawn((
                Agent,
                first_id,
                Relationships::default(),
                Position { x: 2.0, y: 2.0 },
                Needs::with(NeedId::Social, 20.0),
            ))
            .id();
        let partner = sim
            .world_mut()
            .spawn((
                Agent,
                second_id,
                Relationships::default(),
                Position { x: 3.0, y: 2.0 },
                Needs::with(NeedId::Social, 20.0),
            ))
            .id();
        // An exhausted path is an arrival, and `follow_path` converts the
        // target into an in-progress interaction on the tick it sees one.
        //
        // Ticked until the conversation exists rather than exactly once,
        // because selection runs first and may re-path the initiator toward
        // a partner it has not reached yet. Waiting for the state this
        // fixture is named for keeps it about conversation LENGTH instead of
        // about how many ticks selection happens to take today.
        sim.world_mut().entity_mut(initiator).insert((
            Target {
                object: partner,
                interaction: 0,
            },
            Path {
                steps: Vec::new(),
                cursor: 0,
            },
        ));
        let mut ticks = 0;
        while sim.world().get::<Socialising>(initiator).is_none() {
            assert!(
                ticks < 200,
                "two adjacent sims with one social option must start talking"
            );
            sim.tick();
            ticks += 1;
        }
        (sim, initiator, content)
    }

    /// The load-bearing claim of the whole feature: the talking stops exactly
    /// when the second clip runs out.
    ///
    /// Asserted against the SUM of the two clips the draw actually made
    /// rather than against a fixed number, because the pair is drawn and
    /// pinning one expected pair would be pinning the generator instead of
    /// the rule. The clip lengths are pairwise distinct and no two of them
    /// sum to the same total, so a duration built from the wrong pair, from
    /// one clip doubled, or from the authored centre cannot coincide.
    #[test]
    fn a_conversation_lasts_exactly_its_two_voice_clips() {
        let clip_ticks = [13u32, 21, 34, 55];
        let (mut sim, initiator, _) = start_a_conversation(&clip_ticks);

        let voice = sim
            .world()
            .get::<ConversationVoice>(initiator)
            .copied()
            .expect("a pack with clips must give its conversation a voice");
        let expected = clip_ticks[voice.first as usize] + clip_ticks[voice.second as usize];

        // Counted rather than read off `remaining_ticks`, because delivery
        // runs on the tick the conversation is created and has already taken
        // one off by the time anything can observe it. How long the talking
        // RUNS is also the claim worth pinning: it is what has to match the
        // audio, and it does not move if the schedule is reordered.
        //
        // The loop watches the clip pair and not merely the presence of a
        // conversation, because the pair are still standing together when
        // this one ends and may start another on the very next tick.
        let mut lasted = 1;
        loop {
            sim.tick();
            // Counted BEFORE the check: delivery runs on the tick that takes
            // the counter to zero, so the tick that removes the conversation
            // is one the sims spent talking.
            lasted += 1;
            let same_conversation = sim.world().get::<Socialising>(initiator).is_some()
                && sim.world().get::<ConversationVoice>(initiator) == Some(&voice);
            if !same_conversation {
                break;
            }
            assert!(lasted <= 500, "a conversation must end");
        }

        assert_eq!(
            lasted, expected,
            "a conversation must last exactly as long as the two clips it plays"
        );
        assert_ne!(
            lasted, SOCIAL_CENTRE,
            "the authored centre must not decide the length when clips exist"
        );
    }

    /// A pack with no recordings behaves exactly as the game did before they
    /// existed: no voice component, and a duration drawn around the authored
    /// centre.
    ///
    /// Without this, replacing the sampled duration with the clip pair could
    /// silently strand every pack that has no audio - which is every test
    /// fixture in the suite and any future headless tool.
    #[test]
    fn a_pack_with_no_voice_still_draws_a_conversation_duration() {
        let (sim, initiator, _) = start_a_conversation(&[]);

        assert!(
            sim.world().get::<ConversationVoice>(initiator).is_none(),
            "a pack with no clips must not claim a voice it does not have"
        );
        let talking = sim
            .world()
            .get::<Socialising>(initiator)
            .expect("the walk must have started a conversation");
        // The sampled band is the centre either side by `duration_variance`,
        // which is what every other interaction gets.
        let variance = test_content::tuning().duration_variance;
        let lowest = (SOCIAL_CENTRE as f32 * (1.0 - variance)).round() as u32;
        let highest = (SOCIAL_CENTRE as f32 * (1.0 + variance)).round() as u32;
        assert!(
            (lowest..=highest).contains(&talking.remaining_ticks),
            "a voiceless conversation must take a sampled duration; {} is outside {lowest}..={highest}",
            talking.remaining_ticks
        );
    }

    /// The pair survives a save and reload, so resuming mid-conversation
    /// resumes the same two clips.
    ///
    /// Reloading onto a different pair would restart the audio from
    /// somewhere else and finish at a different moment from the talking,
    /// which is the exact desync the clip-driven duration exists to remove.
    #[test]
    fn a_saved_conversation_reloads_the_same_voice_pair() {
        let clip_ticks = [13u32, 21, 34, 55];
        let (sim, initiator, content) = start_a_conversation(&clip_ticks);
        let before = *sim
            .world()
            .get::<ConversationVoice>(initiator)
            .expect("voice");
        let ticks_before = sim
            .world()
            .get::<Socialising>(initiator)
            .expect("talking")
            .remaining_ticks;

        let snapshot = sim.save_snapshot();
        let mut reloaded = test_content::sim_with(8, 8, content);
        reloaded
            .load_snapshot(snapshot)
            .expect("a snapshot this process just wrote must load");

        let (after, ticks_after) = {
            let mut found = None;
            let mut state = reloaded
                .world_mut()
                .try_query::<(&ConversationVoice, &Socialising)>()
                .expect("both components are registered");
            for (voice, talking) in state.iter(reloaded.world()) {
                found = Some((*voice, talking.remaining_ticks));
            }
            found.expect("the reloaded world must still hold the conversation")
        };

        assert_eq!(before, after, "the clip pair must survive a reload");
        assert_eq!(
            ticks_before, ticks_after,
            "the remaining time must survive a reload alongside the pair"
        );
    }
}
