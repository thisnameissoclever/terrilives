//! Social benefits require active, liked company rather than furniture alone.
use crate::Content;
use bevy_ecs::prelude::*;
use terri_core::{
    Agent, ChainState, Eating, NeedId, Needs, Path, Personality, Position, Relationships, SimId,
    SmartObject, StepWork, Target,
};

#[derive(Clone, PartialEq, Eq)]
enum Activity {
    Media(u32),
    Meal,
    Shared(String),
}

#[derive(Clone)]
struct Participant {
    entity: Entity,
    id: SimId,
    station: Entity,
    activity: Activity,
    position: Position,
}

/// Derived at phase boundaries; it consumes no randomness and is not saved.
#[derive(Resource, Default, Clone)]
pub struct SocialCompany {
    participants: Vec<Participant>,
    groups: std::collections::BTreeMap<(Entity, u32), String>,
    preferences: std::collections::BTreeMap<Entity, crate::compatibility::Preferences>,
    rooms: Option<crate::room_regions::RoomRegions>,
    radius: f32,
}

pub(crate) fn effective_delta(need: u8, delta: f32, social_available: bool) -> bool {
    delta <= 0. || need as usize != NeedId::Social.index() || social_available
}

/// Future Social relief is worth seeking after enough completed chats to become liked.
/// Affinity determines effort; it is not converted into need points.
pub(crate) fn friendship_score(
    deficit: f32,
    delta: f32,
    duration: u32,
    distance: f32,
    affinity: f32,
    gain: f32,
) -> f32 {
    if deficit <= 0. || delta <= 0. || affinity > 0. || gain <= 0. {
        return 0.;
    }
    let building = (-affinity / gain).floor() + 1.;
    let horizon = (building + 1.) * duration as f32;
    let d = deficit.clamp(0., 1.);
    d * d * d * delta / (horizon + distance / crate::systems::advertise::TILES_PER_TICK + 1.)
}

impl SocialCompany {
    pub(crate) fn shared_activity(&self, owner: Entity) -> Option<(Entity, String)> {
        let me = self.participants.iter().find(|p| p.entity == owner)?;
        if let Activity::Shared(group) = &me.activity {
            Some((me.station, group.clone()))
        } else {
            None
        }
    }
    fn allowed(
        &self,
        owner: Entity,
        station: Entity,
        activity: &Activity,
        feelings: &Relationships,
    ) -> bool {
        self.participants.iter().any(|other| {
            other.entity != owner
                && other.station == station
                && &other.activity == activity
                && feelings.feeling(other.id) > 0.
        })
    }

    pub(crate) fn active_allowed(&self, owner: Entity, feelings: &Relationships) -> bool {
        self.participants
            .iter()
            .find(|p| p.entity == owner)
            .is_some_and(|me| match &me.activity {
                Activity::Shared(_) => self.active_shared_allowed(owner, feelings),
                _ => self.allowed(owner, me.station, &me.activity, feelings),
            })
    }

    pub(crate) fn media_allowed(
        &self,
        owner: Entity,
        station: Entity,
        interaction: u32,
        feelings: &Relationships,
    ) -> bool {
        self.allowed(owner, station, &Activity::Media(interaction), feelings)
    }

    pub(crate) fn active_shared_allowed(&self, owner: Entity, feelings: &Relationships) -> bool {
        self.participants
            .iter()
            .find(|p| p.entity == owner)
            .is_some_and(|me| {
                let Activity::Shared(group) = &me.activity else {
                    return false;
                };
                self.shared_company(owner, me.station, group, feelings, me.position)
            })
    }

    pub(crate) fn shared_allowed(
        &self,
        owner: Entity,
        station: Entity,
        interaction: u32,
        feelings: &Relationships,
        endpoint: (i32, i32),
    ) -> bool {
        self.groups
            .get(&(station, interaction))
            .is_some_and(|group| {
                self.shared_company(
                    owner,
                    station,
                    group,
                    feelings,
                    Position {
                        x: endpoint.0 as f32,
                        y: endpoint.1 as f32,
                    },
                )
            })
    }

