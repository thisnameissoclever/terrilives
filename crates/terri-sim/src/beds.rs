//! Physical sleep places and permanent assignments are separate kinds of ownership.

use std::collections::{BTreeMap, HashMap, HashSet};

use bevy_ecs::prelude::*;
use terri_core::{SimId, SleepPlace, SmartObject, Target};
use terri_data::{CompiledObject, ContentPack};

pub(crate) mod navigation;

/// A physical place on a live bed. The full entity identity prevents reuse.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BedPlace {
    pub bed: Entity,
    pub ordinal: u8,
}

/// Admission and store facts share these physical ownership rules. A bookcase
/// lends copies through the reading planner; it is not one exclusive reader slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActionAdmission {
    Seats,
    WholeSeat,
    Sleep,
    BookSource,
    Exclusive,
}

pub(crate) fn action_admission(
    pack: &ContentPack,
    object: &CompiledObject,
    action: &terri_data::CompiledInteraction,
) -> ActionAdmission {
    if action.book_reading && object.seats.is_empty() {
        ActionAdmission::BookSource
    } else if action.seat_use == terri_data::SeatUse::One {
        ActionAdmission::Seats
    } else if action.seat_use == terri_data::SeatUse::All {
        ActionAdmission::WholeSeat
    } else if !pack.sleep_tag.is_empty() && action.tags.contains(&pack.sleep_tag) {
        ActionAdmission::Sleep
    } else {
        ActionAdmission::Exclusive
    }
}

pub(crate) fn action_capacity(
    pack: &ContentPack,
    object: &CompiledObject,
    action: &terri_data::CompiledInteraction,
) -> Option<u32> {
    match action_admission(pack, object, action) {
        ActionAdmission::BookSource => None,
        ActionAdmission::Seats => Some(object.seats.len() as u32),
        ActionAdmission::Sleep => Some(u32::from(capacity(pack, object))),
        ActionAdmission::WholeSeat | ActionAdmission::Exclusive => Some(1),
    }
}

/// Whole-seat admission requires every physical seat to be free.
pub fn all_seats_required(
    pack: &ContentPack,
    object: &CompiledObject,
    action: &terri_data::CompiledInteraction,
) -> Option<usize> {
    (action_admission(pack, object, action) == ActionAdmission::WholeSeat)
        .then_some(object.seats.len())
}

