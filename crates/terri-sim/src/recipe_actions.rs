//! Recipe procedure and initiating action are separate identities.
use bevy_ecs::prelude::*;
use terri_core::{
    save_v6::{ChainOrigin, SavedChainOrigin, SavedSelectedUse},
    ChainState, ObjectDefId,
};
use terri_data::{CompiledInteraction, ContentPack};

#[cfg(test)]
mod legacy_migration_tests;

/// Raw roles preserve saved content; usable recipe roles also honor station admission.
pub fn usable_recipe_role(
    pack: &ContentPack,
    object: &terri_data::CompiledObject,
    role: u32,
    cleanup: bool,
) -> bool {
    object.roles.contains(&role)
        && (cleanup
            || pack.roles[role as usize] != "prep_surface"
            || !object
                .roles
                .iter()
                .any(|&role| pack.roles[role as usize] == "dish_sink"))
}

/// Catalogue filters use the same recipe-station eligibility as the runtime.
pub fn usable_catalogue_needs(pack: &ContentPack, object: ObjectDefId) -> u32 {
    pack.needs_served_with_role_filter(object, |chain, role| {
        usable_recipe_role(
            pack,
            pack.object(object),
            role,
            chain.id == crate::domestic::CLEANUP,
        )
    })
}

/// Buying roles describe current recipe or seat routes, not dormant authored tags.
pub fn usable_buying_role(
    pack: &ContentPack,
    object: &terri_data::CompiledObject,
    role: u32,
) -> bool {
    usable_recipe_role(pack, object, role, false)
        && (pack
            .chains
            .iter()
            .any(|chain| chain.steps.iter().any(|step| step.role == role))
            || matches!(
                pack.roles[role as usize].as_str(),
                "dining_seat" | "turnable_seat"
            ))
}

/// Managed dining can use the preparation counter; tables and chairs are optional seating.
pub fn recipe_buying_requirements(
    pack: &ContentPack,
    chain: &terri_data::CompiledChain,
) -> (Vec<String>, Vec<String>) {
    let mut required = Vec::new();
    let mut optional = Vec::new();
    for (index, step) in chain.steps.iter().enumerate() {
        if crate::dining::managed_step(pack, chain, index as u32) {
            optional.extend(["meal_table".to_string(), "dining_seat".to_string()]);
        } else {
            required.push(pack.roles[step.role as usize].clone());
        }
    }
    required.sort();
    required.dedup();
    optional.sort();
    optional.dedup();
    (required, optional)
}

#[derive(Component, Clone, Debug, PartialEq, Eq)]
pub struct Origin(pub ChainOrigin, pub SelectedUse);

#[derive(Component, Clone, Copy)]
pub(crate) struct RecipeOrder(pub u64);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SelectedUse {
    Station(Entity),
    LegacyPending,
    Complete,
}

#[derive(Component, Clone, Copy, Debug, PartialEq, Eq)]
pub struct RecipeActivity(pub(crate) bool);

/// Start, replacement and cancellation carry the recipe's current activity status.
pub(crate) type ActiveRecipe = (ChainState, Origin, RecipeActivity);

pub(crate) fn foreground_state(has_recipe: bool, activity: Option<&RecipeActivity>) -> bool {
    has_recipe && activity.is_none_or(|activity| activity.0)
}

pub(crate) fn foreground(world: &World, actor: Entity) -> bool {
    foreground_state(
        world.get::<ChainState>(actor).is_some(),
        world.get::<RecipeActivity>(actor),
    )
}

pub(crate) fn suspend(world: &mut World, actor: Entity) {
    if world.get::<ChainState>(actor).is_some() {
        world.entity_mut(actor).insert(RecipeActivity(false));
    }
}

pub(crate) fn resume(world: &mut World, actor: Entity) {
    if world.get::<ChainState>(actor).is_some() {
        world.entity_mut(actor).insert(RecipeActivity(true));
    }
}

pub(crate) fn may_continue(
    activity: Option<&RecipeActivity>,
    elected_incoming: bool,
    normal_priority: bool,
) -> bool {
    if elected_incoming {
        foreground_state(true, activity)
    } else {
        normal_priority
    }
}

pub(crate) fn continuation(world: &World, actor: Entity, normal_priority: bool) -> bool {
    may_continue(
        world.get::<RecipeActivity>(actor),
        world
            .get_resource::<crate::social_episode::SocialEpisodes>()
            .is_some_and(|episodes| episodes.incoming.contains_key(&actor)),
        normal_priority,
    )
}