    fn shared_company(
        &self,
        owner: Entity,
        station: Entity,
        group: &str,
        feelings: &Relationships,
        position: Position,
    ) -> bool {
        if self
            .preferences
            .get(&owner)
            .is_none_or(|p| p.get(group).copied().unwrap_or(0.) < 0.)
        {
            return false;
        }
        let Some(rooms) = &self.rooms else {
            return false;
        };
        let Some(room) = rooms.at((position.x.round() as i32, position.y.round() as i32)) else {
            return false;
        };
        self.participants.iter().any(|other| {
            other.entity != owner
                && other.station != station
                && matches!(&other.activity, Activity::Shared(theirs) if theirs == group)
                && rooms.at((
                    other.position.x.round() as i32,
                    other.position.y.round() as i32,
                )) == Some(room)
                && (other.position.x - position.x).hypot(other.position.y - position.y)
                    <= self.radius
                && feelings.feeling(other.id) > 0.
        })
    }
}

fn participation(world: &World, person: Entity) -> Option<Participant> {
    if world.get::<Path>(person).is_some()
        || world.get::<terri_core::AtWork>(person).is_some()
        || world.get::<terri_core::Commuting>(person).is_some()
        || world.get::<terri_core::Socialising>(person).is_some()
    {
        return None;
    }
    let pack = world.resource::<Content>().0;
    let target = world.get::<Target>(person)?;
    let object = world.get::<SmartObject>(target.object)?;
    let position = *world.get::<Position>(person)?;
    let activity = if let Some(eating) = world.get::<Eating>(person) {
        if eating.object != object.0
            || eating.interaction != target.interaction
            || eating.remaining_ticks == 0
            || world.get::<StepWork>(person).is_some()
        {
            return None;
        }
        let action = pack
            .object(object.0)
            .interactions
            .get(target.interaction as usize)?;
        if let Some(group) = &action.shared_activity {
            let preferences = crate::compatibility::preferences(
                pack,
                world.get::<Personality>(person),
                world.get::<terri_core::Traits>(person),
                world.get::<terri_core::Hobbies>(person),
            );
            if world.get::<terri_core::Fumbled>(person).is_some()
                || preferences.get(group).copied().unwrap_or(0.) < 0.
            {
                return None;
            }
            Activity::Shared(group.clone())
        } else {
            crate::seating::media_activity(pack, object.0, target.interaction)?;
            let contact = crate::seating::claim(world, person.index_u32()).map_or_else(
                || {
                    crate::media::valid_standing_contact(
                        world,
                        person.index_u32(),
                        target.object.index_u32(),
                        (position.x.round() as i32, position.y.round() as i32),
                    )
                },
                |lease| crate::media::valid_lease(world, lease),
            );
            if !contact {
                return None;
            }
            Activity::Media(target.interaction)
        }
    } else {
        if !crate::need_interactions::meal_active(world, person) {
            return None;
        }
        if !crate::dining::seated_at_table(world, person) {
            return None;
        }
        Activity::Meal
    };
    Some(Participant {
        entity: person,
        id: *world.get::<SimId>(person)?,
        station: target.object,
        activity,
        position,
    })
}

pub(crate) fn refresh(world: &mut World) {
    let people: Vec<_> = world
        .query_filtered::<Entity, With<Agent>>()
        .iter(world)
        .collect();
    let pack = world.resource::<Content>().0;
    let mut participants: Vec<_> = people
        .iter()
        .filter_map(|&p| participation(world, p))
        .collect();
    participants.sort_by_key(|p| p.entity.index_u32());
    if !participants
        .iter()
        .any(|p| matches!(p.activity, Activity::Shared(_)))
    {
        world.insert_resource(SocialCompany {
            participants,
            ..Default::default()
        });
        return;
    }
    let preferences = people
        .iter()
        .map(|&p| {
            (
                p,
                crate::compatibility::preferences(
                    pack,
                    world.get::<Personality>(p),
                    world.get::<terri_core::Traits>(p),
                    world.get::<terri_core::Hobbies>(p),
                ),
            )
        })
        .collect();
    let groups = world
        .query::<(Entity, &SmartObject)>()
        .iter(world)
        .flat_map(|(entity, object)| {
            pack.object(object.0)
                .interactions
                .iter()
                .enumerate()
                .filter_map(move |(i, a)| {
                    a.shared_activity
                        .clone()
                        .map(|group| ((entity, i as u32), group))
                })
        })
        .collect();
    world.insert_resource(SocialCompany {
        participants,
        groups,
        preferences,
        rooms: Some(crate::room_regions::RoomRegions::from_world(world)),
        radius: pack.tuning.relationships.contact_radius,
    });
}

