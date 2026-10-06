//! Ordinary company and shared activities, distinct from one-time incidents.
use crate::compatibility::Preferences;
use crate::relationship_effects::{RelationshipCause, RelationshipDiagnostics, RelationshipEffect};
use crate::{compatibility, room_regions::RoomRegions, Content};
use bevy_ecs::prelude::*;
use terri_core::{
    Agent, AtWork, Commuting, Eating, Hobbies, NeedId, Needs, Personality, Position, Relationships,
    SimClock, SimId, SmartObject, Socialising, Target, Traits,
};

#[derive(Resource, Default)]
#[doc(hidden)]
pub struct RelationshipContext(pub(crate) std::collections::BTreeMap<Entity, Preferences>);

/// Rebuild unsaved preferences before selection, including the first restored tick.
pub(crate) fn refresh_profiles(world: &mut World) {
    let pack = world.resource::<Content>().0;
    let people: Vec<_> = world
        .query_filtered::<Entity, With<Agent>>()
        .iter(world)
        .collect();
    let profiles = people
        .into_iter()
        .map(|person| {
            (
                person,
                compatibility::preferences(
                    pack,
                    world.get::<Personality>(person),
                    world.get::<Traits>(person),
                    world.get::<Hobbies>(person),
                ),
            )
        })
        .collect();
    world.insert_resource(RelationshipContext(profiles));
}

pub(crate) fn positive_allowed(
    subject: &Needs,
    other: &Needs,
    helped: &[(u8, f32)],
    tuning: &terri_data::Tuning,
) -> bool {
    other.get(NeedId::Hygiene) > tuning.mood_low_need_level
        && NeedId::ALL.into_iter().all(|need| {
            subject.get(need) > tuning.mood_critical_need_level
                || helped
                    .iter()
                    .any(|&(index, delta)| index as usize == need.index() && delta > 0.0)
        })
}

pub(crate) fn positive_scale(score: f32) -> f32 {
    (1.0 + score).clamp(0.25, 2.0)
}

/// A completed chat can establish friendship even when loneliness is critical.
/// Its positive Social advertisement exempts loneliness for relationship growth;
/// actual meter delivery still requires a positive feeling toward the partner.
pub(crate) fn conversation_positive_allowed(
    subject: &Needs,
    other: &Needs,
    advertisements: &[(u8, f32)],
    tuning: &terri_data::Tuning,
) -> bool {
    positive_allowed(subject, other, advertisements, tuning)
}

struct Contact {
    entity: Entity,
    id: SimId,
    position: Position,
    room: Option<u32>,
    needs: Needs,
    preferences: Preferences,
    helped: Vec<(u8, f32)>,
    activity: Option<(Entity, String)>,
}

