//! The point at which player input becomes simulation state - [D-2].
//!
//! **JavaScript never mutates the world.** It enqueues serialisable
//! [`SimCommand`]s, and this module drains them at one fixed point in the
//! tick. That is what keeps replay reproducible, gives [D8]'s save-file
//! command log something to record, and leaves Layer 2 multiplayer
//! possible - the thing you would send over a wire is exactly a
//! serialised command.

use bevy_ecs::prelude::*;
use terri_core::{
    Agent, CommandQueue, Eating, Intent, IntentQueue, Path, Reserved, Selected, SimCommand,
    SmartObject, Target,
};

use crate::Content;

/// The live entity carrying this raw index, if `live` yields one.
///
/// # Why this is a scan rather than a lookup, and why that is not slower
/// than it sounds
///
/// An index arrives from JavaScript, which cannot construct an `Entity`
/// and has no notion of a generation, so the only thing that crosses is a
/// bare `u32`. Resolving it has to answer two questions, and `Entities`
/// answers only the first:
///
/// - **is it live?** - the entity may have been despawned since the click;
/// - **is it the right KIND?** - the caller wants an agent or a smart
///   object, and a raw index promises neither.
///
/// Passing the caller's own filtered query as `live` answers both at once,
/// so `Select` naming an object and `UseObject` naming another sim are
/// rejected by the same mechanism that rejects a stale index. It costs a
/// walk over the agents or the objects - single digits in M1b, and only on
/// ticks where a command actually arrived.
///
/// # The one thing it deliberately does not do
///
/// **A despawned index that has been REUSED resolves to its new occupant.**
/// The wire format carries no generation, so nothing here could tell the
/// difference; the same aliasing is already documented for `world_hash`,
/// which keys rows on the same raw index. Layer 2 needs a stable network
/// id in place of the raw index and that is where this is fixed.
///
/// The result does not depend on iteration order, because at most one live
/// entity carries any given index - so `find` returns the same answer
/// whatever order the query yields.
fn resolve(index: u32, mut live: impl Iterator<Item = Entity>) -> Option<Entity> {
    live.find(|entity| entity.index_u32() == index)
}

