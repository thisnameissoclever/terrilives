use bevy_ecs::prelude::*;
use terri_core::{Agent, Eating, Path, Position, SimRng, SmartObject, Socialising, Target};

use super::advertise::TILES_PER_TICK;
use super::interact::sample_duration;
use crate::Content;

/// Tiles travelled per tick. Imported rather than redeclared so the
/// scoring function's travel estimate cannot silently drift out of step
/// with actual movement.
const SPEED: f32 = TILES_PER_TICK;

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
    )>,
    objects: Query<&SmartObject>,
    sims: Query<(), With<Agent>>,
) {
    let mut walking: Vec<Entity> = agents.iter().map(|(entity, _, _, _, _)| entity).collect();
    walking.sort_by_key(|entity| entity.index());

    for entity in walking {
        // Infallible: the list was just collected from this query and
        // nothing between here and there removes a component.
        let Ok((_, mut pos, mut path, target, traits)) = agents.get_mut(entity) else {
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
            let tuning = &content.0.tuning;
            if let Ok(placed) = objects.get(target.object) {
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
                let remaining_ticks = sample_duration(
                    act.duration_ticks,
                    tuning.duration_variance,
                    tuning.min_interaction_ticks,
                    &mut rng,
                );
                commands
                    .entity(entity)
                    .remove::<Path>()
                    .insert(Socialising {
                        interaction: target.interaction,
                        partner: target.object,
                        remaining_ticks,
                    });
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
    use terri_core::{Agent, NeedId, Needs};

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
}
