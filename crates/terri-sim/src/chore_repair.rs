//! Actual cleaning earns appreciation; resolving an argued duty can repair feelings.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{chores::*, save_v19::SavedNeglect, save_v20::*, SimClock, SimId};

#[cfg(test)]
mod tests;

fn assigned(state: &SavedChores, scope: ChoreObligation) -> bool {
    state
        .assignments
        .binary_search_by_key(&scope.key, |row| row.key)
        .ok()
        .is_some_and(|i| state.assignments[i].owner == scope.owner)
}

fn current_in(
    world: &World,
    state: &SavedChores,
    key: ChoreKey,
    owner: SimId,
) -> Option<ChoreObligation> {
    if state
        .assignments
        .binary_search_by_key(&key, |row| row.key)
        .ok()
        .is_none_or(|i| state.assignments[i].owner != owner.0)
    {
        return None;
    }
    let duties = &world.get_resource::<SavedNeglect>()?.duties;
    let timer = duties.get(
        duties
            .binary_search_by_key(&(key, owner.0), |row| (row.key, row.owner))
            .ok()?,
    )?;
    Some(ChoreObligation {
        key,
        owner: owner.0,
        actionable_since: timer.actionable_since,
    })
}

pub(crate) fn obligation(world: &World, key: ChoreKey, owner: SimId) -> Option<ChoreObligation> {
    current_in(world, world.get_resource::<SavedChores>()?, key, owner)
}

pub(crate) fn still_unfinished(world: &World, scope: ChoreObligation) -> bool {
    world.get_resource::<SavedChores>().is_some_and(|state| {
        obligation(world, scope.key, SimId(scope.owner)) == Some(scope)
            && crate::chores::work_needed(world, state, scope.key, scope.owner)
    })
}

pub(crate) fn still_unfinished_for(world: &World, scope: ChoreObligation, owner: Entity) -> bool {
    world.get_resource::<SavedChores>().is_some_and(|state| {
        world
            .get::<SimId>(owner)
            .is_some_and(|id| id.0 == scope.owner)
            && current_in(world, state, scope.key, SimId(scope.owner)) == Some(scope)
            && crate::chores::work_needed_for(world, state, scope.key, owner)
    })
}

pub(crate) fn record_annoyance_in(
    world: &mut World,
    state: &SavedChores,
    affected: SimId,
    responsible: SimId,
    key: ChoreKey,
    loss: f32,
) {
    if affected == responsible || loss <= 0. || !loss.is_finite() {
        return;
    }
    let subject = state
        .assignments
        .binary_search_by_key(&key, |row| row.key)
        .ok()
        .and_then(|i| current_in(world, state, key, SimId(state.assignments[i].owner)))
        .map_or(GrievanceSubject::None, GrievanceSubject::Chore);
    crate::social_conflicts::remember(
        world,
        affected,
        responsible,
        GrievanceKind::Chore,
        subject,
        loss,
    );
}

pub(crate) fn record_annoyance(
    world: &mut World,
    affected: SimId,
    responsible: SimId,
    key: ChoreKey,
    loss: f32,
) {
    let Some(state) = world.remove_resource::<SavedChores>() else {
        return;
    };
    record_annoyance_in(world, &state, affected, responsible, key, loss);
    world.insert_resource(state);
}

pub(crate) fn appreciate(world: &mut World, person: u32, units: u32) {
    if units == 0 {
        return;
    }
    let Some(actor) = crate::dining::entity(world, person)
        .and_then(|e| world.get::<SimId>(e))
        .copied()
    else {
        return;
    };
    let mut observers: Vec<_> = world
        .query_filtered::<(Entity, &SimId), (With<terri_core::Agent>, With<terri_core::Needs>)>()
        .iter(world)
        .filter(|(_, id)| **id != actor)
        .map(|(e, id)| (*id, e))
        .collect();
    observers.sort_by_key(|row| row.0);
    for (_, observer) in observers {
        let gain = 0.006 + 0.006 * crate::domestic::cleanliness(world, observer);
        crate::relationship_effects::record_opinion_change(
            world,
            actor.0,
            observer,
            gain,
            crate::relationship_effects::RelationshipCause::ChoreFulfilled,
        );
    }
}

