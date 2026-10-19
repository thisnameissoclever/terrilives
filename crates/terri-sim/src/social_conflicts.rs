//! Attributable incidents retained independently of per-tick diagnostics.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{
    chores::ChoreKey, save_v17::SavedOrderActor, save_v20::*, Agent, FnvHasher, SimClock, SimId,
    Socialising,
};

pub(crate) const MAX_GRIEVANCES_PER_PERSON: usize = 64;
pub(crate) const MAX_GRIEVANCES: usize = 100_000;
pub(crate) const MAX_REPAIRS_PER_PERSON: usize = 16;
pub(crate) const MAX_REPAIRS: usize = 100_000;
pub(crate) const MAX_WITNESSES: usize = 1_000_000;
pub(crate) const MAX_DISH_CONTRIBUTIONS: usize = 100_000;
pub(crate) const MAX_MEMORY_TICKS: u64 = 100_800;

type Signature = (u32, u32, GrievanceKind, GrievanceSubject);

#[derive(Resource, Clone, Debug)]
pub(crate) struct State {
    next_id: u64,
    grievances: BTreeMap<u64, SavedGrievance>,
    affected: BTreeMap<u32, BTreeSet<u64>>,
    pairs: BTreeMap<(u32, u32), BTreeSet<u64>>,
    signatures: BTreeMap<Signature, u64>,
    witnesses: BTreeMap<ChoreObligation, BTreeMap<u32, usize>>,
    pub(crate) fights: BTreeMap<Entity, SavedFightContext>,
    pub(crate) pending_fights: BTreeMap<Entity, SavedFightContext>,
    pub(crate) repairs: BTreeMap<(u32, u64, u32), SavedChoreRepair>,
    pub(crate) dish_contributions: BTreeMap<(ChoreObligation, u32), u32>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            next_id: 1,
            grievances: Default::default(),
            affected: Default::default(),
            pairs: Default::default(),
            signatures: Default::default(),
            witnesses: Default::default(),
            fights: Default::default(),
            pending_fights: Default::default(),
            repairs: Default::default(),
            dish_contributions: Default::default(),
        }
    }
}

impl State {
    fn index(&mut self, row: &SavedGrievance) {
        self.affected
            .entry(row.affected)
            .or_default()
            .insert(row.id);
        self.pairs
            .entry((row.affected, row.responsible))
            .or_default()
            .insert(row.id);
        self.signatures.insert(
            (row.affected, row.responsible, row.kind, row.subject),
            row.id,
        );
        if let GrievanceSubject::Chore(obligation) = row.subject {
            *self
                .witnesses
                .entry(obligation)
                .or_default()
                .entry(row.affected)
                .or_default() += 1;
        }
    }

    fn remove(&mut self, id: u64) {
        let Some(row) = self.grievances.remove(&id) else {
            return;
        };
        if let Some(ids) = self.affected.get_mut(&row.affected) {
            ids.remove(&id);
            if ids.is_empty() {
                self.affected.remove(&row.affected);
            }
        }
        if let Some(ids) = self.pairs.get_mut(&(row.affected, row.responsible)) {
            ids.remove(&id);
            if ids.is_empty() {
                self.pairs.remove(&(row.affected, row.responsible));
            }
        }
        let signature = (row.affected, row.responsible, row.kind, row.subject);
        if self.signatures.get(&signature) == Some(&id) {
            self.signatures.remove(&signature);
            if let Some(latest) = self
                .pairs
                .get(&(row.affected, row.responsible))
                .and_then(|ids| {
                    ids.iter().rev().find_map(|id| {
                        self.grievances
                            .get(id)
                            .filter(|r| r.kind == row.kind && r.subject == row.subject)
                    })
                })
            {
                self.signatures.insert(signature, latest.id);
            }
        }
        if let GrievanceSubject::Chore(obligation) = row.subject {
            if let Some(people) = self.witnesses.get_mut(&obligation) {
                if let Some(count) = people.get_mut(&row.affected) {
                    *count -= 1;
                    if *count == 0 {
                        people.remove(&row.affected);
                    }
                }
                if people.is_empty() {
                    self.witnesses.remove(&obligation);
                }
            }
        }
    }

