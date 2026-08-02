//! The point at which player input becomes simulation state - [D-2].
//!
//! **JavaScript never mutates the world.** It enqueues serialisable
//! [`SimCommand`]s, and this module drains them at deterministic command
//! boundaries: first in a full tick, or alone while the shell is paused.
//! Split and batched drains must be equivalent for the same ordered command
//! stream. That is what keeps replay reproducible, gives [D8]'s save-file
//! command log something to record, and leaves Layer 2 multiplayer possible -
//! the thing you would send over a wire is exactly a serialised command.

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

            SimCommand::UseObject {
                agent,
                object,
                interaction,
            } => {
                let Some(agent) = resolve(agent, agents.iter().map(|(entity, _, _)| entity)) else {
                    continue;
                };
                let Some(object) = resolve(object, objects.iter()) else {
                    continue;
                };
                // **The index is copied across, not validated here.** The
                // two entity indices above are resolved because a raw
                // index promises neither liveness nor kind and nothing
                // downstream re-checks; the interaction index is
                // different, because `serve_intents` already drops a front
                // intent whose interaction is past the end of the object's
                // list, before anything indexes with it. A second range
                // check here would be a weaker copy of that one - weaker
                // because it would need the object's definition, which
                // this system does not query - and it would have to agree
                // with it for ever.
                //
                // So out of range remains `serve_intents`' problem, and it
                // must stay a drop rather than a panic: it is what a
                // command log recorded against an older content pack
                // replays as, and what an object with no interactions at
                // all makes of any index whatsoever.
                let intent = Intent {
                    object,
                    interaction,
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
                // A staged front is already part of the ordered command
                // stream even though `Commands` has not inserted its queue
                // yet. Capture it before removal so a cancel makes the same
                // release decision whether UseObject and CancelIntents land
                // in one drain batch or two paused-frame batches.
                let staged_front = fresh
                    .iter()
                    .find(|(entity, _)| *entity == agent)
                    .and_then(|(_, intents)| intents.first())
                    .copied();
                // Intents staged earlier in this same batch are part of
                // what is being cancelled. Keep the staged queue itself and
                // empty it, because a split drain first inserts that queue and
                // the later cancel clears it. Removing the staged entry would
                // make one batch save `None` while two batches save `Some([])`.
                if let Some((_, intents)) = fresh.iter_mut().find(|(entity, _)| *entity == agent) {
                    intents.clear();
                }

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
                // **Both halves of the `&&` are load-bearing, and the
                // interaction half is now obviously so.** A commitment is
                // an (object, interaction) pair and so is an intent, so
                // neither field alone identifies one: an intent for the
                // BED and a target on the FRIDGE can share an interaction
                // index, and two rows of one object's flyout name the same
                // object and different interactions. Relaxed to `||`
                // either of those releases a commitment that is not the
                // one being cancelled - the very interruption the guard
                // exists to prevent.
                //
                // **This comment used to argue the clause was only subtly
                // load-bearing, on the grounds that `UseObject` always
                // named interaction 0.** That premise is gone: the command
                // carries the player's chosen index now, so sharing an
                // interaction index is an ordinary coincidence rather than
                // a consequence of one field being hardcoded.
                // `a_cancel_does_not_release_an_autonomous_target_that_only_shares_the_intents_interaction_index`
                // is what fails on the `||`; it was found by the mutation
                // sweep back when every fixture had BOTH fields agreeing,
                // which is [L34].
                let serving_intent = queue
                    .as_deref()
                    .and_then(IntentQueue::front)
                    .or(staged_front);
                let serving = match (serving_intent, target) {
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
                        .remove::<Eating>()
                        // Reachable since TalkTo: a directed sim can be
                        // mid-conversation when the cancel lands, and a
                        // Socialising left behind with no Target is a
                        // talk tick_social finishes against nobody. The
                        // Reserved release above already freed the
                        // partner, and tick_social's disturbed check
                        // would self-heal one tick later - this makes
                        // the cancel whole on its own tick instead.
                        .remove::<terri_core::Socialising>()
                        // A fumble belongs to the attempt; cancelling
                        // the attempt closes it unfinished, unlearned.
                        .remove::<terri_core::Fumbled>();
                }

                // **A chain is abandoned by an explicit cancel
                // REGARDLESS of the serving guard** - [K4]'s one
                // destructive path. The guard protects autonomous
                // actions from "stop doing what I told you", but a
                // chain is a long visible errand whose starting intent
                // is already spent, so stop means stop. The chain walk
                // is identifiable by its sentinel, which is what lets
                // the station release here without touching the guard
                // above; the counter and the carried item go
                // unconditionally, no-ops for everyone else.
                if let Some(target) = released {
                    if target.interaction == crate::systems::chain::CHAIN_STEP {
                        commands.entity(target.object).try_remove::<Reserved>();
                        commands.entity(agent).remove::<Target>().remove::<Path>();
                    }
                }
                commands
                    .entity(agent)
                    .remove::<terri_core::ChainState>()
                    .remove::<terri_core::Carrying>()
                    .remove::<terri_core::StepWork>();
            }

            SimCommand::TalkTo {
                agent,
                target,
                interaction,
            } => {
                let Some(agent) = resolve(agent, agents.iter().map(|(entity, _, _)| entity)) else {
                    continue;
                };
                // The target resolves against AGENTS, the mirror of
                // UseObject's With<SmartObject> resolve: a stale or
                // object index is dropped silently, exactly like a stale
                // UseObject. Self-talk is dropped too, explicitly -
                // autonomy excludes self by entity in the people loop,
                // and a self-intent surviving to serve_intents would
                // wait forever on "partner busy: me".
                let Some(target) = resolve(target, agents.iter().map(|(entity, _, _)| entity))
                else {
                    continue;
                };
                if target == agent {
                    continue;
                }
                // The social index is copied, not range-checked, for
                // UseObject's exact reasons: serve_intents drops an
                // out-of-range front intent before anything indexes with
                // it, and the check belongs where the data is used.
                let intent = Intent {
                    object: target,
                    interaction,
                };
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
    //! out as simulation state, at a deterministic command boundary.
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
        spawn_object_from(content(), sim, at, id)
    }

    /// The same, from a named pack, for the two-verb fixture below.
    ///
    /// The pack is a parameter rather than read from the sim's `Content`
    /// resource because a `SmartObject` holds an `ObjectDefId` that indexes
    /// one specific pack: spawning from a different pack than the sim was
    /// built with would produce an id that resolves to some other object
    /// entirely, with no error anywhere. Passing the pack in makes the two
    /// obviously come from one place at the call site.
    fn spawn_object_from(
        pack: &'static ContentPack,
        sim: &mut Sim,
        at: (f32, f32),
        id: &str,
    ) -> Entity {
        let def = pack
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

    // ---- The two-verb fixture ------------------------------------------
    //
    // Everything above runs against objects with exactly ONE interaction,
    // which is all `content/objects.toml` ships. That is the input domain
    // in which "the command's interaction index was used" and "0 was
    // hardcoded" agree on every observation, so an object with two
    // genuinely different verbs is the minimum needed to tell them apart -
    // [L34], in the place the whole change lives.

    const DESK: &str = "desk";
    const DESK_AT: (f32, f32) = (5.0, 8.0);

    /// Interaction 0 of the desk: `fun`, a small delta, a short run.
    const FIRST: (NeedId, f32, u32) = (NeedId::Fun, 30.0, 20);
    /// Interaction 1 of the desk: `comfort`, a bigger delta, a long run.
    /// Every component differs from `FIRST`, so which one ran is visible
    /// three separate ways.
    const SECOND: (NeedId, f32, u32) = (NeedId::Comfort, 48.0, 40);

    /// The level the two modulated needs start at: low enough that filling
    /// them is not clamped away at `NEED_MAX`, high enough that neither is
    /// so desperate it beats hunger in autonomous scoring.
    const HALF_FULL: f32 = 50.0;

    /// A desk with two interactions, plus the fridge, at **zero duration
    /// variance**.
    ///
    /// The variance override is what makes "it ran for interaction 1's
    /// duration" a testable claim at all. [D-4] samples a duration within
    /// `duration_variance` either side of the content number, and at the
    /// shipped 0.4 the two bands here are 12-28 ticks and 24-56 - which
    /// OVERLAP, so a measured length could not name the interaction it came
    /// from. At zero the sample is exactly the content value.
    ///
    /// Kept apart from [`content`] rather than folded into it, because that
    /// pack is what every other test in this module runs against and pinning
    /// its durations would silently change the timing every one of them was
    /// written against - the same reasoning `test_content::object_sized`
    /// gives for not widening the shared object helper.
    fn two_verb_content() -> &'static ContentPack {
        test_content::pack_tuned(
            vec![
                test_content::object("fridge", &[(NeedId::Hunger, DELTA)], DURATION),
                test_content::object_with_two_interactions(DESK, FIRST, SECOND),
            ],
            Tuning {
                choice_temperature: DECISIVE_TEMPERATURE,
                duration_variance: 0.0,
                ..test_content::tuning()
            },
        )
    }

    /// A 16x16 lot holding the two-verb desk, the fridge, and one agent
    /// standing ON the desk so it starts interacting within a tick or two.
    ///
    /// The agent is hungry, exactly as in [`scenario`], so autonomy wants
    /// the fridge and BOTH desk interactions are instructions it would
    /// never have given itself. `fun` and `comfort` sit at [`HALF_FULL`]
    /// so that whichever verb runs has somewhere to fill.
    fn two_verb_scenario() -> (Sim, Entity, Entity, Entity) {
        let pack = two_verb_content();
        let mut sim = test_content::sim_with(16, 16, pack);
        let desk = spawn_object_from(pack, &mut sim, DESK_AT, DESK);
        let fridge = spawn_object_from(pack, &mut sim, FRIDGE_AT, "fridge");
        let mut needs = hungry();
        needs.set(FIRST.0, HALF_FULL);
        needs.set(SECOND.0, HALF_FULL);
        let agent = spawn_agent(&mut sim, DESK_AT, needs);
        (sim, desk, fridge, agent)
    }

    fn level(sim: &Sim, agent: Entity, need: NeedId) -> f32 {
        sim.world()
            .get::<Needs>(agent)
            .expect("the agent must carry needs")
            .get(need)
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
                interaction: 0,
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
    fn use_object_queues_the_interaction_index_the_command_named_rather_than_zero() {
        // **The whole of the field this task added, at the drain.** The
        // command names interaction 1 of a two-verb desk, and the intent
        // has to carry a 1. A `0` anywhere on this path - the hardcode the
        // change replaced, or a `..Default::default()` slipped in later -
        // fails only here and only because the index sent is NON-ZERO;
        // that is [L34] in one line.
        //
        // Drain-only, because this is a claim about what the drain writes.
        // What the simulation then DOES with the index is the end-to-end
        // test below, and the two are separate because a drain that stored
        // the right number and a `serve_intents` that ignored it would look
        // identical through either one alone.
        //
        // The second command names interaction 0 of the SAME object, so the
        // queue holds two intents that differ in nothing but the index. A
        // fixture with one entry could be satisfied by a drain that always
        // wrote the LAST index it saw, or the first.
        let (mut sim, desk, _fridge, agent) = two_verb_scenario();

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: desk.index_u32(),
                interaction: 1,
            },
        );
        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: desk.index_u32(),
                interaction: 0,
            },
        );
        drain_only(&mut sim);

        assert_eq!(
            queue_of(&sim, agent).len(),
            2,
            "both clicks must reach the queue"
        );
        // Read by popping, because `IntentQueue` exposes only its front -
        // deliberately, since `serve_intents` only ever looks at the front.
        // Widening that API for a test would add production surface nothing
        // in the simulation wants.
        let mut queue = sim
            .world_mut()
            .get_mut::<IntentQueue>(agent)
            .expect("the agent must have been directed");
        assert_eq!(
            queue.front(),
            Some(Intent {
                object: desk,
                interaction: 1,
            }),
            "the first intent must carry the index its command named; a 1 \
             here is the only thing a hardcoded 0 cannot produce"
        );
        queue.pop();
        assert_eq!(
            queue.front(),
            Some(Intent {
                object: desk,
                interaction: 0,
            }),
            "and the second must carry its own, so the two are not one \
             index copied twice"
        );
    }

    #[test]
    fn an_interaction_index_past_the_end_is_queued_here_and_dropped_by_serve_intents() {
        // **The out-of-range case is deliberately NOT rejected at the
        // drain**, and that has to be asserted rather than left as a
        // reading of the source, because "the drain refuses it" and "the
        // drain accepts it and the server drops it" are indistinguishable
        // from the outside two ticks later. The distinction matters: a
        // range check here would need the object's definition, which this
        // system does not query, so it could only be a weaker second copy
        // of `serve_intents`' check that has to agree with it for ever.
        //
        // `u32::MAX` rather than 2, because it is what the WASM boundary
        // lets through unchanged and because a clamp or a wrap anywhere on
        // the path shows up on it and on nothing smaller.
        let (mut sim, desk, _fridge, agent) = two_verb_scenario();

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: desk.index_u32(),
                interaction: u32::MAX,
            },
        );
        drain_only(&mut sim);

        assert_eq!(
            queue_of(&sim, agent).front(),
            Some(Intent {
                object: desk,
                interaction: u32::MAX,
            }),
            "the drain must pass the index through untouched; a saturating \
             clamp to the last real interaction would turn 'use the verb \
             that is not there' into 'use the last verb'"
        );

        // And the simulation survives it. `serve_intents` drops the intent
        // rather than indexing with it, which is what keeps
        // `tick_interactions`' `interactions[i]` safe by construction.
        for _ in 0..20 {
            sim.tick();
        }
        assert!(
            sim.world()
                .get::<IntentQueue>(agent)
                .is_none_or(IntentQueue::is_empty),
            "the unservable intent must be dropped, or the sim is pinned to \
             an instruction that can never complete"
        );
        assert!(
            sim.world().get::<Eating>(agent).is_none()
                || target_of(&sim, agent).map(|t| t.interaction) != Some(u32::MAX),
            "and nothing may have started an interaction under an index the \
             desk does not have"
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
                interaction: 0,
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
                    interaction: 0,
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
                interaction: 0,
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
                    interaction: 0,
                },
            );
        }
        drain_only(&mut sim);

        assert_eq!(queue_of(&sim, agent).len(), cap());
    }

    #[test]
    fn talk_to_respects_the_cap_on_a_queue_that_already_existed() {
        // TalkTo's push shares its SHAPE with UseObject's but not its
        // code - the drain has one `queue.len() < cap` per variant - so
        // the two UseObject cap tests above hold no mutant on this arm.
        // Seeded with a click first, so this exercises the
        // mutate-in-place path rather than the fresh staging below.
        let (mut sim, bed, _fridge, agent) = scenario();
        let partner = spawn_agent(&mut sim, (9.0, 8.0), hungry());

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: bed.index_u32(),
                interaction: 0,
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
                SimCommand::TalkTo {
                    agent: agent.index_u32(),
                    target: partner.index_u32(),
                    interaction: 0,
                },
            );
        }
        drain_only(&mut sim);

        assert_eq!(queue_of(&sim, agent).len(), cap());
    }

    #[test]
    fn talk_to_staged_for_a_fresh_agent_is_capped_within_one_batch() {
        // The staging path: an agent with no queue yet takes its first
        // TalkTo into `fresh`, and every LATER one in the same batch
        // through the staged-length check - a third copy of the cap,
        // invisible to both tests above.
        let (mut sim, _bed, _fridge, agent) = scenario();
        let partner = spawn_agent(&mut sim, (9.0, 8.0), hungry());

        for _ in 0..cap() + 3 {
            enqueue(
                &mut sim,
                SimCommand::TalkTo {
                    agent: agent.index_u32(),
                    target: partner.index_u32(),
                    interaction: 0,
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
                interaction: 0,
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
                interaction: 0,
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
        // `object == object && interaction == interaction`, and relaxing
        // it to `||` releases the sim's autonomous target the moment the
        // player has queued a click on anything ELSE that happens to share
        // an interaction index - the exact interruption the guard exists to
        // prevent, arriving through the clause nobody was watching. Every
        // other cancel fixture has BOTH fields agreeing, which is the input
        // domain that cannot see it ([L34]).
        //
        // **This fixture used to be awkward to build and no longer is, and
        // the reason is the point.** When `UseObject` hardcoded interaction
        // 0, "an intent and a target that share an index but not an object"
        // was a coincidence you had to arrange: the click's index came from
        // the command's hardcode and the target's from autonomy picking the
        // only interaction a single-verb object has. The command carries a
        // chosen index now, so the `interaction: 0` below is a DELIBERATE
        // match with what autonomy chose rather than an inherited constant,
        // and the input domain is one line to reach. The mutant it kills is
        // unchanged; only the effort of cornering it moved.
        //
        // The mirrored domain - same object, DIFFERENT interaction - is
        // `a_cancel_does_not_release_an_autonomous_target_on_the_same_object_under_another_interaction`
        // below, which the two-verb desk made expressible for the first
        // time. Neither test implies the other: they disagree about which
        // half of the `&&` is the false one.
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
                // Chosen to MATCH the interaction autonomy took on the
                // fridge, not inherited from a hardcode. See above.
                interaction: 0,
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

    #[test]
    fn a_cancel_does_not_release_an_autonomous_target_on_the_same_object_under_another_interaction()
    {
        // **The mirror of the test above, and the input domain that did not
        // exist until `UseObject` could name an interaction.** There the
        // intent and the target share an index and differ in the object;
        // here they share the OBJECT and differ in the index, which needs
        // both a two-verb object and a command able to name its second
        // verb. The two together are what make each half of
        // `object == object && interaction == interaction` separately
        // load-bearing:
        //
        //   - relaxed to `||`, both tests fail;
        //   - with the interaction clause forced true, only this one does,
        //     because there the objects already differ and the `&&` is
        //     false either way.
        //
        // What the bug costs a player: a sim reading at the desk, a click
        // on the desk's OTHER verb queued behind it, and then a cancel -
        // and the reading stops, the desk is unreserved, and the sim stands
        // up for an instruction it was never carrying out.
        //
        // The desk alone, with `fun` the only need worth anything, so
        // autonomy has an unambiguous reason to pick interaction 0 and
        // interaction 1 is genuinely the one it did NOT choose.
        let pack = two_verb_content();
        let mut sim = test_content::sim_with(16, 16, pack);
        let desk = spawn_object_from(pack, &mut sim, DESK_AT, DESK);
        let mut needs = Needs::all_at(NEED_MAX);
        needs.set(FIRST.0, 10.0);
        let agent = spawn_agent(&mut sim, DESK_AT, needs);

        for _ in 0..64 {
            sim.tick();
            if sim.world().get::<Eating>(agent).is_some() {
                break;
            }
        }
        let target = target_of(&sim, agent).expect("the sim must choose the desk for itself");
        assert_eq!(
            (target.object, target.interaction),
            (desk, 0),
            "autonomy must have taken interaction 0; if it took 1 the \
             fixture is the same test upside down and proves nothing"
        );
        assert!(
            sim.world().get::<IntentQueue>(agent).is_none(),
            "and it must be acting on its own, or the guard is not the \
             thing deciding"
        );

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: desk.index_u32(),
                interaction: 1,
            },
        );
        drain_only(&mut sim);

        let intent = queue_of(&sim, agent)
            .front()
            .expect("the click must have queued an intent");
        assert_eq!(
            intent.object, target.object,
            "the intent must name the SAME object, or `&&` and `||` agree \
             here and this test proves nothing"
        );
        assert_ne!(
            intent.interaction, target.interaction,
            "and a DIFFERENT interaction, or there is no disagreement for \
             the second clause to notice"
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
            "the sim's own choice must survive; releasing it here is the \
             `||` mutant, and the player sees a sim abandon what it was \
             doing because they cancelled something it never started"
        );
        assert!(
            sim.world().get::<Eating>(agent).is_some(),
            "and the interaction it chose must not be abandoned"
        );
        assert!(
            sim.world().get::<Reserved>(desk).is_some(),
            "and the desk must stay reserved to it"
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
                    interaction: 0,
                },
            );
            enqueue(
                &mut sim,
                SimCommand::UseObject {
                    agent: agent.index_u32(),
                    object: bad,
                    interaction: 0,
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
                interaction: 0,
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
                interaction: 0,
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
    fn split_and_batched_paused_drains_produce_the_same_saved_world() {
        fn started_meal() -> (Sim, Entity, Entity) {
            let mut sim = test_content::sim_with(8, 8, content());
            let fridge = spawn_object(&mut sim, (4.0, 4.0), "fridge");
            let agent = spawn_agent(&mut sim, (3.0, 4.0), Needs::with(NeedId::Hunger, 0.0));
            sim.tick();
            assert!(
                sim.world().get::<Eating>(agent).is_some(),
                "the fixture must begin mid-interaction so cancel has a live commitment to release"
            );
            (sim, fridge, agent)
        }

        let (mut split, split_fridge, split_agent) = started_meal();
        let (mut batched, batched_fridge, batched_agent) = started_meal();

        enqueue(
            &mut split,
            SimCommand::UseObject {
                agent: split_agent.index_u32(),
                object: split_fridge.index_u32(),
                interaction: 0,
            },
        );
        drain_only(&mut split);
        enqueue(
            &mut split,
            SimCommand::CancelIntents {
                agent: split_agent.index_u32(),
            },
        );
        drain_only(&mut split);

        enqueue(
            &mut batched,
            SimCommand::UseObject {
                agent: batched_agent.index_u32(),
                object: batched_fridge.index_u32(),
                interaction: 0,
            },
        );
        enqueue(
            &mut batched,
            SimCommand::CancelIntents {
                agent: batched_agent.index_u32(),
            },
        );
        drain_only(&mut batched);

        assert_eq!(
            split.save_snapshot(),
            batched.save_snapshot(),
            "render-frame batching must not become simulation or save state"
        );
        assert!(split.world().get::<Eating>(split_agent).is_none());
        assert!(batched.world().get::<Eating>(batched_agent).is_none());
    }

    #[test]
    fn a_cancel_then_a_use_in_one_batch_replaces_the_queue_rather_than_appending_to_it() {
        // **The shape a plain left click now sends** - [I3] in
        // `docs/specs/2026-07-30-selection-and-input-design.md`. The shell
        // enqueues `CancelIntents` immediately followed by `UseObject`, and
        // the pair is a REPLACE only because both land in the same drain,
        // in that order. Nothing in `SimCommand` says so; this is where the
        // claim lives.
        //
        // `two_commands_in_one_tick_apply_in_the_order_the_player_issued_them`
        // already touches the same pair, and deliberately does not replace
        // this: there the agent's queue is empty when the cancel arrives,
        // so "the cancel emptied it" and "there was nothing in it" agree on
        // every number. The redirect only means something against a sim
        // that is already under orders and already walking, which is what
        // this fixture builds and what its preconditions assert.
        //
        // Three separate effects, because a partial replace is the
        // dangerous outcome and each fails differently:
        //
        //   - the queue holds exactly the NEW intent. Drop the cancel and
        //     it holds two, which is the append this decision reversed.
        //   - the old object is released. Send the two in the other order
        //     and the cancel wipes the intent the use just staged, so the
        //     sim is left with nothing queued at all - the opposite bug,
        //     and the one a naive "cancel afterwards" would produce.
        //   - the new intent is served on this same tick, so the redirect
        //     is visible immediately rather than a tick later.
        let (mut sim, bed, fridge, agent) = scenario();

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: bed.index_u32(),
                interaction: 0,
            },
        );
        sim.tick();

        // Preconditions. Without these, "the queue holds one intent" is
        // satisfied by a sim that was never directed anywhere in the first
        // place, and "the bed was released" by a bed never reserved.
        assert_eq!(
            queue_of(&sim, agent).len(),
            1,
            "the sim must already be under orders, or there is nothing for \
             the redirect to replace"
        );
        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(bed),
            "and it must be on its way to the bed"
        );
        assert!(sim.world().get::<Reserved>(bed).is_some());

        enqueue(
            &mut sim,
            SimCommand::CancelIntents {
                agent: agent.index_u32(),
            },
        );
        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: fridge.index_u32(),
                interaction: 0,
            },
        );
        sim.tick();

        let queue = queue_of(&sim, agent);
        assert_eq!(
            queue.len(),
            1,
            "a cancel followed by a use must leave exactly the new \
             instruction; two entries means the cancel did not run and the \
             click appended, which is the behaviour [I3] replaced"
        );
        assert_eq!(
            queue.front().map(|intent| intent.object),
            Some(fridge),
            "and the one entry must be the NEW object; the bed still being \
             at the front means the two commands were applied out of order"
        );
        assert!(
            sim.world().get::<Reserved>(bed).is_none(),
            "the abandoned object must be released, or the bed stays \
             claimed by a sim that is not coming"
        );
        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(fridge),
            "and the redirect must take effect on the tick it arrives, not \
             on the next one"
        );
    }

    #[test]
    fn the_reverse_order_does_not_replace_and_is_why_the_shell_sends_cancel_first() {
        // **The counterfactual for the test above, and the reason the
        // ordering is load-bearing rather than tidy.**
        //
        // `UseObject` then `CancelIntents` is the same two commands in the
        // other order, and it leaves the sim with NOTHING queued: the
        // cancel's staged clear and `queue.clear()` both see the intent
        // the use has just staged, so the redirect cancels itself. A shell
        // that emitted the pair the wrong way round would look like clicks
        // being ignored at random, and the drain would be behaving exactly
        // as documented.
        //
        // Asserted here rather than left as a reading of the source,
        // because "the order matters" is a claim about two runs and only
        // one of them is pinned above.
        let (mut sim, bed, fridge, agent) = scenario();

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: bed.index_u32(),
                interaction: 0,
            },
        );
        sim.tick();
        assert_eq!(
            queue_of(&sim, agent).len(),
            1,
            "the sim must be under orders, matching the fixture above"
        );

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: fridge.index_u32(),
                interaction: 0,
            },
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
            "use-then-cancel must leave the queue EMPTY; if this ever \
             starts leaving the new intent behind, the two orders have \
             become interchangeable and the shell's ordering stops being \
             the thing that makes a click a redirect"
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
                interaction: 0,
            },
        );
        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: bed.index_u32(),
                interaction: 0,
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
                interaction: 0,
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
        // The index the click sent, all the way through to the commitment.
        // Interaction 0 is what the shipped game sends and it is what this
        // must stay; the NON-zero half of the same claim is
        // `a_use_object_naming_the_second_interaction_runs_the_second_one`
        // below, and neither statement implies the other.
        assert_eq!(
            target_of(&sim, agent).map(|t| t.interaction),
            Some(0),
            "a plain click sends interaction 0 and the target must hold it"
        );
    }

    #[test]
    fn a_use_object_naming_the_second_interaction_runs_the_second_one() {
        // **The end-to-end claim of this whole change, through the real
        // schedule rather than through `drain_only`.** A drain that stored
        // the index faithfully and a `serve_intents` that ignored it would
        // both satisfy the drain-level test above; only running the tick
        // pipeline says which interaction actually happened.
        //
        // Three independent measurements, because the index is not
        // observable in itself - only in what running it DOES, and any one
        // of the three could agree with interaction 0 by coincidence:
        //
        //   1. the index the sim is COMMITTED to, in `Eating` and `Target`;
        //   2. how long it runs, which is interaction 1's duration and not
        //      interaction 0's - the fixture pins `duration_variance` to
        //      zero precisely so the two lengths cannot overlap;
        //   3. **the need that moved**, which is the one a hardcoded 0
        //      cannot satisfy under any circumstances: interaction 0
        //      advertises `fun` and interaction 1 advertises `comfort`, so
        //      running the wrong one fills the wrong bar. `fun` is asserted
        //      to have FALLEN, not merely to be unchanged, because it
        //      decays every tick and "unchanged" would be a claim the
        //      simulation cannot produce.
        let (mut sim, desk, _fridge, agent) = two_verb_scenario();
        let fun_before = level(&sim, agent, FIRST.0);
        let comfort_before = level(&sim, agent, SECOND.0);

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: desk.index_u32(),
                interaction: 1,
            },
        );

        let began = tick_until_interacting(&mut sim, agent);
        let eating = *sim
            .world()
            .get::<Eating>(agent)
            .expect("tick_until_interacting returned, so this is present");
        assert_eq!(
            eating.interaction, 1,
            "the sim must be running the interaction the command named"
        );
        assert_eq!(
            target_of(&sim, agent).map(|t| t.interaction),
            Some(1),
            "and the target it is holding the desk under must agree; a \
             Target and an Eating that disagree would release the wrong \
             reservation on the way out"
        );
        // The `- 1` is the schedule, not slack. `follow_path` inserts
        // `Eating` and `tick_interactions` runs after it in the SAME tick,
        // so it has already decremented once by the time a whole `tick()`
        // returns and this can look. Asserted exactly rather than as a
        // range, so reordering those two systems fails here.
        assert_eq!(
            eating.remaining_ticks,
            SECOND.2 - 1,
            "the interaction must be interaction 1's length; interaction \
             0 declares {} ticks and would be visibly shorter",
            FIRST.2
        );

        // Run it out. Bounded by interaction 1's own length plus slack, so
        // a loop that never terminated would fail rather than hang - [L15].
        let mut ran = 0;
        for _ in 0..SECOND.2 + 8 {
            if sim.world().get::<Eating>(agent).is_none() {
                break;
            }
            sim.tick();
            ran += 1;
        }
        assert!(
            sim.world().get::<Eating>(agent).is_none(),
            "the interaction must end; it began on tick {began} and was \
             still running {ran} ticks later"
        );
        assert!(
            ran > FIRST.2,
            "it must have run longer than interaction 0's {} ticks; it ran \
             {ran}, which is the length of the wrong verb",
            FIRST.2
        );

        let fun_after = level(&sim, agent, FIRST.0);
        let comfort_after = level(&sim, agent, SECOND.0);
        assert!(
            fun_after < fun_before,
            "interaction 0 advertises `fun` and it did not run, so `fun` \
             must only have decayed: {fun_before} -> {fun_after}"
        );
        let gained = comfort_after - comfort_before;
        assert!(
            gained > FIRST.1,
            "interaction 1 advertises {} of `comfort`, so the gain must \
             exceed interaction 0's {} delta; it was {gained}",
            SECOND.1,
            FIRST.1
        );
        assert!(
            gained <= SECOND.1,
            "and it cannot exceed what interaction 1 advertises, because \
             `comfort` decays alongside the refill; it was {gained}"
        );
    }

    /// Runs whole ticks until `agent` is actually mid-interaction, and
    /// returns how many that took.
    ///
    /// "Mid-interaction" is `Eating`, not "standing on the object's tile".
    /// The two look identical from outside the simulation and Task 8's play
    /// session initially conflated them, which made a click on an idle sim
    /// loitering on a tile look like a click being ignored for twelve
    /// seconds. They are different states and only one of them is busy.
    fn tick_until_interacting(sim: &mut Sim, agent: Entity) -> u32 {
        for elapsed in 1..=200 {
            sim.tick();
            if sim.world().get::<Eating>(agent).is_some() {
                return elapsed;
            }
        }
        panic!("the agent never began an interaction");
    }

    /// **A click interrupts an interaction that is already running.**
    ///
    /// This is the question Task 8's play session raised and could not
    /// settle from outside: interrupting a sim mid-action measured anywhere
    /// from 1 to 18 ticks, and the fridge cases clustered suspiciously
    /// close to its own sampled duration - which is exactly what "the click
    /// waits politely for the action to finish" would look like.
    ///
    /// It does not wait. `serve_intents` removes `Eating` and installs the
    /// new `Target` and `Path` on the tick the command arrives, and this
    /// asserts that rather than leaving it as a reading of the source.
    ///
    /// **Why it matters beyond responsiveness.**
    /// `docs/specs/2026-07-29-multi-step-interactions-design.md` [M-4]
    /// rests on this: if a click preempts, then terminal-only satisfaction
    /// means a mis-click can destroy a whole cooking chain, and chain
    /// progress has to be stored state that survives interruption. If a
    /// click queued instead, that tension would not exist. The design
    /// depends on which of the two this is, so it is pinned here.
    ///
    /// Three assertions, because preemption is three separate effects and a
    /// partial one is the dangerous outcome: dropping `Eating` without
    /// re-targeting freezes the sim, and re-targeting without releasing the
    /// old reservation leaks a claim on the fridge for ever.
    #[test]
    fn a_click_preempts_an_interaction_already_running() {
        let (mut sim, bed, fridge, agent) = scenario();

        let elapsed = tick_until_interacting(&mut sim, agent);
        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(fridge),
            "autonomy must have taken the fridge, or the interruption below \
             is interrupting nothing"
        );
        assert!(
            elapsed < DURATION,
            "the fixture must interrupt an interaction with time left on it; \
             the agent took {elapsed} ticks to start one that lasts {DURATION}"
        );

        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: agent.index_u32(),
                object: bed.index_u32(),
                interaction: 0,
            },
        );
        sim.tick();

        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(bed),
            "a click must retarget a busy sim on the tick it arrives, not \
             when the sim happens to finish what it was doing"
        );
        assert!(
            sim.world().get::<Eating>(agent).is_none(),
            "the abandoned interaction must end; an `Eating` left behind \
             alongside a new Target is a sim that is both walking and using \
             something"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_none(),
            "the abandoned object must be released, or it stays claimed by \
             a sim that is never coming back"
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
                interaction: 0,
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
                    interaction: 0,
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
