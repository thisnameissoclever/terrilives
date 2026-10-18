//! Failed route searches retry only after a navigation input changes.
use super::*;

#[derive(Clone, PartialEq, Eq)]
struct RecipientTarget {
    object: Entity,
    interaction: u32,
    definition: Option<terri_core::ObjectDefId>,
    position: Option<[u32; 2]>,
}

#[derive(Clone, PartialEq, Eq)]
struct Signature {
    geometry: [u32; 3],
    house: crate::lot_frame::HouseRect,
    people: [Entity; 2],
    positions: [Option<[u32; 2]>; 2],
    destination: Option<(i32, i32)>,
    ready: bool,
    waiting_tile: Option<(i32, i32)>,
    target: Option<RecipientTarget>,
    privacy: crate::systems::interpersonal::NavigationConstraints,
}

#[derive(Clone)]
struct FailedRoute {
    signature: Signature,
    observed: u32,
}

#[derive(Resource, Default)]
struct Failures {
    requests: BTreeMap<u64, FailedRoute>,
    #[cfg(test)]
    attempts: usize,
}

pub(crate) fn invalidate(world: &mut World) {
    world.remove_resource::<Failures>();
}

fn position(world: &World, person: Entity) -> Option<[u32; 2]> {
    world
        .get::<Position>(person)
        .map(|p| [p.x.to_bits(), p.y.to_bits()])
}

fn changed<T: Resource>(world: &World) -> u32 {
    world
        .get_resource_ref::<T>()
        .expect("route dependency")
        .last_changed()
        .get()
}

impl Signature {
    fn read(
        world: &World,
        request: &ConversationRequest,
        ready: bool,
        navigation: &crate::systems::interpersonal::PrivacyNavigation,
    ) -> Self {
        let target = world
            .get::<Target>(request.recipient)
            .map(|t| RecipientTarget {
                object: t.object,
                interaction: t.interaction,
                definition: world.get::<terri_core::SmartObject>(t.object).map(|o| o.0),
                position: position(world, t.object),
            });
        Self {
            geometry: [
                changed::<TileGrid>(world),
                changed::<terri_core::layout::SavedLayout>(world),
                changed::<crate::Content>(world),
            ],
            house: crate::lot_frame::house_or_grid(world),
            people: [request.initiator, request.recipient],
            positions: [
                position(world, request.initiator),
                position(world, request.recipient),
            ],
            destination: world
                .get::<Path>(request.recipient)
                .and_then(|p| p.steps.last().copied()),
            ready,
            waiting_tile: request.waiting_tile,
            target,
            privacy: navigation.constraints().clone(),
        }
    }
}

pub(super) fn prune(world: &mut World) {
    world.init_resource::<Failures>();
    let live: BTreeSet<_> = world
        .resource::<ConversationRequests>()
        .requests
        .keys()
        .copied()
        .collect();
    world
        .resource_mut::<Failures>()
        .requests
        .retain(|id, _| live.contains(id));
}

pub(super) fn plan(
    world: &mut World,
    request: &ConversationRequest,
    ready: bool,
) -> Result<RoutePlan, WaitReason> {
    world.init_resource::<Failures>();
    let navigation =
        crate::systems::interpersonal::PrivacyNavigation::capture(world, request.initiator);
    let signature = Signature::read(world, request, ready, &navigation);
    let hit = world
        .resource::<Failures>()
        .requests
        .get(&request.id)
        .is_some_and(|failed| {
            // An external edit can share a Bevy change tick with the observation.
            // Never reuse such an observation, even after a later tick begins.
            failed.signature == signature
                && !failed.signature.geometry.contains(&failed.observed)
                && failed.signature.privacy.cacheable()
        });
    if hit {
        return Err(WaitReason::NoRoute);
    }
    #[cfg(test)]
    {
        world.resource_mut::<Failures>().attempts += 1;
    }
    let result = super::plan_route_with_navigation(world, request, ready, &navigation);
    let observed = world.read_change_tick().get();
    let mut failures = world.resource_mut::<Failures>();
    if result.is_err() {
        failures.requests.insert(
            request.id,
            FailedRoute {
                signature,
                observed,
            },
        );
    } else {
        failures.requests.remove(&request.id);
    }
    result
}

#[cfg(test)]
pub(crate) fn attempts(world: &World) -> usize {
    world.get_resource::<Failures>().map_or(0, |f| f.attempts)
}