    fn rebuild(&mut self) {
        self.affected.clear();
        self.pairs.clear();
        self.signatures.clear();
        self.witnesses.clear();
        let rows: Vec<_> = self.grievances.values().cloned().collect();
        for row in rows {
            self.index(&row);
        }
    }

    fn pins(&self) -> (BTreeSet<u64>, BTreeSet<ChoreObligation>) {
        (
            self.fights
                .values()
                .chain(self.pending_fights.values())
                .filter_map(|f| f.grievance)
                .collect(),
            self.repairs.values().map(|r| r.obligation).collect(),
        )
    }

    pub(crate) fn witnesses_for(&self, obligation: ChoreObligation) -> Vec<u32> {
        self.witnesses
            .get(&obligation)
            .map_or_else(Vec::new, |ids| ids.keys().copied().collect())
    }

    pub(crate) fn grievance(&self, id: u64) -> Option<&SavedGrievance> {
        self.grievances.get(&id)
    }

    pub(crate) fn for_person(&self, affected: SimId) -> impl Iterator<Item = &SavedGrievance> {
        self.affected
            .get(&affected.0)
            .into_iter()
            .flat_map(|ids| ids.iter())
            .filter_map(|id| self.grievances.get(id))
    }

    pub(crate) fn for_pair(&self, a: SimId, b: SimId) -> impl Iterator<Item = &SavedGrievance> {
        [(a.0, b.0), (b.0, a.0)]
            .into_iter()
            .flat_map(|pair| self.pairs.get(&pair).into_iter().flat_map(|ids| ids.iter()))
            .filter_map(|id| self.grievances.get(id))
    }

    pub(crate) fn fought(&mut self, grievance: u64, now: u64) {
        if let Some(row) = self.grievances.get_mut(&grievance) {
            row.last_fought = Some(now);
        }
    }
}

pub(crate) fn remember(
    world: &mut World,
    affected: SimId,
    responsible: SimId,
    kind: GrievanceKind,
    subject: GrievanceSubject,
    severity: f32,
) -> Option<u64> {
    if crate::fights::published_rules(world) {
        return None;
    }
    if affected == responsible || !severity.is_finite() || severity <= 0.0 {
        return None;
    }
    let now = world.resource::<SimClock>().tick;
    let tuning = world.resource::<crate::Content>().0.tuning;
    let active_until = now.saturating_add(u64::from(tuning.fight_grievance_ticks));
    let forget_at = now.saturating_add(u64::from(tuning.fight_history_ticks));
    let mut state = world.get_resource_or_insert_with(State::default);
    let signature = (affected.0, responsible.0, kind, subject);
    let coalesced = state
        .signatures
        .get(&signature)
        .and_then(|id| state.grievances.get(id))
        .filter(|row| {
            kind == GrievanceKind::Chore
                || (kind == GrievanceKind::Nuisance && row.last_seen.saturating_add(1) >= now)
        })
        .map(|r| r.id);
    if let Some(id) = coalesced {
        let row = state.grievances.get_mut(&id).unwrap();
        row.last_seen = now;
        row.active_until = active_until;
        row.forget_at = forget_at;
        row.severity = if kind == GrievanceKind::Nuisance {
            (row.severity + severity).min(2.0)
        } else {
            row.severity.max(severity.min(2.0))
        };
        return Some(id);
    }
    let person_full = state
        .affected
        .get(&affected.0)
        .is_some_and(|r| r.len() >= MAX_GRIEVANCES_PER_PERSON);
    if person_full || state.grievances.len() >= MAX_GRIEVANCES {
        let (fights, repairs) = state.pins();
        let candidates: Vec<_> = if person_full {
            state
                .affected
                .get(&affected.0)
                .into_iter()
                .flat_map(|ids| ids.iter())
                .filter_map(|id| state.grievances.get(id))
                .collect()
        } else {
            state.grievances.values().collect()
        };
        let evict = candidates
            .into_iter()
            .filter(|r| {
                !fights.contains(&r.id)
                    && !matches!(r.subject,GrievanceSubject::Chore(o) if repairs.contains(&o))
            })
            .min_by_key(|r| (r.last_seen, r.id))
            .map(|r| r.id)?;
        state.remove(evict);
    }
    let id = state.next_id;
    state.next_id = state.next_id.checked_add(1)?;
    let row = SavedGrievance {
        id,
        affected: affected.0,
        responsible: responsible.0,
        kind,
        subject,
        occurred_at: now,
        last_seen: now,
        active_until,
        forget_at,
        severity: severity.min(2.0),
        last_fought: None,
    };
    state.index(&row);
    state.grievances.insert(id, row);
    Some(id)
}