fn response_probability(
    world: &World,
    state: &SavedChores,
    recipient: Entity,
    initiator: SimId,
    scope: ChoreObligation,
) -> f32 {
    let tuning = &world.resource::<crate::Content>().0.tuning;
    let profile = state
        .profiles
        .binary_search_by_key(&scope.owner, |row| row.sim_id)
        .ok()
        .map(|i| state.profiles[i].clone())
        .unwrap_or_else(|| ChoreProfile::neutral(scope.owner));
    let clean = crate::domestic::cleanliness(world, recipient).clamp(0., 1.);
    let opinion = world
        .get::<terri_core::Relationships>(recipient)
        .map_or(0., |r| r.feeling(initiator));
    let mood = crate::mood::score(world, recipient.index_u32(), state).unwrap_or(0.) / 100.;
    response_chance(tuning, clean, &profile, scope.key.kind, opinion, mood)
}

fn response_chance(
    tuning: &terri_data::Tuning,
    clean: f32,
    profile: &ChoreProfile,
    kind: ChoreKind,
    opinion: f32,
    mood: f32,
) -> f32 {
    (tuning.chore_fight_response_base
        + tuning.chore_fight_response_cleanliness * (clean - 0.5)
        + tuning.chore_fight_response_responsibility
            * (f32::from(profile.responsibility) / 100. - 0.5)
        + tuning.chore_fight_response_commitment * (f32::from(profile.commitment) / 100. - 0.5)
        + tuning.chore_fight_response_preference * f32::from(profile.preferences[kind.index()])
            / 100.
        + tuning.chore_fight_response_affinity * opinion.clamp(-1., 1.)
        + tuning.chore_fight_response_mood * mood.clamp(-1., 1.))
    .clamp(0.05, 0.98)
}

pub(crate) fn fight_completed(
    world: &mut World,
    initiator: SimId,
    recipient: SimId,
    scope: ChoreObligation,
) {
    if recipient.0 != scope.owner || initiator == recipient || !still_unfinished(world, scope) {
        return;
    }
    let Some(person) = crate::edit::living_entity(world, recipient.0) else {
        return;
    };
    let now = world.resource::<SimClock>().tick;
    let key = (recipient.0, now, initiator.0);
    let Some(mut conflicts) = world.remove_resource::<crate::social_conflicts::State>() else {
        return;
    };
    if conflicts.repairs.contains_key(&key)
        || conflicts.repairs.len() >= crate::social_conflicts::MAX_REPAIRS
        || conflicts
            .repairs
            .range((recipient.0, 0, 0)..=(recipient.0, u64::MAX, u32::MAX))
            .count()
            >= crate::social_conflicts::MAX_REPAIRS_PER_PERSON
    {
        world.insert_resource(conflicts);
        return;
    }
    let mut witnesses = conflicts.witnesses_for(scope);
    witnesses.push(initiator.0);
    witnesses.retain(|id| *id != recipient.0);
    witnesses.sort_unstable();
    witnesses.dedup();
    let used: usize = conflicts
        .repairs
        .values()
        .map(|row| row.witnesses.len())
        .sum();
    witnesses.truncate(crate::social_conflicts::MAX_WITNESSES.saturating_sub(used));
    let mut chores = world.remove_resource::<SavedChores>().unwrap();
    let chance = response_probability(world, &chores, person, initiator, scope);
    let accepted = chores
        .rng
        .as_mut()
        .is_some_and(|rng| rng.next_f32() < chance);
    world.insert_resource(chores);
    conflicts.repairs.insert(
        key,
        SavedChoreRepair {
            recipient: recipient.0,
            initiator: initiator.0,
            obligation: scope,
            fought_at: now,
            deadline: now.saturating_add(u64::from(
                world
                    .resource::<crate::Content>()
                    .0
                    .tuning
                    .chore_fight_response_ticks,
            )),
            accepted,
            attempted: false,
            working: false,
            contributed_units: 0,
            witnesses,
        },
    );
    world.insert_resource(conflicts);
}

fn normalized_key(world: &World, key: ChoreKey) -> ChoreKey {
    if key.kind == ChoreKind::Surfaces {
        crate::chores::neglect_surface_key(world, key.target).unwrap_or(key)
    } else {
        key
    }
}

fn physical_work(world: &World, state: &SavedChores, person: Entity, key: ChoreKey) -> bool {
    state
        .tasks
        .binary_search_by_key(&person.index_u32(), |row| row.person)
        .ok()
        .is_some_and(|i| normalized_key(world, state.tasks[i].key) == key)
        || (key.kind == ChoreKind::Dishes
            && world
                .get_resource::<terri_core::save::SavedDomestic>()
                .is_some_and(|domestic| {
                    domestic
                        .cleanup
                        .binary_search_by_key(&person.index_u32(), |row| row.person)
                        .is_ok()
                }))
}

