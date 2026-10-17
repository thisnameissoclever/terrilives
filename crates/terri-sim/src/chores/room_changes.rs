//! Final-build reconciliation uses baseline object membership, never edited positions.
use super::*;
use crate::rooms::{ResolvedRooms, RoomError, RoomMap};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug)]
pub struct RoomChangeContext {
    pub map: RoomMap,
    pub groups: BTreeMap<ChoreKey, Vec<u32>>,
    pub duties: Vec<ChoreKey>,
    /// Baseline membership survives coordinate translation without serialized visit metadata.
    pub person_rooms: BTreeMap<u32, Option<u32>>,
}
impl RoomChangeContext {
    pub fn capture(world: &World) -> Result<Self, RoomError> {
        let map = world
            .get_resource::<RoomMap>()
            .cloned()
            .ok_or(RoomError::InvalidRoomMap)?;
        let groups = keys(world)
            .into_iter()
            .filter(|key| key.kind.grouped())
            .map(|key| (key, super::groups::members(world, key)))
            .collect();
        let person_rooms = world
            .try_query::<(Entity, &terri_core::Agent, &terri_core::Position)>()
            .map_or_else(BTreeMap::new, |mut query| {
                query
                    .iter(world)
                    .map(|(entity, _, position)| {
                        (
                            entity.index_u32(),
                            map.selection_at((
                                position.x.round() as u32,
                                position.y.round() as u32,
                            ))
                            .map(|room| room.key()),
                        )
                    })
                    .collect()
            });
        Ok(Self {
            map,
            groups,
            duties: keys(world),
            person_rooms,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DutyChangeKind {
    Unchanged,
    Reassigned,
    Automatic,
    Unassigned,
    Retired,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DutyChange {
    pub key: ChoreKey,
    pub previous: Option<ChoreKey>,
    pub owner: Option<u32>,
    pub kind: DutyChangeKind,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DutyChangeReport {
    pub duties: Vec<DutyChange>,
    pub replanned_people: Vec<u32>,
    pub unavailable_people: Vec<u32>,
}

pub fn reconcile_committed_rooms(
    candidate: &mut crate::Sim,
    before: &RoomChangeContext,
    resolved: &ResolvedRooms,
) -> Result<DutyChangeReport, RoomError> {
    reconcile_committed_world(candidate.world_mut(), before, resolved)
}

pub(crate) fn reconcile_committed_world(
    world: &mut World,
    before: &RoomChangeContext,
    resolved: &ResolvedRooms,
) -> Result<DutyChangeReport, RoomError> {
    crate::rooms::install(world, resolved.saved.clone())?;
    if world.resource::<RoomMap>() != &resolved.map {
        return Err(RoomError::InvalidRoomMap);
    }
    let available = keys(world);
    let mut report = DutyChangeReport::default();
    let Some(mut state) = world.remove_resource::<SavedChores>() else {
        for &key in &available {
            let previous = before.duties.contains(&key).then_some(key);
            report.duties.push(DutyChange {
                key,
                previous,
                owner: None,
                kind: if previous.is_some() {
                    DutyChangeKind::Unchanged
                } else {
                    DutyChangeKind::Unassigned
                },
            });
        }
        for &key in &before.duties {
            if !available.contains(&key) {
                report.duties.push(DutyChange {
                    key,
                    previous: Some(key),
                    owner: None,
                    kind: DutyChangeKind::Retired,
                });
            }
        }
        crate::rooms::refresh_visits(world, &before.person_rooms);
        crate::rooms::retain_referenced_history(world);
        return Ok(report);
    };
    let original = state.assignments.clone();
    let mut pairs = Vec::new();
    for key in available.iter().filter(|key| key.kind.grouped()) {
        let members = groups::members(world, *key);
        for (old, old_members) in &before.groups {
            if old.kind != key.kind {
                continue;
            }
            let overlap = members
                .iter()
                .filter(|id| old_members.binary_search(id).is_ok())
                .count();
            if overlap > 0 {
                pairs.push((*old, *key, overlap));
            }
        }
    }
    let assigned: BTreeSet<_> = original.iter().map(|assignment| assignment.key).collect();
    let owner_priority = |old: &ChoreKey, new: &ChoreKey| {
        (
            assigned.contains(old) && old == new,
            assigned.contains(old),
            old == new,
        )
    };
    pairs.sort_by(|(a, an, ac), (b, bn, bc)| {
        owner_priority(b, bn)
            .cmp(&owner_priority(a, an))
            .then_with(|| bc.cmp(ac))
            .then_with(|| a.cmp(b))
            .then_with(|| an.cmp(bn))
    });
    let mut used_old = BTreeSet::new();
    let mut used_new = BTreeSet::new();
    let mut mapping = BTreeMap::new();
    for (old, new, _) in pairs {
        if !used_old.contains(&old) && !used_new.contains(&new) {
            used_old.insert(old);
            used_new.insert(new);
            mapping.insert(old, new);
        }
    }
    for key in &available {
        if !key.kind.grouped() {
            mapping.insert(*key, *key);
        }
    }
    let mut commands = world
        .resource::<terri_core::CommandQueue>()
        .as_slice()
        .to_vec();
    for command in &mut commands {
        if let terri_core::SimCommand::CleanChore { key, .. }
        | terri_core::SimCommand::CleanChoreFirst { key, .. } = command
        {
            if let Some(current) = mapping.get(key) {
                *key = *current;
            }
        }
    }
    world.insert_resource(terri_core::CommandQueue::from_commands(commands));
    state.assignments = original
        .iter()
        .filter_map(|old| {
            mapping.get(&old.key).map(|key| ChoreAssignment {
                key: *key,
                ..old.clone()
            })
        })
        .collect();
    state.assignments.sort_by_key(|a| a.key);
    for episode in &mut state.episodes {
        if episode.settled {
            continue;
        }
        if let Some(key) = mapping.get(&episode.key) {
            episode.key = *key;
        } else {
            episode.settled = true;
            episode.unavailable = true;
            episode.outcome = DutyOutcome::Unavailable;
        }
    }
    for order in &mut state.orders {
        if let Some(key) = mapping.get(&order.key) {
            order.key = *key;
        }
    }
    reconcile_work(world, &mut state, &mapping, &mut report);

    // This policy preserves existing owners and daily decisions and draws only
    // for genuinely new duties when automatic assignment is enabled.
    super::prune_references(world, &mut state);
    let new_duties: Vec<_> = available
        .iter()
        .copied()
        .filter(|key| {
            !mapping
                .iter()
                .any(|(old, new)| new == key && before.duties.contains(old))
        })
        .collect();
    board::assign_new_duties(world, &mut state, &new_duties);
    for key in &available {
        let previous = mapping
            .iter()
            .find_map(|(old, new)| (*new == *key && before.duties.contains(old)).then_some(*old));
        let owner = state
            .assignments
            .iter()
            .find(|a| a.key == *key)
            .map(|a| a.owner);
        let kind = match previous {
            Some(old) if old == *key => DutyChangeKind::Unchanged,
            Some(_) => DutyChangeKind::Reassigned,
            None if owner.is_some() => DutyChangeKind::Automatic,
            None => DutyChangeKind::Unassigned,
        };
        report.duties.push(DutyChange {
            key: *key,
            previous,
            owner,
            kind,
        });
    }
    for old in &before.duties {
        if !mapping.contains_key(old) {
            report.duties.push(DutyChange {
                key: *old,
                previous: Some(*old),
                owner: original
                    .iter()
                    .find(|row| row.key == *old)
                    .map(|row| row.owner),
                kind: DutyChangeKind::Retired,
            });
        }
    }
    world.insert_resource(state);
    super::patches::reconcile(world);
    crate::rooms::refresh_visits(world, &before.person_rooms);
    crate::rooms::retain_referenced_history(world);
    Ok(report)
}

fn reconcile_work(
    world: &mut World,
    state: &mut SavedChores,
    mapping: &BTreeMap<ChoreKey, ChoreKey>,
    report: &mut DutyChangeReport,
) {
    let mut keep = Vec::<ChoreTask>::new();
    let mut unavailable = Vec::new();
    let mut tasks = std::mem::take(&mut state.tasks);
    // A merged duty admits one group worker. Prefer the inherited group's
    // worker, then retain still-valid work by person order.
    tasks.sort_by_key(|task| {
        (
            task.key.kind.grouped() && !mapping.contains_key(&task.key),
            task.person,
        )
    });
    for mut task in tasks {
        let new_key = if matches!(task.key.kind, ChoreKind::Surfaces | ChoreKind::Bins) {
            work::key_valid(world, task.key).then_some(task.key)
        } else {
            mapping.get(&task.key).copied().or_else(|| {
                (task.key.kind.grouped() && work::key_valid(world, task.key)).then_some(task.key)
            })
        };
        let new_key = new_key
            .filter(|key| !key.kind.grouped() || !keep.iter().any(|retained| retained.key == *key));
        if let Some(key) = new_key {
            task.key = key;
        }
        let valid = new_key.is_some()
            && work::plan_valid(world, &task)
            && physical_plan_valid(world, &task)
            && (!task.key.kind.grouped()
                || task
                    .cells
                    .iter()
                    .skip(task.cursor as usize)
                    .all(|id| groups::members(world, task.key).contains(id)))
            && task.endpoint.is_none_or(|cell| {
                task.key.kind == ChoreKind::Floors
                    || work::contact_valid(world, groups::current_key(&task), cell)
            });
        if valid {
            keep.push(task);
            continue;
        }
        if let Some(person) = crate::dining::entity(world, task.person) {
            if !task.suspended
                && world.get::<ChoreWork>(person).is_some()
                && work::may_release_path(world, person)
            {
                world.entity_mut(person).remove::<terri_core::Path>();
            }
        }
        grime::forget(world, task.person);
        let prior_remaining = task.remaining;
        task.endpoint = None;
        task.remaining = 0;
        let remaining = if new_key.is_none() {
            vec![]
        } else if task.key.kind == ChoreKind::Floors {
            let grid = world.resource::<terri_core::TileGrid>();
            state
                .floors
                .iter()
                .filter(|(cell, _)| {
                    crate::rooms::cleaning_area_at(
                        world,
                        (
                            (cell % grid.width() as u32) as i32,
                            (cell / grid.width() as u32) as i32,
                        ),
                    )
                    .is_some_and(|area| area.key() == task.key.target)
                })
                .map(|r| r.0)
                .collect()
        } else if task.key.kind.grouped() {
            groups::members(world, task.key)
                .into_iter()
                .filter(|id| value(&state.surfaces, *id) > 0)
                .collect()
        } else if matches!(task.key.kind, ChoreKind::Surfaces | ChoreKind::Bins) {
            if let Some(endpoint) = work::contact(world, &task) {
                task.endpoint = Some(endpoint);
                task.remaining = prior_remaining;
                vec![task.key.target]
            } else {
                vec![]
            }
        } else {
            vec![]
        };
        if remaining.is_empty() {
            if let Some(person) = crate::dining::entity(world, task.person) {
                world.entity_mut(person).remove::<ChoreWork>();
            }
            unavailable.push((task.key, task.started_day));
            report.unavailable_people.push(task.person);
        } else {
            task.cells = remaining;
            task.cursor = 0;
            report.replanned_people.push(task.person);
            keep.push(task);
        }
    }
    for (key, day) in unavailable {
        if keep
            .iter()
            .any(|task| task.key == key && task.started_day == day)
        {
            continue;
        }
        for episode in &mut state.episodes {
            if episode.key == key && episode.day == day && !episode.settled {
                episode.settled = true;
                episode.unavailable = true;
                episode.outcome = DutyOutcome::Unavailable;
            }
        }
    }
    keep.sort_by_key(|task| task.person);
    state.tasks = keep;
}

fn physical_plan_valid(world: &World, task: &ChoreTask) -> bool {
    let grid = world.resource::<terri_core::TileGrid>();
    if let Some(cell) = task.endpoint {
        let tile = (
            (cell % grid.width() as u32) as i32,
            (cell / grid.width() as u32) as i32,
        );
        if !grid.is_walkable(tile.0, tile.1) {
            return false;
        }
        if task.key.kind == ChoreKind::Floors
            && crate::rooms::cleaning_area_at(world, tile)
                .is_none_or(|area| area.key() != task.key.target)
        {
            return false;
        }
    }
    if let Some(patch) = world
        .get_resource::<terri_core::grime::SavedGrime>()
        .and_then(|state| {
            state
                .patches
                .iter()
                .find(|patch| patch.person == task.person)
        })
    {
        let allowed = super::patches::cells(world, task.key.target, patch.center);
        if patch.cells.iter().any(|cell| !allowed.contains(cell)) {
            return false;
        }
    }
    if task.suspended {
        return true;
    }
    let Some(person) = crate::dining::entity(world, task.person) else {
        return false;
    };
    if world.get::<ChoreWork>(person).is_none() || !work::may_release_path(world, person) {
        return true;
    }
    let Some(path) = world.get::<terri_core::Path>(person) else {
        return true;
    };
    let Some(position) = world.get::<terri_core::Position>(person) else {
        return false;
    };
    let mut previous = (position.x, position.y);
    for &(x, y) in path.steps.iter().skip(path.cursor) {
        if !grid.is_walkable(x, y) || !grid.segment_can_cross(previous, (x as f32, y as f32)) {
            return false;
        }
        previous = (x as f32, y as f32);
    }
    true
}

pub(crate) fn reconcile_migrated_work(world: &mut World) {
    let Some(mut state) = world.remove_resource::<SavedChores>() else {
        return;
    };
    let mapping = keys(world).into_iter().map(|key| (key, key)).collect();
    reconcile_work(
        world,
        &mut state,
        &mapping,
        &mut DutyChangeReport::default(),
    );
    world.insert_resource(state);
    super::patches::reconcile(world);
}

pub(crate) fn validate_current_work(world: &World) -> Result<(), crate::SaveError> {
    if world.get_resource::<SavedChores>().is_some_and(|state| {
        state
            .tasks
            .iter()
            .any(|task| !physical_plan_valid(world, task))
    }) {
        return Err(crate::SaveError::InvalidValue);
    }
    Ok(())
}
