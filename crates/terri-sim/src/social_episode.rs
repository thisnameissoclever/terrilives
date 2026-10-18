//! Owned conversation rendezvous, topics and bounded shared activity episodes.
pub(crate) mod requests;
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
#[cfg(test)]
use terri_core::{Agent, Path};
use terri_core::{Eating, NeedId, Needs, SimRng, Socialising, Target};
mod execution;
mod execution_persistence;
pub(crate) use execution::{
    commit_autonomous, complete_execution, execution_order, release_order, request_order_id,
    Execution, ExecutionPhase,
};
pub(crate) use execution_persistence::{
    adopt_legacy, adopt_published_player_requests, restore_executions, save_executions,
};

#[derive(Resource, Default, Clone)]
pub struct SocialEpisodes {
    pub(crate) rendezvous: BTreeMap<Entity, Entity>,
    pub(crate) executions: BTreeMap<Entity, Execution>,
    pub(crate) incoming: BTreeMap<Entity, Entity>,
    pub(crate) topics: BTreeMap<Entity, Topic>,
    pub(crate) communal: BTreeMap<Entity, CommunalEpisode>,
}
#[derive(Clone, Debug)]
pub(crate) struct Topic {
    pub code: u32,
    pub tag: String,
    pub initiator_preference: f32,
    pub listener_preference: f32,
}
#[derive(Clone, Debug)]
pub(crate) struct CommunalEpisode {
    pub target: Target,
    pub extensions: u8,
    pub participants: BTreeSet<Entity>,
    pub remaining: u32,
    pub completed_novelty: Option<f32>,
}

/// Family adds value independently of affinity; dislike never removes company.
pub(crate) fn benefit(affinity: f32, strength: f32, family: bool) -> f32 {
    (1. + affinity * strength).max(0.25) + if family { 0.1 } else { 0. }
}
pub(crate) fn urgent(world: &World, person: Entity) -> bool {
    world.get::<terri_core::AtWork>(person).is_some()
        || world.get::<terri_core::Commuting>(person).is_some()
        || world.get::<Needs>(person).is_some_and(|n| {
            [NeedId::Energy, NeedId::Hunger, NeedId::Bladder]
                .iter()
                .any(|&id| {
                    n.get(id)
                        <= world
                            .resource::<crate::Content>()
                            .0
                            .tuning
                            .mood_critical_need_level
                })
        })
}

pub(crate) fn started(world: &mut World, initiator: Entity, partner: Entity) {
    requests::started(world, initiator, partner);
    let target = world.get::<Target>(initiator).copied();
    let order = {
        let mut episodes = world.resource_mut::<SocialEpisodes>();
        episodes.topics.remove(&initiator);
        let order = episodes
            .executions
            .get_mut(&initiator)
            .and_then(|execution| {
                if execution.recipient != partner
                    || target
                        != Some(Target {
                            object: partner,
                            interaction: execution.interaction,
                        })
                {
                    return None;
                }
                execution.phase = ExecutionPhase::Running;
                match execution.owner {
                    execution::ExecutionOwner::Player(id) => Some(id),
                    _ => None,
                }
            });
        if episodes.rendezvous.get(&partner) == Some(&initiator) {
            episodes.rendezvous.remove(&partner);
        }
        order
    };
    if let Some(id) = order {
        crate::player_actions::transition(world, initiator, id, 3, true);
    }
}

/// Redirecting a recipient releases physical claims, never somebody else's order.
pub(crate) fn cancel_incoming(world: &mut World, recipient: Entity) {
    execution::redirect_recipient(world, recipient);
    requests::defer_incoming(world, recipient);
}