/// One assignment per stable person identity; active use is carried by SleepPlace.
#[derive(Resource, Debug, Clone, Default, PartialEq, Eq)]
pub struct BedAssignments(BTreeMap<SimId, BedPlace>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum AssignmentRefusal {
    UnknownSim = 1,
    UnknownBed = 2,
    InvalidPlace = 3,
    AlreadyAssigned = 4,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AssignmentResult {
    pub agent: u32,
    pub place: Option<(u32, u8)>,
    pub refusal: Option<AssignmentRefusal>,
}

/// Feedback is presentation state and is neither saved nor hashed.
#[derive(Resource, Debug, Default)]
pub struct AssignmentFeedback {
    pub sequence: u64,
    pub last: Option<AssignmentResult>,
}

/// Copied presentation state. Assignee and occupant are live entity indices for name lookup.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlaceStatus {
    pub bed: u32,
    pub ordinal: u8,
    pub x: f32,
    pub y: f32,
    pub assignee: Option<u32>,
    pub occupant: Option<u32>,
}

impl crate::Sim {
    pub fn bed_places_of(&self, agent: u32) -> Option<Vec<PlaceStatus>> {
        crate::family::sim_id_at(self.world(), agent)?;
        let world = self.world();
        let pack = world.resource::<crate::Content>().0;
        let assignments = world.resource::<BedAssignments>();
        let people: BTreeMap<_, _> = world
            .try_query::<(Entity, &terri_core::Agent, &SimId)>()?
            .iter(world)
            .map(|(entity, _, person)| (*person, entity.index_u32()))
            .collect();
        let mut occupants = HashMap::new();
        if let Some(mut query) =
            world.try_query::<(Entity, &terri_core::Agent, &Target, &SleepPlace)>()
        {
            for (entity, _, target, place) in query.iter(world) {
                occupants.insert((target.object, place.0), entity.index_u32());
            }
        }
        let mut result = Vec::new();
        if let Some(mut query) = world.try_query::<(Entity, &SmartObject, &terri_core::Position)>()
        {
            for (bed, object, position) in query.iter(world) {
                for ordinal in 0..capacity(pack, pack.object(object.0)) {
                    result.push(PlaceStatus {
                        bed: bed.index_u32(),
                        ordinal,
                        x: position.x,
                        y: position.y,
                        assignee: assignments
                            .assignee(BedPlace { bed, ordinal })
                            .and_then(|id| people.get(&id).copied()),
                        occupant: occupants.get(&(bed, ordinal)).copied(),
                    });
                }
            }
        }
        result.sort_unstable_by_key(|place| (place.bed, place.ordinal));
        Some(result)
    }
}

pub fn validate_assignment(
    world: &World,
    agent: u32,
    place: Option<(u32, u8)>,
) -> Result<(SimId, Option<BedPlace>), AssignmentRefusal> {
    let person = crate::family::sim_id_at(world, agent)
        .map(SimId)
        .ok_or(AssignmentRefusal::UnknownSim)?;
    let Some((bed, ordinal)) = place else {
        return Ok((person, None));
    };
    let bed = bevy_ecs::entity::EntityIndex::from_raw_u32(bed)
        .map(|index| world.entities().resolve_from_index(index))
        .filter(|entity| world.get::<SmartObject>(*entity).is_some())
        .ok_or(AssignmentRefusal::UnknownBed)?;
    let definition = world.get::<SmartObject>(bed).unwrap().0;
    let pack = world.resource::<crate::Content>().0;
    let count = pack
        .objects
        .get(definition.0 as usize)
        .map_or(0, |object| capacity(pack, object));
    if ordinal >= count {
        return Err(AssignmentRefusal::InvalidPlace);
    }
    let place = BedPlace { bed, ordinal };
    if world
        .resource::<BedAssignments>()
        .assignee(place)
        .is_some_and(|owner| owner != person)
    {
        return Err(AssignmentRefusal::AlreadyAssigned);
    }
    Ok((person, Some(place)))
}

pub(crate) fn commit(world: &mut World, agent: u32, place: Option<(u32, u8)>) {
    let checked = validate_assignment(world, agent, place);
    if let Ok((person, assignment)) = checked {
        let applied = world
            .resource_mut::<BedAssignments>()
            .set(person, assignment);
        debug_assert!(
            applied,
            "validated assignment remains available in the exclusive drain"
        );
    }
    let mut feedback = world.resource_mut::<AssignmentFeedback>();
    feedback.sequence = feedback.sequence.saturating_add(1);
    feedback.last = Some(AssignmentResult {
        agent,
        place,
        refusal: checked.err(),
    });
}

impl BedAssignments {
    pub fn assigned_to(&self, person: SimId) -> Option<BedPlace> {
        self.0.get(&person).copied()
    }

    pub fn assignee(&self, place: BedPlace) -> Option<SimId> {
        self.0
            .iter()
            .find_map(|(person, known)| (*known == place).then_some(*person))
    }

    pub fn iter(&self) -> impl Iterator<Item = (SimId, BedPlace)> + '_ {
        self.0.iter().map(|(person, place)| (*person, *place))
    }

    /// Conflicts leave the person's previous assignment intact.
    pub(crate) fn set(&mut self, person: SimId, place: Option<BedPlace>) -> bool {
        if place.is_some_and(|place| self.assignee(place).is_some_and(|owner| owner != person)) {
            return false;
        }
        if let Some(place) = place {
            self.0.insert(person, place);
        } else {
            self.0.remove(&person);
        }
        true
    }

    pub(crate) fn remove_bed(&mut self, bed: Entity) {
        self.0.retain(|_, place| place.bed != bed);
    }
}