pub(crate) fn save_activity(world: &World) -> Vec<terri_core::save_v17::SavedOrderActor> {
    let mut rows: Vec<_> = world
        .try_query::<(Entity, &ChainState, &Origin, &RecipeActivity)>()
        .map(|mut query| {
            query
                .iter(world)
                .filter(|(_, _, _, activity)| !activity.0)
                .filter_map(|(actor, ..)| crate::player_actions::saved_actor(world, actor))
                .collect()
        })
        .unwrap_or_default();
    rows.sort_unstable();
    rows
}

fn other_current_activity(world: &World, actor: Entity) -> bool {
    let own_dining = crate::dining::terminal(world, actor)
        && world
            .get::<terri_core::Target>(actor)
            .is_some_and(|target| target.interaction == crate::systems::chain::CHAIN_STEP);
    world
        .get::<terri_core::Target>(actor)
        .is_some_and(|target| target.interaction != crate::systems::chain::CHAIN_STEP)
        || (world.get::<terri_core::Eating>(actor).is_some() && !own_dining)
        || world.get::<crate::reading::ReadingJourney>(actor).is_some()
        || world.get::<terri_core::Socialising>(actor).is_some()
        || world.get::<terri_core::AtWork>(actor).is_some()
        || world.get::<terri_core::Commuting>(actor).is_some()
        || world.get::<terri_core::chores::ChoreWork>(actor).is_some()
        || world
            .get_resource::<terri_core::chores::SavedChores>()
            .is_some_and(|chores| {
                chores
                    .tasks
                    .iter()
                    .any(|task| task.person == actor.index_u32() && !task.suspended)
            })
}

pub(crate) fn restore_activity(
    world: &mut World,
    rows: Vec<terri_core::save_v17::SavedOrderActor>,
) -> Result<(), crate::SaveError> {
    if rows.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(crate::SaveError::InvalidValue);
    }
    let mut background = std::collections::BTreeSet::new();
    for row in rows {
        let actor = crate::player_actions::restore_actor(world, row)?;
        if world.get::<ChainState>(actor).is_none()
            || world.get::<Origin>(actor).is_none()
            || world
                .get::<terri_core::Target>(actor)
                .is_some_and(|target| target.interaction == crate::systems::chain::CHAIN_STEP)
            || !background.insert(actor)
        {
            return Err(crate::SaveError::InvalidValue);
        }
    }
    let recipes: Vec<_> = world
        .query_filtered::<Entity, With<ChainState>>()
        .iter(world)
        .collect();
    if recipes
        .iter()
        .any(|actor| !background.contains(actor) && other_current_activity(world, *actor))
    {
        return Err(crate::SaveError::InvalidValue);
    }
    for actor in recipes {
        world
            .entity_mut(actor)
            .insert(RecipeActivity(!background.contains(&actor)));
    }
    Ok(())
}

pub(crate) fn adopt_legacy_activity(world: &mut World) {
    let recipes: Vec<_> = world
        .query_filtered::<Entity, With<ChainState>>()
        .iter(world)
        .collect();
    for actor in recipes {
        let current = !other_current_activity(world, actor);
        world.entity_mut(actor).insert(RecipeActivity(current));
    }
}

pub(crate) fn hash_activity(world: &World, hasher: &mut terri_core::FnvHasher) {
    let rows = save_activity(world);
    if rows.is_empty() {
        return;
    }
    hasher.write_bytes(b"background-recipes-v15");
    hasher.write_u64(rows.len() as u64);
    for row in rows {
        let (tag, identity) = match row {
            terri_core::save_v17::SavedOrderActor::Sim(identity) => (0, identity),
            terri_core::save_v17::SavedOrderActor::Entity(index) => (1, index),
        };
        hasher.write_u64(tag);
        hasher.write_u64(u64::from(identity));
    }
}

impl Origin {
    pub(crate) fn selected_step(&self) -> Option<u32> {
        match self.0 {
            ChainOrigin::Action { selected_step, .. } => Some(selected_step),
            _ => None,
        }
    }
}