/// Applies every queued player command, in the order the player issued
/// them, and empties the queue.
///
/// Scheduled **first** in the tick, before `serve_intents` and
/// `select_action`. That position is load-bearing rather than tidy: an
/// intent pushed here has to be visible to `serve_intents` on the same
/// tick, or a click would take a tick to have any effect and the sim would
/// spend that tick choosing for itself instead.
/// `a_use_object_command_is_served_on_the_tick_it_arrives` is what fails if
/// this moves after either of them.
///
/// # Nothing here reaches the world directly except through a query it
/// declared
///
/// The system is an ordinary `fn` with ordinary parameters rather than an
/// exclusive system, so the set of state a command can touch is the
/// signature above it. That is the enforceable half of [D-2]: "JavaScript
/// must not mutate simulation state" is a claim about the shell, but "a
/// command can only do these things" is a claim rustc checks.
///
/// # Deferred commands are why two of these are staged rather than applied
///
/// `Commands` are applied at the end of the system, so a change made
/// through them is invisible to the rest of this drain. Two of the four
/// variants would be wrong if written the obvious way, and both failures
/// are order failures rather than crashes:
///
/// - **`Select` twice in one tick** would leave BOTH agents marked, because
///   the second command's `selected` query cannot see the first's insert.
///   Selection is therefore resolved into a local `Option<Entity>` across
///   the whole batch and written once at the end.
/// - **`UseObject` twice on an agent with no queue yet** would insert a
///   one-entry queue and then overwrite it with another one-entry queue,
///   silently losing the first click. New queues are therefore staged in
///   `fresh` and inserted once.
///
/// `two_commands_in_one_tick_apply_in_the_order_the_player_issued_them` is
/// what fails on either.
///
/// The type_complexity allow is for the same reason it is on
/// `select_action`: the query tuple is what pushes past clippy's
/// threshold, and a type alias would only move it somewhere less readable.
#[allow(clippy::type_complexity)]
pub fn drain_commands(
    mut commands: Commands,
    mut queue: ResMut<CommandQueue>,
    content: Res<Content>,
    selected: Query<Entity, With<Selected>>,
    mut agents: Query<(Entity, Option<&mut IntentQueue>, Option<&Target>), With<Agent>>,
    objects: Query<Entity, With<SmartObject>>,
) {
    // At least 1 by content validation - `ZeroQueuedIntents` - which is
    // what lets a fresh queue be created below without re-checking that
    // its single entry fits.
    let cap = content.0.tuning.max_queued_intents as usize;

    // Taken out of the resource in one go, which both ends the borrow on
    // it and fixes the batch: a command cannot enqueue another command, so
    // what runs this tick is exactly what the player had issued when the
    // drain began.
    let issued: Vec<SimCommand> = queue.drain().collect();

    // The selection this drain starts from. At most one entity carries
    // `Selected`, because this system is its only writer and the flush at
    // the bottom maintains that; `min_by_key` is the answer that does not
    // depend on query order if a future writer ever breaks the invariant.
    let previously: Vec<Entity> = selected.iter().collect();
    let mut selection: Option<Entity> = previously.iter().copied().min_by_key(|e| e.index());

    // Intents for agents that do not carry an `IntentQueue` yet. An agent
    // gains one the first time it is directed, so this is the ordinary
    // case rather than an edge case.
    let mut fresh: Vec<(Entity, Vec<Intent>)> = Vec::new();

    for command in issued {
        match command {
            // A stale index leaves the selection ALONE rather than
            // clearing it. Clearing would make a click on a sim that has
            // just gone away deselect the one the player is watching,
            // which is a worse answer than doing nothing; `Select(None)`
            // is how the shell asks for a clear, and it is a different
            // command.
            SimCommand::Select(Some(index)) => {
                if let Some(agent) = resolve(index, agents.iter().map(|(entity, _, _)| entity)) {
                    selection = Some(agent);
                }
            }
            SimCommand::Select(None) => selection = None,

            SimCommand::UseObject { agent, object } => {
                let Some(agent) = resolve(agent, agents.iter().map(|(entity, _, _)| entity)) else {
                    continue;
                };
                let Some(object) = resolve(object, objects.iter()) else {
                    continue;
                };
                // Interaction 0, because `UseObject` carries no
                // interaction index: a click names an object, not one of
                // its uses. An object with no interactions at all makes
                // this out of range, which `serve_intents` drops on the
                // next tick rather than carrying into a panic - the same
                // path a command log recorded against an older pack takes.
                let intent = Intent {
                    object,
                    interaction: 0,
                };

                // **Refused at the cap, not trimmed.** See
                // `max_queued_intents` in content/tuning.toml for why the
                // overflow drops the newest rather than the oldest.
                if let Ok((_, Some(mut queue), _)) = agents.get_mut(agent) {
                    if queue.len() < cap {
                        queue.push(intent);
                    }
                } else if let Some((_, staged)) = fresh.iter_mut().find(|(e, _)| *e == agent) {
                    if staged.len() < cap {
                        staged.push(intent);
                    }
                } else {
                    fresh.push((agent, vec![intent]));
                }
            }

            SimCommand::CancelIntents { agent } => {
                let Some(agent) = resolve(agent, agents.iter().map(|(entity, _, _)| entity)) else {
                    continue;
                };
                // Intents staged earlier in this same batch are part of
                // what is being cancelled. Without this, `UseObject` then
                // `CancelIntents` in one tick would leave the agent under
                // orders it had just been released from.
                fresh.retain(|(e, _)| *e != agent);

                let Ok((_, queue, target)) = agents.get_mut(agent) else {
                    continue;
                };

                // **Cancelling releases the sim's current commitment only
                // when that commitment IS the intent being cancelled.**
                //
                // The guard is the difference between "stop doing what I
                // told you" and "stop doing anything". A sim that is
                // autonomously asleep has an empty queue, and a cancel
                // arriving then must not wake it up - the player would see
                // a button that interrupts the sim for no reason. The
                // comparison is the same one `tick_interactions` uses to
                // decide whether a finished interaction pops the front
                // intent, and it conflates the same case for the same
                // reason: an autonomous action that happens to match the
                // front intent exactly is treated as that intent being
                // carried out.
                //
                // **Both halves of the `&&` are load-bearing and the
                // interaction half is the one that looks redundant.**
                // `UseObject` always names interaction 0, and an
                // autonomously chosen interaction is 0 on every
                // single-interaction object - so an intent for the bed and
                // a target on the fridge agree on the interaction index
                // while naming different objects entirely. Relaxed to
                // `||` this releases an autonomous target the moment the
                // player queues a click on anything else, which is the
                // very interruption the guard exists to prevent.
                // `a_cancel_does_not_release_an_autonomous_target_that_only_shares_the_intents_interaction_index`
                // is what fails on it, and it was found by the mutation
                // sweep rather than by hand - every fixture until then had
                // BOTH fields agreeing, which is [L34].
                let serving = match (queue.as_deref().and_then(|q| q.front()), target) {
                    (Some(intent), Some(target)) => {
                        intent.object == target.object && intent.interaction == target.interaction
                    }
                    _ => false,
                };
                let released = target.copied();

                if let Some(mut queue) = queue {
                    queue.clear();
                }

                if serving {
                    // **`clear()` alone is not a cancel.** A cleared queue
                    // with a live reservation leaves the object claimed by
                    // a sim that is no longer coming, and `Eating` without
                    // a `Target` drops the agent out of
                    // `tick_interactions`' query entirely - so the
                    // interaction would never end, `select_action` would
                    // skip the agent for ever on its `Without<Eating>`,
                    // and the sim would freeze while its needs drained.
                    // That is [L17] reached by a button rather than by a
                    // distance metric.
                    if let Some(target) = released {
                        // try_remove for the same reason
                        // `tick_interactions` uses it: `Commands::entity`
                        // does not validate, so a `Target` naming an
                        // entity that has gone away would otherwise route
                        // the removal to the command error handler.
                        commands.entity(target.object).try_remove::<Reserved>();
                    }
                    commands
                        .entity(agent)
                        .remove::<Target>()
                        .remove::<Path>()
                        .remove::<Eating>();
                }
            }

            // **Speed changes no simulation state.** It is a tick
            // MULTIPLIER applied by the driver per [D2] - never a change
            // to `dt` - so at the simulation's level the difference
            // between 1x and 3x is only how many times `tick` is called.
            // There is nothing here to apply.
            //
            // It travels as a command anyway, and that is deliberate:
            // [D8]'s command log has to record it to replay a session
            // faithfully, and a second channel for "the one player action
            // that is not a command" is exactly the crack [D-2] exists to
            // close. If a later milestone gives the simulation ownership
            // of the speed, it belongs in a resource set from here.
            SimCommand::SetSpeed(_) => {}
        }
    }

    for (agent, intents) in fresh {
        commands
            .entity(agent)
            .insert(IntentQueue::from_intents(intents));
    }

    // The selection, written once. Removing first and inserting second is
    // not an ordering requirement - a marker is either wanted on an entity
    // or it is not, and the two sets are disjoint by construction - but
    // re-inserting a marker an entity already carries would move it
    // between archetypes for no reason, which is why the insert is
    // conditional.
    for entity in &previously {
        if Some(*entity) != selection {
            commands.entity(*entity).try_remove::<Selected>();
        }
    }
    if let Some(agent) = selection {
        if !previously.contains(&agent) {
            commands.entity(agent).insert(Selected);
        }
    }
}

