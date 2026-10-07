//! Directional consequences of inconvenient company and lost bathroom privacy.
use crate::relationship_effects::{RelationshipCause, RelationshipDiagnostics, RelationshipEffect};
use crate::{room_regions::RoomRegions, Content};
use bevy_ecs::prelude::*;
use terri_core::{
    Agent, AtWork, Eating, NeedId, Needs, Position, Relationships, SimId, SmartObject, Target,
};

pub(crate) const PRIVATE_USE_TAG: &str = "bathroom_privacy";

struct Participant {
    entity: Entity,
    id: SimId,
    room: Option<u32>,
    private_room: Option<u32>,
    needs: Needs,
    shyness: terri_core::Shyness,
    directed: bool,
    commuting: bool,
    chain: Option<terri_core::ChainState>,
    feelings: Relationships,
    destination: (i32, i32),
}

/// Object availability at the start of movement, after route reservations settle.
pub(crate) struct BoundaryFurniture {
    pub entity: Entity,
    pub position: Position,
    pub definition: terri_core::ObjectDefId,
    pub facing: terri_data::Facing,
}

struct AffinityEffect {
    offended: SimId,
    responsible: SimId,
    delta: f32,
    cause: RelationshipCause,
    event: u32,
    emergency: bool,
    directed: bool,
}

/// Exists only between movement preparation and effect application.
#[derive(Resource)]
pub struct InterpersonalPhase {
    rooms: RoomRegions,
    domestic: Option<terri_core::save::SavedDomestic>,
    domestic_occupants: Vec<crate::domestic::BoundaryOccupant>,
    participants: Vec<Participant>,
    objects: Vec<(Entity, Option<u32>)>,
    effects: Vec<AffinityEffect>,
    tuning: terri_data::Tuning,
    next_event: u32,
    emergency: std::collections::BTreeSet<Entity>,
    social: crate::social_company::SocialCompany,
    physical_places: Vec<terri_core::save::SavedDiner>,
}

fn tile(position: Position) -> (i32, i32) {
    (position.x.round() as i32, position.y.round() as i32)
}

pub(crate) fn prepare(world: &mut World) {
    crate::privacy::maintain(world);
    let rooms = RoomRegions::from_world(world);
    let pack = world.resource::<Content>().0;
    let mut objects: Vec<_> = world
        .query::<(Entity, &SmartObject, &Position)>()
        .iter(world)
        .map(|(entity, _, position)| (entity, rooms.at(tile(*position))))
        .collect();
    objects.sort_by_key(|(entity, _)| entity.index());
    let mut participants: Vec<_> = world
        .query_filtered::<(Entity, &SimId, &Position, &Needs), (With<Agent>, Without<AtWork>)>()
        .iter(world)
        .map(|(entity, &id, &position, needs)| {
            let private_room = world.get::<Eating>(entity).and_then(|eating| {
                let target = world.get::<Target>(entity)?;
                let object = world.get::<SmartObject>(target.object)?;
                if object.0 != eating.object {
                    return None;
                }
                let act = pack
                    .object(object.0)
                    .interactions
                    .get(eating.interaction as usize)?;
                if !act.tags.iter().any(|tag| tag == PRIVATE_USE_TAG) {
                    return None;
                }
                rooms.at(tile(*world.get::<Position>(target.object)?))
            });
            Participant {
                entity,
                id,
                destination: world
                    .get::<terri_core::Path>(entity)
                    .and_then(|p| p.steps.last().copied())
                    .unwrap_or(tile(position)),
                room: rooms.at(tile(position)),
                private_room,
                needs: *needs,
                shyness: crate::shyness::of(world, entity),
                directed: crate::privacy::directed(world, entity),
                commuting: world.get::<terri_core::Commuting>(entity).is_some(),
                chain: world.get::<terri_core::ChainState>(entity).copied(),
                feelings: world
                    .get::<Relationships>(entity)
                    .cloned()
                    .unwrap_or_default(),
            }
        })
        .collect();
    participants.sort_by_key(|p| p.entity.index());
    let domestic = world
        .get_resource::<terri_core::save::SavedDomestic>()
        .cloned();
    let domestic_occupants = crate::domestic::boundary_occupants(world);
    let physical_places = crate::seating::physical_places(world);
    let social = world
        .resource::<crate::social_company::SocialCompany>()
        .clone();
    world.insert_resource(InterpersonalPhase {
        domestic,
        domestic_occupants,
        rooms,
        participants,
        objects,
        effects: Vec::new(),
        tuning: pack.tuning,
        next_event: 0,
        emergency: Default::default(),
        social,
        physical_places,
    });
}

