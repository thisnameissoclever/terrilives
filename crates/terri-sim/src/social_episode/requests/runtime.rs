//! Transient observations cross native reconstruction by stable person identity.
use super::*;
use terri_core::SimId;

#[derive(Clone, Debug, PartialEq, Eq)]
struct ObservedRequest {
    initiator: u32,
    recipient: u32,
    interaction: u32,
    origin: ConversationOrigin,
    created: u64,
    phase: RequestPhase,
    reason: Option<WaitReason>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Runtime {
    requests: BTreeMap<u64, ObservedRequest>,
    delays: BTreeMap<u32, Option<u32>>,
}

pub(crate) fn capture(world: &World) -> Runtime {
    let state = world.resource::<ConversationRequests>();
    Runtime {
        requests: state
            .requests
            .values()
            .filter_map(|request| {
                Some((
                    request.id,
                    ObservedRequest {
                        initiator: world.get::<SimId>(request.initiator)?.0,
                        recipient: world.get::<SimId>(request.recipient)?.0,
                        interaction: request.interaction,
                        origin: request.origin,
                        created: request.created,
                        phase: request.phase,
                        reason: state.reasons.get(&request.id).copied(),
                    },
                ))
            })
            .collect(),
        delays: state
            .delays
            .iter()
            .filter_map(|(person, delay)| Some((world.get::<SimId>(*person)?.0, *delay)))
            .collect(),
    }
}

/// Restore observations only for the validated destination's same commitments.
/// Persistent records and their coordinate-bearing fields remain destination-owned.
pub(crate) fn restore(runtime: &Runtime, world: &mut World) {
    let people: BTreeMap<_, _> = world
        .query_filtered::<(Entity, &SimId), With<Agent>>()
        .iter(world)
        .map(|(person, id)| (id.0, person))
        .collect();
    let observations = capture(world);
    let reasons = runtime
        .requests
        .iter()
        .filter_map(|(id, previous)| {
            let mut current = observations.requests.get(id)?.clone();
            current.reason = previous.reason;
            (current == *previous).then_some((*id, previous.reason?))
        })
        .collect();
    let delays = runtime
        .delays
        .iter()
        .filter_map(|(id, delay)| Some((*people.get(id)?, *delay)))
        .collect();
    let mut state = world.resource_mut::<ConversationRequests>();
    state.reasons = reasons;
    state.delays = delays;
    rebuild(world);
}

pub(crate) fn rebuild(world: &mut World) {
    let marked: Vec<_> = world
        .query_filtered::<Entity, With<CommittedConversation>>()
        .iter(world)
        .collect();
    for person in marked {
        world.entity_mut(person).remove::<CommittedConversation>();
    }
    refresh_markers(world);
    route_cache::invalidate(world);
}

/// Coordinate translation changes waiting locations, never request identities.
pub(crate) fn translate(world: &mut World, offset: (u32, u32)) {
    for request in world
        .resource_mut::<ConversationRequests>()
        .requests
        .values_mut()
    {
        if let Some((x, y)) = &mut request.waiting_tile {
            *x += offset.0 as i32;
            *y += offset.1 as i32;
        }
    }
    route_cache::invalidate(world);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observations_remap_person_zero_without_replacing_validated_requests() {
        let mut source = World::new();
        let a = source.spawn((Agent, SimId(0))).id();
        let b = source.spawn((Agent, SimId(1))).id();
        let request = ConversationRequest {
            id: 10,
            initiator: a,
            recipient: b,
            interaction: 0,
            origin: ConversationOrigin::Player { order_id: 4 },
            created: 2,
            phase: RequestPhase::Waiting,
            waiting_tile: Some((2, 3)),
        };
        source.insert_resource(ConversationRequests {
            next_id: 11,
            requests: BTreeMap::from([(10, request.clone())]),
            reasons: BTreeMap::from([(10, WaitReason::Privacy)]),
            delays: BTreeMap::from([(a, Some(7))]),
        });
        let runtime = capture(&source);
        let mut destination = World::new();
        destination.spawn_empty();
        let new_b = destination.spawn((Agent, SimId(1))).id();
        let new_a = destination.spawn((Agent, SimId(0))).id();
        assert_ne!(a, new_a);
        let translated = ConversationRequest {
            initiator: new_a,
            recipient: new_b,
            waiting_tile: Some((12, 13)),
            ..request
        };
        destination.insert_resource(ConversationRequests {
            next_id: 99,
            requests: BTreeMap::from([(10, translated.clone())]),
            ..Default::default()
        });
        restore(&runtime, &mut destination);
        let result = destination.resource::<ConversationRequests>();
        assert_eq!(result.next_id, 99);
        assert_eq!(result.requests, BTreeMap::from([(10, translated)]));
        assert_eq!(result.reasons.get(&10), Some(&WaitReason::Privacy));
        assert_eq!(result.delays, BTreeMap::from([(new_a, Some(7))]));
        assert_eq!(
            destination.get::<CommittedConversation>(new_a).unwrap().0,
            10
        );
        destination
            .resource_mut::<ConversationRequests>()
            .requests
            .get_mut(&10)
            .unwrap()
            .created += 1;
        restore(&runtime, &mut destination);
        assert!(destination
            .resource::<ConversationRequests>()
            .reasons
            .is_empty());
    }
}