/// After a burnt meal (issue 243) the recipe is back at its first step, so a
/// selected station already used must be pinned again or the origin reads
/// as complete at a step before the selected one, which no save would
/// accept. A selected hob keeps its pin through the burn, because its use
/// is marked complete only when the step ends without burning; what needs
/// a pin is an earlier station such as the fridge of a Cook dinner order,
/// and the lowest-indexed placed object of that model gets it. Returns
/// false when no such object exists, and the caller abandons the recipe as
/// a sold station abandons it.
pub(crate) fn repin_after_restart(world: &mut World, person: Entity) -> bool {
    let Some(origin) = world.get::<Origin>(person).cloned() else {
        return true;
    };
    if origin.1 != SelectedUse::Complete {
        return true;
    }
    let ChainOrigin::Action { model, .. } = &origin.0 else {
        return true;
    };
    let pack = world.resource::<crate::Content>().0;
    let pinned = world
        .try_query::<(Entity, &terri_core::SmartObject)>()
        .and_then(|mut q| {
            q.iter(world)
                .filter(|(_, object)| pack.object(object.0).id == *model)
                .map(|(entity, _)| entity)
                .min_by_key(|entity| entity.index_u32())
        });
    match pinned {
        Some(station) => {
            world
                .entity_mut(person)
                .insert(Origin(origin.0, SelectedUse::Station(station)));
            true
        }
        None => false,
    }
}

pub(crate) fn pins_sale(world: &World, station: Entity) -> bool {
    world
        .try_query::<&Origin>()
        .is_some_and(|mut q| q.iter(world).any(|o| o.1 == SelectedUse::Station(station)))
}

pub(crate) fn cleanup_extra(pack: &ContentPack, origin: Option<&Origin>, raw_extra: u32) -> u32 {
    let Some((_, _, action)) = action(pack, origin) else {
        return raw_extra;
    };
    let (_, recipe) = crate::domestic::interaction_chain(pack, action).expect("compiled binding");
    let base: u128 = recipe
        .steps
        .iter()
        .map(|s| u128::from(s.duration_ticks))
        .sum();
    let scaled = u128::from(raw_extra)
        .checked_mul(u128::from(action.duration_ticks))
        .expect("bounded work product");
    ((scaled + base / 2) / base).min(u128::from(u32::MAX)) as u32
}

pub(crate) fn begin(
    pack: &ContentPack,
    model: ObjectDefId,
    row: u32,
    recipe: usize,
    station: Entity,
) -> ActiveRecipe {
    let action = crate::action_rows::resolve(pack, model, row).expect("resolved recipe row");
    let origin = match action.action {
        Some(action) if action.recipe.is_some() => ChainOrigin::Action {
            model: pack.object(model).id.clone(),
            action: action.id.clone(),
            recipe: pack.chains[recipe].id.clone(),
            selected_step: action.recipe.as_ref().map_or(0, |b| b.selected_step),
        },
        _ => ChainOrigin::Internal {
            recipe: pack.chains[recipe].id.clone(),
        },
    };
    let selected = if matches!(origin, ChainOrigin::Action { .. }) {
        SelectedUse::Station(station)
    } else {
        SelectedUse::Complete
    };
    (
        ChainState::begin(recipe as u32),
        Origin(origin, selected),
        RecipeActivity(true),
    )
}

pub(crate) fn internal(pack: &ContentPack, recipe: u32) -> ActiveRecipe {
    (
        ChainState::begin(recipe),
        Origin(
            ChainOrigin::Internal {
                recipe: pack.chains[recipe as usize].id.clone(),
            },
            SelectedUse::Complete,
        ),
        RecipeActivity(true),
    )
}

pub(crate) fn action<'a>(
    pack: &'a ContentPack,
    origin: Option<&Origin>,
) -> Option<(ObjectDefId, u32, &'a CompiledInteraction)> {
    let ChainOrigin::Action {
        model,
        action,
        recipe,
        selected_step,
    } = &origin?.0
    else {
        return None;
    };
    let id = pack.find(model)?;
    let row = pack
        .object(id)
        .interactions
        .iter()
        .position(|a| &a.id == action)?;
    let action = &pack.object(id).interactions[row];
    let binding = action.recipe.as_ref()?;
    (binding.recipe == *recipe && binding.selected_step == *selected_step)
        .then_some((id, row as u32, action))
}

pub(crate) fn duration(pack: &ContentPack, state: &ChainState, origin: Option<&Origin>) -> u32 {
    action(pack, origin).map_or_else(
        || pack.chains[state.chain as usize].steps[state.step as usize].duration_ticks,
        |(_, _, a)| a.recipe.as_ref().expect("bound recipe").steps[state.step as usize],
    )
}

pub(crate) fn benefits<'a>(
    pack: &'a ContentPack,
    state: &ChainState,
    origin: Option<&Origin>,
) -> &'a [(u8, f32)] {
    action(pack, origin).map_or(
        &pack.chains[state.chain as usize].advertises,
        |(_, _, a)| &a.advertises,
    )
}

