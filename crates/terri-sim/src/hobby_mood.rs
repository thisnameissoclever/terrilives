//! The temporary mood lift from minutes spent on a loved activity.

use bevy_ecs::prelude::*;
use terri_core::{
    books::BookCopyId, save_v17::SavedOrderActor, save_v6::ReadingStage, Agent, AtWork, ChainState,
    Commuting, Eating, FnvHasher, Hobbies, Needs, Path, Reserved, SimClock, SimId, Socialising,
    StepWork, Target,
};
use terri_data::ContentPack;

use crate::{recipe_actions::Origin, Content};

pub(crate) const MAX_MINUTES: u16 = 40;
const POINTS_PER_MINUTE: f32 = 0.05;

#[derive(Component, Clone, Copy)]
#[component(storage = "SparseSet")]
pub(crate) struct HobbyMood {
    pub minutes: u16,
    pub tick: u64,
    pub activity: HobbyActivity,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum HobbyActivity {
    Reading(BookCopyId),
    Object(Target),
    Recipe(u32),
    Conversation(Entity, Entity, u32),
}

pub(crate) fn credit(world: &mut World, person: Entity, tags: &[String]) {
    if world
        .get::<Hobbies>(person)
        .is_some_and(|h| h.loves_any(tags))
    {
        credit_minute(world, person);
    }
}

pub(crate) fn queue_credit(commands: &mut Commands, person: Entity) {
    commands.queue(move |world: &mut World| credit_minute(world, person));
}

fn credit_minute(world: &mut World, person: Entity) {
    if terri_data::is_pre_books_pack(world.resource::<Content>().0) {
        return;
    }
    let Some(activity) = loved_activity(world, person) else {
        return;
    };
    let tick = world.resource::<SimClock>().tick;
    if let Some(mut mood) = world.get_mut::<HobbyMood>(person) {
        if mood.tick == tick && mood.activity == activity {
            return;
        }
        let consecutive = mood.activity == activity && mood.tick.checked_add(1) == Some(tick);
        let minutes = if consecutive {
            (mood.minutes + 1).min(MAX_MINUTES)
        } else {
            1
        };
        *mood = HobbyMood {
            minutes,
            tick,
            activity,
        };
    } else if let Ok(mut person) = world.get_entity_mut(person) {
        person.insert(HobbyMood {
            minutes: 1,
            tick,
            activity,
        });
    }
}

pub(crate) fn loves_step(
    pack: &ContentPack,
    state: &ChainState,
    origin: Option<&Origin>,
    hobbies: &Hobbies,
) -> bool {
    let chain = &pack.chains[state.chain as usize];
    if hobbies.loves_any(&chain.steps[state.step as usize].tags) {
        return true;
    }
    // Resolved recipe tags include tags inherited from every step. Only
    // recipe-wide tags can earn mood outside the step that supplies them.
    crate::recipe_actions::action(pack, origin).is_some_and(|(_, _, action)| {
        action.tags.iter().any(|tag| {
            hobbies.0.contains(tag) && !chain.steps.iter().any(|step| step.tags.contains(tag))
        })
    })
}

pub(crate) fn activity(world: &World, person: Entity) -> Option<(HobbyActivity, bool)> {
    let hobbies = world.get::<Hobbies>(person);
    if world.get::<Agent>(person).is_none()
        || world.get::<Needs>(person).is_none()
        || world.get::<AtWork>(person).is_some()
        || world.get::<Commuting>(person).is_some()
        || world.get::<Path>(person).is_some()
    {
        return None;
    }
    let pack = world.resource::<Content>().0;
    let target = world.get::<Target>(person).copied();
    let loves = |tags: &[String]| hobbies.is_some_and(|h| h.loves_any(tags));
    if let Some(journey) = world
        .get::<crate::reading::ReadingJourney>(person)
        .filter(|journey| journey.stage == ReadingStage::Read)
    {
        let finished_book = world
            .get_resource::<crate::social_episode::SocialEpisodes>()
            .and_then(|episodes| episodes.communal.get(&person))
            .is_some_and(|episode| episode.completed_novelty.is_some());
        let action = crate::reading::action(world, target?)?;
        return (!finished_book)
            .then_some((HobbyActivity::Reading(journey.copy), loves(&action.tags)));
    }
    if let Some(eating) = world.get::<Eating>(person) {
        let action = &pack.object(eating.object).interactions[eating.interaction as usize];
        return (!action.book_reading
            && (!crate::pool::is_swimming(action)
                || world
                    .get::<crate::pool::PoolEpisode>(person)
                    .is_some_and(|pool| pool.phase == 2)))
        .then_some((HobbyActivity::Object(target?), loves(&action.tags)));
    }
    if let Some(chain) = world
        .get::<ChainState>(person)
        .filter(|_| world.get::<StepWork>(person).is_some())
    {
        if world
            .get_resource::<terri_core::save::SavedDomestic>()
            .is_some_and(|domestic| {
                world.get::<SimId>(person).is_some_and(|id| {
                    crate::domestic::gathering(
                        domestic,
                        *id,
                        &pack.chains[chain.chain as usize].id,
                        chain.step,
                    )
                })
            })
        {
            return None;
        }
        let loved =
            hobbies.is_some_and(|h| loves_step(pack, chain, world.get::<Origin>(person), h));
        return Some((HobbyActivity::Recipe(chain.chain), loved));
    }
    let conversation = |initiator: Entity, talk: &Socialising| {
        let action = pack.social.get(talk.interaction as usize)?;
        (world.get::<Reserved>(talk.partner).is_some()
            && world.get::<Target>(talk.partner).is_none())
        .then_some((
            HobbyActivity::Conversation(initiator, talk.partner, talk.interaction),
            loves(&action.tags),
        ))
    };
    if let Some(talk) = world.get::<Socialising>(person) {
        return conversation(person, talk);
    }
    if target.is_some() || world.get::<Reserved>(person).is_none() {
        return None;
    }
    world
        .try_query::<(Entity, &Socialising)>()?
        .iter(world)
        .filter(|(_, talk)| talk.partner == person)
        .find_map(|(initiator, talk)| conversation(initiator, talk))
}

fn loved_activity(world: &World, person: Entity) -> Option<HobbyActivity> {
    let (activity, loved) = activity(world, person)?;
    loved.then_some(activity)
}

pub(crate) fn points(world: &World, person: Entity) -> Option<f32> {
    let mood = world.get::<HobbyMood>(person)?;
    (loved_activity(world, person) == Some(mood.activity))
        .then_some(f32::from(mood.minutes) * POINTS_PER_MINUTE)
}

pub(crate) fn prune(world: &mut World) {
    let tick = world.resource::<SimClock>().tick;
    prune_since(world, tick);
}

/// A front order may stop and restart an action before the tick ends.
pub(crate) fn prune_inactive(world: &mut World) {
    prune_since(world, 0);
}

fn prune_since(world: &mut World, minimum_tick: u64) {
    let Some(mut moods) = world.try_query::<(Entity, &HobbyMood)>() else {
        return;
    };
    let finished: Vec<_> = moods
        .iter(world)
        .filter(|(person, mood)| {
            mood.tick < minimum_tick || loved_activity(world, *person) != Some(mood.activity)
        })
        .map(|(person, _)| person)
        .collect();
    for person in finished {
        world.entity_mut(person).remove::<HobbyMood>();
    }
}

pub(crate) fn rows(world: &World) -> Vec<(SavedOrderActor, u16)> {
    let tick = world.resource::<SimClock>().tick;
    let Some(mut moods) = world.try_query::<(Entity, &HobbyMood)>() else {
        return Vec::new();
    };
    let mut rows: Vec<_> = moods
        .iter(world)
        .filter(|(person, mood)| {
            mood.tick == tick && loved_activity(world, *person) == Some(mood.activity)
        })
        .filter_map(|(person, mood)| {
            Some((
                crate::player_actions::saved_actor(world, person)?,
                mood.minutes,
            ))
        })
        .collect();
    rows.sort_unstable();
    rows
}

pub(crate) fn hash(world: &World, hash: &mut FnvHasher) {
    let rows = rows(world);
    if rows.is_empty() {
        return;
    }
    hash.write_bytes(b"hobby-mood-v1");
    hash.write_u64(rows.len() as u64);
    for (actor, minutes) in rows {
        let (kind, id) = match actor {
            SavedOrderActor::Sim(id) => (0, id),
            SavedOrderActor::Entity(index) => (1, index),
        };
        hash.write_u64(kind);
        hash.write_u64(u64::from(id));
        hash.write_u64(u64::from(minutes));
    }
}