pub(crate) fn snapshot(world: &World) -> SavedConflictState {
    let Some(state) = world.get_resource::<State>() else {
        return SavedConflictState::default();
    };
    let mut fights: Vec<_> = state
        .fights
        .values()
        .chain(state.pending_fights.values())
        .cloned()
        .collect();
    fights.sort_by_key(|row| (row.initiator, row.order_id));
    SavedConflictState {
        next_id: state.next_id,
        grievances: state.grievances.values().cloned().collect(),
        fights,
        repairs: state.repairs.values().cloned().collect(),
        dish_contributions: state
            .dish_contributions
            .iter()
            .map(|(&(obligation, person), &units)| SavedDishContribution {
                obligation,
                person,
                units,
            })
            .collect(),
    }
}

pub(crate) fn cancel(world: &mut World, initiator: Entity) {
    if let Some(mut state) = world.get_resource_mut::<State>() {
        state.fights.remove(&initiator);
    }
}

pub(crate) fn cancel_order(world: &mut World, initiator: Entity, order: u64) {
    if let Some(mut state) = world.get_resource_mut::<State>() {
        if state
            .fights
            .get(&initiator)
            .is_some_and(|r| r.order_id == Some(order))
        {
            state.fights.remove(&initiator);
        }
        if state
            .pending_fights
            .get(&initiator)
            .is_some_and(|r| r.order_id == Some(order))
        {
            state.pending_fights.remove(&initiator);
        }
    }
}

pub(crate) fn cancel_execution(world: &mut World, initiator: Entity, order: Option<u64>) {
    let retained = order.filter(|id| {
        world
            .resource::<crate::fights::Fights>()
            .owns_order(initiator, *id)
            && world
                .get::<terri_core::IntentQueue>(initiator)
                .is_some_and(|queue| queue.order(*id).is_some())
    });
    if let Some(mut state) = world.get_resource_mut::<State>() {
        if let Some(context) = state.fights.remove(&initiator) {
            if context.autonomous && context.order_id == retained && retained.is_some() {
                state.pending_fights.insert(initiator, context);
            }
        }
        if retained.is_none() {
            if let Some(order) = order {
                if state
                    .pending_fights
                    .get(&initiator)
                    .is_some_and(|row| row.order_id == Some(order))
                {
                    state.pending_fights.remove(&initiator);
                }
            }
        }
    }
}

pub(crate) fn remap_chore_keys(world: &mut World, mut remap: impl FnMut(ChoreKey) -> ChoreKey) {
    if let Some(mut state) = world.get_resource_mut::<State>() {
        for row in state.grievances.values_mut() {
            if let GrievanceSubject::Chore(o) = &mut row.subject {
                o.key = remap(o.key);
            }
        }
        for row in state.repairs.values_mut() {
            row.obligation.key = remap(row.obligation.key);
        }
        let contributions = std::mem::take(&mut state.dish_contributions);
        state.dish_contributions = contributions
            .into_iter()
            .map(|((mut obligation, person), units)| {
                obligation.key = remap(obligation.key);
                ((obligation, person), units)
            })
            .collect();
        state.rebuild();
    }
}