fn continuity(world: &World, state: &SavedChores, row: &SavedChoreRepair, person: Entity) -> bool {
    if !assigned(state, row.obligation) {
        return false;
    }
    match current_in(world, state, row.obligation.key, SimId(row.recipient)) {
        Some(scope) => scope == row.obligation,
        None => {
            (row.working && physical_work(world, state, person, row.obligation.key))
                || dishes_continue(world, row.obligation)
        }
    }
}

fn dishes_continue(world: &World, scope: ChoreObligation) -> bool {
    if scope.key.kind != ChoreKind::Dishes {
        return false;
    }
    let Some(domestic) = world.get_resource::<terri_core::save::SavedDomestic>() else {
        return false;
    };
    let Some(neglect) = world.get_resource::<SavedNeglect>() else {
        return false;
    };
    domestic.dishes.iter().any(|dish| {
        let source = terri_core::save_v19::NeglectSource::Dish(dish.id);
        neglect
            .sources
            .binary_search_by_key(&source, |timer| timer.source)
            .ok()
            .is_some_and(|i| neglect.sources[i].actionable_since <= scope.actionable_since)
    })
}

pub(crate) fn started_in(world: &mut World, state: &SavedChores, person: Entity, key: ChoreKey) {
    let Some(id) = world.get::<SimId>(person).copied() else {
        return;
    };
    let key = normalized_key(world, key);
    let matching: Vec<_> = world
        .get_resource::<crate::social_conflicts::State>()
        .into_iter()
        .flat_map(|conflicts| {
            conflicts
                .repairs
                .range((id.0, 0, 0)..=(id.0, u64::MAX, u32::MAX))
        })
        .filter(|(_, row)| row.obligation.key == key && continuity(world, state, row, person))
        .map(|(key, _)| *key)
        .collect();
    if let Some(mut conflicts) = world.get_resource_mut::<crate::social_conflicts::State>() {
        for key in matching {
            let row = conflicts.repairs.get_mut(&key).unwrap();
            row.working = true;
            row.attempted = true;
        }
    }
}

pub(crate) fn started(world: &mut World, person: Entity, key: ChoreKey) {
    let Some(state) = world.remove_resource::<SavedChores>() else {
        return;
    };
    started_in(world, &state, person, key);
    world.insert_resource(state);
}

pub(crate) fn canceled(world: &mut World, person: Entity) {
    let Some(id) = world.get::<SimId>(person).copied() else {
        return;
    };
    if let Some(mut conflicts) = world.get_resource_mut::<crate::social_conflicts::State>() {
        for (_, row) in conflicts
            .repairs
            .range_mut((id.0, 0, 0)..=(id.0, u64::MAX, u32::MAX))
        {
            row.working = false;
        }
    }
}

fn ready(world: &World, chores: &SavedChores, person: Entity) -> bool {
    world.get::<terri_core::Needs>(person).is_some_and(|needs| {
        [
            terri_core::NeedId::Hunger,
            terri_core::NeedId::Energy,
            terri_core::NeedId::Bladder,
        ]
        .into_iter()
        .all(|need| {
            needs.get(need)
                > world
                    .resource::<crate::Content>()
                    .0
                    .tuning
                    .mood_critical_need_level
        })
    }) && world
        .get::<terri_core::IntentQueue>(person)
        .is_none_or(|q| q.is_empty())
        && world.get::<terri_core::Target>(person).is_none()
        && world.get::<terri_core::Path>(person).is_none()
        && world.get::<terri_core::Socialising>(person).is_none()
        && world.get::<terri_core::ChainState>(person).is_none()
        && world.get::<terri_core::Eating>(person).is_none()
        && world.get::<terri_core::AtWork>(person).is_none()
        && world.get::<terri_core::Commuting>(person).is_none()
        && world
            .get::<crate::reading::ReadingJourney>(person)
            .is_none()
        && world.get::<crate::reading::PendingShift>(person).is_none()
        && chores
            .tasks
            .binary_search_by_key(&person.index_u32(), |row| row.person)
            .is_err()
        && !world
            .get_resource::<crate::social_episode::SocialEpisodes>()
            .is_some_and(|s| s.rendezvous.contains_key(&person))
}