#[cfg(test)]
mod tests {
    //! [D-2] end to end: a command goes into the queue as data and comes
    //! out as simulation state, at one fixed point in the tick.
    //!
    //! Two shapes of fixture appear below and the split is deliberate.
    //! Tests about what the DRAIN does run it on its own through
    //! [`drain_only`], because the rest of the schedule reacts within the
    //! same tick and would otherwise decide half of what is being
    //! asserted - `select_action` re-targets a released object on the very
    //! tick a cancel frees it, so "the target was released" measured
    //! through a full tick would be measuring autonomy. Tests about what a
    //! command MEANS run the real schedule, because that is the thing the
    //! player experiences.

    use super::*;
    use crate::{test_content, Sim};
    use terri_core::{NeedId, Needs, NEED_MAX};
    use terri_data::{ContentPack, Tuning};

    const DELTA: f32 = 40.0;
    const DURATION: u32 = 15;
    const AGENT_AT: (f32, f32) = (8.0, 8.0);
    const FRIDGE_AT: (f32, f32) = (11.0, 8.0);
    const BED_AT: (f32, f32) = (2.0, 8.0);

    /// Low enough that a weighted draw between two DIFFERENT scores has
    /// one answer, so a test naming the object autonomy picks is a
    /// statement about scoring rather than about one roll of the dice.
    ///
    /// The same value and the same reasoning as `DECISIVE_TEMPERATURE` in
    /// `action.rs`; that module's copy is `pub(super)` to it, and reaching
    /// across two private test modules to share six lines would couple
    /// them more than it saves.
    const DECISIVE_TEMPERATURE: f32 = 0.0001;

