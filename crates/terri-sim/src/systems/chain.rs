//! The multi-step chain runtime - [K4] in
//! docs/specs/2026-08-01-m2f-multi-step-working-design.md.
//!
//! Two systems around one component. `advance_chains` is the TARGETING
//! half: any idle sim holding a [`ChainState`] is sent to its current
//! step's station - which is also the whole of RESUME, because a
//! preempted chain's counter survives and the sim simply comes back to
//! it when it is next free. `tick_chain_steps` is the CLOCK half: it
//! runs the step at the station, moves the item through the sim's
//! hands, and pays the whole chain at the terminal step's completion
//! and nowhere else ([M-1]).
//!
//! Walking and arrival deliberately reuse the one mover: a chain walk
//! is a `Target` whose interaction is [`CHAIN_STEP`], the sentinel
//! `follow_path` converts into [`StepWork`] instead of `Eating`. The
//! wire cannot produce the sentinel - `serve_intents` range-checks
//! every player index against real rows before anything targets.

use bevy_ecs::prelude::*;
use terri_core::{
    Agent, AtWork, Blocked, Carrying, ChainState, Commuting, Eating, Hobbies, IntentQueue, NeedId,
    Needs, Path, Personality, Position, Reserved, Restless, Satisfaction, SmartObject, Socialising,
    StepWork, Target, TileGrid, Traits,
};

use super::advertise::scaled_delta;
use crate::Content;

/// `Target::interaction`'s chain-step sentinel. Out of band by
/// construction: `serve_intents` drops any player index at or past the
/// real row count before it can become a Target, and selection only
/// writes indices it read out of the pack.
pub const CHAIN_STEP: u32 = u32::MAX;

/// Sends every idle chain-holder to its current step's station.
///
/// Runs directly after `select_action`: a freshly selected chain (the
/// counter inserted this tick, by selection or by a player's flyout
/// click) gets its first walk on the same tick, exactly as a selected
/// fridge does - and a sim whose interruption just ended gets its
/// resume walk the same way, because this system cannot tell the two
/// apart and should not.
///
/// The station is the NEAREST placed object wearing the step's role
/// that is not reserved, by path length with entity index as the tie
/// break - resolved fresh each time on purpose ([K4]'s rejection of
/// pre-expanded intents): the nearest free table when the plate is
/// ready, not when the fridge was opened. All stations reserved means
/// WAIT, the standing [C3] answer, with `Blocked` saying why.
#[allow(clippy::type_complexity)]
pub fn advance_chains(
    mut commands: Commands,
    grid: Res<TileGrid>,
    content: Res<Content>,
    idle: Query<
        (Entity, &Position, Option<&IntentQueue>, &ChainState),
        (
            With<Agent>,
            Without<Target>,
            Without<Path>,
            Without<Eating>,
            Without<Socialising>,
            Without<StepWork>,
            Without<Commuting>,
            Without<AtWork>,
        ),
    >,
    stations: Query<(Entity, &Position, &SmartObject, Has<Reserved>)>,
) {
    // Entity order: stations are claimed within this loop, so which
    // sim gets the last free counter must be a function of world state.
    let mut resuming: Vec<Entity> = idle
        .iter()
        // A queued player intent outranks the resume - serve_intents
        // will act on it this tick, and targeting here as well would
        // hand the sim two walks at once.
        .filter(|(_, _, queue, _)| queue.is_none_or(|q| q.is_empty()))
        .map(|(entity, _, _, _)| entity)
        .collect();
    resuming.sort_by_key(|entity| entity.index());

    // This tick's claims, the same within-tick truth select_action's
    // people loop keeps: deferred commands make a reservation invisible
    // to this same run.
    let mut claimed: Vec<Entity> = Vec::new();

    for sim in resuming {
        let Ok((_, pos, _, chain_state)) = idle.get(sim) else {
            continue;
        };
        let chain = &content.0.chains[chain_state.chain as usize];
        let step = &chain.steps[chain_state.step as usize];
        let from = (pos.x.round() as i32, pos.y.round() as i32);

        // The nearest free station wearing the role, by real path
        // length - a straight-line pick could name a counter through a
        // wall. Reserved stations are skipped rather than waited on if
        // a free one exists anywhere; only a fully-booked role waits.
        let mut best: Option<(Entity, Vec<(i32, i32)>)> = None;
        let mut any_station = false;
        let mut in_order: Vec<(Entity, &Position, &SmartObject, bool)> = stations.iter().collect();
        in_order.sort_by_key(|(entity, ..)| entity.index());
        for (station, station_pos, object, reserved) in in_order {
            let def = content.0.object(object.0);
            if !def.roles.contains(&step.role) {
                continue;
            }
            any_station = true;
            if reserved || claimed.contains(&station) {
                continue;
            }
            let to = (station_pos.x.round() as i32, station_pos.y.round() as i32);
            let Some(steps) = grid.find_path_adjacent(from, to, def.footprint) else {
                continue;
            };
            let shorter = match &best {
                Some((_, best_steps)) => steps.len() < best_steps.len(),
                None => true,
            };
            if shorter {
                best = Some((station, steps));
            }
        }

        match best {
            Some((station, steps)) => {
                claimed.push(station);
                commands.entity(station).insert(Reserved);
                commands.entity(sim).remove::<Restless>().insert((
                    Target {
                        object: station,
                        interaction: CHAIN_STEP,
                    },
                    Path { steps, cursor: 0 },
                ));
            }
            // Somebody is at every station (or none is reachable, which
            // shipped content cannot express - the coverage rule). The
            // sim stands and waits, saying why, and tries again next
            // tick - the fridge-queue behaviour, inherited on purpose.
            None if any_station => {
                commands.entity(sim).insert(Blocked);
            }
            None => {}
        }
    }
}

