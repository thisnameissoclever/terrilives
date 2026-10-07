//! Recipe procedure and initiating action are separate identities.
use bevy_ecs::prelude::*;
use terri_core::{
    save_v6::{ChainOrigin, SavedChainOrigin, SavedSelectedUse},
    ChainState, ObjectDefId,
};
use terri_data::{CompiledInteraction, ContentPack};

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

/// Start, replacement and cancellation always operate on this complete pair.
pub(crate) type ActiveRecipe = (ChainState, Origin);

impl Origin {
    pub(crate) fn selected_step(&self) -> Option<u32> {
        match self.0 {
            ChainOrigin::Action { selected_step, .. } => Some(selected_step),
            _ => None,
        }
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
    (ChainState::begin(recipe as u32), Origin(origin, selected))
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
    if rows.windows(2).any(|rows| rows[0].person >= rows[1].person) {
        return Err(crate::SaveError::InvalidValue);
    }
    let pack = world.resource::<crate::Content>().0;
    let active: std::collections::BTreeSet<_> = world
        .try_query::<(Entity, &ChainState)>()
        .map(|mut q| q.iter(world).map(|(e, _)| e.index_u32()).collect())
        .unwrap_or_default();
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
