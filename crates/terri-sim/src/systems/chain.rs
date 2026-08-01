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
    Agent, AtWork, Blocked, Carrying, ChainState, Commuting, Eating, Fumbled, Hobbies, IntentQueue,
    NeedId, Needs, Path, Personality, Position, Reserved, Restless, Satisfaction, SmartObject,
    Socialising, StepWork, Target, TileGrid, Traits,
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
            Option<&Fumbled>,
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
            fumbled,
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
        // exactly as tick_interactions' does; the fumble scales
        // benefits only and zeroes the satisfaction.
        let fumble = fumbled.map_or(1.0, |f| f.delta_scale);
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
            move |world: &mut World| {
                if let Some(mut habituation) = world.get_mut::<terri_core::Habituation>(sim) {
                    habituation.bump(advertiser, row, per_use);
                }
            }
        });

        if let Some(mut satisfaction) = satisfaction {
            if fumbled.is_none() {
                let tags = all_tags(chain);
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

        commands
            .entity(sim)
            .remove::<ChainState>()
            .remove::<Fumbled>();
    }
}

/// The chain's position among its advertiser's chains - the second
/// half of [K5]'s flyout row `interactions.len() + position`.
fn chain_position(pack: &terri_data::ContentPack, chain: u32) -> u32 {
    let advertiser = pack.chains[chain as usize].advertised_by;
    pack.chains[..chain as usize]
        .iter()
        .filter(|c| c.advertised_by == advertiser)
        .count() as u32
}

/// The union of every step's tags, for the hobby payout: loving
/// cooking makes the dinner loved, wherever the tag sits.
fn all_tags(chain: &terri_data::CompiledChain) -> Vec<String> {
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