/// Runs the step at the station, and pays the chain when it ends.
///
/// The delivery mirrors `tick_interactions`' composition exactly, once,
/// at the terminal completion: benefits scale by the personality's
/// per-need satisfaction and by a fumble's `delta_scale`, costs land
/// whole (`scaled_delta`, the standing rule). Habituation bumps against
/// the ADVERTISER under the chain's flyout row - `interactions.len() +
/// chain index`, [K5]'s mapping - so a sim tires of dinner as a WHOLE
/// rather than of any station. The hobby payout reads the union of
/// every step's tags: loving cooking makes the dinner loved, even
/// though the tag lives on the hob step.
///
/// A fumble RIDES from the tagged step it was rolled at to the terminal
/// delivery ([K4]): Nadia serves the dinner she ruined, is fed almost
/// nothing by it, paid nothing for it - and learned at the hob, where
/// `learn_and_manage` fires on the tagged step's own completion.
#[allow(clippy::type_complexity)]
pub fn tick_chain_steps(
    mut commands: Commands,
    content: Res<Content>,
    mut working: Query<
        (
            Entity,
            &mut ChainState,
            &mut StepWork,
            &mut Needs,
            Option<&Target>,
            Option<&Personality>,
            Option<&Hobbies>,
            Option<&mut Satisfaction>,
            Option<&mut Traits>,
            Option<&Carrying>,
        ),
        With<Agent>,
    >,
) {
    let mut at_work: Vec<Entity> = working.iter().map(|(entity, ..)| entity).collect();
    at_work.sort_by_key(|entity| entity.index());

    for sim in at_work {
        let Ok((
            _,
            mut chain_state,
            mut step_work,
            mut needs,
            target,
            personality,
            hobbies,
            satisfaction,
            mut traits,
            carrying,
        )) = working.get_mut(sim)
        else {
            continue;
        };
        step_work.remaining_ticks -= 1;
        if step_work.remaining_ticks > 0 {
            continue;
        }

        let chain = &content.0.chains[chain_state.chain as usize];
        let step = &chain.steps[chain_state.step as usize];
        let terminal = chain_state.step as usize + 1 == chain.steps.len();

        // The hands, first: the step's whole observable effect below
        // the terminal. Compile's hands rule proved the bookkeeping, so
        // the runtime applies it without re-deriving - a mismatch here
        // would mean the pack gate was removed, not that this needs a
        // guard.
        if let Some(kind) = step.yields {
            commands.entity(sim).insert(Carrying(kind));
        } else if let Some((_, to)) = step.transforms {
            commands.entity(sim).insert(Carrying(to));
        } else if step.consumes.is_some() {
            commands.entity(sim).remove::<Carrying>();
        }
        let _ = carrying;

        // Tagged steps teach and manage at their OWN completion, the
        // [E3] rule unchanged - the lesson does not wait for dessert.
        if !step.tags.is_empty() {
            if let Some(traits) = traits.as_deref_mut() {
                super::trait_effects::learn_and_manage(traits, content.0, &step.tags);
            }
        }

        // The station is released either way: done with the counter is
        // done with the counter.
        if let Some(target) = target {
            commands.entity(target.object).try_remove::<Reserved>();
        }
        commands.entity(sim).remove::<Target>().remove::<StepWork>();

        if !terminal {
            chain_state.step += 1;
            continue;
        }

        // The terminal payoff, whole, once - [M-1]. Delivery composes
        // exactly as tick_interactions' does; the fumble - carried in
        // the counter itself, preemption-proof - scales benefits only
        // and zeroes the satisfaction.
        let fumble = chain_state.fumble_scale;
        for (need_index, delta) in &chain.advertises {
            let per_need = personality.map_or(1.0, |p| p.satisfaction[*need_index as usize]);
            let delta = scaled_delta(*delta, per_need * fumble);
            needs.fill(NeedId::ALL[*need_index as usize], delta);
        }

        // Habituation against the advertiser, under the chain's flyout
        // row: the sim tires of DINNER, not of the table.
        let row = content.0.object(chain.advertised_by).interactions.len() as u32
            + chain_position(content.0, chain_state.chain);
        commands.queue({
            let advertiser = chain.advertised_by;
            let per_use = content.0.tuning.habituation_per_use;
            // Insert-if-absent, the tick_interactions rule: an agent
            // gains the component the first time it finishes anything,
            // and a fresh sim's first dinner must leave a record too.
            move |world: &mut World| match world.get_mut::<terri_core::Habituation>(sim) {
                Some(mut habituation) => habituation.bump(advertiser, row, per_use),
                None => {
                    let mut fresh = terri_core::Habituation::default();
                    fresh.bump(advertiser, row, per_use);
                    if let Ok(mut entity) = world.get_entity_mut(sim) {
                        entity.insert(fresh);
                    }
                }
            }
        });

        if let Some(mut satisfaction) = satisfaction {
            if !chain_state.fumbled() {
                let tags = chain_tags(chain);
                let payout =
                    super::satisfaction::hobby_payout(
                        chain.satisfaction,
                        &tags,
                        hobbies,
                        content.0.tuning.hobby_multiplier,
                    ) * super::trait_effects::condition_accrual_scale(traits.as_deref(), content.0);
                satisfaction.add(payout);
            }
        }

        commands.entity(sim).remove::<ChainState>();
    }
}

