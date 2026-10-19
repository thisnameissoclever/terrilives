//! The authenticated producer's fight policy preserves its original random draws.
use super::*;
use terri_core::chores::DutyOutcome;

pub(super) fn reason_against(world: &World, owner: SimId) -> Option<Reason> {
    let state = world.get_resource::<SavedChores>()?;
    state
        .episodes
        .iter()
        .rev()
        .filter(|e| e.owner == owner.0 && e.settled && e.outcome == DutyOutcome::Missed)
        .find(|e| crate::chores::work_needed(world, state, e.key, e.owner))
        .map(|e| {
            if e.key.kind == ChoreKind::Dishes {
                Reason::Dishes
            } else {
                Reason::OtherChore
            }
        })
}

fn approachable(world: &mut World, person: Entity) -> bool {
    world.get::<terri_core::AtWork>(person).is_none()
        && world.get::<terri_core::Commuting>(person).is_none()
        && world.get::<Socialising>(person).is_none()
        && !world
            .query::<&Socialising>()
            .iter(world)
            .any(|talk| talk.partner == person)
}

pub(super) fn provoke(world: &mut World) {
    let pack = world.resource::<crate::Content>().0;
    let Some(fight) = fight_index(pack) else {
        return;
    };
    retract(world);
    let threshold = pack.tuning.fight_affinity_threshold;
    let chance = pack.tuning.fight_chance_per_tick;
    let now = world.resource::<SimClock>().tick;
    let Some(mut query) = world.try_query_filtered::<(Entity, &SimId), With<Agent>>() else {
        return;
    };
    let mut people: Vec<(SimId, Entity)> = query
        .iter(world)
        .filter(|(e, _)| world.get::<Needs>(*e).is_some())
        .map(|(e, id)| (*id, e))
        .collect();
    people.sort_by_key(|(id, _)| *id);
    for &(id, person) in &people {
        if !idle(world, person)
            || world.resource::<Fights>().active(id, now)
            || crate::social_episode::urgent(world, person)
        {
            continue;
        }
        let Some(feelings) = world.get::<Relationships>(person) else {
            continue;
        };
        let grudges: Vec<(SimId, Entity)> = people
            .iter()
            .filter(|(other_id, other)| {
                *other != person && feelings.feeling(*other_id) <= threshold
            })
            .copied()
            .collect();
        for (other_id, other) in grudges {
            if !approachable(world, other)
                || crate::social_episode::urgent(world, other)
                || reason_against(world, other_id).is_none()
            {
                continue;
            }
            if world.resource_mut::<SimRng>().next_f32() >= chance {
                continue;
            }
            let intent = Intent {
                cleanup: None,
                chore: None,
                object: other,
                interaction: fight,
            };
            let mut entity = world.entity_mut(person);
            let id = match entity.get_mut::<IntentQueue>() {
                Some(mut queue) => queue.insert_order(intent, None, true),
                None => {
                    let mut queue = IntentQueue::default();
                    let id = queue.insert_order(intent, None, true);
                    entity.insert(queue);
                    id
                }
            };
            if let Some(id) = id {
                world.resource_mut::<Fights>().restore_order(person, id);
            }
            break;
        }
    }
}
