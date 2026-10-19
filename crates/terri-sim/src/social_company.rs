//! Social benefits require actual company; affinity scales its value.
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
    strength: f32,
    identities: std::collections::BTreeMap<Entity, SimId>,
    family: terri_core::layout::FamilyTies,
}

pub(crate) fn effective_delta(need: u8, delta: f32, social_available: bool) -> bool {
    delta <= 0. || need as usize != NeedId::Social.index() || social_available
}

pub(crate) fn solo_social(action: &terri_data::CompiledInteraction) -> bool {
    action.activity == Some(terri_data::CompiledActivity::Correspondence)
}

pub(crate) fn social_scale(action: &terri_data::CompiledInteraction, company: f32) -> f32 {
    if solo_social(action) {
        1.
    } else {
        company
    }
}

impl SocialCompany {
    pub(crate) fn active_scale(&self, owner: Entity, feelings: &Relationships) -> f32 {
        let Some(me) = self.participants.iter().find(|p| p.entity == owner) else {
            return 0.;
        };
        self.scale(owner, me.station, &me.activity, feelings, me.position)
    }
    fn peers<'a>(
        &'a self,
        owner: Entity,
        station: Entity,
        activity: &'a Activity,
        position: Position,
    ) -> impl Iterator<Item = &'a Participant> {
        self.participants.iter().filter(move |p| {
            if p.entity == owner || &p.activity != activity {
                return false;
            }
            match activity {
                Activity::Shared(group) => {
                    p.station != station
                        && self
                            .preferences
                            .get(&owner)
                            .is_some_and(|prefs| prefs.get(group).copied().unwrap_or(0.) >= 0.)
                        && self.rooms.as_ref().is_some_and(|r| {
                            let room = r.at((position.x.round() as i32, position.y.round() as i32));
                            room.is_some()
                                && room
                                    == r.at((
                                        p.position.x.round() as i32,
                                        p.position.y.round() as i32,
                                    ))
                        })
                        && (p.position.x - position.x).hypot(p.position.y - position.y)
                            <= self.radius
                }
                _ => p.station == station,
            }
        })
    }
    fn scale(
        &self,
        owner: Entity,
        station: Entity,
        activity: &Activity,
        feelings: &Relationships,
        position: Position,
    ) -> f32 {
        let mut value = 0.0f32;
        let mut related = false;
        for other in self.peers(owner, station, activity, position) {
            related |= self
                .identities
                .get(&owner)
                .is_some_and(|id| self.family.relation(id.0, other.id.0).is_some());
            value = value.max(crate::social_episode::benefit(
                feelings.feeling(other.id),
                self.strength,
                false,
            ));
        }
        value + crate::social_episode::family_bonus(related)
    }
    pub(crate) fn proposed_scale(
        &self,
        owner: Entity,
        station: Entity,
        interaction: u32,
        feelings: &Relationships,
        endpoint: (i32, i32),
    ) -> f32 {
        let activity = self
            .groups
            .get(&(station, interaction))
            .map_or(Activity::Media(interaction), |g| {
                Activity::Shared(g.clone())
            });
        self.scale(
            owner,
            station,
            &activity,
            feelings,
            Position {
                x: endpoint.0 as f32,
                y: endpoint.1 as f32,
            },
        )
    }
    /// What `owner` is doing in company, for affinity recognition.
    pub(crate) fn communal_activity(&self, owner: Entity) -> Option<Communal> {
        let me = self.participants.iter().find(|p| p.entity == owner)?;
        Some(match &me.activity {
            Activity::Shared(group) => Communal::Shared {
                station: me.station,
                group: group.clone(),
            },
            Activity::Media(interaction) => Communal::Device {
                station: me.station,
                interaction: *interaction,
            },
            Activity::Meal => Communal::Table {
                station: me.station,
            },
        })
    }
}