/// A shared meal pays only for the minutes actually spent eating in company.
pub(crate) fn tick_meals(world: &mut World) {
    refresh(world);
    let company = world.resource::<SocialCompany>();
    let payments: Vec<_> = company
        .participants
        .iter()
        .filter(|p| p.activity == Activity::Meal)
        .filter_map(|p| {
            let feelings = world
                .get::<Relationships>(p.entity)
                .cloned()
                .unwrap_or_default();
            if !company.active_allowed(p.entity, &feelings) {
                return None;
            }
            let state = world.get::<ChainState>(p.entity)?;
            let chain = world
                .resource::<Content>()
                .0
                .chains
                .get(state.chain as usize)?;
            let delta = chain
                .advertises
                .iter()
                .find(|(id, delta)| *id as usize == NeedId::Social.index() && *delta > 0.)?
                .1;
            let duration = chain.steps.get(state.step as usize)?.duration_ticks as f32;
            let personality = world
                .get::<Personality>(p.entity)
                .map_or(1., |p| p.satisfaction[NeedId::Social.index()]);
            Some((p.entity, delta * personality / duration))
        })
        .collect();
    for (person, delta) in payments {
        if let Some(mut needs) = world.get_mut::<Needs>(person) {
            needs.fill(NeedId::Social, delta);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn critical_social_does_not_create_phantom_media_emergencies() {
        for company in [false, true] {
            let mut sim = crate::Sim::new_with_lot(8, 8);
            let mut pack = sim.world().resource::<Content>().0.clone();
            pack.tuning.relationships.privacy_respect_chance = 1.;
            pack.tuning.relationships.shyness_respect_strength = 0.;
            let pack = Box::leak(Box::new(pack));
            sim.world_mut().insert_resource(Content(pack));
            use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
            sim.world_mut().insert_resource(SavedLayout::EdgeWallsV1 {
                edges: (0..8)
                    .map(|x| WallEdge {
                        axis: EdgeAxis::Horizontal,
                        x,
                        y: 4,
                        doorway: true,
                    })
                    .collect(),
            });
            let television =
                sim.spawn_object(Position { x: 2., y: 2. }, pack.find("television").unwrap());
            let toilet = sim.spawn_object(Position { x: 5., y: 2. }, pack.find("toilet").unwrap());
            crate::apply_object_placement(
                sim.world_mut(),
                television,
                pack.object(pack.find("television").unwrap()),
                Position { x: 2., y: 2. },
                terri_core::Facing::SouthEast,
            );
            let mut spawn = |name: &str, position| {
                crate::household::spawn_member(
                    sim.world_mut(),
                    &pack.personalities,
                    &pack.traits,
                    crate::household::Member {
                        name: name.into(),
                        personality: 0,
                        position,
                        needs: [100.; 7],
                        hobbies: vec![],
                        traits: &[],
                        career: None,
                        instinct: Some(50),
                    },
                )
            };
            let actor = spawn("Lonely", Position { x: 4., y: 5. });
            let private_user = spawn("Private user", Position { x: 5., y: 3. });
            let viewer = spawn("Viewer", Position { x: 3., y: 2. });
            sim.world_mut().entity_mut(private_user).insert((
                Target {
                    object: toilet,
                    interaction: 0,
                },
                Eating {
                    object: pack.find("toilet").unwrap(),
                    interaction: 0,
                    remaining_ticks: 1000,
                },
            ));
            sim.world_mut()
                .entity_mut(toilet)
                .insert(terri_core::Reserved);
            if company {
                sim.world_mut().entity_mut(viewer).insert((
                    Target {
                        object: television,
                        interaction: 0,
                    },
                    Eating {
                        object: pack.find("television").unwrap(),
                        interaction: 0,
                        remaining_ticks: 1000,
                    },
                ));
            } else {
                sim.world_mut().entity_mut(viewer).remove::<Agent>();
            }
            let mut feelings = Relationships::default();
            feelings.bump(*sim.world().get::<SimId>(viewer).unwrap(), 0.5);
            sim.world_mut().entity_mut(actor).insert((
                feelings,
                Target {
                    object: television,
                    interaction: 0,
                },
                Path {
                    steps: vec![(4, 4), (4, 3), (4, 2)],
                    cursor: 0,
                },
            ));
            sim.world_mut()
                .get_mut::<Needs>(actor)
                .unwrap()
                .set(NeedId::Social, 0.);
            sim.world_mut()
                .entity_mut(television)
                .insert(terri_core::Reserved);
            for _ in 0..20 {
                sim.tick();
            }
            let y = sim.world().get::<Position>(actor).unwrap().y;
            assert!(
                y >= 4.,
                "The actor must respect private use when a safe viewing location exists"
            );
            let social = sim.world().get::<Needs>(actor).unwrap().get(NeedId::Social);
            assert_eq!(
                social > 0.,
                company,
                "Only actual shared viewing restores Social: {social}, company={company}"
            );
            if company {
                assert!(
                    sim.world().get::<Eating>(actor).is_some(),
                    "The safe viewing alternative actually started"
                );
            }
        }
    }

    #[test]
    fn social_privacy_substitution_requires_active_liked_company_and_a_free_endpoint() {
        let mut sim = crate::Sim::new_with_lot(8, 8);
        let pack = sim.world().resource::<Content>().0;
        let television =
            sim.spawn_object(Position { x: 2., y: 2. }, pack.find("television").unwrap());
        crate::apply_object_placement(
            sim.world_mut(),
            television,
            pack.object(pack.find("television").unwrap()),
            Position { x: 2., y: 2. },
            terri_core::Facing::SouthEast,
        );
        let first = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                Position { x: 4., y: 3. },
                Needs::with(NeedId::Social, 0.),
            ))
            .id();
        let viewer = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                Position { x: 3., y: 2. },
                Needs::all_at(100.),
                Target {
                    object: television,
                    interaction: 0,
                },
                Eating {
                    object: pack.find("television").unwrap(),
                    interaction: 0,
                    remaining_ticks: 100,
                },
            ))
            .id();
        sim.world_mut()
            .entity_mut(television)
            .insert(terri_core::Reserved);
        let mut feelings = Relationships::default();
        feelings.bump(SimId(1), -0.5);
        sim.world_mut().entity_mut(first).insert(feelings);
        refresh(sim.world_mut());
        let grid = sim.world().resource::<terri_core::TileGrid>().clone();
        assert!(!crate::privacy::substitute(
            sim.world_mut(),
            first,
            NeedId::Social.index() as u8,
            &grid,
            false
        ));
        let mut feelings = Relationships::default();
        feelings.bump(SimId(1), 0.5);
        sim.world_mut().entity_mut(first).insert(feelings);
        sim.world_mut()
            .entity_mut(viewer)
            .remove::<Eating>()
            .insert(Path {
                steps: vec![(3, 2)],
                cursor: 0,
            });
        refresh(sim.world_mut());
        assert!(!crate::privacy::substitute(
            sim.world_mut(),
            first,
            NeedId::Social.index() as u8,
            &grid,
            false
        ));
        sim.world_mut()
            .entity_mut(viewer)
            .remove::<Path>()
            .insert(Eating {
                object: pack.find("television").unwrap(),
                interaction: 0,
                remaining_ticks: 100,
            });
        refresh(sim.world_mut());
        assert!(crate::privacy::substitute(
            sim.world_mut(),
            first,
            NeedId::Social.index() as u8,
            &grid,
            false
        ));
        assert_ne!(
            sim.world().get::<Path>(first).unwrap().steps.last(),
            Some(&(3, 2)),
            "The existing viewer's standing endpoint remains occupied"
        );
    }

    #[test]
    fn social_costs_still_apply_to_solo_interactions() {
        let pack = crate::test_content::pack(vec![crate::test_content::object(
            "costly_activity",
            &[(NeedId::Social, -20.), (NeedId::Fun, 30.)],
            40,
        )]);
        let mut sim = crate::test_content::sim_with(8, 8, pack);
        let object = sim.spawn_object(Position { x: 2., y: 1. }, terri_core::ObjectDefId(0));
        let person = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1., y: 1. },
                Needs::with(NeedId::Social, 50.),
                Target {
                    object,
                    interaction: 0,
                },
                Eating {
                    object: terri_core::ObjectDefId(0),
                    interaction: 0,
                    remaining_ticks: 2,
                },
            ))
            .id();
        sim.world_mut()
            .entity_mut(object)
            .insert(terri_core::Reserved);
        sim.tick();
        let expected = 50. - pack.decay_per_tick[NeedId::Social.index()] - 20. / 40.;
        assert!(
            (sim.world()
                .get::<Needs>(person)
                .unwrap()
                .get(NeedId::Social)
                - expected)
                .abs()
                < 0.00001
        );
    }

    #[test]
    fn media_company_requires_active_shared_use_across_room_and_distance_boundaries() {
        let mut sim = crate::Sim::new_with_lot(16, 16);
        let pack = sim.world().resource::<Content>().0;
        let device = sim.spawn_object(Position { x: 2., y: 3. }, pack.find("television").unwrap());
        crate::apply_object_placement(
            sim.world_mut(),
            device,
            pack.object(pack.find("television").unwrap()),
            Position { x: 2., y: 3. },
            terri_core::Facing::SouthEast,
        );
        let first = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                Position { x: 3., y: 3. },
                Target {
                    object: device,
                    interaction: 0,
                },
                Eating {
                    object: pack.find("television").unwrap(),
                    interaction: 0,
                    remaining_ticks: 30,
                },
            ))
            .id();
        let second = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                Position { x: 3., y: 4. },
                Target {
                    object: device,
                    interaction: 0,
                },
                Eating {
                    object: pack.find("television").unwrap(),
                    interaction: 0,
                    remaining_ticks: 30,
                },
            ))
            .id();
        let mut feelings = Relationships::default();
        feelings.bump(SimId(1), 0.5);
        let allowed = |sim: &crate::Sim| {
            sim.world()
                .resource::<SocialCompany>()
                .active_allowed(first, &feelings)
        };
        assert!(crate::media::valid_standing_contact(
            sim.world(),
            second.index_u32(),
            device.index_u32(),
            (3, 4)
        ));
        refresh(sim.world_mut());
        assert!(allowed(&sim));
        sim.world_mut()
            .entity_mut(second)
            .remove::<Eating>()
            .insert(Path {
                steps: vec![(3, 4)],
                cursor: 0,
            });
        refresh(sim.world_mut());
        assert!(
            !allowed(&sim),
            "A travelling co-user is not participating yet"
        );
        sim.world_mut().entity_mut(second).remove::<Path>().insert((
            Position { x: 7., y: 7. },
            Eating {
                object: pack.find("television").unwrap(),
                interaction: 0,
                remaining_ticks: 30,
            },
        ));
        assert!(crate::media::valid_standing_contact(
            sim.world(),
            second.index_u32(),
            device.index_u32(),
            (7, 7)
        ));
        refresh(sim.world_mut());
        assert!(
            allowed(&sim),
            "Valid shared viewing still counts beyond ordinary affinity-contact range"
        );
        sim.world_mut()
            .entity_mut(second)
            .insert(Position { x: 3., y: 4. });
        use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
        sim.world_mut().insert_resource(SavedLayout::EdgeWallsV1 {
            edges: (0..16)
                .map(|x| WallEdge {
                    axis: EdgeAxis::Horizontal,
                    x,
                    y: 4,
                    doorway: true,
                })
                .collect(),
        });
        assert!(crate::media::valid_standing_contact(
            sim.world(),
            second.index_u32(),
            device.index_u32(),
            (3, 4)
        ));
        refresh(sim.world_mut());
        assert!(
            allowed(&sim),
            "Architectural room boundaries do not erase actual shared device use"
        );
    }

    #[test]
    fn friendship_utility_counts_building_chats_and_requires_future_relief() {
        let neutral = friendship_score(0.8, 30., 40, 0., 0., 0.2);
        assert!((neutral - 0.18962963).abs() < 0.000001);
        let disliked = friendship_score(0.8, 30., 40, 0., -0.2, 0.2);
        assert!((disliked - 0.12694215).abs() < 0.000001);
        assert!(disliked < neutral);
        assert_eq!(friendship_score(0., 30., 40, 0., 0., 0.2), 0.);
        assert_eq!(friendship_score(0.8, 30., 40, 0., 0., 0.), 0.);
        assert_eq!(friendship_score(0.8, 30., 40, 0., 0.1, 0.2), 0.);
        assert_eq!(
            friendship_score(0.8, 30., 40, 0., -1., f32::MIN_POSITIVE / 100.),
            0.
        );
    }
}