#[cfg(test)]
fn tick(world: &mut World) {
    let Some(mut chores) = world.remove_resource::<SavedChores>() else {
        return;
    };
    tick_in(world, &mut chores);
    world.insert_resource(chores);
}

pub(crate) fn tick_in(world: &mut World, chores: &mut SavedChores) {
    let Some(mut conflicts) = world.remove_resource::<crate::social_conflicts::State>() else {
        return;
    };
    if conflicts.repairs.is_empty() && conflicts.dish_contributions.is_empty() {
        world.insert_resource(conflicts);
        return;
    }
    let now = world.resource::<SimClock>().tick;
    let people: BTreeMap<_, _> = world
        .query_filtered::<(Entity, &SimId), (With<terri_core::Agent>, With<terri_core::Needs>)>()
        .iter(world)
        .map(|(e, id)| (id.0, e))
        .collect();
    let rows = std::mem::take(&mut conflicts.repairs);
    let mut used: usize = rows.values().map(|row| row.witnesses.len()).sum();
    let mut failed = BTreeSet::new();
    let mut started = BTreeSet::new();
    for (key, mut row) in rows {
        if started.contains(&row.obligation) {
            row.working = true;
            row.attempted = true;
        }
        let Some(&person) = people.get(&row.recipient) else {
            used -= row.witnesses.len();
            continue;
        };
        if now > row.deadline
            || !people.contains_key(&row.initiator)
            || !continuity(world, chores, &row, person)
        {
            used -= row.witnesses.len();
            continue;
        }
        let mut merged = conflicts.witnesses_for(row.obligation);
        merged.extend(row.witnesses.iter().copied());
        merged.sort_unstable();
        merged.dedup();
        merged.retain(|id| *id != row.recipient && people.contains_key(id));
        used -= row.witnesses.len();
        merged.truncate(crate::social_conflicts::MAX_WITNESSES.saturating_sub(used));
        used += merged.len();
        row.witnesses = merged;
        if row.working && !physical_work(world, chores, person, row.obligation.key) {
            row.working = false;
        }
        if row.accepted
            && !row.attempted
            && !failed.contains(&row.recipient)
            && ready(world, chores, person)
        {
            row.attempted = true;
            row.working =
                crate::chores::start_response(world, chores, person, row.obligation.key, false);
            if row.working {
                started.insert(row.obligation);
            }
            if !row.working {
                failed.insert(row.recipient);
            }
        }
        conflicts.repairs.insert(key, row);
    }
    prune_contributions(world, chores, &mut conflicts, &people);
    world.insert_resource(conflicts);
}

/// Called only by successful physical completion, before its ownership disappears.
pub(crate) fn completed_in(
    world: &mut World,
    chores: &SavedChores,
    person: u32,
    key: ChoreKey,
    units: u32,
) {
    completed_verified_in(world, chores, person, key, units, None);
}

fn completed_verified_in(
    world: &mut World,
    chores: &SavedChores,
    person: u32,
    key: ChoreKey,
    units: u32,
    verified: Option<ChoreObligation>,
) {
    if units == 0 {
        return;
    }
    let Some(entity) = crate::dining::entity(world, person) else {
        return;
    };
    let Some(actor) = world.get::<SimId>(entity).copied() else {
        return;
    };
    let key = normalized_key(world, key);
    let Some(mut conflicts) = world.remove_resource::<crate::social_conflicts::State>() else {
        return;
    };
    let now = world.resource::<SimClock>().tick;
    let candidates: Vec<_> = conflicts
        .repairs
        .range((actor.0, 0, 0)..=(actor.0, u64::MAX, u32::MAX))
        .filter(|(_, row)| {
            row.obligation.key == key
                && now <= row.deadline
                && (continuity(world, chores, row, entity)
                    || (verified == Some(row.obligation) && assigned(chores, row.obligation)))
                && (key.kind != ChoreKind::Dishes || row.contributed_units > 0)
                && !crate::chores::work_needed_for(world, chores, key, entity)
        })
        .map(|(id, _)| *id)
        .collect();
    let mut observers = BTreeSet::new();
    let mut initiators = BTreeSet::new();
    for id in candidates {
        let row = conflicts.repairs.remove(&id).unwrap();
        observers.extend(conflicts.witnesses_for(row.obligation));
        observers.extend(row.witnesses);
        observers.insert(row.initiator);
        initiators.insert(row.initiator);
    }
    world.insert_resource(conflicts);
    let people: BTreeMap<_, _> = world
        .query_filtered::<(Entity, &SimId), (With<terri_core::Agent>, With<terri_core::Needs>)>()
        .iter(world)
        .map(|(e, id)| (id.0, e))
        .collect();
    let tuning = &world.resource::<crate::Content>().0.tuning;
    let (base, clean_weight) = (tuning.chore_repair_base, tuning.chore_repair_cleanliness);
    for observer in observers {
        let Some(&affected) = people.get(&observer) else {
            continue;
        };
        let gain = base + clean_weight * crate::domestic::cleanliness(world, affected);
        crate::relationship_effects::record_opinion_change(
            world,
            actor.0,
            affected,
            gain,
            crate::relationship_effects::RelationshipCause::ChoreFulfilled,
        );
    }
    let gain = base + clean_weight * crate::domestic::cleanliness(world, entity);
    for initiator in initiators {
        if people.contains_key(&initiator) {
            crate::relationship_effects::record_unlogged_opinion_change(
                world,
                initiator,
                entity,
                gain,
                crate::relationship_effects::RelationshipCause::ChoreFulfilled,
            );
        }
    }
}