/// An active communal activity, keyed by what a partner must share.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Communal {
    /// The same shared-activity group on a different object.
    Shared { station: Entity, group: String },
    /// The same television or radio, in the same way.
    Device { station: Entity, interaction: u32 },
    /// A seat at the same table during a meal.
    Table { station: Entity },
}

impl Communal {
    /// Whether two people's activities count as one communal activity.
    /// A `Shared` participant already accepts the group and has not
    /// failed the attempt; `participation` filters both out.
    pub(crate) fn pairs_with(&self, other: &Self) -> bool {
        match (self, other) {
            (
                Self::Shared { station, group },
                Self::Shared {
                    station: theirs,
                    group: their_group,
                },
            ) => station != theirs && group == their_group,
            (
                Self::Device {
                    station,
                    interaction,
                },
                Self::Device {
                    station: theirs,
                    interaction: their_interaction,
                },
            ) => station == theirs && interaction == their_interaction,
            (Self::Table { station }, Self::Table { station: theirs }) => station == theirs,
            _ => false,
        }
    }
}

impl SocialCompany {
    fn allowed(
        &self,
        owner: Entity,
        station: Entity,
        activity: &Activity,
        _feelings: &Relationships,
    ) -> bool {
        self.participants.iter().any(|other| {
            other.entity != owner && other.station == station && &other.activity == activity
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
        _feelings: &Relationships,
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
    let activity = if let Some(journey) = world.get::<crate::reading::ReadingJourney>(person) {
        if journey.stage != terri_core::save_v6::ReadingStage::Read
            || !matches!(
                journey.outcome,
                Some(terri_core::save_v6::ReadingOutcome::Success)
            )
        {
            return None;
        }
        let action = crate::reading::action(world, *target)?;
        let group = action.shared_activity.as_ref()?;
        let preferences = crate::compatibility::preferences(
            pack,
            world.get::<Personality>(person),
            world.get::<terri_core::Traits>(person),
            world.get::<terri_core::Hobbies>(person),
        );
        if preferences.get(group).copied().unwrap_or(0.) < 0. {
            return None;
        }
        Activity::Shared(group.clone())
    } else if let Some(eating) = world.get::<Eating>(person) {
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
            strength: pack.tuning.relationship_delta_scale,
            identities: people
                .iter()
                .filter_map(|&p| world.get::<SimId>(p).map(|&id| (p, id)))
                .collect(),
            family: world
                .get_resource::<terri_core::layout::FamilyTies>()
                .cloned()
                .unwrap_or_default(),
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
        strength: pack.tuning.relationship_delta_scale,
        identities: people
            .iter()
            .filter_map(|&p| world.get::<SimId>(p).map(|&id| (p, id)))
            .collect(),
        family: world
            .get_resource::<terri_core::layout::FamilyTies>()
            .cloned()
            .unwrap_or_default(),
    });
}

/// Arrival snapshots are immutable across the pass, so newcomers on the same
/// tick cannot inherit each other's just-extended timers.
pub(crate) fn extend_episodes(world: &mut World) {
    use crate::social_episode::{CommunalEpisode, SocialEpisodes};
    use std::collections::{BTreeMap, BTreeSet};
    refresh(world);
    let company = world.resource::<SocialCompany>().clone();
    let pack = world.resource::<Content>().0;
    let remaining = |person| {
        world
            .get::<Eating>(person)
            .map(|e| e.remaining_ticks)
            .or_else(|| world.get::<StepWork>(person).map(|s| s.remaining_ticks))
            .or_else(|| {
                world
                    .get::<crate::reading::ReadingJourney>(person)
                    .map(|j| {
                        world
                            .resource::<SocialEpisodes>()
                            .communal
                            .get(&person)
                            .filter(|e| e.remaining > 0)
                            .map_or_else(
                                || {
                                    pack.reading
                                        .as_ref()
                                        .unwrap()
                                        .session_ticks
                                        .saturating_sub(j.elapsed)
                                },
                                |e| e.remaining,
                            )
                    })
            })
            .unwrap_or(0)
    };
    let durations: BTreeMap<_, _> = company
        .participants
        .iter()
        .map(|p| (p.entity, remaining(p.entity)))
        .collect();
    let old = world.resource::<SocialEpisodes>().communal.clone();
    let mut incoming: Vec<_> = world
        .query::<(Entity, &Target, &Path)>()
        .iter(world)
        .filter(|(e, _, _)| world.get::<Agent>(*e).is_some())
        .map(|(e, t, p)| (e, *t, p.steps.last().copied()))
        .collect();
    incoming.extend(
        world
            .query::<(Entity, &crate::reading::ReadingJourney)>()
            .iter(world)
            .filter(|(_, j)| approaching_reader(j))
            .map(|(e, j)| (e, j.origin, Some(j.destination))),
    );
    let mut next: BTreeMap<_, _> = old
        .iter()
        .filter(|(person, _)| {
            world
                .get::<crate::reading::ReadingJourney>(**person)
                .is_some_and(|j| {
                    j.stage != terri_core::save_v6::ReadingStage::Read
                        && j.elapsed > pack.reading.as_ref().unwrap().session_ticks
                })
        })
        .map(|(&person, episode)| (person, episode.clone()))
        .collect();
    for me in &company.participants {
        let Some(target) = world
            .get::<crate::reading::ReadingJourney>(me.entity)
            .map(|journey| journey.origin)
            .or_else(|| world.get::<Target>(me.entity).copied())
        else {
            continue;
        };
        let peers: BTreeSet<_> = company
            .peers(me.entity, me.station, &me.activity, me.position)
            .map(|p| p.entity)
            .collect();
        let previous = old.get(&me.entity).filter(|e| e.target == target);
        let mut episode = previous.cloned().unwrap_or(CommunalEpisode {
            target,
            extensions: 0,
            participants: peers.clone(),
            remaining: 0,
            completed_novelty: None,
        });
        let mut duration = durations[&me.entity];
        if previous.is_some() && episode.extensions < 2 {
            let mut newcomers: Vec<_> = peers.difference(&episode.participants).copied().collect();
            newcomers.sort_by_key(|e| e.index_u32());
            for newcomer in &newcomers {
                let newcomer_duration = durations.get(newcomer).copied().unwrap_or(0);
                if episode.extensions < 2 && newcomer_duration > duration {
                    duration = newcomer_duration;
                    episode.extensions += 1;
                    if world
                        .get::<crate::reading::ReadingJourney>(me.entity)
                        .is_some()
                    {
                        episode.remaining = duration;
                    }
                }
            }
        }
        // Continue the present activity while an admitted newcomer approaches.
        // At the cap, even travel cannot keep this participant past its deadline.
        let inbound = episode.extensions < 2
            && !crate::social_episode::urgent(world, me.entity)
            && incoming.iter().any(|(person, t, endpoint)| {
                if *person == me.entity || crate::social_episode::urgent(world, *person) {
                    return false;
                }
                match &me.activity {
                    Activity::Media(i) => t.object == me.station && t.interaction == *i,
                    Activity::Meal => {
                        t.object == me.station && crate::dining::terminal(world, *person)
                    }
                    Activity::Shared(group) => {
                        t.object != me.station
                            && company.groups.get(&(t.object, t.interaction)) == Some(group)
                            && endpoint.is_some_and(|(x, y)| {
                                company.rooms.as_ref().is_some_and(|r| {
                                    let room = r.at((x, y));
                                    room.is_some()
                                        && room
                                            == r.at((
                                                me.position.x.round() as i32,
                                                me.position.y.round() as i32,
                                            ))
                                }) && (x as f32 - me.position.x).hypot(y as f32 - me.position.y)
                                    <= company.radius
                            })
                    }
                }
            });
        if inbound && duration <= 1 {
            duration = 2;
            if world
                .get::<crate::reading::ReadingJourney>(me.entity)
                .is_some()
            {
                episode.remaining = duration;
            }
        }
        if let Some(mut eating) = world.get_mut::<Eating>(me.entity) {
            eating.remaining_ticks = duration;
        }
        if let Some(mut step) = world.get_mut::<StepWork>(me.entity) {
            step.remaining_ticks = duration;
        }
        episode.participants = peers;
        next.insert(me.entity, episode);
    }
    world.resource_mut::<SocialEpisodes>().communal = next;
}

fn approaching_reader(journey: &crate::reading::ReadingJourney) -> bool {
    matches!(
        journey.stage,
        terri_core::save_v6::ReadingStage::Fetch
            | terri_core::save_v6::ReadingStage::Pickup
            | terri_core::save_v6::ReadingStage::Travel
    )
}

/// The reading save validator uses the same real approach conditions as holds.
pub(crate) fn has_inbound(world: &World, person: Entity) -> bool {
    let Some(me) = participation(world, person) else {
        return false;
    };
    let Activity::Shared(ref group) = me.activity else {
        return false;
    };
    let pack = world.resource::<Content>().0;
    let rooms = crate::room_regions::RoomRegions::from_world(world);
    let room = rooms.at((me.position.x.round() as i32, me.position.y.round() as i32));
    let planned = world
        .try_query::<(Entity, &crate::reading::ReadingJourney)>()
        .is_some_and(|mut query| {
            query.iter(world).any(|(other, j)| {
                if other == person
                    || crate::social_episode::urgent(world, other)
                    || !approaching_reader(j)
                {
                    return false;
                }
                let Some(action) = crate::reading::action(world, j.origin) else {
                    return false;
                };
                let (x, y) = j.destination;
                action.shared_activity.as_ref() == Some(group)
                    && j.origin.object != me.station
                    && room.is_some()
                    && rooms.at((x, y)) == room
                    && (x as f32 - me.position.x).hypot(y as f32 - me.position.y)
                        <= pack.tuning.relationships.contact_radius
            })
        });
    let newly_arrived = world
        .try_query_filtered::<Entity, With<Agent>>()
        .is_some_and(|mut query| {
            query.iter(world).any(|other| {
                if other == person
                    || crate::social_episode::urgent(world, other)
                    || world
                        .resource::<crate::social_episode::SocialEpisodes>()
                        .communal
                        .get(&person)
                        .is_some_and(|episode| episode.participants.contains(&other))
                {
                    return false;
                }
                let Some(peer) = participation(world, other) else {
                    return false;
                };
                peer.station != me.station
                    && matches!(&peer.activity,Activity::Shared(theirs) if theirs==group)
                    && room.is_some()
                    && rooms.at((
                        peer.position.x.round() as i32,
                        peer.position.y.round() as i32,
                    )) == room
                    && (peer.position.x - me.position.x).hypot(peer.position.y - me.position.y)
                        <= pack.tuning.relationships.contact_radius
            })
        });
    planned
        || newly_arrived
        || world
            .try_query::<(Entity, &Target, &Path)>()
            .is_some_and(|mut query| {
                query.iter(world).any(|(other, target, path)| {
                    if other == person || crate::social_episode::urgent(world, other) {
                        return false;
                    }
                    let Some(object) = world.get::<SmartObject>(target.object) else {
                        return false;
                    };
                    let Some(action) = pack
                        .object(object.0)
                        .interactions
                        .get(target.interaction as usize)
                    else {
                        return false;
                    };
                    target.object != me.station
                        && action.shared_activity.as_ref() == Some(group)
                        && path.steps.last().is_some_and(|&(x, y)| {
                            room.is_some()
                                && rooms.at((x, y)) == room
                                && (x as f32 - me.position.x).hypot(y as f32 - me.position.y)
                                    <= pack.tuning.relationships.contact_radius
                        })
                })
            })
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
            let pack = world.resource::<Content>().0;
            let origin = world.get::<crate::recipe_actions::Origin>(p.entity);
            let delta = crate::recipe_actions::benefits(pack, state, origin)
                .iter()
                .find(|(id, delta)| *id as usize == NeedId::Social.index() && *delta > 0.)?
                .1;
            let duration = crate::recipe_actions::duration(pack, state, origin) as f32;
            let personality = world
                .get::<Personality>(p.entity)
                .map_or(1., |p| p.satisfaction[NeedId::Social.index()]);
            Some((
                p.entity,
                delta * personality * company.active_scale(p.entity, &feelings) / duration,
            ))
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

    /// Which pairs of activities count as one communal activity: the same
    /// table, the same device used the same way, or the same shared group
    /// on different objects. Anything else, not.
    #[test]
    fn communal_pairs_need_the_same_table_or_device_and_distinct_shared_objects() {
        let mut world = bevy_ecs::prelude::World::new();
        let (one, two) = (world.spawn_empty().id(), world.spawn_empty().id());
        let table = |station| Communal::Table { station };
        let device = |station, interaction| Communal::Device {
            station,
            interaction,
        };
        let shared = |station, group: &str| Communal::Shared {
            station,
            group: group.to_string(),
        };
        assert!(table(one).pairs_with(&table(one)));
        assert!(!table(one).pairs_with(&table(two)));
        assert!(device(one, 0).pairs_with(&device(one, 0)));
        assert!(!device(one, 0).pairs_with(&device(two, 0)));
        assert!(!device(one, 0).pairs_with(&device(one, 1)));
        assert!(shared(one, "reading").pairs_with(&shared(two, "reading")));
        assert!(!shared(one, "reading").pairs_with(&shared(one, "reading")));
        assert!(!shared(one, "reading").pairs_with(&shared(two, "exercise")));
        assert!(!table(one).pairs_with(&device(one, 0)));
        assert!(!device(one, 0).pairs_with(&shared(two, "reading")));
        assert!(!shared(one, "reading").pairs_with(&table(one)));
    }

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
            crate::test_content::enclose(&mut sim);
            let rooms = crate::room_regions::RoomRegions::from_world(sim.world());
            assert!(rooms.at((2, 2)).is_some());
            assert_ne!(rooms.at((2, 2)), rooms.at((2, 6)));
            assert_eq!(
                sim.world()
                    .resource::<crate::rooms::RoomMap>()
                    .topology
                    .components
                    .len(),
                2
            );
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
    fn social_privacy_substitution_requires_active_company_and_a_free_endpoint() {
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
        assert!(crate::privacy::substitute(
            sim.world_mut(),
            first,
            NeedId::Social.index() as u8,
            &grid,
            false
        ));
        sim.world_mut().entity_mut(first).remove::<(Target, Path)>();
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
        let mut edges = sim.world().resource::<SavedLayout>().edges().to_vec();
        edges.extend((0..16).flat_map(|x| {
            [0, 16].map(move |y| WallEdge {
                axis: EdgeAxis::Horizontal,
                x,
                y,
                doorway: false,
            })
        }));
        edges.extend((0..16).flat_map(|y| {
            [0, 16].map(move |x| WallEdge {
                axis: EdgeAxis::Vertical,
                x,
                y,
                doorway: false,
            })
        }));
        edges.sort_by_key(|edge| (edge.axis as u8, edge.x, edge.y));
        sim.world_mut()
            .insert_resource(SavedLayout::EdgeWallsV1 { edges });
        crate::rooms::initialize(sim.world_mut()).unwrap();
        let rooms = sim.world().resource::<crate::rooms::RoomMap>();
        assert_eq!(rooms.topology.components.len(), 2);
        assert_ne!(rooms.selection_at((3, 3)), rooms.selection_at((3, 4)));
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
}