    /// A fridge and a bed, advertising DIFFERENT needs so that directing a
    /// sim at one of them overrides what it wanted rather than merely
    /// picking between two ways to feed it.
    fn content() -> &'static ContentPack {
        test_content::pack_tuned(
            vec![
                test_content::object("fridge", &[(NeedId::Hunger, DELTA)], DURATION),
                test_content::object("bed", &[(NeedId::Energy, DELTA)], DURATION),
            ],
            Tuning {
                choice_temperature: DECISIVE_TEMPERATURE,
                ..test_content::tuning()
            },
        )
    }

    /// The cap the drain actually enforces, read from the same content the
    /// system read rather than restated as a literal. A `4` here would
    /// leave the cap test green while silently no longer testing the
    /// shipped value, from the first time anybody tunes it.
    fn cap() -> usize {
        test_content::tuning().max_queued_intents as usize
    }

    fn spawn_object(sim: &mut Sim, at: (f32, f32), id: &str) -> Entity {
        let def = content()
            .find(id)
            .unwrap_or_else(|| panic!("the fixture must declare '{id}'"));
        sim.world_mut()
            .spawn((terri_core::Position { x: at.0, y: at.1 }, SmartObject(def)))
            .id()
    }

    fn spawn_agent(sim: &mut Sim, at: (f32, f32), needs: Needs) -> Entity {
        sim.world_mut()
            .spawn((Agent, terri_core::Position { x: at.0, y: at.1 }, needs))
            .id()
    }

    /// Hungrier than it is tired, so autonomy has an unambiguous
    /// preference for the fridge and directing it at the bed is a genuine
    /// override.
    fn hungry() -> Needs {
        let mut needs = Needs::all_at(NEED_MAX);
        needs.set(NeedId::Hunger, 20.0);
        needs
    }

    fn enqueue(sim: &mut Sim, command: SimCommand) {
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
    }

    /// Runs `drain_commands` and NOTHING else, so what is asserted
    /// afterwards is what the drain did rather than what the rest of the
    /// tick did in response.
    ///
    /// The `ApplyDeferred` at the end of a schedule run is what makes the
    /// system's `Commands` visible to the assertions, so this is not the
    /// same as calling the function directly.
    fn drain_only(sim: &mut Sim) {
        let mut schedule = Schedule::default();
        schedule.add_systems(drain_commands);
        schedule.run(sim.world_mut());
    }

    fn queue_of(sim: &Sim, agent: Entity) -> &IntentQueue {
        sim.world()
            .get::<IntentQueue>(agent)
            .expect("the agent must have been directed at least once")
    }

    fn selected(sim: &Sim) -> Vec<Entity> {
        let mut state = sim
            .world()
            .try_query_filtered::<Entity, With<Selected>>()
            .expect("Selected is registered eagerly in Sim::new");
        let mut found: Vec<Entity> = state.iter(sim.world()).collect();
        found.sort_by_key(|entity| entity.index());
        found
    }

    fn target_of(sim: &Sim, agent: Entity) -> Option<Target> {
        sim.world().get::<Target>(agent).copied()
    }

    /// A 16x16 lot holding a bed, a fridge and one hungry agent, in that
    /// spawn order.
    fn scenario() -> (Sim, Entity, Entity, Entity) {
        let mut sim = test_content::sim_with(16, 16, content());
        let bed = spawn_object(&mut sim, BED_AT, "bed");
        let fridge = spawn_object(&mut sim, FRIDGE_AT, "fridge");
        let agent = spawn_agent(&mut sim, AGENT_AT, hungry());
        (sim, bed, fridge, agent)
    }

    // ---- Select --------------------------------------------------------

    #[test]
    fn select_marks_the_named_agent_and_unmarks_whatever_was_selected_before() {
        // Both halves matter and the second is the one with a mutation
        // behind it: leaving the previous marker in place would give the
        // shell two selected sims and a need-bar panel with no way to
        // choose between them. `Selected`'s docs put that invariant here
        // rather than in the type, so this is the only thing holding it.
        let mut sim = test_content::sim_with(16, 16, content());
        let first = spawn_agent(&mut sim, AGENT_AT, hungry());
        let second = spawn_agent(&mut sim, (9.0, 8.0), hungry());
        assert!(
            selected(&sim).is_empty(),
            "nothing is selected until a command says so"
        );

        enqueue(&mut sim, SimCommand::Select(Some(first.index_u32())));
        drain_only(&mut sim);
        assert_eq!(selected(&sim), vec![first]);

        enqueue(&mut sim, SimCommand::Select(Some(second.index_u32())));
        drain_only(&mut sim);
        assert_eq!(
            selected(&sim),
            vec![second],
            "selecting a second sim must unmark the first; two selected \
             sims is a state the shell cannot render"
        );
    }

    #[test]
    fn select_none_clears_the_selection() {
        let mut sim = test_content::sim_with(16, 16, content());
        let agent = spawn_agent(&mut sim, AGENT_AT, hungry());

        enqueue(&mut sim, SimCommand::Select(Some(agent.index_u32())));
        drain_only(&mut sim);
        assert_eq!(
            selected(&sim),
            vec![agent],
            "the selection must exist before clearing it means anything"
        );

        enqueue(&mut sim, SimCommand::Select(None));
        drain_only(&mut sim);
        assert!(
            selected(&sim).is_empty(),
            "Select(None) must clear; a no-op arm here leaves the player \
             unable to deselect at all"
        );
    }

    #[test]
    fn select_ignores_an_index_that_is_not_an_agent() {
        // `Selected` marks a SIM. An object carrying it would put the
        // need-bar panel in front of a fridge, and `needsOf` would have
        // nothing to read. The index is a bare `u32`, so nothing but this
        // check distinguishes the two.
        let (mut sim, bed, _fridge, agent) = scenario();
        enqueue(&mut sim, SimCommand::Select(Some(agent.index_u32())));
        drain_only(&mut sim);

        enqueue(&mut sim, SimCommand::Select(Some(bed.index_u32())));
        drain_only(&mut sim);

        assert_eq!(
            selected(&sim),
            vec![agent],
            "selecting an object must be ignored, and must not clear the \
             selection the player already had"
        );
    }

    // ---- UseObject -----------------------------------------------------

    #[test]
    fn use_object_queues_an_intent_for_the_named_agent_and_the_named_object() {
        // Two agents and two objects, so an implementation that pushed to
        // the first agent it found, or that named the first object it
        // found, is visible. Every fixture with one of each is an input
        // domain that cannot see either ([L34]).
        let (mut sim, bed, _fridge, first) = scenario();
        let second = spawn_agent(&mut sim, (9.0, 8.0), hungry());

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: second.index_u32(),
                object: bed.index_u32(),
            },
        );
        drain_only(&mut sim);

        assert_eq!(
            queue_of(&sim, second).front(),
            Some(Intent {
                object: bed,
                interaction: 0,
            }),
            "the intent must name the object the command named"
        );
        assert!(
            sim.world().get::<IntentQueue>(first).is_none(),
            "the agent the command did NOT name must be left alone"
        );
    }

    #[test]
    fn use_object_ignores_an_index_that_is_not_a_smart_object() {
        // Directing a sim at another sim. `serve_intents` looks the object
        // up in a `(&Position, &SmartObject, Has<Reserved>)` query and
        // drops an intent it cannot find, so this would not crash - but it
        // would cost the sim a tick of suppressed autonomy for an
        // instruction that was never meaningful.
        let (mut sim, _bed, _fridge, agent) = scenario();
        let other = spawn_agent(&mut sim, (9.0, 8.0), hungry());

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: other.index_u32(),
            },
        );
        drain_only(&mut sim);

        assert!(
            sim.world().get::<IntentQueue>(agent).is_none(),
            "an object index naming an agent must be refused before an \
             intent is created"
        );
    }

    #[test]
    fn the_intent_queue_is_capped_at_the_tuned_depth_rather_than_growing_without_bound() {
        // Nothing else rate-limits a click. `drain_commands` pushes one
        // intent per command and nothing trims the queue, so without the
        // cap a JavaScript loop grows one agent's queue until it runs out
        // of memory - and long before that, the sim stops choosing for
        // itself for as long as the backlog takes to work through.
        //
        // Three past the cap rather than one, so a cap that is off by one
        // in either direction is still visible.
        let (mut sim, bed, _fridge, agent) = scenario();
        let attempts = cap() + 3;
        assert!(cap() >= 1, "a cap of zero is rejected at build time");

        for _ in 0..attempts {
            enqueue(
                &mut sim,
                SimCommand::UseObject {
                    agent: agent.index_u32(),
                    object: bed.index_u32(),
                },
            );
        }
        drain_only(&mut sim);

        assert_eq!(
            queue_of(&sim, agent).len(),
            cap(),
            "the queue must stop at the tuned cap; {attempts} clicks were \
             issued"
        );
    }

    #[test]
    fn the_cap_applies_to_a_queue_that_already_existed_as_well_as_to_a_new_one() {
        // The two push paths are separate code - an agent with a queue is
        // mutated in place, an agent without one is staged and inserted at
        // the end - so a cap applied to only one of them would be invisible
        // to the test above, which exercises whichever path a fresh agent
        // takes.
        let (mut sim, bed, _fridge, agent) = scenario();

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: bed.index_u32(),
            },
        );
        drain_only(&mut sim);
        assert_eq!(
            queue_of(&sim, agent).len(),
            1,
            "the agent must already carry a queue before the burst below"
        );

        for _ in 0..cap() + 3 {
            enqueue(
                &mut sim,
                SimCommand::UseObject {
                    agent: agent.index_u32(),
                    object: bed.index_u32(),
                },
            );
        }
        drain_only(&mut sim);

        assert_eq!(queue_of(&sim, agent).len(), cap());
    }

    // ---- CancelIntents -------------------------------------------------

    #[test]
    fn cancel_intents_releases_the_target_the_path_and_the_reservation() {
        // **The mutation this exists for is `clear()` alone.** A cleared
        // queue with a live reservation leaves the bed claimed by a sim
        // that is no longer coming, and no other agent could ever use it.
        // A `Target` left behind is worse: the sim keeps walking to an
        // object it was told to forget, and `select_action`'s
        // `Without<Target>` means it never chooses anything again.
        //
        // Drain-only, because `select_action` runs later in the same tick
        // and would re-target the freed object immediately - "the
        // reservation was released" measured through a whole tick would be
        // measuring autonomy rather than the cancel.
        let (mut sim, bed, _fridge, agent) = scenario();
        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: bed.index_u32(),
            },
        );
        sim.tick();

        // Preconditions. Without these every assertion below is satisfied
        // by a sim that never set off in the first place.
        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(bed),
            "the sim must be under way before there is anything to cancel"
        );
        assert!(sim.world().get::<Path>(agent).is_some());
        assert!(sim.world().get::<Reserved>(bed).is_some());
        assert_eq!(queue_of(&sim, agent).len(), 1);

        enqueue(
            &mut sim,
            SimCommand::CancelIntents {
                agent: agent.index_u32(),
            },
        );
        drain_only(&mut sim);

        assert!(
            queue_of(&sim, agent).is_empty(),
            "the queue must be emptied"
        );
        assert_eq!(
            target_of(&sim, agent),
            None,
            "the target must go, or the sim walks on to an object it was \
             told to forget and never chooses anything again"
        );
        assert!(
            sim.world().get::<Path>(agent).is_none(),
            "the path must go with it"
        );
        assert!(
            sim.world().get::<Reserved>(bed).is_none(),
            "the reservation must be released, or the bed is claimed \
             forever by a sim that is not coming"
        );
    }

    #[test]
    fn cancelling_a_directed_interaction_stops_it_and_returns_the_sim_to_autonomy() {
        // The end-to-end half, through the real schedule. Cancelling
        // mid-meal has to drop `Eating` as well as `Target`: an `Eating`
        // with no `Target` falls out of `tick_interactions`' query
        // entirely, so the interaction would never end and
        // `select_action`'s `Without<Eating>` would skip the agent for
        // ever. The sim would stand there for the rest of the session with
        // its needs draining - [L17]'s frozen agent, reached by a button.
        //
        // The sim is spawned ON the bed so it is mid-interaction after a
        // tick or two, and the remaining duration is asserted before the
        // cancel: without that, "the interaction stopped" would be
        // satisfied by it simply having run out.
        let mut sim = test_content::sim_with(16, 16, content());
        let bed = spawn_object(&mut sim, BED_AT, "bed");
        let fridge = spawn_object(&mut sim, FRIDGE_AT, "fridge");
        let agent = spawn_agent(&mut sim, BED_AT, hungry());

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: bed.index_u32(),
            },
        );

        let mut eating = None;
        for _ in 0..64 {
            sim.tick();
            if let Some(state) = sim.world().get::<Eating>(agent) {
                eating = Some(*state);
                break;
            }
        }
        let eating = eating.expect("the directed sim must begin its interaction");
        assert!(
            eating.remaining_ticks > 1,
            "the interaction must have real time left on it; got {}",
            eating.remaining_ticks
        );

        enqueue(
            &mut sim,
            SimCommand::CancelIntents {
                agent: agent.index_u32(),
            },
        );
        sim.tick();

        assert!(
            sim.world().get::<Eating>(agent).is_none(),
            "the interaction must stop; an Eating with no Target never \
             ends and freezes the sim"
        );
        assert!(queue_of(&sim, agent).is_empty());

        // And the sim genuinely chooses again, on the thing it wanted all
        // along. The fixture runs at a decisive temperature, so this is a
        // statement about scoring rather than about one roll of the dice.
        let mut chose_the_fridge = false;
        for _ in 0..200 {
            sim.tick();
            if target_of(&sim, agent).map(|t| t.object) == Some(fridge) {
                chose_the_fridge = true;
                break;
            }
        }
        assert!(
            chose_the_fridge,
            "the sim must return to autonomy; still being pinned to the \
             bed means the cancel released the queue but not the sim"
        );
    }

    #[test]
    fn cancel_intents_does_not_interrupt_an_action_the_sim_chose_for_itself() {
        // **The guard's only reachable input.** Every other cancel test
        // has a matching front intent, so `serving` is true and the guard
        // decides nothing. Here the queue is empty and the sim is
        // autonomously eating: without the guard a cancel would abandon a
        // meal nobody asked it to abandon, which is a button that
        // interrupts the sim for no reason.
        //
        // [L41] is the recorded shape - a guard normally shadowed is only
        // observable where the shadow is absent - and this fixture had to
        // be built deliberately rather than found.
        let mut sim = test_content::sim_with(16, 16, content());
        let fridge = spawn_object(&mut sim, FRIDGE_AT, "fridge");
        let agent = spawn_agent(&mut sim, FRIDGE_AT, hungry());

        let mut eating = None;
        for _ in 0..64 {
            sim.tick();
            if let Some(state) = sim.world().get::<Eating>(agent) {
                eating = Some(*state);
                break;
            }
        }
        let eating = eating.expect("the sim must choose the fridge for itself");
        assert!(
            eating.remaining_ticks > 1,
            "the meal must have time left on it"
        );
        assert!(
            sim.world().get::<IntentQueue>(agent).is_none(),
            "the sim must be acting on its own, or this is a second copy \
             of the cancel test above"
        );

        enqueue(
            &mut sim,
            SimCommand::CancelIntents {
                agent: agent.index_u32(),
            },
        );
        drain_only(&mut sim);

        assert!(
            sim.world().get::<Eating>(agent).is_some(),
            "a cancel must not abandon an autonomously chosen action"
        );
        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(fridge),
            "and it must not release the target"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_some(),
            "and it must not release the reservation"
        );
    }

    #[test]
    fn a_cancel_does_not_release_an_autonomous_target_that_only_shares_the_intents_interaction_index(
    ) {
        // **Found by the mutation sweep, not by hand.** The guard above is
        // `object == object && interaction == interaction`, and the second
        // clause looks redundant until you notice that `UseObject` always
        // names interaction 0 and an autonomously chosen interaction is 0
        // on every single-interaction object. So an intent for the BED and
        // a target on the FRIDGE agree on the interaction index while
        // naming completely different objects.
        //
        // Relaxed to `||` the cancel then releases the sim's autonomous
        // target the moment the player has queued a click on anything
        // else - the exact interruption the guard exists to prevent,
        // arriving through the clause nobody was watching. Every other
        // cancel fixture has BOTH fields agreeing, which is the input
        // domain that cannot see it ([L34]).
        //
        // The two drains are deliberately not separated by a tick:
        // `serve_intents` would convert the intent into a target in
        // between, and then the two really would agree.
        let mut sim = test_content::sim_with(16, 16, content());
        let bed = spawn_object(&mut sim, BED_AT, "bed");
        let fridge = spawn_object(&mut sim, FRIDGE_AT, "fridge");
        let agent = spawn_agent(&mut sim, FRIDGE_AT, hungry());

        let mut eating = None;
        for _ in 0..64 {
            sim.tick();
            if let Some(state) = sim.world().get::<Eating>(agent) {
                eating = Some(*state);
                break;
            }
        }
        let eating = eating.expect("the sim must choose the fridge for itself");
        assert!(
            eating.remaining_ticks > 1,
            "the meal must have time left on it"
        );

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: bed.index_u32(),
            },
        );
        drain_only(&mut sim);

        // The precondition that makes this fixture the one the mutant
        // needs: same interaction index, different object.
        let target = target_of(&sim, agent).expect("the autonomous target must still be held");
        let intent = queue_of(&sim, agent)
            .front()
            .expect("the click must have queued an intent");
        assert_eq!(
            (target.object, target.interaction),
            (fridge, 0),
            "the sim must still be on its own choice"
        );
        assert_ne!(
            intent.object, target.object,
            "the intent must name a DIFFERENT object, or `&&` and `||` \
             agree here and this test proves nothing"
        );
        assert_eq!(
            intent.interaction, target.interaction,
            "and it must share the interaction index, or `||` never fires \
             and this test proves nothing"
        );

        enqueue(
            &mut sim,
            SimCommand::CancelIntents {
                agent: agent.index_u32(),
            },
        );
        drain_only(&mut sim);

        assert!(
            queue_of(&sim, agent).is_empty(),
            "the cancel must still empty the queue"
        );
        assert_eq!(
            target_of(&sim, agent),
            Some(target),
            "the sim's OWN choice must survive a cancel of an intent that \
             was never served"
        );
        assert!(
            sim.world().get::<Eating>(agent).is_some(),
            "and the meal it chose must not be abandoned"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_some(),
            "and the object it chose must stay reserved"
        );
    }

    // ---- Hostile input -------------------------------------------------

    #[test]
    fn a_stale_entity_index_is_ignored_rather_than_panicking() {
        // **The case that matters most.** Indices arrive from JavaScript,
        // which is where inputs are hostile (docs/testing-protocol.md rule
        // 8), and a panic inside the WASM module traps it for the rest of
        // the page's life - from the player's side the whole game freezes,
        // not just the click.
        //
        // Three flavours of bad index, because they fail differently: one
        // that WAS live and has been despawned, one far past anything ever
        // allocated, and `u32::MAX`. A resolution that unwrapped would
        // panic on all three; one that clamped or wrapped would be visible
        // on the last.
        //
        // **Run this under `--release` too.** `debug_assert!` is compiled
        // out of what `wasm-pack` ships, so a debug-only guard passes a
        // debug test while being absent from the only build that reaches a
        // player ([L12]).
        let (mut sim, bed, _fridge, agent) = scenario();
        enqueue(&mut sim, SimCommand::Select(Some(agent.index_u32())));
        drain_only(&mut sim);

        let doomed = spawn_agent(&mut sim, (9.0, 8.0), hungry());
        let stale = doomed.index_u32();
        assert!(
            sim.world_mut().despawn(doomed),
            "the entity must actually be despawned, or this test is about \
             a live index"
        );

        let baseline = sim.world_hash();
        for bad in [stale, 9_999, u32::MAX] {
            enqueue(&mut sim, SimCommand::Select(Some(bad)));
            enqueue(
                &mut sim,
                SimCommand::UseObject {
                    agent: bad,
                    object: bed.index_u32(),
                },
            );
            enqueue(
                &mut sim,
                SimCommand::UseObject {
                    agent: agent.index_u32(),
                    object: bad,
                },
            );
            enqueue(&mut sim, SimCommand::CancelIntents { agent: bad });
            drain_only(&mut sim);
        }

        assert_eq!(
            sim.world_hash(),
            baseline,
            "a stale index must change nothing at all"
        );
        assert!(
            sim.world().get::<IntentQueue>(agent).is_none(),
            "no intent may be created for an object that does not exist"
        );
        assert_eq!(
            selected(&sim),
            vec![agent],
            "a stale Select must leave the existing selection alone rather \
             than clearing it or moving it"
        );
    }

    // ---- Ordering ------------------------------------------------------

    #[test]
    fn two_commands_in_one_tick_apply_in_the_order_the_player_issued_them() {
        // Replay diverges the moment this stops holding, because a command
        // log records an order and nothing else re-derives it.
        //
        // Three pairs, each of which distinguishes ordered application
        // from every unordered one:
        //
        //   - two Selects: an implementation that read the CURRENT
        //     selection out of the query for each command would leave BOTH
        //     agents marked, because the first insert is deferred;
        //   - UseObject then CancelIntents: the cancel must see the intent
        //     the same batch just staged;
        //   - CancelIntents then UseObject: the reverse order must keep it.
        //
        // The `SetSpeed` in the middle is not filler. It is the one
        // variant with nothing to apply, and a `break` or an early return
        // in its arm would swallow every command after it.
        let (mut sim, bed, _fridge, first) = scenario();
        let second = spawn_agent(&mut sim, (9.0, 8.0), hungry());

        enqueue(&mut sim, SimCommand::Select(Some(first.index_u32())));
        enqueue(&mut sim, SimCommand::SetSpeed(3));
        enqueue(&mut sim, SimCommand::Select(Some(second.index_u32())));
        drain_only(&mut sim);
        assert_eq!(
            selected(&sim),
            vec![second],
            "the later Select must win, and the earlier one must not be \
             left marked as well"
        );

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: first.index_u32(),
                object: bed.index_u32(),
            },
        );
        enqueue(
            &mut sim,
            SimCommand::CancelIntents {
                agent: first.index_u32(),
            },
        );
        drain_only(&mut sim);
        assert!(
            sim.world()
                .get::<IntentQueue>(first)
                .is_none_or(IntentQueue::is_empty),
            "a cancel issued after a click must cancel it, including when \
             the agent had no queue before the click"
        );

        enqueue(
            &mut sim,
            SimCommand::CancelIntents {
                agent: first.index_u32(),
            },
        );
        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: first.index_u32(),
                object: bed.index_u32(),
            },
        );
        drain_only(&mut sim);
        assert_eq!(
            queue_of(&sim, first).len(),
            1,
            "a click issued after a cancel must survive it"
        );
    }

    #[test]
    fn two_clicks_on_a_sim_with_no_queue_yet_both_survive_the_same_tick() {
        // The staging bug this exists for: an agent with no `IntentQueue`
        // gains one through `Commands`, which the rest of the drain cannot
        // see, so the second click would insert a SECOND one-entry queue
        // over the top and the first click would vanish with no error.
        //
        // The two intents name DIFFERENT objects, so "both survived" is
        // distinguishable from "one survived twice", and the order is
        // asserted rather than only the count.
        let (mut sim, bed, fridge, agent) = scenario();
        assert!(
            sim.world().get::<IntentQueue>(agent).is_none(),
            "the agent must start with no queue, or the staging path this \
             tests is never taken"
        );

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: fridge.index_u32(),
            },
        );
        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: bed.index_u32(),
            },
        );
        drain_only(&mut sim);

        let queue = queue_of(&sim, agent);
        assert_eq!(queue.len(), 2, "both clicks must reach the queue");
        assert_eq!(
            queue.front(),
            Some(Intent {
                object: fridge,
                interaction: 0,
            }),
            "the FIRST click must be at the front; a queue holding the bed \
             first means the batch was applied out of order"
        );
    }

    #[test]
    fn a_use_object_command_is_served_on_the_tick_it_arrives() {
        // **The schedule position, stated as behaviour.** `drain_commands`
        // runs before `serve_intents` and before `select_action`, and each
        // of the three possible orders produces a different observable
        // outcome on this one tick:
        //
        //   - drain first, as shipped: the intent becomes a Target now;
        //   - drain between the two: the queue is non-empty when
        //     `select_action` runs, so it skips the agent, and
        //     `serve_intents` has already been past - no Target at all;
        //   - drain last: autonomy takes the fridge instead.
        //
        // So this single assertion fails on either mutation, for a
        // different reason each time.
        let (mut sim, bed, fridge, agent) = scenario();

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: bed.index_u32(),
            },
        );
        sim.tick();

        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(bed),
            "a click must take effect on the tick it arrives, and it must \
             beat autonomy"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_none(),
            "autonomy must not have run for a directed agent"
        );
    }

    #[test]
    fn commands_are_applied_once_rather_than_re_applied_on_every_tick() {
        // The drain must EMPTY the queue. Iterating it instead would
        // re-push the same intent every tick until the cap, and a single
        // click would look like a player holding the mouse down.
        let (mut sim, bed, _fridge, agent) = scenario();
        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: bed.index_u32(),
            },
        );

        sim.tick();
        assert!(
            sim.world().resource::<CommandQueue>().is_empty(),
            "the drain must empty the queue"
        );
        let after_one = queue_of(&sim, agent).len();
        for _ in 0..5 {
            sim.tick();
        }
        assert_eq!(
            queue_of(&sim, agent).len(),
            after_one,
            "five further ticks with an empty command queue must not add \
             intents"
        );
    }

    // ---- Replay --------------------------------------------------------

    /// A world holding a bed at entity index 0, one agent at index 1 and
    /// a fridge at index 2, so the script below can name them by the
    /// literal indices a recorded command log would carry.
    ///
    /// Deliberately the SHIPPED content, the shipped lot dimensions and
    /// the shipped tuning, because a determinism claim about a fixture
    /// nobody plays is worth less than one about the game. The agent is
    /// hungry and fully rested, which is what makes the script's
    /// `UseObject` a genuine override: autonomy wants the fridge, so
    /// directing the sim at the BED is an instruction it would never have
    /// given itself. [L36] is the recorded instance of a fixture whose
    /// single candidate made a whole mechanism invisible; a script whose
    /// commands agree with autonomy is that same trap.
    ///
    /// The spawn ORDER is what fixes the indices, so it is asserted rather
    /// than assumed - the script is written in literals and would silently
    /// address the wrong entities if anything were reordered here.
    fn replay_world() -> Sim {
        let mut sim = Sim::new_with_lot(24, 24);
        let bed = sim
            .world_mut()
            .spawn((
                terri_core::Position { x: 2.0, y: 2.0 },
                test_content::shipped_object("bed"),
            ))
            .id();
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                terri_core::Position { x: 10.0, y: 10.0 },
                Needs::with(NeedId::Hunger, 35.0),
            ))
            .id();
        let fridge = sim
            .world_mut()
            .spawn((
                terri_core::Position { x: 18.0, y: 18.0 },
                test_content::shipped_fridge(),
            ))
            .id();
        assert_eq!(
            (bed.index_u32(), agent.index_u32(), fridge.index_u32()),
            (0, 1, 2),
            "the script below names these entities by literal index"
        );
        sim
    }

    /// Runs `ticks` ticks, injecting each command on the tick its script
    /// entry names, and returns the world hash plus the selected entity's
    /// raw index.
    ///
    /// **The selection is returned separately because `world_hash` does
    /// not observe `Selected`.** That is a real gap and it is bounded: no
    /// system reads the marker, so a divergent selection cannot make the
    /// simulation diverge - it is a projection the shell renders, not an
    /// input to anything. Widening the digest would move a published
    /// format and both golden vectors for a term with no causal power, so
    /// the selection is asserted here instead. Whoever gives `Selected` a
    /// reader inside the simulation owns revisiting that.
    fn run_scripted(script: &[(u64, SimCommand)], ticks: u64) -> (u64, Option<u32>) {
        let mut sim = replay_world();
        for tick in 0..ticks {
            for (at, command) in script {
                if *at == tick {
                    enqueue(&mut sim, command.clone());
                }
            }
            sim.tick();
        }
        let selection = selected(&sim).first().map(|entity| entity.index_u32());
        (sim.world_hash(), selection)
    }

    /// The same world advanced the same number of ticks with no commands
    /// at all. The counterfactual the replay test needs: without it,
    /// "two runs of the script agree" is equally true of a drain that does
    /// nothing whatsoever.
    fn run_unscripted(ticks: u64) -> (u64, Option<u32>) {
        run_scripted(&[], ticks)
    }

    fn empty_world_hash(ticks: u64) -> u64 {
        let mut sim = Sim::new_with_lot(24, 24);
        for _ in 0..ticks {
            sim.tick();
        }
        sim.world_hash()
    }

    #[test]
    fn a_recorded_command_sequence_replays_to_the_same_hash() {
        // **The milestone's determinism guarantee.** If this fails,
        // JavaScript is mutating state somewhere it should be enqueueing a
        // command.
        //
        // The equality on its own would be weak - [L5] is three recorded
        // instances of "two runs in one process" being permanently green -
        // so it is surrounded by the three things that make it mean
        // something:
        //
        //   1. the run is not an empty world's, so the digest is seeing
        //      entity rows at all;
        //   2. the scripted run differs from an UNSCRIPTED one, so the
        //      commands demonstrably reached the simulation - this is what
        //      fails if `drain_commands` is deleted outright;
        //   3. removing ONE command from the script changes the outcome,
        //      and putting it back restores it - twice, once per command
        //      that has an effect the digest can see. That is the causal
        //      form docs/testing-protocol.md rule 3 asks for, and it is
        //      what distinguishes "the drain works" from "the drain runs".
        const TICKS: u64 = 200;
        let script = vec![
            (0, SimCommand::Select(Some(1))),
            (
                5,
                SimCommand::UseObject {
                    agent: 1,
                    object: 0,
                },
            ),
            (40, SimCommand::CancelIntents { agent: 1 }),
        ];

        let a = run_scripted(&script, TICKS);
        let b = run_scripted(&script, TICKS);

        assert_ne!(
            a.0,
            empty_world_hash(TICKS),
            "the run must not be trivially empty"
        );
        assert_eq!(
            a.1,
            Some(1),
            "the scripted selection must have landed, or the Select in \
             this script is doing nothing and the replay claim excludes it"
        );
        // The HASH alone, deliberately, not the whole tuple. Measured
        // during this task's hand-mutation pass: with `UseObject` and
        // `CancelIntents` made no-ops and only `Select` still working,
        // the tuples still differed - because the selection is in the
        // tuple and the Select had landed. Comparing the tuple therefore
        // asks "did ANY command do anything", which one working command
        // out of three satisfies. Comparing the digest asks "did the
        // commands change the WORLD", which is the claim [D-2] makes.
        assert_ne!(
            a.0,
            run_unscripted(TICKS).0,
            "the scripted run must reach a different world from an \
             unscripted one, or the commands never reached the simulation \
             and this test would be green with the whole drain deleted"
        );
        assert_eq!(a, b, "the same command script must replay identically");

        // The causal half: each command removed on its own, so the
        // outcome cannot be produced by the other two.
        //
        // On the DIGEST rather than the tuple, for the reason above and
        // per [L42]. Both of these scripts keep the `Select`, so the
        // selection term is identical in each pair and a tuple comparison
        // would be carried entirely by the hash anyway - but that is a
        // property of today's script rather than of the assertion, and an
        // inequality over a pair is satisfied by whichever term is
        // cheapest. Stating the field is what stops a fourth command
        // added to this script later from quietly making these vacuous.
        let without_direction: Vec<_> = script
            .iter()
            .filter(|(_, command)| !matches!(command, SimCommand::UseObject { .. }))
            .cloned()
            .collect();
        assert_ne!(
            run_scripted(&without_direction, TICKS).0,
            a.0,
            "dropping the UseObject must change the world, or the \
             direction was doing nothing and the replay says nothing \
             about it"
        );

        let without_cancel: Vec<_> = script
            .iter()
            .filter(|(_, command)| !matches!(command, SimCommand::CancelIntents { .. }))
            .cloned()
            .collect();
        assert_ne!(
            run_scripted(&without_cancel, TICKS).0,
            a.0,
            "dropping the CancelIntents must change the world, or the \
             cancel was doing nothing"
        );

        assert_eq!(
            run_scripted(&script, TICKS),
            a,
            "restoring the script must restore the digest"
        );
    }
}