pub(crate) fn forget_person(world: &mut World, person: Entity) {
    requests::forget_person(world, person);
    let owned: Vec<_> = world
        .get_resource::<crate::player_actions::PlayerActions>()
        .map_or_else(Vec::new, |s| {
            s.orders
                .iter()
                .filter(|((actor, _), state)| {
                    *actor == person || state.entry.intent.object == person
                })
                .map(|(&(actor, id), _)| (actor, id))
                .collect()
        });
    for (actor, id) in owned {
        crate::player_actions::terminal(
            world,
            actor,
            id,
            "failed",
            Some(if actor == person {
                "Initiator died"
            } else {
                "Recipient died"
            }),
        );
    }
    let topics: BTreeSet<_> = world
        .resource::<SocialEpisodes>()
        .topics
        .keys()
        .copied()
        .filter(|&owner| {
            owner == person
                || world
                    .get::<Socialising>(owner)
                    .is_some_and(|s| s.partner == person)
        })
        .collect();
    execution::forget_person(world, person);
    let mut episodes = world.resource_mut::<SocialEpisodes>();
    episodes
        .rendezvous
        .retain(|&recipient, initiator| recipient != person && *initiator != person);
    episodes.topics.retain(|owner, _| !topics.contains(owner));
    episodes.communal.remove(&person);
    for episode in episodes.communal.values_mut() {
        episode.participants.remove(&person);
    }
}

pub(crate) fn maintain(world: &mut World) {
    crate::player_actions::observe(world);
    crate::fights::yield_to_critical_needs(world);
    execution::maintain(world);
    requests::maintain(world);
    let mut held_readers: Vec<_> = world
        .resource::<SocialEpisodes>()
        .communal
        .keys()
        .copied()
        .collect();
    held_readers.sort_by_key(|person| person.index_u32());
    for person in held_readers {
        crate::reading::finish_abandoned_company(world, person);
    }
    let live: BTreeSet<_> = world
        .query::<(Entity, &Socialising)>()
        .iter(world)
        .map(|(e, _)| e)
        .collect();
    world
        .resource_mut::<SocialEpisodes>()
        .topics
        .retain(|e, _| live.contains(e));
    let active: BTreeSet<_> = world
        .query::<Entity>()
        .iter(world)
        .filter(|e| {
            world.get::<Eating>(*e).is_some()
                || world.get::<terri_core::StepWork>(*e).is_some()
                || world.get::<crate::reading::ReadingJourney>(*e).is_some()
        })
        .collect();
    world
        .resource_mut::<SocialEpisodes>()
        .communal
        .retain(|e, _| active.contains(e));
}

/// Every topic tag with a bubble code of its own; any other tag draws the
/// generic code 7. One list, so the activity log's label table names every
/// tag a chat can show by its code.
pub(crate) const TOPIC_CODES: [(&str, u32); 29] = [
    ("reading", 8),
    ("exercise", 9),
    ("aquarium", 10),
    ("fish", 10),
    ("television", 14),
    ("tv", 14),
    ("music", 18),
    ("radio", 18),
    ("socialising", 4),
    ("lounging", 15),
    ("correspondence", 19),
    ("cooking", 23),
    ("eating", 3),
    ("food", 3),
    ("sleeping", 5),
    ("sleep", 5),
    ("sitting", 11),
    ("comfort", 11),
    ("showering", 12),
    ("shower", 12),
    ("toilet", 13),
    ("bathing", 20),
    ("bath", 20),
    ("washing", 16),
    ("hygiene", 16),
    ("cleaning", 17),
    // Fights (issue 248): what the fight is about, drawn in red.
    ("fight-dishes", 24),
    ("fight-chore", 25),
    ("fight", 26),
];

