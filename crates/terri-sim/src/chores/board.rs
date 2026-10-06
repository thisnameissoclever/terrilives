use super::{dirt_in, keys, policy, work};
use bevy_ecs::prelude::*;
use terri_core::{
    chores::*, Agent, AtWork, Commuting, Eating, IntentQueue, Needs, Path, Relationships, SimClock,
    SimId, Socialising, Target,
};

fn people(world: &World) -> Vec<(u32, Entity)> {
    let Some(mut q) = world.try_query_filtered::<(Entity, &SimId), With<Agent>>() else {
        return vec![];
    };
    let mut people: Vec<_> = q
        .iter(world)
        .filter(|(e, _)| world.get::<Needs>(*e).is_some())
        .map(|(e, id)| (id.0, e))
        .collect();
    people.sort_by_key(|p| p.0);
    people
}
pub(crate) fn readiness(world: &World, person: Entity) -> f32 {
    let Some(needs) = world.get::<Needs>(person) else {
        return 0.0;
    };
    let critical = world
        .resource::<crate::Content>()
        .0
        .tuning
        .mood_critical_need_level;
    let urgent = [
        terri_core::NeedId::Energy,
        terri_core::NeedId::Hunger,
        terri_core::NeedId::Bladder,
    ]
    .into_iter()
    .map(|n| needs.get(n))
    .fold(100.0, f32::min);
    ((urgent - critical) / (45.0 - critical)).clamp(0.0, 1.0)
}
fn idle(world: &World, state: &SavedChores, person: Entity) -> bool {
    !state.tasks.iter().any(|t| t.person == person.index_u32())
        && world.get::<Path>(person).is_none()
        && world.get::<Target>(person).is_none()
        && world.get::<Eating>(person).is_none()
        && world.get::<Socialising>(person).is_none()
        && world.get::<AtWork>(person).is_none()
        && world.get::<Commuting>(person).is_none()
        && world.get::<terri_core::ChainState>(person).is_none()
        && world
            .get::<IntentQueue>(person)
            .is_none_or(|q| q.is_empty())
}
fn cost(world: &World, key: ChoreKey) -> u32 {
    if key.kind.grouped() {
        return super::groups::members(world, key).len() as u32 * 45;
    }
    if key.kind != ChoreKind::Floors {
        return match key.kind {
            ChoreKind::Dishes => 200,
            ChoreKind::Surfaces => 45,
            ChoreKind::Bins => 60,
            _ => 12,
        };
    }
    let grid = world.resource::<terri_core::TileGrid>();
    let rooms = crate::room_regions::RoomRegions::from_world(world);
    (0..grid.height())
        .flat_map(|y| (0..grid.width()).map(move |x| (x, y)))
        .filter(|(x, y)| {
            grid.is_walkable(*x as i32, *y as i32)
                && rooms.at((*x as i32, *y as i32)) == Some(key.target)
        })
        .count()
        .max(1)
        .div_ceil(9) as u32
        * super::patches::WORK_TICKS
}
pub(crate) fn reconcile(world: &World, state: &mut SavedChores) {
    if !state.board_enabled {
        return;
    }
    let day = world.resource::<SimClock>().tick
        / u64::from(world.resource::<crate::Content>().0.tuning.day_ticks);
    let week = day / 7;
    let live = people(world);
    let roster: Vec<_> = live.iter().map(|p| p.0).collect();
    let available = keys(world);
    for episode in &mut state.episodes {
        if !episode.settled && !available.contains(&episode.key) {
            episode.outcome = DutyOutcome::Unavailable;
            episode.unavailable = true;
            episode.settled = true;
        }
    }
    let cleared: Vec<_> = state
        .episodes
        .iter()
        .filter(|e| {
            e.day == day
                && !e.settled
                && e.needed
                && e.key.kind.grouped()
                && !state.tasks.iter().any(|t| t.key == e.key)
                && dirt_in(world, state, e.key) < 150
        })
        .map(|e| e.id)
        .collect();
    for episode in &mut state.episodes {
        if cleared.contains(&episode.id) {
            episode.needed = false;
            episode.outcome = DutyOutcome::NoWork;
        }
    }
    if state.week != Some(week)
        || state.roster != roster
        || state.assignments.iter().map(|a| a.key).collect::<Vec<_>>() != available
    {
        let profiles: Vec<_> = roster
            .iter()
            .filter_map(|id| state.profiles.iter().find(|p| p.sim_id == *id).cloned())
            .collect();
        let weighted: Vec<_> = available
            .iter()
            .map(|key| (*key, cost(world, *key)))
            .collect();
        let keep = if state.week == Some(week) && state.roster == roster {
            state.assignments.clone()
        } else {
            vec![]
        };
        let rng = state.rng.as_mut().expect("chore stream is initialized");
        state.assignments = if keep.is_empty() {
            policy::assign(&weighted, &profiles, week, rng)
        } else {
            policy::assign_with_existing(&weighted, &profiles, week, rng, &keep)
        };
        state.week = Some(week);
        state.roster = roster;
    }
    for assignment in state.assignments.clone() {
        if let Some(old) = state
            .episodes
            .iter_mut()
            .rev()
            .find(|e| e.key == assignment.key && e.day == day && !e.settled)
        {
            if old.owner == assignment.owner {
                continue;
            }
            old.outcome = DutyOutcome::Unavailable;
            old.unavailable = true;
            old.settled = true;
        } else if state
            .episodes
            .iter()
            .any(|e| e.key == assignment.key && e.day == day && e.completed_at.is_some())
        {
            continue;
        }
        let id = state.next_episode;
        state.next_episode = state
            .next_episode
            .checked_add(1)
            .expect("chore episode identity exhausted");
        state.episodes.push(ChoreEpisode {
            id,
            key: assignment.key,
            owner: assignment.owner,
            day,
            decision: None,
            outcome: DutyOutcome::Pending,
            performer: None,
            completed_at: None,
            settled: false,
            needed: false,
            unavailable: false,
        });
    }
    state.episodes.retain(|e| e.day.saturating_add(8) >= day);
    let episodes: std::collections::BTreeSet<_> = state.episodes.iter().map(|e| e.id).collect();
    state.dish_contributions.retain(|r| episodes.contains(&r.0));
}
fn history(state: &mut SavedChores, id: u32, outcome: u8) {
    if let Some(p) = state.profiles.iter_mut().find(|p| p.sim_id == id) {
        p.commitment = ((u16::from(p.commitment) * 4 + u16::from(outcome)) / 5) as u8;
    }
}
fn effect(
    world: &mut World,
    responsible: u32,
    affected: Entity,
    delta: f32,
    cause: crate::relationship_effects::RelationshipCause,
) {
    let Some(subject) = world.get::<SimId>(affected).copied() else {
        return;
    };
    if subject.0 == responsible {
        return;
    }
    if world.get::<Relationships>(affected).is_none() {
        world.entity_mut(affected).insert(Relationships::default());
    }
    let before = world
        .get::<Relationships>(affected)
        .unwrap()
        .feeling(SimId(responsible));
    world
        .get_mut::<Relationships>(affected)
        .unwrap()
        .bump(SimId(responsible), delta);
    let after = world
        .get::<Relationships>(affected)
        .unwrap()
        .feeling(SimId(responsible));
    let tick = world.resource::<SimClock>().tick;
    world
        .resource_mut::<crate::relationship_effects::RelationshipDiagnostics>()
        .effects
        .push(crate::relationship_effects::RelationshipEffect {
            tick,
            event: 0,
            cause,
            responsible: SimId(responsible),
            affected: subject,
            requested: delta,
            actual: after - before,
            emergency: false,
            directed: false,
        });
}
pub(crate) fn credit(
    world: &mut World,
    state: &mut SavedChores,
    person: u32,
    key: ChoreKey,
    day: u64,
    units: u32,
) {
    if units == 0 {
        return;
    }
    let Some(actor) = crate::dining::entity(world, person)
        .and_then(|e| world.get::<SimId>(e))
        .copied()
    else {
        return;
    };
    let Some(index) = state
        .episodes
        .iter()
        .rposition(|e| e.key == key && e.day == day)
    else {
        return;
    };
    if state.episodes[index].settled {
        return;
    }
    let owner = state.episodes[index].owner;
    let now = world.resource::<SimClock>().tick;
    let today = now / u64::from(world.resource::<crate::Content>().0.tuning.day_ticks);
    let covered = owner != actor.0;
    {
        let e = &mut state.episodes[index];
        e.completed_at = Some(now);
        e.performer = Some(actor.0);
        e.needed = true;
        e.outcome = if covered {
            DutyOutcome::Covered
        } else {
            DutyOutcome::Done
        };
        e.settled = true;
    }
    if !covered {
        history(state, owner, if day == today { 100 } else { 50 });
    } else if state.episodes[index].decision == Some(false) {
        history(state, owner, 50);
    }
    for (_, observer) in people(world) {
        let cleanliness = crate::domestic::cleanliness(world, observer);
        effect(
            world,
            actor.0,
            observer,
            0.006 + 0.006 * cleanliness,
            crate::relationship_effects::RelationshipCause::ChoreFulfilled,
        );
    }
    if covered && state.episodes[index].decision == Some(false) {
        if let Some(helper) = crate::dining::entity(world, person) {
            effect(
                world,
                owner,
                helper,
                -0.004,
                crate::relationship_effects::RelationshipCause::ChoreNeglected,
            );
        }
    }
}
pub(crate) fn tick(world: &mut World, state: &mut SavedChores) {
    reconcile(world, state);
    if !state.board_enabled {
        return;
    }
    let now = world.resource::<SimClock>().tick;
    let day = now / u64::from(world.resource::<crate::Content>().0.tuning.day_ticks);
    let live = people(world);
    for i in 0..state.episodes.len() {
        if state.episodes[i].settled {
            continue;
        }
        let key = state.episodes[i].key;
        let owner = state.episodes[i].owner;
        let person = live.iter().find(|p| p.0 == owner).map(|p| p.1);
        if state.episodes[i].day < day {
            if state
                .tasks
                .iter()
                .any(|t| t.key == key && t.started_day == state.episodes[i].day)
                || (key.kind == ChoreKind::Dishes
                    && state.dish_started.iter().any(|(person, start)| {
                        *start == state.episodes[i].day
                            && world
                                .get_resource::<terri_core::save::SavedDomestic>()
                                .is_some_and(|s| s.cleanup.iter().any(|t| t.person == *person))
                    }))
            {
                continue;
            }
            let missed =
                state.episodes[i].needed && !state.episodes[i].unavailable && person.is_some();
            state.episodes[i].outcome = if missed {
                DutyOutcome::Missed
            } else if state.episodes[i].needed {
                DutyOutcome::Unavailable
            } else {
                DutyOutcome::NoWork
            };
            state.episodes[i].settled = true;
            if missed {
                history(state, owner, 0);
                for (_, observer) in &live {
                    let cleanliness = crate::domestic::cleanliness(world, *observer);
                    effect(
                        world,
                        owner,
                        *observer,
                        -(0.008 + 0.012 * cleanliness),
                        crate::relationship_effects::RelationshipCause::ChoreNeglected,
                    );
                }
            }
            continue;
        }
        let amount = dirt_in(world, state, key);
        let threshold = match key.kind {
            ChoreKind::Dishes => 1,
            ChoreKind::Floors => 250,
            ChoreKind::Surfaces | ChoreKind::CounterSurfaces | ChoreKind::TableSurfaces => 150,
            ChoreKind::Bins => 600,
        };
        if amount < threshold && !state.episodes[i].needed {
            state.episodes[i].outcome = DutyOutcome::NoWork;
            continue;
        }
        state.episodes[i].needed = true;
        if state.episodes[i].outcome == DutyOutcome::NoWork {
            state.episodes[i].outcome = match state.episodes[i].decision {
                Some(true) => DutyOutcome::WillDo,
                Some(false) => DutyOutcome::Skipped,
                None => DutyOutcome::Pending,
            };
        }
        let Some(person) = person else {
            state.episodes[i].unavailable = true;
            continue;
        };
        if !idle(world, state, person) || readiness(world, person) == 0.0 {
            if state.episodes[i].decision.is_none() {
                state.episodes[i].unavailable = true;
            }
            continue;
        }
        if state.episodes[i].decision.is_none() {
            let profile = state
                .profiles
                .iter()
                .find(|p| p.sim_id == owner)
                .cloned()
                .unwrap_or_else(|| ChoreProfile::neutral(owner));
            let mood = crate::mood::score(world, person.index_u32(), state).unwrap_or(0.0) / 8.0;
            let chance = policy::willingness(
                &profile,
                key.kind,
                crate::domestic::cleanliness(world, person),
                readiness(world, person),
                mood,
            );
            let decision = state.rng.as_mut().unwrap().next_f32() < chance;
            state.episodes[i].decision = Some(decision);
            state.episodes[i].unavailable = false;
            state.episodes[i].outcome = if decision {
                DutyOutcome::WillDo
            } else {
                DutyOutcome::Skipped
            };
        }
        if state.episodes[i].decision == Some(true) {
            state.episodes[i].unavailable = !work::start(world, state, person, key, false);
        }
    }
}