/// The chain's position among its advertiser's chains - the second
/// half of [K5]'s flyout row `interactions.len() + position`.
/// `pub(crate)` for its unit test: the row arithmetic survived a
/// sweep unconstrained while only integration outcomes were pinned.
pub(crate) fn chain_position(pack: &terri_data::ContentPack, chain: u32) -> u32 {
    let advertiser = pack.chains[chain as usize].advertised_by;
    pack.chains[..chain as usize]
        .iter()
        .filter(|c| c.advertised_by == advertiser)
        .count() as u32
}

/// The union of every step's tags, first-appearance order, no
/// repeats - what the hobby payout and the disposition multiplier
/// both read: loving cooking makes the dinner loved, wherever the
/// tag sits. ONE function for both consumers ([S4]'s one-mechanism
/// discipline applied to a Vec), with its own unit test because both
/// consumers happen to be duplicate-insensitive and a sweep proved
/// that leaves every line here unconstrained.
pub(crate) fn chain_tags(chain: &terri_data::CompiledChain) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    for step in &chain.steps {
        for tag in &step.tags {
            if !tags.contains(tag) {
                tags.push(tag.clone());
            }
        }
    }
    tags
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_content;
    use crate::Sim;
    use terri_core::{Agent, CommandQueue, NEED_MAX};
    use terri_data::{CompiledChain, CompiledChainStep, ContentPack};

    /// A two-step chain over two roles with pairwise distinct numbers:
    /// fetch at the pantry (yields kind 0), eat at the table (consumes
    /// it, tagged so trait tests can hang a roll off it). Terminal
    /// deltas distinct per need ([L34]).
    fn a_chain() -> CompiledChain {
        CompiledChain {
            id: "cook_dinner".to_string(),
            label: "Cook dinner".to_string(),
            advertised_by: terri_data::ObjectDefId(0),
            advertises: vec![(0, 48.0), (6, 12.0)],
            satisfaction: 2.5,
            steps: vec![
                CompiledChainStep {
                    role: 0,
                    label: "Fetch".to_string(),
                    duration_ticks: 16,
                    tags: vec![],
                    yields: Some(0),
                    transforms: None,
                    consumes: None,
                },
                CompiledChainStep {
                    role: 1,
                    label: "Eat".to_string(),
                    duration_ticks: 20,
                    tags: vec!["cooking".to_string()],
                    yields: None,
                    transforms: None,
                    consumes: Some(0),
                },
            ],
        }
    }

    /// A pack whose object 0 is the roleless snack fridge and whose
    /// objects 1 and 2 wear the chain's two roles - built through the
    /// data layer's own types, zero variance so nothing here rides a
    /// draw, decisive temperature where a test names a winner.
    fn chain_pack() -> &'static ContentPack {
        let mut pantry = test_content::object_offering("pantry", vec![]);
        pantry.roles = vec![0];
        let mut table = test_content::object_offering("table", vec![]);
        table.roles = vec![1];
        let fridge = test_content::object("fridge", &[(terri_core::NeedId::Hunger, 40.0)], 30);
        let base = test_content::pack_tuned(
            vec![fridge, pantry, table],
            terri_data::Tuning {
                duration_variance: 0.0,
                choice_temperature: 0.0001,
                ..test_content::tuning()
            },
        );
        Box::leak(Box::new(ContentPack {
            roles: vec!["pantry_shelf".to_string(), "eating_surface".to_string()],
            item_kinds: vec!["dinner".to_string()],
            chains: vec![a_chain()],
            ..base.clone()
        }))
    }

    /// The world: the three stations placed apart on an open grid, one
    /// hungry agent. Returns (sim, agent, pantry, table).
    fn chain_world() -> (Sim, Entity, Entity, Entity) {
        let pack = chain_pack();
        let mut sim = test_content::sim_with(12, 8, pack);
        let spawn_station = |sim: &mut Sim, id: &str, x: f32, y: f32| {
            let def = pack.find(id).expect("fixture");
            sim.world_mut()
                .spawn((Position { x, y }, SmartObject(def)))
                .id()
        };
        let _fridge = spawn_station(&mut sim, "fridge", 1.0, 1.0);
        let pantry = spawn_station(&mut sim, "pantry", 4.0, 1.0);
        let table = spawn_station(&mut sim, "table", 8.0, 1.0);
        let mut needs = Needs::all_at(80.0);
        needs.set(NeedId::Hunger, 20.0);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 4.0 },
                needs,
                Satisfaction::default(),
                terri_core::Hobbies(vec!["cooking".to_string()]),
            ))
            .id();
        (sim, agent, pantry, table)
    }

    fn start_chain(sim: &mut Sim, agent: Entity) {
        sim.world_mut()
            .entity_mut(agent)
            .insert(ChainState::begin(0));
    }

    /// The whole errand, end to end: the counter walks the sim through
    /// both stations, the item appears and is consumed, and the payoff
    /// lands ONCE at the terminal completion - needs jump by the
    /// terminal deltas and satisfaction by the loved payout - with
    /// nothing delivered before it ([M-1]).
    #[test]
    fn a_chain_runs_both_stations_and_pays_only_at_the_end() {
        let (mut sim, agent, pantry, table) = chain_world();
        start_chain(&mut sim, agent);

        let mut saw_carrying = false;
        let mut hunger_before_terminal = 0.0f32;
        for _ in 0..200 {
            sim.tick();
            let world = sim.world();
            if world.get::<terri_core::Carrying>(agent).is_some() {
                saw_carrying = true;
            }
            let mid_chain = world.get::<ChainState>(agent).is_some();
            if mid_chain {
                hunger_before_terminal = world.get::<Needs>(agent).unwrap().get(NeedId::Hunger);
            } else {
                // Done. Everything lands here, at once.
                let needs = world.get::<Needs>(agent).unwrap();
                assert!(
                    needs.get(NeedId::Hunger) > hunger_before_terminal + 40.0,
                    "the terminal step delivers the WHOLE hunger payoff; \
                     before {} after {}",
                    hunger_before_terminal,
                    needs.get(NeedId::Hunger)
                );
                assert!(
                    saw_carrying,
                    "the dinner must have been in hand between the stations"
                );
                assert!(
                    world.get::<terri_core::Carrying>(agent).is_none(),
                    "consumed at the table"
                );
                let paid = world.get::<Satisfaction>(agent).unwrap().value();
                let expected = 2.5 * test_content::tuning().hobby_multiplier;
                assert!(
                    (paid - expected).abs() < 0.001,
                    "a loved dinner pays base times the hobby multiplier; \
                     got {paid}, expected {expected}"
                );
                assert!(
                    world.get::<Reserved>(pantry).is_none()
                        && world.get::<Reserved>(table).is_none(),
                    "every station released"
                );
                return;
            }
            // Mid-chain the payoff must NOT have landed: hunger only
            // decays until the table.
            assert!(
                hunger_before_terminal < 25.0,
                "nothing delivers before the terminal step; hunger read {}",
                hunger_before_terminal
            );
        }
        panic!("the chain never completed");
    }

    /// RESUME - [K4]'s option three, the milestone's headline. A player
    /// command lands mid-chain; the step is dropped, the errand is not:
    /// when the snack is done the sim returns to its chain unprompted
    /// and finishes it.
    #[test]
    fn a_player_command_interrupts_and_the_chain_resumes() {
        let (mut sim, agent, _pantry, _table) = chain_world();
        start_chain(&mut sim, agent);
        // Let the errand get under way.
        for _ in 0..10 {
            sim.tick();
        }
        assert!(
            sim.world().get::<ChainState>(agent).is_some(),
            "precondition: mid-chain"
        );

        // The interruption: eat a snack at the fridge, by command.
        let fridge = {
            let world = sim.world_mut();
            let mut state = world.query::<(Entity, &SmartObject)>();
            state
                .iter(world)
                .find(|(_, o)| o.0 == terri_data::ObjectDefId(0))
                .map(|(e, _)| e)
                .expect("the fixture placed a fridge")
        };
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(terri_core::SimCommand::UseObject {
                agent: agent.index_u32(),
                object: fridge.index_u32(),
                interaction: 0,
            });

        let mut snacked = false;
        for _ in 0..400 {
            sim.tick();
            let world = sim.world();
            if world.get::<Eating>(agent).is_some() {
                snacked = true;
                assert!(
                    world.get::<ChainState>(agent).is_some(),
                    "the counter survives the player's snack"
                );
            }
            if snacked && world.get::<ChainState>(agent).is_none() {
                // Resumed and finished after the interruption.
                assert!(
                    world.get::<Satisfaction>(agent).unwrap().value() > 0.0,
                    "the resumed chain paid out"
                );
                return;
            }
        }
        panic!("interrupted chain never resumed and completed (snacked: {snacked})");
    }

    /// CANCEL abandons - the one destructive path. Counter, item and
    /// station reservation all gone, nothing paid.
    #[test]
    fn a_cancel_abandons_the_chain_whole() {
        let (mut sim, agent, pantry, table) = chain_world();
        start_chain(&mut sim, agent);
        for _ in 0..25 {
            sim.tick();
        }
        assert!(
            sim.world().get::<ChainState>(agent).is_some(),
            "precondition: mid-chain"
        );

        sim.world_mut().resource_mut::<CommandQueue>().push(
            terri_core::SimCommand::CancelIntents {
                agent: agent.index_u32(),
            },
        );
        sim.tick();

        let world = sim.world();
        assert!(world.get::<ChainState>(agent).is_none(), "counter gone");
        assert!(
            world.get::<terri_core::Carrying>(agent).is_none(),
            "hands emptied"
        );
        assert!(
            world.get::<terri_core::StepWork>(agent).is_none(),
            "no step keeps running"
        );
        assert_eq!(
            world.get::<Satisfaction>(agent).unwrap().value(),
            0.0,
            "an abandoned dinner pays nothing"
        );
        // One more tick for deferred releases, then no station may
        // stay claimed by a sim that is no longer coming.
        sim.tick();
        let world = sim.world();
        let stale =
            world.get::<Reserved>(pantry).is_some() && world.get::<ChainState>(agent).is_none();
        assert!(!stale, "the pantry must not stay reserved");
        let _ = table;
    }

    /// The fumble rides IN the counter: a level-0 cook fumbles the
    /// tagged step, the terminal delivery scales to nothing, no
    /// satisfaction lands - and the counter's record survives where
    /// the transient marker would have been cleared.
    #[test]
    fn a_fumbled_step_ruins_the_terminal_delivery() {
        let (mut sim, agent, _pantry, _table) = chain_world();
        // A hopeless cook: level 0, fail scale 0 - the roll cannot
        // pass, so the test is about machinery rather than a seed.
        let pack = sim
            .world()
            .get_resource::<crate::Content>()
            .expect("content installed")
            .0;
        let pack = Box::leak(Box::new(ContentPack {
            traits: vec![terri_data::CompiledTrait {
                id: "cannot_cook".to_string(),
                label: "Can't cook".to_string(),
                tag: "cooking".to_string(),
                kind: terri_data::CompiledTraitKind::Capability {
                    start_level: 0.0,
                    fail_delta_scale: 0.0,
                    learn_per_attempt: 0.015,
                },
            }],
            ..pack.clone()
        }));
        sim.world_mut().insert_resource(crate::Content(pack));
        sim.world_mut()
            .entity_mut(agent)
            .insert(Traits::from_entries(vec![(0, 0.0)]));
        start_chain(&mut sim, agent);

        for _ in 0..200 {
            sim.tick();
            let world = sim.world();
            if let Some(state) = world.get::<ChainState>(agent) {
                if state.fumbled() {
                    // The record is in the counter, where preemption
                    // cannot clear it.
                    assert_eq!(state.fumble_scale, 0.0);
                }
            } else {
                let world = sim.world();
                let hunger = world.get::<Needs>(agent).unwrap().get(NeedId::Hunger);
                assert!(
                    hunger < 25.0,
                    "a fail scale of 0 must deliver nothing of the dinner; \
                     hunger read {hunger}"
                );
                assert_eq!(
                    world.get::<Satisfaction>(agent).unwrap().value(),
                    0.0,
                    "a ruined dinner feeds nobody's soul"
                );
                let level = world.get::<Traits>(agent).unwrap().state(0).expect("worn");
                assert!(
                    level > 0.0,
                    "and yet the tagged step taught at its own completion"
                );
                return;
            }
        }
        panic!("the fumbled chain never completed");
    }

    // ---- The scoring sandwich -----------------------------------------
    //
    // The sweep's largest cluster: every operator in the chain-scoring
    // block survived, because the outcome tests never pinned the
    // NUMBER. The kill is a sandwich: the expected score is computed
    // IN THE TEST from the same public pieces selection composes
    // (benefit_scale, disposition_multiplier, scaled_delta,
    // score_advertisement) against exactly known geometry, and the
    // pack's action_threshold is then set fractionally below it (must
    // choose), fractionally above it (must not), and exactly at it
    // (must not - the strict `>`). Any mutant that moves the score by
    // a fifth of a percent in either direction flips one slice. The
    // fixture deliberately engages every term: two steps for the
    // duration sum, two advertised needs on distinct non-1 personality
    // satisfactions, a 0.5 trait disposition on a step tag, and a leg
    // with both axes nonzero.

    /// The scoring world: fridge (advertiser, NO interactions of its
    /// own so the chain is the only candidate), pantry and table
    /// wearing the two roles, a decoy chain declared FIRST and
    /// advertised by the pantry so the target chain's global index (1)
    /// differs from its local row (0). Returns everything the expected
    /// score needs.
    fn scoring_world(threshold_of: impl Fn(f32) -> f32) -> (Sim, Entity, u32) {
        // Pass 1: a probe pack to measure the score with a threshold
        // low enough that measurement is possible... instead computed
        // analytically below - one pass, no probe.
        let mut pantry = test_content::object_offering("pantry", vec![]);
        pantry.roles = vec![0];
        let mut table = test_content::object_offering("table", vec![]);
        table.roles = vec![1];
        let fridge = test_content::object_offering("fridge", vec![]);

        let mut decoy = a_chain();
        decoy.id = "decoy".to_string();
        decoy.advertised_by = terri_data::ObjectDefId(1);
        let target = a_chain();

        // Geometry, exactly known: agent at (2, 4), fridge at (2, 1)
        // (walk 2 - find_path_adjacent stops beside it), pantry at
        // (5, 2) and table at (9, 5) so the one leg is |5-9| + |2-5|
        // = 7 with both axes engaged.
        let agent_tile = (2i32, 4i32);
        let fridge_tile = (2i32, 1i32);
        let leg = 7.0f32;

        let hunger_start = 30.0f32;
        let comfort_start = 55.0f32;
        let hunger_rate = test_content::decay_per_tick(NeedId::Hunger);
        let comfort_rate = test_content::decay_per_tick(NeedId::Comfort);

        // The walk, measured on the same grid selection will use.
        let grid = terri_core::TileGrid::new(12, 8);
        let steps = grid
            .find_path_adjacent(agent_tile, fridge_tile, terri_data::Footprint::SINGLE)
            .expect("open grid");
        let distance = steps.len() as f32;

        let total_duration: u32 = target.steps.iter().map(|s| s.duration_ticks).sum();
        let trait_disposition = 0.5f32;
        let sat_hunger = 1.25f32;
        let sat_comfort = 0.75f32;
        // benefit_scale(0, floor) is 1, archetype dispositions absent
        // are 1, so the slot is the trait disposition alone.
        let scale = trait_disposition;
        let mut expected = 0.0f32;
        for (need, delta, start, rate, sat) in [
            (
                NeedId::Hunger,
                48.0f32,
                hunger_start,
                hunger_rate,
                sat_hunger,
            ),
            (
                NeedId::Comfort,
                12.0,
                comfort_start,
                comfort_rate,
                sat_comfort,
            ),
        ] {
            // Selection runs after one decay tick.
            let level = start - rate;
            let deficit = (NEED_MAX - level) / NEED_MAX;
            let delta = crate::systems::advertise::scaled_delta(delta, scale * sat);
            expected += crate::systems::advertise::score_advertisement(
                deficit,
                delta,
                total_duration,
                distance + leg,
            );
            let _ = need;
        }

        let base = test_content::pack_tuned(
            vec![fridge, pantry, table],
            terri_data::Tuning {
                duration_variance: 0.0,
                choice_temperature: 0.0001,
                idle_threshold: 0.0,
                action_threshold: threshold_of(expected),
                ..test_content::tuning()
            },
        );
        let pack: &'static ContentPack = Box::leak(Box::new(ContentPack {
            roles: vec!["pantry_shelf".to_string(), "eating_surface".to_string()],
            item_kinds: vec!["dinner".to_string()],
            chains: vec![decoy, target],
            traits: vec![terri_data::CompiledTrait {
                id: "wary_cook".to_string(),
                label: "Wary cook".to_string(),
                tag: "cooking".to_string(),
                kind: terri_data::CompiledTraitKind::Disposition {
                    score_multiplier: trait_disposition,
                },
            }],
            ..base.clone()
        }));

        let mut sim = test_content::sim_with(12, 8, pack);
        let spawn_station = |sim: &mut Sim, id: &str, x: f32, y: f32| {
            let def = pack.find(id).expect("fixture");
            sim.world_mut()
                .spawn((Position { x, y }, SmartObject(def)))
                .id()
        };
        spawn_station(&mut sim, "fridge", 2.0, 1.0);
        spawn_station(&mut sim, "pantry", 5.0, 2.0);
        spawn_station(&mut sim, "table", 9.0, 5.0);

        let mut needs = Needs::all_at(NEED_MAX);
        needs.set(NeedId::Hunger, hunger_start);
        needs.set(NeedId::Comfort, comfort_start);
        let mut satisfaction = [1.0f32; terri_core::NEED_COUNT];
        satisfaction[NeedId::Hunger.index()] = sat_hunger;
        satisfaction[NeedId::Comfort.index()] = sat_comfort;
        let personality = terri_core::Personality::with_dispositions(
            [1.0; terri_core::NEED_COUNT],
            satisfaction,
            vec![],
        );
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 4.0 },
                needs,
                personality,
                Traits::from_entries(vec![(0, 0.0)]),
                Satisfaction::default(),
            ))
            .id();
        // The target chain is global index 1: the decoy rides first.
        (sim, agent, 1)
    }

    /// The sandwich, all three slices: fractionally below the score
    /// chooses (and the STARTED chain is the right global index, the
    /// decoy filter working); fractionally above does not; exactly at
    /// it does not, because the comparison is strictly greater.
    #[test]
    fn chain_scoring_is_pinned_by_a_threshold_sandwich() {
        let (mut sim, agent, global) = scoring_world(|expected| expected * 0.998);
        sim.tick();
        let state = sim
            .world()
            .get::<ChainState>(agent)
            .expect("a score above the threshold starts the chain");
        assert_eq!(
            state.chain, global,
            "the committed chain is the advertiser's own, not the decoy"
        );

        // ONE tick for the negative slices, deliberately: the score
        // GROWS as needs decay, so a threshold set fractionally above
        // the tick-1 score is crossed honestly a few ticks later - the
        // first draft ran five ticks here and diagnosed its own
        // modelling as wrong. The expectation models tick 1; tick 1 is
        // what it pins.
        let (mut sim, agent, _) = scoring_world(|expected| expected * 1.002);
        sim.tick();
        assert!(
            sim.world().get::<ChainState>(agent).is_none(),
            "a score below the threshold starts nothing; started {:?}",
            sim.world().get::<ChainState>(agent)
        );

        let (mut sim, agent, _) = scoring_world(|expected| expected);
        sim.tick();
        assert!(
            sim.world().get::<ChainState>(agent).is_none(),
            "exactly at the threshold is not above it - the comparison \
             is strictly greater"
        );
    }

    /// The flyout arm resolves the same identity: a UseObject at the
    /// row past the advertiser's interactions starts the advertiser's
    /// FIRST chain - global index 1 past the decoy - through the
    /// untouched wire.
    #[test]
    fn a_use_object_row_starts_the_advertisers_chain_not_the_decoys() {
        let (mut sim, agent, global) = scoring_world(|expected| expected * 10.0);
        let fridge = {
            let world = sim.world_mut();
            let mut state = world.query::<(Entity, &SmartObject)>();
            state
                .iter(world)
                .find(|(_, o)| o.0 == terri_data::ObjectDefId(0))
                .map(|(e, _)| e)
                .expect("the fixture placed a fridge")
        };
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(terri_core::SimCommand::UseObject {
                agent: agent.index_u32(),
                object: fridge.index_u32(),
                // The fixture fridge has NO interactions, so row 0 is
                // its first chain.
                interaction: 0,
            });
        sim.tick();
        let state = sim
            .world()
            .get::<ChainState>(agent)
            .expect("the row starts the chain");
        assert_eq!(state.chain, global);

        // And a row past the chains is a stale click: dropped, not a
        // panic and not the decoy.
        let (mut sim, agent, _) = scoring_world(|expected| expected * 10.0);
        let fridge = {
            let world = sim.world_mut();
            let mut state = world.query::<(Entity, &SmartObject)>();
            state
                .iter(world)
                .find(|(_, o)| o.0 == terri_data::ObjectDefId(0))
                .map(|(e, _)| e)
                .expect("fixture")
        };
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(terri_core::SimCommand::UseObject {
                agent: agent.index_u32(),
                object: fridge.index_u32(),
                interaction: 7,
            });
        sim.tick();
        assert!(
            sim.world().get::<ChainState>(agent).is_none(),
            "a row past the chains is dropped"
        );
    }

    /// The tag union, pinned directly: both consumers (hobby payout,
    /// disposition multiplier) are duplicate-insensitive, so only a
    /// unit test can see the union's own shape - first appearance
    /// order, every tag once, nothing invented.
    #[test]
    fn chain_tags_unions_step_tags_once_in_first_appearance_order() {
        let mut chain = a_chain();
        chain.steps[0].tags = vec!["cooking".to_string(), "baking".to_string()];
        chain.steps[1].tags = vec!["baking".to_string(), "plating".to_string()];
        assert_eq!(
            chain_tags(&chain),
            vec![
                "cooking".to_string(),
                "baking".to_string(),
                "plating".to_string()
            ]
        );
        chain.steps[0].tags.clear();
        chain.steps[1].tags.clear();
        assert!(chain_tags(&chain).is_empty());
    }

    /// The flyout-row arithmetic, pinned from positions 0 AND 1 with a
    /// decoy advertiser in between - a constant 0 fails the second, a
    /// constant 1 fails the first, and a broken advertiser filter
    /// counts the decoy.
    #[test]
    fn chain_position_counts_only_the_same_advertisers_earlier_chains() {
        let pack = chain_pack();
        let mut decoy = a_chain();
        decoy.id = "decoy".to_string();
        decoy.advertised_by = terri_data::ObjectDefId(1);
        let mut second = a_chain();
        second.id = "second".to_string();
        let pack = Box::leak(Box::new(ContentPack {
            chains: vec![pack.chains[0].clone(), decoy, second],
            ..pack.clone()
        }));
        assert_eq!(chain_position(pack, 0), 0, "the advertiser's first");
        assert_eq!(
            chain_position(pack, 2),
            1,
            "the decoy between them belongs to another advertiser"
        );
    }

    /// The NEAREST free station wins, and the fixture makes wrong
    /// comparisons visible: the FAR pantry is spawned first (lower
    /// entity index), so a pick that fell to entity order - or that
    /// relaxed the strictly-shorter rule - reserves the far one.
    #[test]
    fn the_nearest_free_station_is_picked_over_an_earlier_far_one() {
        let pack = chain_pack();
        let mut sim = test_content::sim_with(12, 8, pack);
        let def = pack.find("pantry").expect("fixture");
        let far = sim
            .world_mut()
            .spawn((Position { x: 10.0, y: 6.0 }, SmartObject(def)))
            .id();
        let near = sim
            .world_mut()
            .spawn((Position { x: 3.0, y: 4.0 }, SmartObject(def)))
            .id();
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 4.0 },
                Needs::all_at(80.0),
                Satisfaction::default(),
            ))
            .id();
        start_chain(&mut sim, agent);
        sim.tick();
        assert!(
            sim.world().get::<Reserved>(near).is_some(),
            "the two-tile pantry outranks the earlier-spawned far one"
        );
        assert!(sim.world().get::<Reserved>(far).is_none());
    }

    /// A role with NO stations at all (a hand-built world the compile
    /// gate would refuse) does nothing - no Blocked, because there is
    /// nothing to wait FOR; Blocked is for a booked kitchen, not a
    /// missing one.
    #[test]
    fn a_roleless_world_neither_proceeds_nor_claims_to_wait() {
        let pack = chain_pack();
        let mut sim = test_content::sim_with(12, 8, pack);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 4.0 },
                Needs::all_at(80.0),
                Satisfaction::default(),
            ))
            .id();
        start_chain(&mut sim, agent);
        for _ in 0..5 {
            sim.tick();
        }
        let world = sim.world();
        assert!(
            world.get::<ChainState>(agent).is_some(),
            "the counter holds"
        );
        assert!(
            world.get::<terri_core::Blocked>(agent).is_none(),
            "nothing to wait for is not the same as waiting"
        );
    }

    /// The steps take their DECLARED time: at zero variance the two
    /// stations cost at least 16 + 20 ticks of work on top of the
    /// walking, so a completion before tick 36 means the countdown
    /// comparison broke and steps are finishing early or instantly.
    #[test]
    fn steps_run_their_declared_durations() {
        let (mut sim, agent, _pantry, _table) = chain_world();
        start_chain(&mut sim, agent);
        for tick in 1..=400u32 {
            sim.tick();
            if sim.world().get::<ChainState>(agent).is_none() {
                assert!(
                    tick >= 36,
                    "two steps of 16 and 20 ticks cannot finish by tick {tick}"
                );
                return;
            }
        }
        panic!("the chain never completed");
    }

    /// Habituation lands against the ADVERTISER under the chain's
    /// flyout row - `interactions.len() + position`, here 1 + 0 - and
    /// the component is inserted for a sim that had never finished
    /// anything, the tick_interactions rule.
    #[test]
    fn completion_habituates_the_advertiser_under_the_flyout_row() {
        let (mut sim, agent, _pantry, _table) = chain_world();
        start_chain(&mut sim, agent);
        for _ in 0..400 {
            sim.tick();
            if sim.world().get::<ChainState>(agent).is_none() {
                let habituation = sim
                    .world()
                    .get::<terri_core::Habituation>(agent)
                    .expect("the first dinner inserts the component");
                // A range rather than an equality: decay_habituation
                // runs later in the completion tick, so the fresh
                // entry has already been nibbled by the time this
                // reads. The kill only needs the RIGHT row nonzero
                // near per_use and every wrong row at zero.
                let per_use = test_content::tuning().habituation_per_use;
                let entry = habituation.get(terri_data::ObjectDefId(0), 1);
                assert!(
                    entry > per_use * 0.9 && entry <= per_use,
                    "one completion, keyed at interactions.len() 1 plus \
                     chain position 0; read {entry} against {per_use}"
                );
                assert_eq!(
                    habituation.get(terri_data::ObjectDefId(0), 0),
                    0.0,
                    "the snack row itself is untouched"
                );
                return;
            }
        }
        panic!("the chain never completed");
    }

    /// A condition scales the terminal payout exactly as it scales an
    /// interaction's: severity 1 at accrual_scale 0.5 halves the loved
    /// dinner, asserted as arithmetic rather than direction.
    #[test]
    fn a_condition_taxes_the_terminal_payout() {
        let (mut sim, agent, _pantry, _table) = chain_world();
        let pack = sim
            .world()
            .get_resource::<crate::Content>()
            .expect("content installed")
            .0;
        let pack = Box::leak(Box::new(ContentPack {
            traits: vec![terri_data::CompiledTrait {
                id: "weary".to_string(),
                label: "Weary".to_string(),
                tag: "resting".to_string(),
                kind: terri_data::CompiledTraitKind::Condition {
                    accrual_scale: 0.5,
                    manage_per_completion: 0.0,
                    start_severity: 1.0,
                },
            }],
            ..pack.clone()
        }));
        sim.world_mut().insert_resource(crate::Content(pack));
        sim.world_mut()
            .entity_mut(agent)
            .insert(Traits::from_entries(vec![(0, 1.0)]));
        start_chain(&mut sim, agent);
        for _ in 0..400 {
            sim.tick();
            if sim.world().get::<ChainState>(agent).is_none() {
                let paid = sim.world().get::<Satisfaction>(agent).unwrap().value();
                let expected = 2.5 * test_content::tuning().hobby_multiplier * 0.5;
                assert!(
                    (paid - expected).abs() < 0.001,
                    "severity 1 at scale 0.5 halves the loved payout: got \
                     {paid}, expected {expected}"
                );
                return;
            }
        }
        panic!("the chain never completed");
    }

    /// Contention: with the pantry claimed by somebody else, the
    /// chain-holder WAITS (Blocked, counter intact) and proceeds the
    /// moment the station frees - the fridge-queue behaviour inherited.
    #[test]
    fn a_booked_station_is_waited_for() {
        let (mut sim, agent, pantry, _table) = chain_world();
        sim.world_mut().entity_mut(pantry).insert(Reserved);
        start_chain(&mut sim, agent);

        for _ in 0..30 {
            sim.tick();
        }
        let world = sim.world();
        assert!(
            world.get::<ChainState>(agent).is_some()
                && world.get::<terri_core::StepWork>(agent).is_none(),
            "the errand stands at step 0 while the only pantry is booked"
        );
        assert!(
            world.get::<terri_core::Blocked>(agent).is_some(),
            "and says why"
        );

        sim.world_mut().entity_mut(pantry).remove::<Reserved>();
        for _ in 0..200 {
            sim.tick();
            if sim.world().get::<ChainState>(agent).is_none() {
                return; // proceeded to completion once freed
            }
        }
        panic!("the chain never proceeded after the station freed");
    }
}