/// Alternate sleep interactions share these physical places rather than adding capacity.
pub fn capacity(pack: &ContentPack, object: &CompiledObject) -> u8 {
    object.sleep_capacity(&pack.sleep_tag)
}

/// Current sleeping ownership, independent of whether the bed has body art.
/// The caller excludes objects, work and both sides of an active conversation.
pub(crate) fn sleeping_place(world: &World, agent: Entity) -> Option<BedPlace> {
    let eating = world.get::<terri_core::Eating>(agent)?;
    if world.get::<terri_core::StepWork>(agent).is_some()
        || world.get::<terri_core::Path>(agent).is_some()
        || world.get::<terri_core::Commuting>(agent).is_some()
    {
        return None;
    }
    let target = world.get::<Target>(agent)?;
    let place = world.get::<SleepPlace>(agent)?;
    let object = world.get::<SmartObject>(target.object)?;
    world.get::<terri_core::Position>(target.object)?;
    if target.interaction != eating.interaction || object.0 != eating.object {
        return None;
    }
    let pack = world.resource::<crate::Content>().0;
    let definition = pack.objects.get(object.0 .0 as usize)?;
    let interaction = definition.interactions.get(target.interaction as usize)?;
    if pack.sleep_tag.is_empty()
        || !interaction.tags.contains(&pack.sleep_tag)
        || place.0 >= capacity(pack, definition)
    {
        return None;
    }
    Some(BedPlace {
        bed: target.object,
        ordinal: place.0,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Preference {
    Assigned,
    Unassigned,
    SomeoneElses,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Admission {
    Exclusive,
    Seat { ordinal: u16, all: bool },
    Sleep { ordinal: u8, preference: Preference },
}

impl Admission {
    pub(crate) fn apply(self, commands: &mut EntityCommands) {
        match self {
            Self::Exclusive | Self::Seat { .. } => {
                commands.remove::<SleepPlace>();
            }
            Self::Sleep { ordinal, .. } => {
                commands.insert(SleepPlace(ordinal));
            }
        }
    }
}

/// A system-local view: a claim is visible to the next agent before Commands flush.
pub(crate) struct Occupancy {
    targets: Vec<(Entity, Target, Option<SleepPlace>)>,
    orphaned_markers: HashSet<Entity>,
    seats: Vec<(Entity, Entity, u16, bool)>,
    endpoints: Vec<crate::seating::EndpointUse>,
    historical_endpoints: bool,
}

impl Occupancy {
    pub(crate) fn new(
        targets: impl Iterator<Item = (Entity, Target, Option<SleepPlace>)>,
        reserved: impl Iterator<Item = Entity>,
    ) -> Self {
        let targets: Vec<_> = targets.collect();
        let orphaned_markers = reserved
            .filter(|object| {
                !targets
                    .iter()
                    .any(|(_, target, _)| target.object == *object)
            })
            .collect();
        Self {
            targets,
            orphaned_markers,
            seats: vec![],
            endpoints: vec![],
            historical_endpoints: false,
        }
    }

    pub(crate) fn historical_endpoints(&mut self, historical: bool) {
        self.historical_endpoints = historical;
    }

    pub(crate) fn endpoint_available(&self, candidate: crate::seating::EndpointUse) -> bool {
        self.endpoints.iter().all(|known| {
            !crate::seating::endpoints_conflict(candidate, *known, self.historical_endpoints)
        })
    }

    pub(crate) fn claim_endpoint(&mut self, endpoint: crate::seating::EndpointUse) {
        self.endpoints
            .retain(|known| known.owner != endpoint.owner || known.kind != endpoint.kind);
        self.endpoints.push(endpoint);
    }

    pub(crate) fn exclusive_available(&self, agent: Entity, object: Entity) -> bool {
        !self.orphaned_markers.contains(&object)
            && !self
                .seats
                .iter()
                .any(|(owner, item, _, _)| *owner != agent && *item == object)
            && !self
                .targets
                .iter()
                .any(|(owner, target, _)| *owner != agent && target.object == object)
    }

    pub(crate) fn seat_available(&self, agent: Entity, object: Entity, ordinal: u16) -> bool {
        !self.orphaned_markers.contains(&object)
            && !self.seats.iter().any(|(owner, item, seat, all)| {
                *owner != agent && *item == object && (*all || *seat == ordinal)
            })
            && !self.targets.iter().any(|(owner, target, _)| {
                *owner != agent
                    && target.object == object
                    && !self
                        .seats
                        .iter()
                        .any(|(known, item, _, _)| known == owner && *item == object)
            })
    }

    pub(crate) fn physical_seat_claim(
        &mut self,
        owner: Entity,
        object: Entity,
        ordinal: u16,
        all: bool,
    ) {
        self.orphaned_markers.remove(&object);
        self.seats.retain(|(known, _, _, _)| *known != owner);
        self.seats.push((owner, object, ordinal, all));
    }

    pub(crate) fn physical_claim(&mut self, owner: Entity, object: Entity) {
        self.orphaned_markers.remove(&object);
        self.targets.push((
            owner,
            Target {
                object,
                interaction: 0,
            },
            None,
        ));
    }

    pub(crate) fn admissions(
        &self,
        pack: &ContentPack,
        object: &CompiledObject,
        agent: Entity,
        person: Option<SimId>,
        target: Target,
        assignments: &BedAssignments,
    ) -> Vec<Admission> {
        let Some(interaction) = object.interactions.get(target.interaction as usize) else {
            return Vec::new();
        };
        let admission = action_admission(pack, object, interaction);
        if admission == ActionAdmission::BookSource {
            return Vec::new();
        }
        if admission == ActionAdmission::Seats {
            return (0..object.seats.len())
                .filter(|ordinal| self.seat_available(agent, target.object, *ordinal as u16))
                .map(|ordinal| Admission::Seat {
                    ordinal: ordinal as u16,
                    all: false,
                })
                .collect();
        }
        if admission == ActionAdmission::WholeSeat {
            return self
                .exclusive_available(agent, target.object)
                .then_some(Admission::Seat {
                    ordinal: 0,
                    all: true,
                })
                .into_iter()
                .collect();
        }
        if admission == ActionAdmission::Exclusive {
            return self
                .exclusive_available(agent, target.object)
                .then_some(Admission::Exclusive)
                .into_iter()
                .collect();
        }
        if self.orphaned_markers.contains(&target.object) {
            return Vec::new();
        }
        let occupants: Vec<_> = self
            .targets
            .iter()
            .filter(|(owner, known, _)| *owner != agent && known.object == target.object)
            .collect();
        // A target without a sleep lease is an exclusive claim, even on a bed.
        if occupants.iter().any(|(_, known, place)| {
            place.is_none_or(|place| place.0 >= capacity(pack, object))
                || object
                    .interactions
                    .get(known.interaction as usize)
                    .is_none_or(|interaction| !interaction.tags.contains(&pack.sleep_tag))
        }) {
            return Vec::new();
        }
        let held = self.targets.iter().find_map(|(owner, known, place)| {
            (*owner == agent && known.object == target.object)
                .then_some(*place)
                .flatten()
        });
        let mut places: Vec<_> = (0..capacity(pack, object))
            .filter(|ordinal| {
                !occupants
                    .iter()
                    .any(|(_, _, place)| place == &Some(SleepPlace(*ordinal)))
            })
            .map(|ordinal| {
                let place = BedPlace {
                    bed: target.object,
                    ordinal,
                };
                let preference = match assignments.assignee(place) {
                    Some(owner) if Some(owner) == person => Preference::Assigned,
                    None => Preference::Unassigned,
                    Some(_) => Preference::SomeoneElses,
                };
                (ordinal, preference)
            })
            .collect();
        // A replacement order keeps its current place when it remains reachable.
        places.sort_by_key(|(ordinal, preference)| {
            (held != Some(SleepPlace(*ordinal)), *preference, *ordinal)
        });
        places
            .into_iter()
            .map(|(ordinal, preference)| Admission::Sleep {
                ordinal,
                preference,
            })
            .collect()
    }

    pub(crate) fn release(&mut self, agent: Entity) {
        self.targets.retain(|(owner, _, _)| *owner != agent);
        self.seats.retain(|(owner, _, _, _)| *owner != agent);
        self.endpoints.retain(|known| known.owner != agent);
    }

    pub(crate) fn claim(&mut self, agent: Entity, target: Target, admission: Admission) {
        self.release(agent);
        let place = match admission {
            Admission::Exclusive => None,
            Admission::Seat { ordinal, all } => {
                self.physical_seat_claim(agent, target.object, ordinal, all);
                None
            }
            Admission::Sleep { ordinal, .. } => Some(SleepPlace(ordinal)),
        };
        self.targets.push((agent, target, place));
    }
}

/// Prefer an assigned place only over sleep alternatives carrying at least its risk.
/// Other needs remain eligible with their original scores; preference draws no RNG.
pub(crate) fn prefer_assignments(
    candidates: &mut Vec<(Entity, u32, f32)>,
    risks: &mut Vec<f32>,
    admissions: &HashMap<(Entity, u32), Admission>,
) {
    let preference = |at: usize| match admissions.get(&(candidates[at].0, candidates[at].1)) {
        Some(Admission::Sleep { preference, .. }) => Some(*preference),
        _ => None,
    };
    let keep: Vec<_> = (0..candidates.len())
        .map(|at| {
            preference(at).is_none_or(|current| {
                !(0..candidates.len()).any(|other| {
                    preference(other)
                        .is_some_and(|preferred| preferred < current && risks[other] <= risks[at])
                })
            })
        })
        .collect();
    let mut at = 0;
    candidates.retain(|_| {
        let retained = keep[at];
        at += 1;
        retained
    });
    at = 0;
    risks.retain(|_| {
        let retained = keep[at];
        at += 1;
        retained
    });
}

pub(crate) fn hash(world: &World, hasher: &mut terri_core::FnvHasher) {
    let mut active: Vec<_> = world
        .try_query::<(Entity, &SleepPlace, Option<&Target>)>()
        .map_or_else(Vec::new, |mut query| {
            query
                .iter(world)
                .map(|(agent, place, target)| {
                    (
                        agent.index_u32(),
                        target.map(|target| target.object.index_u32()),
                        place.0,
                    )
                })
                .collect()
        });
    active.sort_unstable_by_key(|row| row.0);
    if !active.is_empty() {
        hasher.write_bytes(b"sleep-places-v1");
        hasher.write_u64(active.len() as u64);
        for (agent, bed, ordinal) in active {
            hasher.write_u64(agent.into());
            hasher.write_u64(bed.map_or(u64::MAX, u64::from));
            hasher.write_bytes(&[ordinal]);
        }
    }
    let assignments = world.resource::<BedAssignments>();
    if !assignments.0.is_empty() {
        hasher.write_bytes(b"bed-assignments-v1");
        hasher.write_u64(assignments.0.len() as u64);
        for (person, place) in assignments.iter() {
            hasher.write_u64(person.0.into());
            hasher.write_u64(place.bed.index_u32().into());
            hasher.write_bytes(&[place.ordinal]);
        }
    }
}

#[cfg(test)]
mod tests;