pub(crate) fn remove_actor(world: &mut World, actor: Entity) {
    let id = world.get::<SimId>(actor).copied();
    let saved = crate::player_actions::saved_actor(world, actor);
    if let Some(mut state) = world.get_resource_mut::<State>() {
        let player_pins: BTreeSet<_> = state
            .fights
            .values()
            .filter(|r| !r.autonomous && Some(r.initiator) != saved && Some(r.recipient) != saved)
            .filter_map(|r| r.grievance)
            .collect();
        let remove: Vec<_> = state.grievances.values().filter(|r| id.is_some_and(|id|
            r.affected == id.0 || r.responsible == id.0 || matches!(r.subject,GrievanceSubject::Chore(o) if o.owner == id.0 && !player_pins.contains(&r.id))))
            .map(|r| r.id).collect();
        for id in remove {
            state.remove(id);
        }
        state
            .fights
            .retain(|_, r| Some(r.initiator) != saved && Some(r.recipient) != saved);
        state
            .pending_fights
            .retain(|_, r| Some(r.initiator) != saved && Some(r.recipient) != saved);
        if let Some(id) = id {
            state.repairs.retain(|_, r| {
                r.recipient != id.0 && r.initiator != id.0 && r.obligation.owner != id.0
            });
            for row in state.repairs.values_mut() {
                row.witnesses.retain(|who| *who != id.0);
            }
            state
                .dish_contributions
                .retain(|(scope, person), _| scope.owner != id.0 && *person != id.0);
        }
    }
}

pub(crate) fn tick(world: &mut World) {
    let now = world.resource::<SimClock>().tick;
    let living: BTreeSet<_> = world
        .query_filtered::<&SimId, With<Agent>>()
        .iter(world)
        .map(|id| id.0)
        .collect();
    let Some(mut state) = world.remove_resource::<State>() else {
        return;
    };
    state.pending_fights.retain(|actor, row| {
        row.order_id.is_some_and(|id| {
            world
                .resource::<crate::fights::Fights>()
                .owns_order(*actor, id)
                && world
                    .get::<terri_core::IntentQueue>(*actor)
                    .is_some_and(|queue| queue.order(id).is_some())
        })
    });
    let (fights, repairs) = state.pins();
    let player_pins: BTreeSet<_> = state
        .fights
        .iter()
        .filter(|(actor, context)| {
            !context.autonomous && world.get::<Socialising>(**actor).is_some()
        })
        .filter_map(|(_, context)| context.grievance)
        .collect();
    let valid_keys: BTreeMap<_, _> = state
        .grievances
        .values()
        .filter_map(|r| match r.subject {
            GrievanceSubject::Chore(o) => Some(o.key),
            _ => None,
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|key| (key, crate::chores::key_valid(world, key)))
        .collect();
    let remove: Vec<_> = state.grievances.values().filter(|r|
        !living.contains(&r.affected) || !living.contains(&r.responsible)
            || (r.forget_at <= now && !fights.contains(&r.id) && !matches!(r.subject,GrievanceSubject::Chore(o) if repairs.contains(&o)))
            || (!player_pins.contains(&r.id) && (matches!(r.subject, GrievanceSubject::Nuisance { object, .. } if crate::dining::entity(world, object).is_none())
                || matches!(r.subject, GrievanceSubject::Chore(o) if !valid_keys[&o.key]))))
        .map(|r| r.id).collect();
    for id in remove {
        state.remove(id);
    }
    state.repairs.retain(|_, r| {
        r.deadline >= now && living.contains(&r.recipient) && living.contains(&r.initiator)
    });
    for row in state.repairs.values_mut() {
        row.witnesses.retain(|id| living.contains(id));
    }
    let valid_scopes: BTreeMap<_, _> = state
        .dish_contributions
        .keys()
        .map(|(scope, _)| *scope)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|scope| {
            (
                scope,
                crate::chore_repair::valid_saved_contribution(world, scope, &state.repairs),
            )
        })
        .collect();
    state.dish_contributions.retain(|(scope, person), _| {
        living.contains(person) && living.contains(&scope.owner) && valid_scopes[scope]
    });
    world.insert_resource(state);
}

#[path = "social_conflicts/persistence.rs"]
mod persistence;
pub(crate) use persistence::{adopt_legacy, hash, restore};

#[cfg(test)]
mod tests;