pub(crate) fn tag_code(tag: &str) -> u32 {
    TOPIC_CODES
        .iter()
        .find(|(known, _)| *known == tag)
        .map_or(7, |&(_, code)| code)
}
pub(crate) fn topic_weight(mine: f32, theirs: f32, inclination: f32) -> f32 {
    mine.max(0.) * (1. + 4. * inclination.clamp(0., 1.) * theirs.max(0.))
}
pub(crate) fn begin_topics(world: &mut World) {
    let mut talks: Vec<_> = world
        .query::<(Entity, &Socialising)>()
        .iter(world)
        .map(|(e, s)| (e, s.partner, s.interaction))
        .collect();
    talks.sort_by_key(|(e, _, _)| e.index_u32());
    for (initiator, listener, interaction) in talks {
        if world
            .resource::<SocialEpisodes>()
            .topics
            .contains_key(&initiator)
        {
            continue;
        }
        let pack = world.resource::<crate::Content>().0;
        // A fight's topic is its reason, not a draw: the listener's missed
        // chore when there is one, a plain argument otherwise.
        if pack
            .social
            .get(interaction as usize)
            .is_some_and(crate::fights::is_fight)
        {
            let reason = world
                .get::<terri_core::SimId>(listener)
                .copied()
                .and_then(|id| crate::fights::reason_against(world, id));
            world.resource_mut::<SocialEpisodes>().topics.insert(
                initiator,
                Topic {
                    code: crate::fights::Reason::code(reason),
                    tag: crate::fights::Reason::tag(reason).into(),
                    initiator_preference: -1.,
                    listener_preference: -1.,
                },
            );
            continue;
        }
        let prefs = |person| {
            crate::compatibility::preferences(
                pack,
                world.get::<terri_core::Personality>(person),
                world.get::<terri_core::Traits>(person),
                world.get::<terri_core::Hobbies>(person),
            )
        };
        let mine = prefs(initiator);
        let theirs = prefs(listener);
        let inclination = mine
            .get("socialising")
            .copied()
            .unwrap_or(0.)
            .max(0.)
            .max(
                world
                    .get::<terri_core::Personality>(initiator)
                    .map_or(0., |p| {
                        ((p.satisfaction[NeedId::Social.index()] - 1.) / 2.).clamp(0., 1.)
                    }),
            )
            .max(
                crate::skills::mastery_for_tag(
                    world.get::<terri_core::Skills>(initiator),
                    pack,
                    "socialising",
                )
                .unwrap_or(0.),
            );
        let candidates: Vec<_> = mine
            .iter()
            .filter(|(_, value)| **value > 0.)
            .map(|(tag, &value)| {
                (
                    tag.clone(),
                    value,
                    theirs.get(tag).copied().unwrap_or(0.),
                    topic_weight(value, theirs.get(tag).copied().unwrap_or(0.), inclination),
                )
            })
            .collect();
        let topic = if candidates.is_empty() {
            Topic {
                code: 4,
                tag: "smalltalk".into(),
                initiator_preference: 0.,
                listener_preference: 0.,
            }
        } else {
            let total: f32 = candidates.iter().map(|c| c.3).sum();
            let draw = world.resource_mut::<SimRng>().next_f32() * total;
            let mut cumulative = 0.;
            let choice = candidates
                .iter()
                .find(|c| {
                    cumulative += c.3;
                    draw < cumulative
                })
                .unwrap_or(candidates.last().unwrap());
            Topic {
                code: tag_code(&choice.0),
                tag: choice.0.clone(),
                initiator_preference: choice.1,
                listener_preference: choice.2,
            }
        };
        world
            .resource_mut::<SocialEpisodes>()
            .topics
            .insert(initiator, topic);
    }
}

pub(crate) fn bubble(world: &World, index: u32) -> (u32, f32) {
    let Some(index) = bevy_ecs::entity::EntityIndex::from_raw_u32(index) else {
        return (0, 0.);
    };
    let entity = world.entities().resolve_from_index(index);
    let episodes = world.resource::<SocialEpisodes>();
    if world.get::<Socialising>(entity).is_some() {
        return episodes
            .topics
            .get(&entity)
            .map_or((0, 0.), |t| (t.code, t.initiator_preference));
    }
    episodes
        .topics
        .iter()
        .find_map(|(owner, topic)| {
            world
                .get::<Socialising>(*owner)
                .filter(|talk| talk.partner == entity)
                .map(|_| (topic.code, topic.listener_preference))
        })
        .unwrap_or((0, 0.))
}

#[cfg(test)]
mod tests;