/// Only the designated stage depends on the selected entity; later stations may substitute.
pub(crate) fn station_eligible(
    pack: &ContentPack,
    state: &ChainState,
    origin: Option<&Origin>,
    station: Entity,
    model: ObjectDefId,
) -> bool {
    let Some(origin) = origin.filter(|o| o.selected_step() == Some(state.step)) else {
        return true;
    };
    match origin.1 {
        SelectedUse::Station(selected) => selected == station,
        SelectedUse::LegacyPending => {
            action(pack, Some(origin)).is_some_and(|(id, _, _)| id == model)
        }
        SelectedUse::Complete => false,
    }
}

pub(crate) fn capture(world: &World) -> Vec<SavedChainOrigin> {
    let mut rows = world
        .try_query::<(Entity, &Origin)>()
        .map(|mut q| {
            q.iter(world)
                .map(|(person, origin)| SavedChainOrigin {
                    person: person.index_u32(),
                    origin: origin.0.clone(),
                    selected_use: match origin.1 {
                        SelectedUse::Station(entity) => {
                            SavedSelectedUse::Station(entity.index_u32())
                        }
                        SelectedUse::LegacyPending => SavedSelectedUse::LegacyPending,
                        SelectedUse::Complete => SavedSelectedUse::Complete,
                    },
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    rows.sort_by_key(|r| r.person);
    rows
}

pub(crate) fn restore(
    world: &mut World,
    rows: Vec<SavedChainOrigin>,
) -> Result<(), crate::SaveError> {
    let active: std::collections::BTreeSet<_> = world
        .try_query::<(Entity, &ChainState)>()
        .map(|mut q| q.iter(world).map(|(e, _)| e.index_u32()).collect())
        .unwrap_or_default();
    restore_scoped(world, rows, active)
}

fn restore_scoped(
    world: &mut World,
    rows: Vec<SavedChainOrigin>,
    active: std::collections::BTreeSet<u32>,
) -> Result<(), crate::SaveError> {
    if rows.windows(2).any(|rows| rows[0].person >= rows[1].person) {
        return Err(crate::SaveError::InvalidValue);
    }
    let pack = world.resource::<crate::Content>().0;
    let mut seen = std::collections::BTreeSet::new();
    for row in rows {
        let invalid = crate::SaveError::InvalidValue;
        if !active.contains(&row.person) || !seen.insert(row.person) {
            return Err(invalid);
        }
        let person = crate::dining::entity(world, row.person).ok_or(invalid)?;
        if world.get::<terri_core::Agent>(person).is_none()
            || world.get::<terri_core::Needs>(person).is_none()
        {
            return Err(invalid);
        }
        let chain = world.get::<ChainState>(person).ok_or(invalid)?;
        let recipe = &pack.chains[chain.chain as usize].id;
        let selected = match row.selected_use {
            SavedSelectedUse::Station(index) => {
                SelectedUse::Station(crate::dining::entity(world, index).ok_or(invalid)?)
            }
            SavedSelectedUse::LegacyPending => SelectedUse::LegacyPending,
            SavedSelectedUse::Complete => SelectedUse::Complete,
        };
        let origin = Origin(row.origin, selected);
        match &origin.0 {
            ChainOrigin::Action {
                recipe: named,
                model,
                action: action_id,
                selected_step,
            } => {
                if named != recipe || action(pack, Some(&origin)).is_none() {
                    return Err(invalid);
                }
                let target = world
                    .get::<terri_core::Target>(person)
                    .filter(|t| t.interaction == crate::systems::chain::CHAIN_STEP);
                match origin.1 {
                    SelectedUse::Station(station) => {
                        if chain.step > *selected_step
                            || world
                                .get::<terri_core::SmartObject>(station)
                                .is_none_or(|o| pack.object(o.0).id != *model)
                            || (chain.step == *selected_step
                                && target.is_some_and(|t| t.object != station))
                        {
                            return Err(invalid);
                        }
                    }
                    SelectedUse::LegacyPending => {
                        if chain.step > *selected_step
                            || (chain.step == *selected_step && target.is_some())
                            || !matches!(
                                (model.as_str(), action_id.as_str()),
                                ("fridge", "grab_snack" | "cook_dinner")
                                    | ("kitchen_sink", "clean_dishes")
                            )
                        {
                            return Err(invalid);
                        }
                    }
                    SelectedUse::Complete => {
                        if chain.step <= *selected_step {
                            return Err(invalid);
                        }
                    }
                }
            }
            ChainOrigin::Internal { recipe: named } => {
                if named != recipe
                    || origin.1 != SelectedUse::Complete
                    || !matches!(
                        named.as_str(),
                        crate::domestic::CLEANUP | crate::domestic::SHARED
                    )
                {
                    return Err(invalid);
                }
            }
        }
        world.entity_mut(person).insert(origin);
    }
    if active != seen {
        return Err(crate::SaveError::InvalidValue);
    }
    Ok(())
}

pub(crate) fn historical(
    snapshot: &terri_core::SaveSnapshotV5,
) -> Result<Vec<SavedChainOrigin>, crate::SaveError> {
    snapshot
        .world
        .entities
        .iter()
        .filter_map(|e| e.chain.as_ref().map(|c| (e.index, c)))
        .map(|(person, chain)| {
            let origin = match chain.chain.as_str() {
                crate::domestic::SNACK => ChainOrigin::Action {
                    model: "fridge".into(),
                    action: "grab_snack".into(),
                    recipe: chain.chain.clone(),
                    selected_step: 0,
                },
                "cook_dinner" => ChainOrigin::Action {
                    model: "fridge".into(),
                    action: "cook_dinner".into(),
                    recipe: chain.chain.clone(),
                    selected_step: 0,
                },
                crate::domestic::CLEANUP
                    if snapshot.domestic.as_ref().is_some_and(|d| {
                        d.cleanup.iter().any(|t| t.person == person && t.directed)
                    }) =>
                {
                    ChainOrigin::Action {
                        model: "kitchen_sink".into(),
                        action: "clean_dishes".into(),
                        recipe: chain.chain.clone(),
                        selected_step: 1,
                    }
                }
                crate::domestic::CLEANUP | crate::domestic::SHARED => ChainOrigin::Internal {
                    recipe: chain.chain.clone(),
                },
                _ => return Err(crate::SaveError::InvalidContentReference),
            };
            let selected_use = if let ChainOrigin::Action {
                model,
                selected_step,
                ..
            } = &origin
            {
                if chain.step > *selected_step {
                    SavedSelectedUse::Complete
                } else if chain.step == *selected_step {
                    let target = snapshot
                        .world
                        .entities
                        .iter()
                        .find(|e| e.index == person)
                        .and_then(|e| e.target)
                        .filter(|t| t.interaction == crate::systems::chain::CHAIN_STEP);
                    if let Some(target) = target {
                        if !snapshot.world.entities.iter().any(|e| {
                            e.index == target.object && e.smart_object.as_ref() == Some(model)
                        }) {
                            return Err(crate::SaveError::InvalidValue);
                        }
                        SavedSelectedUse::Station(target.object)
                    } else {
                        SavedSelectedUse::LegacyPending
                    }
                } else {
                    SavedSelectedUse::LegacyPending
                }
            } else {
                SavedSelectedUse::Complete
            };
            Ok(SavedChainOrigin {
                person,
                origin,
                selected_use,
            })
        })
        .collect()
}

/// Only legacy adoption reconstructs missing recipe metadata. Current saves
/// must supply every origin and continue through the strict restore validator.
pub(crate) fn migrate_legacy(sim: &mut crate::Sim) -> Result<(), crate::SaveError> {
    if sim.world().resource::<crate::Content>().0.reading.is_none() {
        return Ok(());
    }
    // Historical native snapshots also accept projection-only entities. Recipe
    // execution requires Agent and Needs, so only that domain gains metadata.
    // Current restoration still requires coverage of every saved ChainState.
    let active: std::collections::BTreeSet<_> = sim
        .world()
        .try_query::<(Entity, &terri_core::Agent, &terri_core::Needs, &ChainState)>()
        .map(|mut query| {
            query
                .iter(sim.world())
                .map(|(person, _, _, _)| person.index_u32())
                .collect()
        })
        .unwrap_or_default();
    let missing: std::collections::BTreeSet<_> = active
        .iter()
        .copied()
        .filter(|index| {
            crate::dining::entity(sim.world(), *index)
                .is_some_and(|person| sim.world().get::<Origin>(person).is_none())
        })
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    let mut legacy = sim.save_snapshot_v5();
    for row in &mut legacy.world.entities {
        if !missing.contains(&row.index) {
            row.chain = None;
        }
    }
    let mut origins: Vec<_> = capture(sim.world())
        .into_iter()
        .filter(|row| active.contains(&row.person))
        .collect();
    origins.extend(historical(&legacy)?);
    origins.sort_by_key(|row| row.person);
    restore_scoped(sim.world_mut(), origins, active)
}