pub(crate) fn valid_saved_repair(world: &World, row: &SavedChoreRepair, recipient: Entity) -> bool {
    let Some(chores) = world.get_resource::<SavedChores>() else {
        return false;
    };
    row.recipient == row.obligation.owner
        && row.recipient != row.initiator
        && row.obligation.actionable_since <= row.fought_at
        && row.deadline >= row.fought_at
        && row.deadline - row.fought_at <= 100800
        && (!row.working || row.attempted)
        && (!row.working || physical_work(world, chores, recipient, row.obligation.key))
        && continuity(world, chores, row, recipient)
}

pub(crate) fn valid_saved_contribution(
    world: &World,
    scope: ChoreObligation,
    repairs: &BTreeMap<(u32, u64, u32), SavedChoreRepair>,
) -> bool {
    let Some(chores) = world.get_resource::<SavedChores>() else {
        return false;
    };
    scope.key.kind == ChoreKind::Dishes
        && assigned(chores, scope)
        && match current_in(world, chores, scope.key, SimId(scope.owner)) {
            Some(current) => current == scope,
            None => {
                dishes_continue(world, scope)
                    || repairs
                        .range((scope.owner, 0, 0)..=(scope.owner, u64::MAX, u32::MAX))
                        .any(|(_, row)| row.obligation == scope && row.working)
            }
        }
}

fn prune_contributions(
    world: &World,
    chores: &SavedChores,
    conflicts: &mut crate::social_conflicts::State,
    people: &BTreeMap<u32, Entity>,
) {
    let continuing: BTreeSet<_> = conflicts
        .repairs
        .values()
        .filter(|row| row.working)
        .map(|row| row.obligation)
        .collect();
    conflicts.dish_contributions.retain(|(scope, person), _| {
        people.contains_key(person)
            && assigned(chores, *scope)
            && match current_in(world, chores, scope.key, SimId(scope.owner)) {
                Some(current) => current == *scope,
                None => continuing.contains(scope) || dishes_continue(world, *scope),
            }
    });
}

/// Capture physical washing while its task still proves the continuous duty.
pub(crate) fn before_dishes_washed(
    world: &mut World,
    person: Entity,
    units: u32,
) -> Vec<ChoreObligation> {
    if units == 0 || crate::fights::published_rules(world) {
        return vec![];
    }
    let Some(actor) = world.get::<SimId>(person).copied() else {
        return vec![];
    };
    let Some(chores) = world.get_resource::<SavedChores>() else {
        return vec![];
    };
    let key = ChoreKey {
        kind: ChoreKind::Dishes,
        target: 0,
    };
    if !physical_work(world, chores, person, key) {
        return vec![];
    }
    let mut scopes = BTreeSet::new();
    if let Ok(i) = chores.assignments.binary_search_by_key(&key, |row| row.key) {
        if let Some(scope) = current_in(world, chores, key, SimId(chores.assignments[i].owner)) {
            scopes.insert(scope);
        }
    }
    if let (Some(conflicts), Ok(index)) = (
        world.get_resource::<crate::social_conflicts::State>(),
        chores.assignments.binary_search_by_key(&key, |row| row.key),
    ) {
        let owner = chores.assignments[index].owner;
        for (_, row) in conflicts
            .repairs
            .range((owner, 0, 0)..=(owner, u64::MAX, u32::MAX))
        {
            if row.obligation.key == key && continuity(world, chores, row, person) {
                scopes.insert(row.obligation);
            }
        }
    }
    let now = world.resource::<SimClock>().tick;
    let Some(mut conflicts) = world.get_resource_mut::<crate::social_conflicts::State>() else {
        return vec![];
    };
    for &scope in &scopes {
        let entry = (scope, actor.0);
        if conflicts.dish_contributions.contains_key(&entry)
            || conflicts.dish_contributions.len() < crate::social_conflicts::MAX_DISH_CONTRIBUTIONS
        {
            let amount = conflicts.dish_contributions.entry(entry).or_default();
            *amount = amount.saturating_add(units);
        }
    }
    let recorded: BTreeSet<_> = scopes
        .iter()
        .filter(|scope| {
            conflicts
                .dish_contributions
                .contains_key(&(**scope, actor.0))
        })
        .copied()
        .collect();
    for (_, row) in conflicts
        .repairs
        .range_mut((actor.0, 0, 0)..=(actor.0, u64::MAX, u32::MAX))
    {
        if now <= row.deadline && recorded.contains(&row.obligation) {
            row.attempted = true;
            row.working = true;
            row.contributed_units = row.contributed_units.saturating_add(units);
        }
    }
    scopes.into_iter().collect()
}