pub(crate) fn tick(world: &mut World) {
    crate::social_company::refresh(world);
    let pack = world.resource::<Content>().0;
    let tuning = pack.tuning;
    let rates = tuning.relationships;
    let rooms = RoomRegions::from_world(world);
    let conversations: Vec<_> = world
        .query::<(Entity, &Socialising)>()
        .iter(world)
        .filter(|(_, talk)| {
            world.get::<Agent>(talk.partner).is_some()
                && world.get::<terri_core::Reserved>(talk.partner).is_some()
                && world.get::<Target>(talk.partner).is_none()
        })
        .map(|(e, talk)| (e, *talk))
        .collect();
    let talks: std::collections::BTreeSet<_> = conversations
        .iter()
        .flat_map(|(a, talk)| [(*a, talk.partner), (talk.partner, *a)])
        .collect();
    let mut profiles = std::collections::BTreeMap::new();
    let mut contacts: Vec<_> = world
        .query_filtered::<(Entity, &SimId, &Position, &Needs), With<Agent>>()
        .iter(world)
        .filter_map(|(entity, &id, &position, needs)| {
            let preferences = compatibility::preferences(
                pack,
                world.get::<Personality>(entity),
                world.get::<Traits>(entity),
                world.get::<Hobbies>(entity),
            );
            profiles.insert(entity, preferences.clone());
            let eating = world.get::<Eating>(entity);
            if world.get::<AtWork>(entity).is_some()
                || world.get::<Commuting>(entity).is_some()
                || crate::systems::circadian::is_asleep(pack, eating)
            {
                return None;
            }
            let act = eating.and_then(|e| {
                let target = world.get::<Target>(entity)?;
                let object = world.get::<SmartObject>(target.object)?;
                if object.0 != e.object || target.interaction != e.interaction {
                    return None;
                }
                Some((
                    target.object,
                    pack.object(e.object)
                        .interactions
                        .get(e.interaction as usize)?,
                ))
            });
            if act.is_some_and(|(_, a)| {
                a.tags
                    .iter()
                    .any(|tag| tag == crate::systems::interpersonal::PRIVATE_USE_TAG)
            }) {
                return None;
            }
            Some(Contact {
                entity,
                id,
                position,
                room: rooms.at((position.x.round() as i32, position.y.round() as i32)),
                needs: *needs,
                preferences,
                helped: if let Some((_, talk)) = conversations
                    .iter()
                    .find(|(a, talk)| *a == entity || talk.partner == entity)
                {
                    pack.social[talk.interaction as usize].advertises.clone()
                } else {
                    crate::need_interactions::active_benefits(world, entity)
                },
                activity: world
                    .resource::<crate::social_company::SocialCompany>()
                    .shared_activity(entity),
            })
        })
        .collect();
    contacts.sort_by_key(|p| p.entity.index());
    world.resource_mut::<RelationshipContext>().0 = profiles;
    let tick = world.resource::<SimClock>().tick;
    for subject in &contacts {
        for other in &contacts {
            if subject.entity == other.entity
                || subject.room.is_none()
                || subject.room != other.room
                || (subject.position.x - other.position.x)
                    .hypot(subject.position.y - other.position.y)
                    > rates.contact_radius
            {
                continue;
            }
            world
                .resource_mut::<RelationshipDiagnostics>()
                .contacts
                .push((subject.id, other.id));
            if talks.contains(&(subject.entity, other.entity)) {
                continue;
            }
            let score = compatibility::between(&subject.preferences, &other.preferences);
            let shared = subject
                .activity
                .as_ref()
                .zip(other.activity.as_ref())
                .is_some_and(|((a, group), (b, theirs))| {
                    a != b
                        && group == theirs
                        && subject.preferences.get(group).copied().unwrap_or(0.0) >= 0.0
                        && other.preferences.get(group).copied().unwrap_or(0.0) >= 0.0
                });
            let (cause, requested) = if shared {
                (
                    RelationshipCause::SharedActivity,
                    rates.proximity_per_hour
                        * rates.shared_activity_multiplier
                        * positive_scale(score)
                        / 60.0,
                )
            } else if score < rates.incompatible_below {
                (
                    RelationshipCause::Incompatibility,
                    -rates.friction_per_hour * (rates.incompatible_below - score)
                        / (1.0 + rates.incompatible_below)
                        / 60.0,
                )
            } else {
                (
                    RelationshipCause::Proximity,
                    rates.proximity_per_hour / 60.0,
                )
            };
            if requested == 0.0
                || (requested > 0.0
                    && !positive_allowed(&subject.needs, &other.needs, &subject.helped, &tuning))
            {
                continue;
            }
            let before = world
                .get::<Relationships>(subject.entity)
                .map_or(0.0, |r| r.feeling(other.id));
            let mut feelings = world
                .get::<Relationships>(subject.entity)
                .cloned()
                .unwrap_or_default();
            feelings.bump(other.id, requested);
            let actual = feelings.feeling(other.id) - before;
            world.entity_mut(subject.entity).insert(feelings);
            world
                .resource_mut::<RelationshipDiagnostics>()
                .effects
                .push(RelationshipEffect {
                    tick,
                    event: 0,
                    cause,
                    responsible: other.id,
                    affected: subject.id,
                    requested,
                    actual,
                    emergency: false,
                    directed: false,
                });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Content, Sim};
    use terri_core::{Agent, Eating, NeedId, Needs, Position, Relationships, SimId, Target};

    fn pair() -> (Sim, Entity, Entity) {
        let mut sim = Sim::new_with_lot(8, 8);
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.relationships.proximity_per_hour = 0.002;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        let a = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                Position { x: 2.0, y: 2.0 },
                Needs::all_at(100.0),
            ))
            .id();
        let b = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                Position { x: 3.0, y: 2.0 },
                Needs::all_at(100.0),
            ))
            .id();
        (sim, a, b)
    }
    fn feeling(sim: &Sim, entity: Entity, other: SimId) -> f32 {
        sim.world()
            .get::<Relationships>(entity)
            .map_or(0.0, |r| r.feeling(other))
    }
    #[test]
    fn proximity_recovers_existing_dislike_but_smell_and_critical_needs_block_positive_gain() {
        let (mut sim, a, b) = pair();
        let mut feelings = Relationships::default();
        feelings.bump(SimId(1), -0.7);
        sim.world_mut().entity_mut(a).insert(feelings);
        tick(sim.world_mut());
        assert!(feeling(&sim, a, SimId(1)) > -0.7);
        let before = feeling(&sim, a, SimId(1));
        sim.world_mut()
            .get_mut::<Needs>(b)
            .unwrap()
            .set(NeedId::Hygiene, 40.0);
        tick(sim.world_mut());
        assert_eq!(feeling(&sim, a, SimId(1)), before);
        sim.world_mut()
            .get_mut::<Needs>(b)
            .unwrap()
            .set(NeedId::Hygiene, 100.0);
        sim.world_mut()
            .get_mut::<Needs>(a)
            .unwrap()
            .set(NeedId::Bladder, 20.0);
        tick(sim.world_mut());
        assert_eq!(feeling(&sim, a, SimId(1)), before);
    }
    #[test]
    fn a_redirected_conversation_partner_cannot_claim_social_help_from_the_old_talk() {
        let (mut sim, a, b) = pair();
        let c = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(2),
                Position { x: 2.0, y: 3.0 },
                Needs::all_at(100.0),
            ))
            .id();
        let pack = sim.world().resource::<Content>().0;
        let def = pack.find("bookshelf").unwrap();
        let object = sim.spawn_object(Position { x: 1.0, y: 2.0 }, def);
        sim.world_mut()
            .get_mut::<Needs>(a)
            .unwrap()
            .set(NeedId::Social, 10.0);
        sim.world_mut().entity_mut(c).insert(Socialising {
            partner: a,
            interaction: 0,
            remaining_ticks: 20,
        });
        sim.world_mut().entity_mut(a).insert((
            terri_core::Reserved,
            Target {
                object,
                interaction: 0,
            },
            Eating {
                object: def,
                interaction: 0,
                remaining_ticks: 20,
            },
        ));
        tick(sim.world_mut());
        assert_eq!(feeling(&sim, a, SimId(1)), 0.0);
        assert!(feeling(&sim, b, SimId(0)) > 0.0);
    }

    #[test]
    fn critical_needs_helped_by_active_chains_or_either_conversation_role_allow_proximity() {
        for case in ["chain", "initiator", "partner"] {
            let (mut sim, a, b) = pair();
            let pack = sim.world().resource::<Content>().0;
            let need = if case == "chain" {
                NeedId::Hunger
            } else {
                NeedId::Social
            };
            sim.world_mut().get_mut::<Needs>(a).unwrap().set(need, 10.0);
            if case == "chain" {
                let chain = pack
                    .chains
                    .iter()
                    .position(|c| {
                        c.advertises
                            .iter()
                            .any(|&(n, d)| n as usize == need.index() && d > 0.0)
                    })
                    .unwrap();
                sim.world_mut().entity_mut(a).insert((
                    terri_core::ChainState::begin(chain as u32),
                    terri_core::StepWork {
                        remaining_ticks: 20,
                    },
                ));
            } else {
                let c = sim
                    .world_mut()
                    .spawn((
                        Agent,
                        SimId(2),
                        Position { x: 2.0, y: 3.0 },
                        Needs::all_at(100.0),
                    ))
                    .id();
                let (initiator, partner) = if case == "initiator" { (a, c) } else { (c, a) };
                sim.world_mut()
                    .entity_mut(partner)
                    .insert(terri_core::Reserved);
                let interaction = pack
                    .social
                    .iter()
                    .position(|act| {
                        act.advertises
                            .iter()
                            .any(|&(n, d)| n as usize == need.index() && d > 0.0)
                    })
                    .unwrap() as u32;
                sim.world_mut().entity_mut(initiator).insert(Socialising {
                    interaction,
                    partner,
                    remaining_ticks: 20,
                });
            }
            tick(sim.world_mut());
            assert!(feeling(&sim, a, SimId(1)) > 0.0, "{case}");
            assert_eq!(
                feeling(&sim, a, SimId(2)),
                0.0,
                "conversation pair must not double count"
            );
            assert!(feeling(&sim, b, SimId(0)) > 0.0);
        }
    }

    #[test]
    fn shared_reading_pays_ten_times_proximity_and_does_not_also_pay_proximity() {
        let (mut sim, a, b) = pair();
        let pack = sim.world().resource::<Content>().0;
        for (e, id, x) in [(a, "bookshelf", 1.0), (b, "reading_chair", 4.0)] {
            let definition = pack.find(id).unwrap();
            let object = sim.spawn_object(Position { x, y: 2.0 }, definition);
            sim.world_mut().entity_mut(e).insert((
                Target {
                    object,
                    interaction: 0,
                },
                Eating {
                    object: definition,
                    interaction: 0,
                    remaining_ticks: 30,
                },
            ));
        }
        tick(sim.world_mut());
        assert!((feeling(&sim, a, SimId(1)) - 0.02 / 60.0).abs() < 0.0000001);
        let events = sim.relationship_effects();
        assert_eq!(events.len(), 2);
        assert!(events
            .iter()
            .all(|e| e.cause == crate::relationship_effects::RelationshipCause::SharedActivity));
    }

    #[test]
    fn contact_excludes_walls_distance_sleep_private_use_commutes_and_conversations() {
        for case in [
            "wall", "distance", "sleep", "private", "commute", "work", "talk",
        ] {
            let (mut sim, a, b) = pair();
            let pack = sim.world().resource::<Content>().0;
            match case {
                "wall" => {
                    use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
                    sim.world_mut().insert_resource(SavedLayout::EdgeWallsV1 {
                        edges: (0..8)
                            .map(|y| WallEdge {
                                axis: EdgeAxis::Vertical,
                                x: 3,
                                y,
                                doorway: false,
                            })
                            .collect(),
                    });
                }
                "distance" => {
                    sim.world_mut().get_mut::<Position>(b).unwrap().x = 7.0;
                }
                "commute" => {
                    sim.world_mut().entity_mut(b).insert(Commuting);
                }
                "work" => {
                    sim.world_mut().entity_mut(b).insert(AtWork {
                        remaining_ticks: 20,
                    });
                }
                "talk" => {
                    sim.world_mut().entity_mut(b).insert(terri_core::Reserved);
                    sim.world_mut().entity_mut(a).insert(Socialising {
                        interaction: 0,
                        partner: b,
                        remaining_ticks: 20,
                    });
                }
                _ => {
                    let def = if case == "sleep" {
                        pack.objects
                            .iter()
                            .position(|o| {
                                o.interactions
                                    .iter()
                                    .any(|a| a.tags.iter().any(|t| t == &pack.sleep_tag))
                            })
                            .unwrap()
                    } else {
                        pack.find("toilet").unwrap().0 as usize
                    };
                    let object = sim.spawn_object(
                        Position { x: 5.0, y: 5.0 },
                        terri_core::ObjectDefId(def as u32),
                    );
                    sim.world_mut().entity_mut(a).insert((
                        Target {
                            object,
                            interaction: 0,
                        },
                        Eating {
                            object: terri_core::ObjectDefId(def as u32),
                            interaction: 0,
                            remaining_ticks: 20,
                        },
                    ));
                }
            }
            tick(sim.world_mut());
            assert_eq!(feeling(&sim, a, SimId(1)), 0.0, "{case}");
            assert_eq!(feeling(&sim, b, SimId(0)), 0.0, "{case}");
        }
    }

    #[test]
    fn shared_activity_suspends_friction_but_failed_or_disliked_activity_does_not() {
        for (failed, disliked) in [(false, false), (true, false), (false, true)] {
            let (mut sim, a, b) = pair();
            let pack = sim.world().resource::<Content>().0;
            let reading = pack.find("bookshelf").unwrap();
            let exercise = pack.find("moving_box").unwrap();
            for (entity, weight, x) in [(a, 2.0, 1.0), (b, 0.0, 4.0)] {
                let personality = Personality::with_dispositions(
                    [1.0; 7],
                    [1.0; 7],
                    vec![
                        (exercise, 0, weight),
                        (reading, 0, if disliked && entity == a { 0.0 } else { 1.0 }),
                    ],
                );
                let object = sim.spawn_object(Position { x, y: 3.0 }, reading);
                sim.world_mut().entity_mut(entity).insert((
                    personality,
                    Target {
                        object,
                        interaction: 0,
                    },
                    Eating {
                        object: reading,
                        interaction: 0,
                        remaining_ticks: 20,
                    },
                ));
            }
            if failed {
                sim.world_mut()
                    .entity_mut(a)
                    .insert(terri_core::Fumbled { delta_scale: 0.5 });
            }
            tick(sim.world_mut());
            if failed || disliked {
                assert!(feeling(&sim, a, SimId(1)) < 0.0);
            } else {
                assert!((feeling(&sim, a, SimId(1)) - 0.02 / 60.0 * 0.25).abs() < 1e-8);
            }
        }
    }
}