impl InterpersonalPhase {
    pub(crate) fn entry_blocked(&self, agent: Entity, position: Position) -> bool {
        let room = self.rooms.at(tile(position));
        room.is_some()
            && self
                .participants
                .iter()
                .find(|p| p.entity == agent)
                .is_some_and(|p| p.room != room)
            && self
                .participants
                .iter()
                .any(|p| p.entity != agent && p.private_room == room)
    }
    pub(crate) fn start_blocked(&self, agent: Entity, object: Entity) -> bool {
        let room = self
            .objects
            .iter()
            .find(|(e, _)| *e == object)
            .and_then(|(_, r)| *r);
        room.is_some()
            && self
                .participants
                .iter()
                .any(|p| p.entity != agent && p.room == room)
    }
    pub(crate) fn safe_grid(
        &self,
        agent: Entity,
        grid: &terri_core::TileGrid,
    ) -> terri_core::TileGrid {
        let mut safe = grid.clone();
        let current = self
            .participants
            .iter()
            .find(|p| p.entity == agent)
            .and_then(|p| p.room);
        for y in 0..grid.height() {
            for x in 0..grid.width() {
                let room = self.rooms.at((x as i32, y as i32));
                if room.is_some()
                    && room != current
                    && self
                        .participants
                        .iter()
                        .any(|p| p.entity != agent && p.private_room == room)
                {
                    safe.set_blocked(x, y, true);
                }
            }
        }
        safe
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn permit(
        &mut self,
        agent: Entity,
        target: Option<&Target>,
        pack: &terri_data::ContentPack,
        object: Option<terri_core::ObjectDefId>,
        position: Position,
        grid: &terri_core::TileGrid,
        furniture: &[BoundaryFurniture],
        occupancy: &crate::beds::Occupancy,
        assignments: &crate::beds::BedAssignments,
        tick: u64,
        decisions: &mut crate::privacy::BoundaryDecisions,
        rng: &mut terri_core::SimRng,
    ) -> bool {
        let Some(person) = self.participants.iter().find(|p| p.entity == agent) else {
            return true;
        };
        if person.directed || person.commuting {
            return true;
        }
        let social_available = target.is_some_and(|t| {
            self.social
                .media_allowed(agent, t.object, t.interaction, &person.feelings)
        });
        let helped = object
            .zip(target)
            .and_then(|(id, t)| {
                let action = pack.object(id).interactions.get(t.interaction as usize)?;
                let shared = self.social.shared_allowed(
                    agent,
                    t.object,
                    t.interaction,
                    &person.feelings,
                    person.destination,
                );
                let seat = self
                    .physical_places
                    .iter()
                    .find(|p| p.person == agent.index_u32() && p.station == t.object.index_u32())
                    .and_then(|p| p.chair)
                    .and_then(|id| furniture.iter().find(|seat| seat.entity.index_u32() == id))
                    .map_or(0., |seat| pack.object(seat.definition).seat_comfort_rate());
                Some(crate::need_interactions::benefits(
                    pack,
                    action,
                    &person.needs,
                    social_available,
                    seat,
                    shared,
                ))
            })
            .or_else(|| {
                target
                    .filter(|t| t.interaction == super::chain::CHAIN_STEP)
                    .and(person.chain)
                    .map(|c| {
                        pack.chains[c.chain as usize]
                            .advertises
                            .iter()
                            .copied()
                            .filter(|&(n, d)| crate::social_company::effective_delta(n, d, false))
                            .collect()
                    })
            });
        let mut need = helped.as_ref().map_or(100.0, |act| {
            act.iter()
                .filter(|(_, delta)| *delta > 0.0)
                .map(|(need, _)| person.needs.get(NeedId::ALL[*need as usize]))
                .fold(100.0, f32::min)
        });
        // Occupancy can change earlier in this very movement pass. Check the
        // updated room state before treating a critical need as unavoidable.
        // A safe alternative is selected by the next routing pass; keep the
        // current reservation and chain intact while waiting for that pass.
        if pack.tuning.relationships.privacy_respect_chance > 0.0
            && need <= pack.tuning.mood_critical_need_level
        {
            let safe = self.safe_grid(agent, grid);
            let relevant = helped.as_ref().and_then(|act| {
                act.iter()
                    .filter(|(_, d)| *d > 0.0)
                    .min_by(|(a, _), (b, _)| {
                        person
                            .needs
                            .get(NeedId::ALL[*a as usize])
                            .total_cmp(&person.needs.get(NeedId::ALL[*b as usize]))
                    })
                    .map(|(n, _)| *n)
            });
            let role = target
                .filter(|t| t.interaction == super::chain::CHAIN_STEP)
                .and(person.chain)
                .map(|c| pack.chains[c.chain as usize].steps[c.step as usize].role);
            let field = safe.distance_field(tile(position));
            let alternate = field.as_ref().is_some_and(|field| {
                furniture.iter().any(|item| {
                    let definition = pack.object(item.definition);
                    let access = crate::beds::navigation::Access::new(
                        definition,
                        &pack.sleep_tag,
                        item.facing,
                        tile(item.position),
                        field,
                    );
                    let reachable = |admission| {
                        access
                            .for_admission(admission)
                            .and_then(|route| route.route.path(&safe, tile(position)))
                            .and_then(|steps| safe.anchor_path((position.x, position.y), steps))
                            .is_some()
                    };
                    if let Some(role) = role {
                        let _ = role;
                        return person.chain.is_some_and(|chain| {
                            crate::domestic::boundary_route(
                                pack,
                                self.domestic.as_ref(),
                                agent,
                                Some(person.id),
                                chain,
                                item.entity,
                                item.definition,
                                Some(&terri_core::ObjectFacing(item.facing)),
                                item.position,
                                position,
                                &safe,
                                occupancy.exclusive_available(agent, item.entity),
                                &self.domestic_occupants,
                            )
                            .is_some()
                        });
                    }
                    definition
                        .interactions
                        .iter()
                        .enumerate()
                        .any(|(index, a)| {
                            let media =
                                crate::seating::media_activity(pack, item.definition, index as u32)
                                    .is_some();
                            let seated = crate::seating::seated_activity(
                                pack,
                                item.definition,
                                index as u32,
                            )
                            .is_some();
                            let plan = seated
                                .then(|| {
                                    crate::media::plan(
                                        crate::media::Planning {
                                            pack,
                                            grid: &safe,
                                            field,
                                            objects: furniture,
                                            occupancy,
                                            claims: &self.physical_places,
                                        },
                                        agent,
                                        item,
                                    )
                                })
                                .flatten();
                            let social_available = plan.as_ref().is_some_and(|_| {
                                self.social.media_allowed(
                                    agent,
                                    item.entity,
                                    index as u32,
                                    &person.feelings,
                                )
                            });
                            let shared = access
                                .nearest(false)
                                .and_then(|route| route.route.path(&safe, tile(position)))
                                .is_some_and(|steps| {
                                    self.social.shared_allowed(
                                        agent,
                                        item.entity,
                                        index as u32,
                                        &person.feelings,
                                        steps.last().copied().unwrap_or(tile(position)),
                                    )
                                });
                            let seat = plan
                                .as_ref()
                                .and_then(|p| p.lease.as_ref())
                                .and_then(|p| p.chair)
                                .and_then(|id| {
                                    furniture.iter().find(|seat| seat.entity.index_u32() == id)
                                })
                                .map_or(0., |seat| {
                                    pack.object(seat.definition).seat_comfort_rate()
                                });
                            crate::need_interactions::benefits(
                                pack,
                                a,
                                &person.needs,
                                social_available,
                                seat,
                                shared,
                            )
                            .iter()
                            .any(|&(n, d)| Some(n) == relevant && d > 0.)
                                && (!a.tags.iter().any(|tag| tag == PRIVATE_USE_TAG)
                                    || !self.start_blocked(agent, item.entity))
                                && occupancy
                                    .admissions(
                                        pack,
                                        definition,
                                        agent,
                                        Some(person.id),
                                        Target {
                                            object: item.entity,
                                            interaction: index as u32,
                                        },
                                        assignments,
                                    )
                                    .into_iter()
                                    .any(|admission| {
                                        // A viewing use needs its planned place; seated
                                        // work without a chair keeps the standing route.
                                        match (media, plan.as_ref()) {
                                            (_, Some(plan)) => plan
                                                .access
                                                .route
                                                .path(&safe, tile(position))
                                                .is_some(),
                                            (true, None) => false,
                                            (false, None) => reachable(admission),
                                        }
                                    })
                        })
                })
            });
            if alternate {
                need = 100.0;
            }
        }
        let (allowed, emergency) = decisions.permits(
            person.id,
            target.map(|t| (t.object.index_u32(), t.interaction)),
            tick,
            need,
            person.shyness.value(),
            pack.tuning,
            rng,
        );
        if emergency {
            self.emergency.insert(agent);
        }
        allowed
    }
    pub(crate) fn object_cost(&self, agent: Entity, object: Entity, tags: &[String]) -> f32 {
        let room = self
            .objects
            .iter()
            .find(|(e, _)| *e == object)
            .and_then(|(_, room)| *room);
        let Some(room) = room else {
            return 0.0;
        };
        let private = tags.iter().any(|tag| tag == PRIVATE_USE_TAG);
        let violates = self.participants.iter().any(|p| {
            p.entity != agent && (p.private_room == Some(room) || (private && p.room == Some(room)))
        });
        if violates {
            self.shyness(agent)
                .avoidance_cost(self.tuning.social_boundary_avoidance_cost)
        } else {
            0.0
        }
    }
    pub(crate) fn social_cost(
        &self,
        agent: Entity,
        partner: Entity,
        interaction: u32,
        pack: &terri_data::ContentPack,
    ) -> f32 {
        let Some(partner) = self.participants.iter().find(|p| p.entity == partner) else {
            return 0.0;
        };
        if conversation_need_penalty(&partner.needs, interaction, pack, (1.0, 1.0)) > 0.0 {
            self.shyness(agent)
                .avoidance_cost(self.tuning.social_boundary_avoidance_cost)
        } else {
            0.0
        }
    }
    pub(crate) fn path_intrudes(&self, agent: Entity, steps: &[(i32, i32)]) -> bool {
        let Some(person) = self.participants.iter().find(|p| p.entity == agent) else {
            return false;
        };
        let mut previous = person.room;
        for &step in steps {
            let room = self.rooms.at(step);
            if room != previous
                && room.is_some()
                && self
                    .participants
                    .iter()
                    .any(|p| p.entity != agent && p.private_room == room)
            {
                return true;
            }
            previous = room;
        }
        false
    }
    pub(crate) fn reconsider_chance(&self, entity: Entity) -> f32 {
        self.shyness(entity).wander_reconsider_chance(
            self.tuning.boundary_wander_reconsider_chance,
            self.tuning.shyness_wander_reconsider_strength,
        )
    }
    pub(crate) fn shyness(&self, entity: Entity) -> terri_core::Shyness {
        self.participants
            .iter()
            .find(|p| p.entity == entity)
            .map_or(terri_core::Shyness::new(50).unwrap(), |p| p.shyness)
    }
    pub(crate) fn moved(&mut self, entity: Entity, position: Position, penalty: f32) {
        let room = self.rooms.at(tile(position));
        let Some(entrant) = self.participants.iter_mut().find(|p| p.entity == entity) else {
            return;
        };
        let previous = entrant.room;
        entrant.room = room;
        if room.is_none() || previous == room {
            return;
        }
        let id = entrant.id;
        let directed = entrant.directed;
        let emergency = self.emergency.contains(&entity);
        self.next_event += 1;
        for user in &self.participants {
            if user.id != id && user.private_room == room {
                self.effects.push(AffinityEffect {
                    offended: user.id,
                    responsible: id,
                    cause: RelationshipCause::PrivacyEntry,
                    event: self.next_event,
                    directed,
                    emergency,
                    delta: -penalty
                        * user
                            .shyness
                            .annoyance_scale(self.tuning.shyness_annoyance_strength),
                });
            }
        }
    }

    pub(crate) fn private_start(&mut self, entity: Entity, object: Entity, penalty: f32) {
        let Some(room) = self
            .objects
            .iter()
            .find(|(e, _)| *e == object)
            .and_then(|(_, room)| *room)
        else {
            return;
        };
        let Some(user) = self.participants.iter_mut().find(|p| p.entity == entity) else {
            return;
        };
        user.private_room = Some(room);
        let id = user.id;
        let directed = user.directed;
        let emergency = self.emergency.contains(&entity);
        self.next_event += 1;
        for observer in &self.participants {
            if observer.id != id && observer.room == Some(room) {
                self.effects.push(AffinityEffect {
                    offended: observer.id,
                    responsible: id,
                    cause: RelationshipCause::PrivacyStart,
                    event: self.next_event,
                    directed,
                    emergency,
                    delta: -penalty
                        * observer
                            .shyness
                            .annoyance_scale(self.tuning.shyness_annoyance_strength),
                });
            }
        }
    }

    pub(crate) fn conversation_start(
        &mut self,
        initiator: Entity,
        partner: Entity,
        interaction: u32,
        pack: &terri_data::ContentPack,
    ) {
        let Some(initiator) = self.participants.iter().find(|p| p.entity == initiator) else {
            return;
        };
        let Some(partner) = self.participants.iter().find(|p| p.entity == partner) else {
            return;
        };
        let t = pack.tuning;
        let magnitude = conversation_need_penalty(
            &partner.needs,
            interaction,
            pack,
            (t.social_unmet_need_penalty, t.social_critical_need_penalty),
        );
        self.effects.push(AffinityEffect {
            offended: partner.id,
            responsible: initiator.id,
            cause: if magnitude == t.social_critical_need_penalty {
                RelationshipCause::CriticalNeedInterruption
            } else {
                RelationshipCause::LowNeedInterruption
            },
            event: 0,
            directed: initiator.directed,
            emergency: false,
            delta: -magnitude
                * partner
                    .shyness
                    .annoyance_scale(self.tuning.shyness_annoyance_strength),
        });
    }
}

fn conversation_need_penalty(
    needs: &Needs,
    interaction: u32,
    pack: &terri_data::ContentPack,
    penalties: (f32, f32),
) -> f32 {
    let mut helped = [false; 7];
    for &(need, delta) in &pack.social[interaction as usize].advertises {
        if delta > 0.0 {
            helped[need as usize] = true;
        }
    }
    unmet_need_penalty(
        &NeedId::ALL.map(|need| needs.get(need)),
        &helped,
        pack.tuning.mood_low_need_level,
        pack.tuning.mood_critical_need_level,
        penalties.0,
        penalties.1,
    )
}

pub(crate) fn apply(world: &mut World) {
    let phase = world
        .remove_resource::<InterpersonalPhase>()
        .expect("movement phase must be prepared");
    for effect in phase.effects {
        if effect.delta == 0.0
            && !matches!(
                effect.cause,
                RelationshipCause::PrivacyEntry | RelationshipCause::PrivacyStart
            )
        {
            continue;
        }
        let Some(person) = phase.participants.iter().find(|p| p.id == effect.offended) else {
            continue;
        };
        let before = world
            .get::<Relationships>(person.entity)
            .map_or(0.0, |r| r.feeling(effect.responsible));
        if let Some(mut feelings) = world.get_mut::<Relationships>(person.entity) {
            feelings.bump(effect.responsible, effect.delta);
        } else {
            let mut feelings = Relationships::default();
            feelings.bump(effect.responsible, effect.delta);
            world.entity_mut(person.entity).insert(feelings);
        }
        let actual = world
            .get::<Relationships>(person.entity)
            .unwrap()
            .feeling(effect.responsible)
            - before;
        let tick = world.resource::<terri_core::SimClock>().tick;
        world
            .resource_mut::<RelationshipDiagnostics>()
            .effects
            .push(RelationshipEffect {
                tick,
                event: effect.event,
                cause: effect.cause,
                responsible: effect.responsible,
                affected: effect.offended,
                requested: effect.delta,
                actual,
                emergency: effect.emergency,
                directed: effect.directed,
            });
    }
}

/// Refresh task routing facts without resetting the incident ordering baseline.
pub(crate) fn refresh_routes(world: &mut World) {
    crate::social_company::refresh(world);
    let social = world
        .resource::<crate::social_company::SocialCompany>()
        .clone();
    let physical_places = crate::seating::physical_places(world);
    let domestic = world
        .get_resource::<terri_core::save::SavedDomestic>()
        .cloned();
    let occupants = crate::domestic::boundary_occupants(world);
    let chains: Vec<_> = world
        .query::<(Entity, Option<&terri_core::ChainState>)>()
        .iter(world)
        .map(|(e, c)| (e, c.copied()))
        .collect();
    let mut phase = world.resource_mut::<InterpersonalPhase>();
    phase.domestic = domestic;
    phase.domestic_occupants = occupants;
    phase.social = social;
    phase.physical_places = physical_places;
    for person in &mut phase.participants {
        person.chain = chains
            .iter()
            .find(|(e, _)| *e == person.entity)
            .and_then(|(_, c)| *c);
    }
}

#[cfg(test)]
#[path = "interpersonal_tests.rs"]
mod integration_tests;

pub(crate) fn unmet_need_penalty(
    levels: &[f32; 7],
    helped: &[bool; 7],
    low_level: f32,
    critical_level: f32,
    low_penalty: f32,
    critical_penalty: f32,
) -> f32 {
    let mut penalty = 0.0;
    for (&level, &helps) in levels.iter().zip(helped) {
        if helps {
            continue;
        }
        if level <= critical_level {
            return critical_penalty;
        }
        if level <= low_level {
            penalty = low_penalty;
        }
    }
    penalty
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unmet_need_uses_the_worst_unhelped_need_once() {
        for (level, expected) in [
            (40.01, 0.0),
            (40.0, 0.20),
            (20.01, 0.20),
            (20.0, 0.35),
            (0.0, 0.35),
        ] {
            let levels = [level; 7];
            assert_eq!(
                unmet_need_penalty(&levels, &[false; 7], 40.0, 20.0, 0.20, 0.35),
                expected
            );
            assert_eq!(
                unmet_need_penalty(&levels, &[true; 7], 40.0, 20.0, 0.20, 0.35),
                0.0
            );
        }
        let mut levels = [100.0; 7];
        levels[0] = 35.0;
        levels[1] = 10.0;
        let mut helped = [false; 7];
        helped[1] = true;
        assert_eq!(
            unmet_need_penalty(&levels, &helped, 40.0, 20.0, 0.20, 0.35),
            0.20
        );
    }
}