pub(crate) fn dishes_finished(world: &mut World, units: u32, scopes: &[ChoreObligation]) {
    if units == 0
        || world
            .get_resource::<terri_core::save::SavedDomestic>()
            .is_none_or(|state| !state.dishes.is_empty())
    {
        return;
    }
    let leaders: Vec<_> = world
        .get_resource::<crate::social_conflicts::State>()
        .into_iter()
        .flat_map(|conflicts| {
            scopes
                .iter()
                .filter_map(|scope| {
                    conflicts
                        .dish_contributions
                        .range((*scope, 0)..=(*scope, u32::MAX))
                        .max_by_key(|((_, person), units)| (**units, std::cmp::Reverse(*person)))
                        .map(|((_, person), _)| (*scope, *person))
                })
                .collect::<Vec<_>>()
        })
        .collect();
    let people: BTreeMap<_, _> = world
        .query_filtered::<(Entity, &SimId), (With<terri_core::Agent>, With<terri_core::Needs>)>()
        .iter(world)
        .map(|(e, id)| (id.0, e))
        .collect();
    let Some(chores) = world.remove_resource::<SavedChores>() else {
        return;
    };
    for (scope, leader) in leaders {
        if let Some(&person) = people.get(&leader) {
            completed_verified_in(
                world,
                &chores,
                person.index_u32(),
                scope.key,
                units,
                Some(scope),
            );
        }
    }
    if let Some(mut conflicts) = world.get_resource_mut::<crate::social_conflicts::State>() {
        conflicts
            .dish_contributions
            .retain(|(scope, _), _| !scopes.contains(scope));
    }
    world.insert_resource(chores);
}

/// Geometry and paused commands reconcile ownership without admitting new work.
pub(crate) fn reconcile(world: &mut World) {
    let Some(chores) = world.get_resource::<SavedChores>() else {
        return;
    };
    let Some(mut people_query) = world
        .try_query_filtered::<(Entity, &SimId), (With<terri_core::Agent>, With<terri_core::Needs>)>(
        )
    else {
        return;
    };
    let people: BTreeMap<_, _> = people_query.iter(world).map(|(e, id)| (id.0, e)).collect();
    let keep: BTreeMap<_, _> = world
        .get_resource::<crate::social_conflicts::State>()
        .into_iter()
        .flat_map(|state| state.repairs.iter())
        .filter_map(|(key, row)| {
            people
                .get(&row.recipient)
                .filter(|person| continuity(world, chores, row, **person))
                .map(|person| {
                    (
                        *key,
                        row.working && physical_work(world, chores, *person, row.obligation.key),
                    )
                })
        })
        .collect();
    let Some(chores) = world.remove_resource::<SavedChores>() else {
        return;
    };
    if let Some(mut conflicts) = world.remove_resource::<crate::social_conflicts::State>() {
        conflicts.repairs.retain(|key, row| {
            keep.get(key).is_some_and(|working| {
                row.working = *working;
                true
            })
        });
        prune_contributions(world, &chores, &mut conflicts, &people);
        world.insert_resource(conflicts);
    }
    world.insert_resource(chores);
    crate::fights::retract(world);
}
