//! Mood-sensitive arguments require a recorded, attributable incident.
use bevy_ecs::prelude::*;
#[cfg(test)]
use terri_core::chores::DutyOutcome;
use terri_core::save_v20::{
    GrievanceKind, GrievanceSubject, NuisanceKind, SavedFightContext, SavedGrievance,
};
use terri_core::{
    chores::{ChoreKind, SavedChores},
    Agent, FnvHasher, Intent, IntentQueue, Needs, Relationships, Reserved, SimClock, SimId, SimRng,
    Socialising,
};
use terri_data::{CompiledInteraction, ContentPack};
mod published;

pub(crate) fn published_rules(world: &World) -> bool {
    world.resource::<crate::Content>().0.tuning.fight_rules == terri_data::FightRules::Published
}

use crate::moodlet_timers::MoodletTimers;

/// The activity tag that marks a social interaction as a fight.
pub const FIGHT_TAG: &str = "fighting";

/// Who had a fight and the tick their Had a fight moodlet ends. Saved in
/// schema twelve; in the world hash whenever it holds anything.
///
/// `provoked` watches a trigger's front order until execution or redirection,
/// so withdrawal removes that entry without touching a player's identical order.
/// `system_orders` retains its provenance through execution and queue changes;
/// schema seventeen saves those exact identities (`system_social_orders`)
/// separately from player orders.
#[derive(Resource, Default, Clone, Debug, PartialEq, Eq)]
pub struct Fights {
    pub timers: MoodletTimers,
    provoked: std::collections::BTreeMap<Entity, u64>,
    system_orders: std::collections::BTreeMap<Entity, u64>,
}

impl Fights {
    pub fn from_timers(timers: MoodletTimers) -> Self {
        Self {
            timers,
            provoked: Default::default(),
            system_orders: Default::default(),
        }
    }

    /// Whether the trigger's made-up fight order for `person` is still
    /// being watched.
    pub fn provoked(&self, person: Entity) -> bool {
        self.provoked.contains_key(&person)
    }
    pub(crate) fn saved_orders(&self, world: &World) -> Vec<(u32, u64)> {
        self.system_orders
            .iter()
            .filter(|(actor, id)| {
                world
                    .get::<IntentQueue>(**actor)
                    .is_some_and(|q| q.order(**id).is_some())
            })
            .map(|(actor, id)| (actor.index_u32(), *id))
            .collect()
    }
    pub(crate) fn restore_order(&mut self, person: Entity, id: u64) {
        self.provoked.insert(person, id);
        self.system_orders.insert(person, id);
    }
    pub(crate) fn owns_order(&self, person: Entity, id: u64) -> bool {
        self.system_orders.get(&person) == Some(&id)
    }
}

impl std::ops::Deref for Fights {
    type Target = MoodletTimers;
    fn deref(&self) -> &MoodletTimers {
        &self.timers
    }
}
impl std::ops::DerefMut for Fights {
    fn deref_mut(&mut self) -> &mut MoodletTimers {
        &mut self.timers
    }
}

/// Whether a social interaction is a fight rather than a chat.
pub fn is_fight(act: &CompiledInteraction) -> bool {
    act.tags.iter().any(|tag| tag == FIGHT_TAG)
}

/// The index of the pack's fight interaction, if it has one.
pub(crate) fn fight_index(pack: &ContentPack) -> Option<u32> {
    pack.social
        .iter()
        .position(is_fight)
        .map(|index| index as u32)
}

/// What a fight is about. The topic code and tag the bubble shows follow
/// from it; so does whether a person starts one on their own.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    /// The other person's missed Dishes duty, with the dishes still dirty.
    Dishes,
    /// Any other missed duty of theirs whose mess is still there.
    OtherChore,
    Privacy,
    Television,
    Music,
    Exercise,
    Nuisance,
    Interruption,
    Random(u8),
}

impl Reason {
    /// The topic code the browser maps to artwork: 24 and 25 for the two
    /// reasons, 26 for a fight the player started with no reason.
    pub const NONE_CODE: u32 = 26;
    pub fn code(reason: Option<Self>) -> u32 {
        match reason {
            Some(Self::Dishes) => 24,
            Some(Self::OtherChore) => 25,
            Some(Self::Privacy) => 27,
            Some(Self::Television) => 28,
            Some(Self::Music) => 29,
            Some(Self::Exercise) => 30,
            Some(Self::Nuisance) => 31,
            Some(Self::Interruption) => 32,
            Some(Self::Random(code)) => u32::from(code) + 30,
            None => Self::NONE_CODE,
        }
    }
    /// Every reason a fight can have, `None` first, so a table such as the
    /// activity log's labels can name every tag [`Reason::tag`] returns.
    pub fn all() -> impl Iterator<Item = Option<Self>> {
        [
            None,
            Some(Self::Dishes),
            Some(Self::OtherChore),
            Some(Self::Privacy),
            Some(Self::Television),
            Some(Self::Music),
            Some(Self::Exercise),
            Some(Self::Nuisance),
            Some(Self::Interruption),
        ]
        .into_iter()
        .chain(RANDOM_TOPICS.iter().map(|&code| Some(Self::Random(code))))
    }
    pub fn tag(reason: Option<Self>) -> &'static str {
        match reason {
            Some(Self::Dishes) => "fight-dishes",
            Some(Self::OtherChore) => "fight-chore",
            Some(Self::Privacy) => "fight-privacy",
            Some(Self::Television) => "fight-television",
            Some(Self::Music) => "fight-music",
            Some(Self::Exercise) => "fight-exercise",
            Some(Self::Nuisance) => "fight-nuisance",
            Some(Self::Interruption) => "fight-interruption",
            Some(Self::Random(code)) => RANDOM_TAGS
                .get(usize::from(code))
                .copied()
                .unwrap_or("fight-random-4"),
            None => "fight",
        }
    }
    /// The reason behind a saved tag, if the tag names one. `fight` is a
    /// fight with no reason, so it maps to `Some(None)`.
    pub fn from_tag(tag: &str) -> Option<Option<Self>> {
        match tag {
            "fight-dishes" => Some(Some(Self::Dishes)),
            "fight-chore" => Some(Some(Self::OtherChore)),
            "fight" => Some(None),
            _ => None,
        }
    }

    pub fn from_tag_current(tag: &str) -> Option<Option<Self>> {
        Self::from_tag(tag).or_else(|| match tag {
            "fight-privacy" => Some(Some(Self::Privacy)),
            "fight-television" => Some(Some(Self::Television)),
            "fight-music" => Some(Some(Self::Music)),
            "fight-exercise" => Some(Some(Self::Exercise)),
            "fight-nuisance" => Some(Some(Self::Nuisance)),
            "fight-interruption" => Some(Some(Self::Interruption)),
            _ => RANDOM_TOPICS
                .iter()
                .copied()
                .find(|code| RANDOM_TAGS[usize::from(*code)] == tag)
                .map(|code| Some(Self::Random(code))),
        })
    }
}

const RANDOM_TOPICS: &[u8] = &[
    3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
];
const RANDOM_TAGS: &[&str] = &[
    "",
    "",
    "",
    "fight-random-3",
    "fight-random-4",
    "fight-random-5",
    "",
    "fight-random-7",
    "fight-random-8",
    "fight-random-9",
    "fight-random-10",
    "fight-random-11",
    "fight-random-12",
    "fight-random-13",
    "fight-random-14",
    "fight-random-15",
    "fight-random-16",
    "fight-random-17",
    "fight-random-18",
    "fight-random-19",
    "fight-random-20",
    "fight-random-21",
    "fight-random-22",
    "fight-random-23",
];

pub(crate) fn reason_for(row: &SavedGrievance) -> Reason {
    match row.subject {
        GrievanceSubject::Chore(o) if o.key.kind == ChoreKind::Dishes => Reason::Dishes,
        GrievanceSubject::Chore(_) => Reason::OtherChore,
        GrievanceSubject::Nuisance { kind, .. } => match kind {
            NuisanceKind::Television => Reason::Television,
            NuisanceKind::Music => Reason::Music,
            NuisanceKind::Exercise => Reason::Exercise,
            NuisanceKind::Other => Reason::Nuisance,
        },
        GrievanceSubject::None if row.kind == GrievanceKind::Chore => Reason::OtherChore,
        GrievanceSubject::None if row.kind == GrievanceKind::NeedInterruption => {
            Reason::Interruption
        }
        GrievanceSubject::None => Reason::Privacy,
    }
}

/// A chore `owner` was assigned, did not do, and whose mess is still there:
/// a settled Missed episode on the board whose key still needs work. The
/// latest such episode wins, and the dishes name themselves.
#[cfg(test)]
pub(crate) fn reason_against(world: &World, owner: SimId) -> Option<Reason> {
    let state = world.get_resource::<SavedChores>()?;
    state
        .episodes
        .iter()
        .rev()
        .filter(|e| e.owner == owner.0 && e.settled && e.outcome == DutyOutcome::Missed)
        .find(|e| {
            crate::chore_repair::obligation(world, e.key, owner)
                .is_some_and(|o| crate::chore_repair::still_unfinished(world, o))
        })
        .map(|e| {
            if e.key.kind == ChoreKind::Dishes {
                Reason::Dishes
            } else {
                Reason::OtherChore
            }
        })
}

/// Nothing claims the person: no order, journey, meal, chain, work or
/// conversation of their own, and nobody approaching them.
fn idle(world: &World, person: Entity) -> bool {
    world.get::<terri_core::Target>(person).is_none()
        && world.get::<terri_core::Path>(person).is_none()
        && world.get::<Socialising>(person).is_none()
        && world.get::<terri_core::ChainState>(person).is_none()
        && world.get::<terri_core::Eating>(person).is_none()
        && world.get::<terri_core::AtWork>(person).is_none()
        && world.get::<terri_core::Commuting>(person).is_none()
        && world
            .get::<crate::reading::ReadingJourney>(person)
            .is_none()
        && world.get::<Reserved>(person).is_none()
        && world
            .get::<IntentQueue>(person)
            .is_none_or(IntentQueue::is_empty)
}

/// On the lot and not spoken for by a running conversation.
fn approachable(
    world: &World,
    person: Entity,
    listeners: &std::collections::BTreeSet<Entity>,
) -> bool {
    world.get::<terri_core::AtWork>(person).is_none()
        && world.get::<terri_core::Commuting>(person).is_none()
        && world.get::<Socialising>(person).is_none()
        && !listeners.contains(&person)
}

/// Withdraws a fight nobody ordered once it can no longer be served: the
/// other person has left for work or is commuting while the initiator was
/// still waiting to set off. (Death already strips every order naming the
/// dead from every queue; the despawn check below is a guard, not a
/// path.) A player's order waits for its partner to come home; an order
/// the trigger made up does not deserve that wait, and without this the
/// initiator would stand blocked for a whole shift. An order already under way (the initiator
/// has a target) is the rendezvous system's to release, as it releases any
/// approach a shift start interrupts. Only the queue entry the trigger
/// pushed is watched, by its id, so a player's identical order is never
/// touched: once the front of the queue is any other entry (the order was
/// served, popped, cancelled, or a player put their own order ahead of it)
/// this withdrawal watch ends. Its system provenance remains until the exact
/// queue entry leaves, including while it waits behind a player's order.
pub(crate) fn retract(world: &mut World) {
    if !published_rules(world) {
        withdraw_invalid(world);
    }
    let live_owners: std::collections::BTreeSet<_> = world
        .resource::<Fights>()
        .system_orders
        .iter()
        .filter(|(person, id)| {
            world
                .get::<IntentQueue>(**person)
                .is_some_and(|queue| queue.order(**id).is_some())
        })
        .map(|(&person, _)| person)
        .collect();
    world
        .resource_mut::<Fights>()
        .system_orders
        .retain(|person, _| live_owners.contains(person));
    let provoked: Vec<(Entity, u64)> = world
        .resource::<Fights>()
        .provoked
        .iter()
        .map(|(person, id)| (*person, *id))
        .collect();
    for (person, id) in provoked {
        let front = world
            .get::<IntentQueue>(person)
            .and_then(|queue| queue.entries().first())
            .filter(|entry| entry.id == id)
            .map(|entry| entry.intent);
        let Some(intent) = front else {
            world.resource_mut::<Fights>().provoked.remove(&person);
            continue;
        };
        if world.get::<terri_core::Target>(person).is_some() {
            world.resource_mut::<Fights>().provoked.remove(&person);
            continue;
        }
        let gone = world.get_entity(intent.object).is_err()
            || world.get::<terri_core::AtWork>(intent.object).is_some()
            || world.get::<terri_core::Commuting>(intent.object).is_some();
        if !gone {
            continue;
        }
        if let Some(mut queue) = world.get_mut::<IntentQueue>(person) {
            queue.remove_order(id);
        }
        world.entity_mut(person).remove::<terri_core::Blocked>();
        world.resource_mut::<Fights>().provoked.remove(&person);
    }
}

#[cfg(test)]
pub(crate) fn eligible(world: &World, row: &SavedGrievance, now: u64) -> bool {
    eligible_for(world, row, now, None)
}

pub(crate) fn eligible_for(
    world: &World,
    row: &SavedGrievance,
    now: u64,
    owner: Option<Entity>,
) -> bool {
    let tuning = world.resource::<crate::Content>().0.tuning;
    row.active_until > now
        && match row.subject {
            GrievanceSubject::Chore(o) => {
                row.responsible == o.owner
                    && owner.map_or_else(
                        || crate::chore_repair::still_unfinished(world, o),
                        |entity| crate::chore_repair::still_unfinished_for(world, o, entity),
                    )
                    && world
                        .get_resource::<SavedChores>()
                        .is_some_and(|s| crate::neglect::duty_due(world, s, o.key, o.owner))
                    && row.last_fought.is_none_or(|tick| {
                        now.saturating_sub(tick) >= u64::from(tuning.fight_repeat_grievance_ticks)
                    })
            }
            GrievanceSubject::None if row.kind == GrievanceKind::Chore => false,
            GrievanceSubject::Nuisance { object, .. } => {
                row.last_fought.is_none() && crate::dining::entity(world, object).is_some()
            }
            _ => row.last_fought.is_none(),
        }
}

fn context_valid(world: &World, context: &SavedFightContext, recipient: Entity) -> bool {
    if context.legacy {
        return true;
    }
    let Some(row) = context.grievance.and_then(|id| {
        world
            .get_resource::<crate::social_conflicts::State>()?
            .grievance(id)
    }) else {
        return false;
    };
    // An admitted incident remains the same incident. Its six-hour admission
    // horizon can pass during the argument; resolving its duty still cancels it.
    match row.subject {
        GrievanceSubject::Chore(o) => {
            crate::chore_repair::still_unfinished_for(world, o, recipient)
        }
        GrievanceSubject::Nuisance { object, .. } => crate::dining::entity(world, object).is_some(),
        _ => true,
    }
}

fn withdraw_invalid(world: &mut World) {
    let orders: Vec<_> = world.get_resource::<Fights>().map_or_else(Vec::new, |f| {
        f.system_orders
            .iter()
            .map(|(&actor, &id)| (actor, id))
            .collect()
    });
    for (actor, id) in orders {
        let intent = world
            .get::<IntentQueue>(actor)
            .and_then(|q| q.order(id))
            .map(|e| e.intent);
        let context = world
            .get_resource::<crate::social_conflicts::State>()
            .and_then(|s| {
                s.pending_fights
                    .get(&actor)
                    .or_else(|| s.fights.get(&actor).filter(|c| c.order_id == Some(id)))
            })
            .cloned();
        let Some(intent) = intent else {
            crate::social_conflicts::cancel_order(world, actor, id);
            world.resource_mut::<Fights>().system_orders.remove(&actor);
            continue;
        };
        let running = world
            .get::<Socialising>(actor)
            .is_some_and(|s| s.partner == intent.object)
            && crate::social_episode::request_order_id(world, actor) == Some(id);
        let reason_valid = context.as_ref().is_some_and(|c| {
            c.order_id == Some(id)
                && context_valid(world, c, intent.object)
                && (running
                    || c.legacy
                    || c.grievance
                        .and_then(|id| {
                            world
                                .get_resource::<crate::social_conflicts::State>()?
                                .grievance(id)
                        })
                        .is_some_and(|row| {
                            eligible_for(
                                world,
                                row,
                                world.resource::<SimClock>().tick,
                                Some(intent.object),
                            )
                        }))
        });
        let unavailable = world.get_entity(intent.object).is_err()
            || crate::social_episode::urgent(world, actor)
            || crate::social_episode::urgent(world, intent.object)
            || !running
                && [actor, intent.object].into_iter().any(|person| {
                    world.get::<SimId>(person).is_some_and(|id| {
                        world
                            .resource::<Fights>()
                            .active(*id, world.resource::<SimClock>().tick)
                    })
                });
        if reason_valid && !unavailable {
            continue;
        }
        crate::social_episode::release_order(world, actor, id);
        if running {
            world
                .entity_mut(actor)
                .remove::<(Socialising, terri_core::ConversationVoice)>();
        }
        if let Some(mut queue) = world.get_mut::<IntentQueue>(actor) {
            queue.remove_order(id);
        }
        if world.get::<terri_core::Target>(actor).is_none() {
            world.entity_mut(actor).remove::<terri_core::Blocked>();
        }
        crate::social_conflicts::cancel_order(world, actor, id);
        let mut fights = world.resource_mut::<Fights>();
        fights.provoked.remove(&actor);
        fights.system_orders.remove(&actor);
    }
}

/// Withdraws a fight nobody ordered once either side is in crisis: Hunger,
/// Energy or Bladder at or below the critical level, or away at work
/// (`social_episode::urgent`). A player's order survives critical needs; a
/// made-up grudge does not outrank food and sleep. This is the issue 301
/// ruling in rule 3 of `docs/specs/2026-10-16-fights.md`, pending the owner's
/// confirmation. A fight already under way runs to its end. Released claims
/// follow the execution owner, so a waiting partner is freed on this tick.
pub(crate) fn yield_to_critical_needs(world: &mut World) {
    if !published_rules(world) {
        withdraw_invalid(world);
    }
    let Some(fights) = world.get_resource::<Fights>() else {
        return;
    };
    let orders: Vec<(Entity, u64)> = fights
        .system_orders
        .iter()
        .map(|(person, id)| (*person, *id))
        .collect();
    for (person, id) in orders {
        let Some(intent) = world
            .get::<IntentQueue>(person)
            .and_then(|queue| queue.order(id))
            .map(|entry| entry.intent)
        else {
            continue;
        };
        let running = world
            .get::<Socialising>(person)
            .is_some_and(|talk| talk.partner == intent.object);
        let crisis = crate::social_episode::urgent(world, person)
            || (world.get_entity(intent.object).is_ok()
                && crate::social_episode::urgent(world, intent.object));
        if running || !crisis {
            continue;
        }
        crate::social_episode::release_order(world, person, id);
        if let Some(mut queue) = world.get_mut::<IntentQueue>(person) {
            queue.remove_order(id);
        }
        if world.get::<terri_core::Target>(person).is_none() {
            world.entity_mut(person).remove::<terri_core::Blocked>();
        }
        let mut fights = world.resource_mut::<Fights>();
        fights.provoked.remove(&person);
        fights.system_orders.remove(&person);
    }
}

/// Starts fights nobody ordered. Each tick, in id order, every idle person
/// without a running Had a fight moodlet or a crisis of their own looks at
/// every other living person, in id order: a feeling at or below the tuned
/// threshold, a reason against them and no crisis on their side earn one
/// seeded draw, and a draw under the tuned chance pushes a Fight order to
/// the front of the initiator's queue, which is then served as a player's
/// order is unless `retract` or `yield_to_critical_needs` withdraws it. The
/// first draw that passes ends the initiator's search this tick. Orders this
/// made earlier are withdrawn first when they can no longer be served.
pub(crate) fn provoke(world: &mut World) {
    if published_rules(world) {
        published::provoke(world);
        crate::social_conflicts::adopt_legacy(world);
        return;
    }
    let pack = world.resource::<crate::Content>().0;
    let Some(fight) = fight_index(pack) else {
        return;
    };
    retract(world);
    let chance = pack.tuning.fight_chance_per_tick;
    let now = world.resource::<SimClock>().tick;
    let mut people: Vec<(SimId, Entity)> = world
        .query_filtered::<(Entity, &SimId), With<Agent>>()
        .iter(world)
        .filter(|(e, _)| world.get::<Needs>(*e).is_some())
        .map(|(e, id)| (*id, e))
        .collect();
    people.sort_by_key(|(id, _)| *id);
    let entities: std::collections::BTreeMap<_, _> = people.iter().copied().collect();
    let listeners: std::collections::BTreeSet<_> = world
        .query::<&Socialising>()
        .iter(world)
        .map(|talk| talk.partner)
        .collect();
    for &(id, person) in &people {
        if !idle(world, person)
            || world.resource::<Fights>().active(id, now)
            || crate::social_episode::urgent(world, person)
        {
            continue;
        }
        let candidates: Vec<_> = world
            .get_resource::<crate::social_conflicts::State>()
            .map_or_else(Vec::new, |s| {
                s.for_person(id)
                    .filter(|r| r.active_until > now)
                    .cloned()
                    .collect()
            });
        let mut best: Option<(SavedGrievance, Entity)> = None;
        for row in candidates {
            let Some(&other) = entities.get(&SimId(row.responsible)) else {
                continue;
            };
            if !eligible_for(world, &row, now, Some(other)) {
                continue;
            }
            if world
                .resource::<Fights>()
                .active(SimId(row.responsible), now)
                || !approachable(world, other, &listeners)
                || crate::social_episode::urgent(world, other)
            {
                continue;
            }
            let replace = best.as_ref().is_none_or(|(current, _)| {
                row.severity.total_cmp(&current.severity).is_gt()
                    || row.severity == current.severity
                        && (row.responsible, row.id) < (current.responsible, current.id)
            });
            if replace {
                best = Some((row, other));
            }
        }
        let Some((row, other)) = best else { continue };
        let feeling = world
            .get::<Relationships>(person)
            .map_or(0.0, |r| r.feeling(SimId(row.responsible)));
        let mood = crate::mood::overall_score(world, person.index_u32()).unwrap_or(0.0);
        let probability = fight_probability(chance, mood, feeling, row.severity, &pack.tuning);
        if probability <= 0.0 || world.resource_mut::<SimRng>().next_f32() >= probability {
            continue;
        }
        let intent = Intent {
            cleanup: None,
            chore: None,
            object: other,
            interaction: fight,
        };
        let mut entity = world.entity_mut(person);
        let order = match entity.get_mut::<IntentQueue>() {
            Some(mut queue) => queue.insert_order(intent, None, true),
            None => {
                let mut queue = IntentQueue::default();
                let id = queue.insert_order(intent, None, true);
                entity.insert(queue);
                id
            }
        };
        if let Some(order) = order {
            world.resource_mut::<Fights>().restore_order(person, order);
            insert_context(
                world,
                person,
                other,
                Some(row.id),
                true,
                Some(order),
                reason_for(&row),
            );
        }
    }
}

pub(crate) fn fight_probability(
    base: f32,
    mood: f32,
    feeling: f32,
    severity: f32,
    tuning: &terri_data::Tuning,
) -> f32 {
    if base <= 0.0 {
        return 0.0;
    }
    if base >= 1.0 {
        return 1.0;
    }
    let mood = mood.clamp(-100.0, 100.0) / 100.0;
    let mood_scale = if mood < 0.0 {
        1.0 - mood * (tuning.fight_mood_bad_multiplier - 1.0)
    } else {
        1.0 - mood * (1.0 - tuning.fight_mood_good_multiplier)
    };
    let opinion = 1.0 - feeling.clamp(-1.0, 1.0) * tuning.fight_opinion_strength;
    let severity = (severity / tuning.fight_severity_reference).clamp(0.1, 2.0);
    (base * mood_scale * opinion * severity).clamp(0.0, 1.0)
}

fn insert_context(
    world: &mut World,
    initiator: Entity,
    recipient: Entity,
    grievance: Option<u64>,
    autonomous: bool,
    order_id: Option<u64>,
    reason: Reason,
) {
    let Some((a, b)) = crate::player_actions::saved_actor(world, initiator)
        .zip(crate::player_actions::saved_actor(world, recipient))
    else {
        return;
    };
    let started_at = world.resource::<SimClock>().tick;
    let row = SavedFightContext {
        initiator: a,
        recipient: b,
        grievance,
        autonomous,
        started_at,
        topic_code: Reason::code(Some(reason)) as u8,
        topic_tag: Reason::tag(Some(reason)).into(),
        legacy: false,
        order_id,
    };
    let mut state = world.get_resource_or_insert_with(crate::social_conflicts::State::default);
    if autonomous {
        state.pending_fights.insert(initiator, row);
    } else {
        state.fights.insert(initiator, row);
    }
}

pub(crate) fn begin_topic(
    world: &mut World,
    initiator: Entity,
    recipient: Entity,
) -> Option<crate::social_episode::Topic> {
    if published_rules(world) {
        let reason = world
            .get::<SimId>(recipient)
            .copied()
            .and_then(|id| published::reason_against(world, id));
        crate::social_conflicts::adopt_legacy(world);
        let now = world.resource::<SimClock>().tick;
        if let Some(context) = world
            .get_resource_mut::<crate::social_conflicts::State>()
            .and_then(|mut s| {
                s.fights.get_mut(&initiator).map(|row| {
                    row.started_at = now;
                    row.topic_code = Reason::code(reason) as u8;
                    row.topic_tag = Reason::tag(reason).into();
                    row.clone()
                })
            })
        {
            return Some(crate::social_episode::Topic {
                code: u32::from(context.topic_code),
                tag: context.topic_tag,
                initiator_preference: -1.,
                listener_preference: -1.,
            });
        }
        return None;
    }
    let executing = crate::social_episode::request_order_id(world, initiator);
    let pending = world
        .resource::<Fights>()
        .system_orders
        .get(&initiator)
        .copied();
    if let Some(id) = pending.filter(|id| Some(*id) != executing) {
        // Player contact supersedes the exact discretionary system request.
        crate::social_episode::release_order(world, initiator, id);
        if let Some(mut queue) = world.get_mut::<IntentQueue>(initiator) {
            queue.remove_order(id);
        }
        let mut fights = world.resource_mut::<Fights>();
        fights.system_orders.remove(&initiator);
        fights.provoked.remove(&initiator);
        crate::social_conflicts::cancel_order(world, initiator, id);
    }
    withdraw_invalid(world);
    world.get::<Socialising>(initiator)?;
    if let Some(mut state) = world.get_resource_mut::<crate::social_conflicts::State>() {
        if state
            .pending_fights
            .get(&initiator)
            .is_some_and(|row| row.order_id == executing)
        {
            let row = state.pending_fights.remove(&initiator).unwrap();
            state.fights.insert(initiator, row);
        }
    }
    let existing = world
        .get_resource::<crate::social_conflicts::State>()
        .and_then(|s| s.fights.get(&initiator))
        .cloned();
    if existing.is_none() {
        let now = world.resource::<SimClock>().tick;
        let selected = world
            .get::<SimId>(initiator)
            .copied()
            .zip(world.get::<SimId>(recipient).copied())
            .and_then(|(a, b)| {
                world
                    .get_resource::<crate::social_conflicts::State>()?
                    .for_pair(a, b)
                    .filter(|r| r.forget_at > now)
                    .max_by(|a, b| {
                        a.severity
                            .total_cmp(&b.severity)
                            .then_with(|| b.id.cmp(&a.id))
                    })
                    .cloned()
            });
        let (grievance, reason) = if let Some(row) = selected {
            (Some(row.id), reason_for(&row))
        } else {
            let draw = world.resource_mut::<SimRng>().next_f32();
            let index = ((draw * RANDOM_TOPICS.len() as f32) as usize).min(RANDOM_TOPICS.len() - 1);
            (None, Reason::Random(RANDOM_TOPICS[index]))
        };
        let order = crate::social_episode::request_order_id(world, initiator);
        insert_context(world, initiator, recipient, grievance, false, order, reason);
    }
    let now = world.resource::<SimClock>().tick;
    let mut state = world.get_resource_mut::<crate::social_conflicts::State>()?;
    let context = state.fights.get_mut(&initiator)?;
    context.started_at = now;
    Some(crate::social_episode::Topic {
        code: u32::from(context.topic_code),
        tag: context.topic_tag.clone(),
        initiator_preference: -1.0,
        listener_preference: -1.0,
    })
}

pub(crate) fn completed(world: &mut World, initiator: Entity, recipient: Entity) {
    if published_rules(world) {
        crate::social_conflicts::cancel(world, initiator);
        return;
    }
    let now = world.resource::<SimClock>().tick;
    let Some(context) = world
        .get_resource_mut::<crate::social_conflicts::State>()
        .and_then(|mut s| s.fights.remove(&initiator))
    else {
        return;
    };
    let Some(id) = context.grievance else { return };
    let subject = world
        .resource::<crate::social_conflicts::State>()
        .grievance(id)
        .map(|r| r.subject);
    world
        .resource_mut::<crate::social_conflicts::State>()
        .fought(id, now);
    if let Some(GrievanceSubject::Chore(obligation)) = subject {
        if let Some((a, b)) = world
            .get::<SimId>(initiator)
            .copied()
            .zip(world.get::<SimId>(recipient).copied())
        {
            if b.0 == obligation.owner && crate::chore_repair::still_unfinished(world, obligation) {
                crate::chore_repair::fight_completed(world, a, b, obligation);
            }
        }
    }
}
/// Drops expired moodlets once per tick, before anything reads them.
pub(crate) fn expire(world: &mut World) {
    let now = world.resource::<SimClock>().tick;
    if let Some(mut fights) = world.get_resource_mut::<Fights>() {
        fights.expire(now);
    }
}

pub(crate) fn hash(world: &World, hash: &mut FnvHasher) {
    if let Some(fights) = world.get_resource::<Fights>() {
        fights.hash_into(hash, b"fights-v1");
        let orders = fights.saved_orders(world);
        if !orders.is_empty() {
            hash.write_bytes(b"system-social-orders-v15");
            for (actor, id) in orders {
                hash.write_u64(u64::from(actor));
                hash.write_u64(id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{test_content, Sim};
    use terri_core::{NeedId, Position, SimIdAllocator, Target};

    fn fight_pack() -> &'static ContentPack {
        let mut fight = test_content::interaction("fight", &[], 40);
        fight.tags = vec![FIGHT_TAG.into()];
        test_content::pack_with_social(
            vec![test_content::object("fridge", &[(NeedId::Hunger, 20.)], 60)],
            vec![
                test_content::interaction("chat", &[(NeedId::Social, 30.)], 40),
                fight,
            ],
            test_content::tuning(),
        )
    }

    #[test]
    fn the_fight_is_the_tagged_entry_and_the_shipped_pack_has_one() {
        let pack = fight_pack();
        assert!(!is_fight(&pack.social[0]));
        assert!(is_fight(&pack.social[1]));
        assert_eq!(fight_index(pack), Some(1));
        let shipped = terri_data::pack();
        let index = fight_index(shipped).expect("content/social.toml ships a fight");
        assert_eq!(shipped.social[index as usize].label, "Fight");
        assert!(
            shipped.social[index as usize].advertises.is_empty(),
            "a fight fills no need"
        );
        assert_eq!(fight_index(test_content::pack(vec![])), None);
    }

    #[test]
    fn reasons_map_to_the_three_codes_and_tags_both_ways() {
        for (reason, code, tag) in [
            (Some(Reason::Dishes), 24, "fight-dishes"),
            (Some(Reason::OtherChore), 25, "fight-chore"),
            (None, 26, "fight"),
        ] {
            assert_eq!(Reason::code(reason), code);
            assert_eq!(Reason::tag(reason), tag);
            assert_eq!(Reason::from_tag(tag), Some(reason));
        }
        assert_eq!(Reason::from_tag("reading"), None);
        assert_eq!(Reason::NONE_CODE, 26);
    }

    /// A reason is a settled Missed episode the person owns whose chore
    /// still needs work; a done, pending or someone else's episode is
    /// not one, and the dishes name themselves.
    #[test]
    fn a_reason_is_a_missed_chore_still_undone() {
        let mut sim = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
        crate::chores::ensure(sim.world_mut());
        let owner = sim
            .world_mut()
            .query::<&SimId>()
            .iter(sim.world())
            .map(|id| id.0)
            .min()
            .unwrap();
        assert_eq!(reason_against(sim.world(), SimId(owner)), None);
        let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
        let counter = sim
            .world_mut()
            .query::<(Entity, &terri_core::SmartObject)>()
            .iter(sim.world())
            .find(|(_, o)| sim.world().resource::<crate::Content>().0.object(o.0).id == "counter")
            .unwrap()
            .0;
        crate::chores::add(&mut state.surfaces, counter.index_u32(), 1000);
        let key = terri_core::chores::ChoreKey {
            kind: ChoreKind::CounterSurfaces,
            target: crate::room_regions::RoomRegions::from_world(sim.world())
                .at((1, 0))
                .unwrap(),
        };
        let episode = |outcome, settled| terri_core::chores::ChoreEpisode {
            id: 1,
            key,
            owner,
            day: 0,
            decision: None,
            outcome,
            performer: None,
            completed_at: None,
            settled,
            needed: true,
            unavailable: false,
        };
        state.assignments = vec![terri_core::chores::ChoreAssignment {
            key,
            owner,
            week: 0,
        }];
        sim.world_mut()
            .insert_resource(terri_core::save_v19::SavedNeglect {
                duties: vec![terri_core::save_v19::DutyTimer {
                    key,
                    owner,
                    actionable_since: 0,
                    maximum_since: Some(0),
                }],
                ..Default::default()
            });
        state.episodes = vec![episode(DutyOutcome::Pending, false)];
        sim.world_mut().insert_resource(state.clone());
        assert_eq!(
            reason_against(sim.world(), SimId(owner)),
            None,
            "not settled"
        );
        state.episodes = vec![episode(DutyOutcome::Done, true)];
        sim.world_mut().insert_resource(state.clone());
        assert_eq!(reason_against(sim.world(), SimId(owner)), None, "done");
        state.episodes = vec![episode(DutyOutcome::Missed, true)];
        sim.world_mut().insert_resource(state.clone());
        assert_eq!(
            reason_against(sim.world(), SimId(owner)),
            Some(Reason::OtherChore)
        );
        assert_eq!(
            reason_against(sim.world(), SimId(owner + 100)),
            None,
            "somebody else's duty"
        );
        state.surfaces.clear();
        sim.world_mut().insert_resource(state.clone());
        assert_eq!(
            reason_against(sim.world(), SimId(owner)),
            None,
            "the mess is gone"
        );
        let mut dishes = episode(DutyOutcome::Missed, true);
        dishes.key = terri_core::chores::ChoreKey {
            kind: ChoreKind::Dishes,
            target: 0,
        };
        state.assignments[0].key = dishes.key;
        sim.world_mut()
            .resource_mut::<terri_core::save_v19::SavedNeglect>()
            .duties[0]
            .key = dishes.key;
        state.episodes = vec![dishes];
        sim.world_mut().insert_resource(state);
        sim.world_mut()
            .init_resource::<terri_core::save::SavedDomestic>();
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedDomestic>()
            .dishes
            .push(terri_core::save::SavedDishes {
                id: 1,
                surface: counter.index_u32(),
                owner,
                units: 3,
            });
        assert_eq!(
            reason_against(sim.world(), SimId(owner)),
            Some(Reason::Dishes)
        );
    }

    fn household(feeling: f32) -> (Sim, Entity, Entity) {
        let mut sim = test_content::sim_with(12, 8, fight_pack());
        let mut create = |x| {
            let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
            sim.world_mut()
                .spawn((
                    Agent,
                    id,
                    Position { x, y: 1. },
                    Needs::all_at(90.),
                    Relationships::default(),
                ))
                .id()
        };
        let a = create(1.);
        let b = create(7.);
        let b_id = *sim.world().get::<SimId>(b).unwrap();
        sim.world_mut()
            .get_mut::<Relationships>(a)
            .unwrap()
            .bump(b_id, feeling);
        (sim, a, b)
    }

    /// Plants a missed, still-dirty duty owned by `owner` on the board.
    pub(super) fn plant_reason(sim: &mut Sim, owner: Entity) {
        let owner_id = sim.world().get::<SimId>(owner).unwrap().0;
        let mut state = SavedChores {
            board_enabled: true,
            // The running board draws from its own stream, so a planted
            // state needs one; the provoke tests never tick the board.
            rng: Some(SimRng::from_seed(7)),
            ..Default::default()
        };
        let key = terri_core::chores::ChoreKey {
            kind: ChoreKind::Floors,
            target: 0,
        };
        state.floors = (0..96).map(|cell| (cell, 1000)).collect();
        state.assignments.push(terri_core::chores::ChoreAssignment {
            key,
            owner: owner_id,
            week: 0,
        });
        state.episodes.push(terri_core::chores::ChoreEpisode {
            id: 1,
            key,
            owner: owner_id,
            day: 0,
            decision: None,
            outcome: DutyOutcome::Missed,
            performer: None,
            completed_at: None,
            settled: true,
            needed: true,
            unavailable: false,
        });
        sim.world_mut().insert_resource(state);
        sim.world_mut().resource_mut::<SimClock>().tick = 120;
        sim.world_mut()
            .insert_resource(terri_core::save_v19::SavedNeglect {
                duties: vec![terri_core::save_v19::DutyTimer {
                    key,
                    owner: owner_id,
                    actionable_since: 0,
                    maximum_since: Some(0),
                }],
                ..Default::default()
            });
        let observers: Vec<_> = sim
            .world_mut()
            .query::<&SimId>()
            .iter(sim.world())
            .copied()
            .filter(|id| id.0 != owner_id)
            .collect();
        for affected in observers {
            crate::social_conflicts::remember(
                sim.world_mut(),
                affected,
                SimId(owner_id),
                GrievanceKind::Chore,
                GrievanceSubject::Chore(terri_core::save_v20::ChoreObligation {
                    key,
                    owner: owner_id,
                    actionable_since: 0,
                }),
                0.25,
            );
        }
    }

    fn queued_fight(sim: &Sim, person: Entity, target: Entity) -> bool {
        sim.world()
            .get::<IntentQueue>(person)
            .and_then(|q| q.front())
            .is_some_and(|i| i.object == target && i.interaction == 1)
    }

    #[test]
    fn issue314_stale_or_reassigned_chore_owner_has_no_current_reason() {
        let (mut sim, _, old_owner) = household(-1.0);
        plant_reason(&mut sim, old_owner);
        let key = sim.world().resource::<SavedChores>().episodes[0].key;
        let owner = *sim.world().get::<SimId>(old_owner).unwrap();
        sim.world_mut()
            .resource_mut::<SavedChores>()
            .assignments
            .clear();
        assert_eq!(
            reason_against(sim.world(), owner),
            None,
            "a historical missed episode without a current assignment cannot authorize blame"
        );
        sim.world_mut()
            .resource_mut::<SavedChores>()
            .assignments
            .push(terri_core::chores::ChoreAssignment {
                key,
                owner: owner.0 + 1,
                week: 0,
            });
        assert_eq!(
            reason_against(sim.world(), owner),
            None,
            "reassignment must not retain an autonomous reason against the previous owner"
        );
    }

    #[test]
    fn issue314_resolving_the_source_withdraws_only_the_autonomous_order() {
        let (mut sim, a, b) = household(-1.0);
        certain(&mut sim);
        plant_reason(&mut sim, b);
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, b));
        let system = sim.world().get::<IntentQueue>(a).unwrap().entries()[0].id;
        sim.world_mut()
            .get_mut::<IntentQueue>(a)
            .unwrap()
            .push(order(b));
        let player = sim.world().get::<IntentQueue>(a).unwrap().entries()[1].id;
        sim.world_mut().resource_mut::<SavedChores>().floors.clear();
        provoke(sim.world_mut());
        let queue = sim.world().get::<IntentQueue>(a).unwrap();
        assert!(
            queue.order(system).is_none(),
            "a resolved cause withdraws its exact system order"
        );
        assert!(
            queue.order(player).is_some(),
            "the identical player order keeps its ownership"
        );
    }

    /// The trigger needs all three: a feeling at or below the threshold, a
    /// reason, and an idle initiator; with a chance of one it fires on the
    /// first tick, and a running moodlet holds it off.
    #[test]
    fn a_fight_starts_only_with_a_grudge_a_reason_and_an_idle_initiator() {
        let with_chance = |feeling: f32, chance: f32| {
            let (mut sim, a, b) = household(feeling);
            let mut tuning = sim.world().resource::<crate::Content>().0.tuning;
            tuning.fight_chance_per_tick = chance;
            let pack = Box::leak(Box::new(ContentPack {
                tuning,
                ..sim.world().resource::<crate::Content>().0.clone()
            }));
            sim.world_mut().insert_resource(crate::Content(pack));
            (sim, a, b)
        };
        // No reason: nothing, however deep the grudge.
        let (mut sim, a, b) = with_chance(-1.0, 1.0);
        provoke(sim.world_mut());
        assert!(!queued_fight(&sim, a, b));
        // A reason and a grudge exactly at the threshold: a fight.
        let (mut sim, a, b) = with_chance(-0.9, 1.0);
        plant_reason(&mut sim, b);
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, b));
        assert!(!queued_fight(&sim, b, a), "the victim holds no grudge");
        // Just above the threshold: nothing.
        let (mut sim, a, b) = with_chance(-0.89, 1.0);
        plant_reason(&mut sim, b);
        provoke(sim.world_mut());
        assert!(
            queued_fight(&sim, a, b),
            "a real grievance is eligible above the former hostility gate"
        );
        // A chance of zero never fires.
        let (mut sim, a, b) = with_chance(-1.0, 0.0);
        plant_reason(&mut sim, b);
        provoke(sim.world_mut());
        assert!(!queued_fight(&sim, a, b));
        // A busy initiator waits; a running moodlet holds it off.
        let (mut sim, a, b) = with_chance(-1.0, 1.0);
        plant_reason(&mut sim, b);
        sim.world_mut().entity_mut(a).insert(Target {
            object: b,
            interaction: 0,
        });
        provoke(sim.world_mut());
        assert!(!queued_fight(&sim, a, b));
        sim.world_mut().entity_mut(a).remove::<Target>();
        let a_id = *sim.world().get::<SimId>(a).unwrap();
        sim.world_mut().resource_mut::<Fights>().record(a_id, 500);
        provoke(sim.world_mut());
        assert!(!queued_fight(&sim, a, b));
        sim.world_mut().resource_mut::<Fights>().forget(a_id);
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, b));
    }

    fn certain(sim: &mut Sim) {
        let mut tuning = sim.world().resource::<crate::Content>().0.tuning;
        tuning.fight_chance_per_tick = 1.0;
        let pack = Box::leak(Box::new(ContentPack {
            tuning,
            ..sim.world().resource::<crate::Content>().0.clone()
        }));
        sim.world_mut().insert_resource(crate::Content(pack));
    }

    fn incident(sim: &mut Sim, a: Entity, b: Entity, severity: f32) -> u64 {
        let a = *sim.world().get::<SimId>(a).unwrap();
        let b = *sim.world().get::<SimId>(b).unwrap();
        crate::social_conflicts::remember(
            sim.world_mut(),
            a,
            b,
            GrievanceKind::PrivacyStart,
            GrievanceSubject::None,
            severity,
        )
        .unwrap()
    }

    #[test]
    fn issue314_probability_uses_bounded_mood_opinion_and_severity() {
        let tuning = terri_data::pack().tuning;
        assert_eq!(fight_probability(0.001, 0., 0., 0.25, &tuning), 0.001);
        assert_eq!(fight_probability(0.001, -100., 0., 0.25, &tuning), 0.002);
        assert_eq!(fight_probability(0.001, 100., 0., 0.25, &tuning), 0.00025);
        assert_eq!(fight_probability(0.001, 0., 1., 0.25, &tuning), 0.0005);
        assert_eq!(fight_probability(0.001, 0., -1., 0.25, &tuning), 0.0015);
        assert_eq!(fight_probability(0., -100., -1., 2., &tuning), 0.);
        assert_eq!(fight_probability(1., 100., 1., 0.001, &tuning), 1.);
    }

    #[test]
    fn issue314_published_producer_retains_the_original_per_recipient_draws() {
        let (mut sim, a, b) = household(-1.);
        let mut pack = sim.world().resource::<crate::Content>().0.clone();
        pack.tuning.fight_rules = terri_data::FightRules::Published;
        pack.tuning.fight_chance_per_tick = 0.;
        sim.world_mut()
            .insert_resource(crate::Content(Box::leak(Box::new(pack))));
        let c = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(7),
                Position { x: 5., y: 2. },
                Needs::all_at(90.),
                Relationships::default(),
            ))
            .id();
        sim.world_mut()
            .get_mut::<Relationships>(a)
            .unwrap()
            .bump(SimId(7), -1.);
        plant_reason(&mut sim, b);
        let mut missed = sim.world().resource::<SavedChores>().episodes[0].clone();
        missed.id = 2;
        missed.owner = 7;
        sim.world_mut()
            .resource_mut::<SavedChores>()
            .episodes
            .push(missed);
        let mut expected = sim.world().resource::<SimRng>().clone();
        expected.next_f32();
        expected.next_f32();
        provoke(sim.world_mut());
        assert_eq!(
            sim.world().resource::<SimRng>(),
            &expected,
            "the frozen zero chance still spends one draw per eligible recipient"
        );
        assert!(!queued_fight(&sim, a, b) && !queued_fight(&sim, a, c));
        assert!(crate::social_conflicts::snapshot(sim.world())
            .grievances
            .is_empty());
    }

    #[test]
    fn issue314_old_save_version_does_not_select_the_published_producer_policy() {
        let (mut sim, _, _) = household(0.);
        assert!(!published_rules(sim.world()));
        let old = sim.save_snapshot_v19();
        sim.load_snapshot_v19(old).unwrap();
        assert!(
            !published_rules(sim.world()),
            "ordinary old saves inherit the live content policy"
        );
    }

    #[test]
    fn issue314_no_reason_means_no_draw_and_both_cooldowns_hold() {
        let (mut sim, a, b) = household(0.);
        certain(&mut sim);
        let rng = sim.world().resource::<SimRng>().clone();
        provoke(sim.world_mut());
        assert_eq!(sim.world().resource::<SimRng>(), &rng);
        incident(&mut sim, a, b, 0.25);
        let id = *sim.world().get::<SimId>(b).unwrap();
        sim.world_mut().resource_mut::<Fights>().record(id, 500);
        provoke(sim.world_mut());
        assert!(!queued_fight(&sim, a, b));
        assert_eq!(
            sim.world().resource::<SimRng>(),
            &rng,
            "recipient cooldown consumes no draw"
        );
        sim.world_mut().resource_mut::<Fights>().forget(id);
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, b));
        assert!(!queued_fight(&sim, b, a), "annoyance has a direction");
    }

    #[test]
    fn issue314_many_recipients_spend_one_draw_and_choose_the_strongest() {
        let (mut sim, a, b) = household(0.);
        certain(&mut sim);
        let c = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(7),
                Position { x: 5., y: 2. },
                Needs::all_at(90.),
                Relationships::default(),
            ))
            .id();
        incident(&mut sim, a, b, 0.1);
        incident(&mut sim, a, c, 0.4);
        let mut expected = sim.world().resource::<SimRng>().clone();
        expected.next_f32();
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, c));
        assert_eq!(sim.world().resource::<SimRng>(), &expected);
    }

    #[test]
    fn issue314_consumed_privacy_does_not_restart_without_another_incident() {
        let (mut sim, a, b) = household(0.);
        certain(&mut sim);
        let id = incident(&mut sim, a, b, 0.25);
        sim.world_mut()
            .resource_mut::<crate::social_conflicts::State>()
            .fought(id, 0);
        provoke(sim.world_mut());
        assert!(!queued_fight(&sim, a, b));
        incident(&mut sim, a, b, 0.25);
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, b));
    }

    #[test]
    fn issue314_player_fallback_is_an_ordinary_subject_with_explicit_context() {
        let (mut sim, a, b) = household(0.);
        sim.world_mut().entity_mut(a).insert(Socialising {
            partner: b,
            interaction: 1,
            remaining_ticks: 40,
        });
        let topic = begin_topic(sim.world_mut(), a, b).unwrap();
        assert!(matches!(
            Reason::from_tag_current(&topic.tag),
            Some(Some(Reason::Random(_)))
        ));
        assert!(
            Reason::from_tag(&topic.tag).is_none(),
            "published readers retain their topic contract"
        );
        let row = &sim
            .world()
            .resource::<crate::social_conflicts::State>()
            .fights[&a];
        assert!(!row.autonomous && !row.legacy && row.grievance.is_none());
    }

    #[test]
    fn issue314_running_resolved_chore_cancels_without_fight_outcomes() {
        let (mut sim, a, b) = household(0.);
        certain(&mut sim);
        plant_reason(&mut sim, b);
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, b));
        sim.world_mut().entity_mut(a).insert(Socialising {
            partner: b,
            interaction: 1,
            remaining_ticks: 40,
        });
        let order = sim.world().get::<IntentQueue>(a).unwrap().entries()[0].id;
        sim.world_mut()
            .resource_mut::<crate::social_episode::SocialEpisodes>()
            .executions
            .insert(
                a,
                crate::social_episode::Execution {
                    recipient: b,
                    interaction: 1,
                    owner: crate::social_episode::ExecutionOwner::System(Some(order)),
                    phase: crate::social_episode::ExecutionPhase::Running,
                    admitted: true,
                },
            );
        sim.world_mut().resource_mut::<SavedChores>().floors.clear();
        retract(sim.world_mut());
        assert!(sim.world().get::<Socialising>(a).is_none());
        assert!(sim.world().resource::<Fights>().entries().is_empty());
        assert!(!queued_fight(&sim, a, b));
        assert!(sim
            .world()
            .resource::<crate::social_conflicts::State>()
            .repairs
            .is_empty());
    }

    fn order(object: Entity) -> Intent {
        Intent {
            cleanup: None,
            chore: None,
            object,
            interaction: 1,
        }
    }

    /// Someone in a conversation, their own or as the one being talked to,
    /// is not approached for a fight until it ends; a conversation between
    /// two other people holds nothing off.
    #[test]
    fn a_fight_waits_while_the_other_person_is_being_talked_to() {
        let (mut sim, a, b) = household(-1.0);
        certain(&mut sim);
        plant_reason(&mut sim, b);
        let c = sim.world_mut().spawn_empty().id();
        let d = sim.world_mut().spawn_empty().id();
        let talk = |partner| Socialising {
            interaction: 0,
            partner,
            remaining_ticks: 10,
        };
        sim.world_mut().entity_mut(c).insert(talk(b));
        provoke(sim.world_mut());
        assert!(!queued_fight(&sim, a, b), "b is being talked to");
        sim.world_mut().entity_mut(c).remove::<Socialising>();
        sim.world_mut().entity_mut(b).insert(talk(d));
        provoke(sim.world_mut());
        assert!(
            !queued_fight(&sim, a, b),
            "b is in a conversation of its own"
        );
        sim.world_mut().entity_mut(b).remove::<Socialising>();
        sim.world_mut().entity_mut(c).insert(talk(d));
        provoke(sim.world_mut());
        assert!(
            queued_fight(&sim, a, b),
            "a talk between two others holds nothing off"
        );
    }

    /// Issue 301: a crisis on either side holds off a made-up fight, so the
    /// trigger never queues one that would only be withdrawn again.
    #[test]
    fn a_crisis_on_either_side_holds_off_a_fight() {
        for (need, on_initiator) in [
            (NeedId::Hunger, true),
            (NeedId::Energy, true),
            (NeedId::Hunger, false),
            (NeedId::Bladder, false),
        ] {
            let (mut sim, a, b) = household(-1.0);
            certain(&mut sim);
            plant_reason(&mut sim, b);
            let person = if on_initiator { a } else { b };
            sim.world_mut()
                .get_mut::<Needs>(person)
                .unwrap()
                .set(need, 5.0);
            provoke(sim.world_mut());
            assert!(
                !queued_fight(&sim, a, b),
                "{need:?} on initiator={on_initiator} holds the fight off"
            );
            sim.world_mut()
                .get_mut::<Needs>(person)
                .unwrap()
                .set(need, 90.0);
            provoke(sim.world_mut());
            assert!(queued_fight(&sim, a, b), "relief lets the grudge resurface");
        }
    }

    /// Each tick's expiry drops a moodlet whose end has passed and keeps a
    /// running one, so the saved and hashed list holds only running rows.
    #[test]
    fn expiry_drops_only_finished_moodlets() {
        let (mut sim, a, b) = household(0.0);
        let a_id = *sim.world().get::<SimId>(a).unwrap();
        let b_id = *sim.world().get::<SimId>(b).unwrap();
        {
            let mut fights = sim.world_mut().resource_mut::<Fights>();
            fights.record(a_id, 10);
            fights.record(b_id, 1000);
        }
        sim.world_mut().resource_mut::<SimClock>().tick = 500;
        expire(sim.world_mut());
        assert_eq!(sim.world().resource::<Fights>().entries(), &[(b_id, 1000)]);
    }

    /// An order the trigger made up is withdrawn when the other person
    /// leaves for work before it is served, and the initiator is unblocked;
    /// a player's order to the same person is left alone.
    #[test]
    fn a_provoked_order_is_withdrawn_when_the_other_person_leaves() {
        let (mut sim, a, b) = household(-1.0);
        certain(&mut sim);
        plant_reason(&mut sim, b);
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, b));
        assert!(sim.world().resource::<Fights>().provoked(a));
        // Still here: the order stays, as `serve_intents` would wait.
        sim.world_mut().entity_mut(a).insert(terri_core::Blocked);
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, b));
        // Gone to work: withdrawn, unblocked, and not pushed again while
        // they are away.
        sim.world_mut().entity_mut(b).insert(terri_core::AtWork {
            remaining_ticks: 100,
        });
        provoke(sim.world_mut());
        assert!(!queued_fight(&sim, a, b));
        assert!(sim.world().get::<terri_core::Blocked>(a).is_none());
        assert!(!sim.world().resource::<Fights>().provoked(a));
        // A player's own order survives the same departure.
        sim.world_mut()
            .get_mut::<IntentQueue>(a)
            .unwrap()
            .push_front(order(b));
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, b));
    }

    /// Only the exact made-up order is ever withdrawn. A player's order
    /// queued behind it, or put in front of it, is left alone when its
    /// partner leaves; the person is forgotten once the front changes.
    #[test]
    fn only_the_made_up_order_is_withdrawn_not_a_players_queued_near_it() {
        let (mut sim, a, b) = household(-1.0);
        certain(&mut sim);
        let c = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(7),
                Position { x: 3.0, y: 1.0 },
                Needs::all_at(90.),
                Relationships::default(),
            ))
            .id();
        plant_reason(&mut sim, b);
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, b));
        // Queued behind: the made-up order is served and popped, the
        // player's order to someone else reaches the front, that someone
        // leaves for work, and the order stays.
        sim.world_mut()
            .get_mut::<IntentQueue>(a)
            .unwrap()
            .push(order(c));
        sim.world_mut()
            .get_mut::<IntentQueue>(a)
            .unwrap()
            .remove_first(order(b));
        sim.world_mut().entity_mut(c).insert(terri_core::AtWork {
            remaining_ticks: 100,
        });
        sim.world_mut().entity_mut(a).insert(terri_core::Blocked);
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, c));
        assert!(sim.world().get::<terri_core::Blocked>(a).is_some());
        assert!(!sim.world().resource::<Fights>().provoked(a));
        // In front: a player's order ahead of the made-up one ends the
        // watch, and the player's order stays when its partner leaves.
        sim.world_mut()
            .get_mut::<IntentQueue>(a)
            .unwrap()
            .remove_first(order(c));
        sim.world_mut().entity_mut(c).remove::<terri_core::AtWork>();
        sim.world_mut()
            .entity_mut(a)
            .remove::<terri_core::Blocked>();
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, b));
        assert!(sim.world().resource::<Fights>().provoked(a));
        sim.world_mut()
            .get_mut::<IntentQueue>(a)
            .unwrap()
            .push_front(order(c));
        sim.world_mut().entity_mut(c).insert(terri_core::AtWork {
            remaining_ticks: 100,
        });
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, c));
        assert!(!sim.world().resource::<Fights>().provoked(a));
        assert_eq!(sim.world().get::<IntentQueue>(a).unwrap().len(), 2);
        // Identical to the made-up one, queued behind it by the player,
        // and the made-up one withdrawn from the order list: the player's
        // copy has its own id and is never withdrawn.
        let (mut sim, a, b) = household(-1.0);
        certain(&mut sim);
        plant_reason(&mut sim, b);
        provoke(sim.world_mut());
        let made_up = sim.world().get::<IntentQueue>(a).unwrap().entries()[0].id;
        sim.world_mut()
            .get_mut::<IntentQueue>(a)
            .unwrap()
            .push(order(b));
        sim.world_mut()
            .get_mut::<IntentQueue>(a)
            .unwrap()
            .remove_order(made_up);
        sim.world_mut().entity_mut(b).insert(terri_core::AtWork {
            remaining_ticks: 100,
        });
        provoke(sim.world_mut());
        assert!(queued_fight(&sim, a, b));
        assert!(!sim.world().resource::<Fights>().provoked(a));
    }

    /// The roll is one seeded draw: two worlds from one seed fire on the
    /// same tick, another seed on another, and at a half chance both
    /// outcomes occur.
    #[test]
    fn the_trigger_is_seeded() {
        let first_tick = |seed: u64| {
            let (mut sim, a, b) = household(-1.0);
            let mut tuning = sim.world().resource::<crate::Content>().0.tuning;
            tuning.fight_chance_per_tick = 0.5;
            let pack = Box::leak(Box::new(ContentPack {
                tuning,
                ..sim.world().resource::<crate::Content>().0.clone()
            }));
            sim.world_mut().insert_resource(crate::Content(pack));
            sim.world_mut().insert_resource(SimRng::from_seed(seed));
            plant_reason(&mut sim, b);
            (1..=40)
                .find(|_| {
                    provoke(sim.world_mut());
                    queued_fight(&sim, a, b)
                })
                .expect("a half chance fires within forty ticks")
        };
        assert_eq!(first_tick(11), first_tick(11));
        let ticks: std::collections::BTreeSet<_> = (1..=12).map(first_tick).collect();
        assert!(ticks.len() > 1, "different seeds fire on different ticks");
    }
}

/// A player's Fight order through the running schedule: the approach, the
/// red topic, the completion effects on both sides, and an interruption.
#[cfg(test)]
mod order_tests {
    use super::*;
    use crate::{test_content, Sim};
    use terri_core::{CommandQueue, NeedId, Position, SimCommand, Target};

    fn household() -> (Sim, Entity, Entity, Entity) {
        let mut fight = test_content::interaction("fight", &[], 40);
        fight.tags = vec![FIGHT_TAG.into()];
        let pack = test_content::pack_with_social(
            vec![test_content::object(
                "fridge",
                &[(NeedId::Hunger, 30.0)],
                18,
            )],
            vec![
                test_content::interaction("chat", &[(NeedId::Social, 30.0)], 40),
                fight,
            ],
            test_content::tuning(),
        );
        let fridge_def = pack.find("fridge").expect("the fixture declares it");
        let mut sim = test_content::sim_with(10, 8, pack);
        let person = |sim: &mut Sim, id, x| {
            let issued = sim
                .world_mut()
                .resource_mut::<terri_core::SimIdAllocator>()
                .issue();
            assert_eq!(issued.0, id);
            sim.world_mut()
                .spawn((
                    Agent,
                    SimId(id),
                    Position { x, y: 1.0 },
                    Needs::with(NeedId::Social, 50.0),
                    Relationships::default(),
                ))
                .id()
        };
        let a = person(&mut sim, 0, 1.0);
        let b = person(&mut sim, 1, 4.0);
        let fridge = sim
            .world_mut()
            .spawn((
                Position { x: 7.0, y: 3.0 },
                terri_core::SmartObject(fridge_def),
            ))
            .id();
        (sim, a, b, fridge)
    }

    fn order_fight(sim: &mut Sim, a: Entity, b: Entity) {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::TalkTo {
                agent: a.index_u32(),
                target: b.index_u32(),
                interaction: 1,
            });
    }

    fn tick_until(sim: &mut Sim, mut done: impl FnMut(&Sim) -> bool, what: &str) -> u64 {
        for _ in 0..600 {
            sim.tick();
            if done(sim) {
                return sim.world().resource::<SimClock>().tick;
            }
        }
        let agents: Vec<_> = sim
            .world_mut()
            .query_filtered::<(
                Entity,
                &Position,
                Option<&terri_core::Target>,
                Option<&terri_core::Path>,
                Option<&IntentQueue>,
            ), With<Agent>>()
            .iter(sim.world())
            .map(|(actor, position, target, path, queue)| {
                (
                    actor,
                    *position,
                    target.copied(),
                    path.cloned(),
                    queue.cloned(),
                )
            })
            .collect();
        panic!("{what} never happened in 600 ticks; agents={agents:?}; executions={:?}; chores={:?}; orders={:?}",
            sim.world().resource::<crate::social_episode::SocialEpisodes>().executions,
            sim.world().get_resource::<SavedChores>().map(|state|&state.tasks),
            sim.action_events_since(0).events);
    }

    fn feeling(sim: &Sim, me: Entity, other: Entity) -> f32 {
        let other = *sim.world().get::<SimId>(other).unwrap();
        sim.world()
            .get::<Relationships>(me)
            .map_or(0.0, |r| r.feeling(other))
    }

    fn social(sim: &Sim, who: Entity) -> f32 {
        sim.world().get::<Needs>(who).unwrap().get(NeedId::Social)
    }

    /// The order walks the initiator over, both bubbles carry the plain
    /// fight topic, nobody's Social rises, and the end costs both sides
    /// the tuned feeling and leaves both with the moodlet.
    #[test]
    fn a_fight_order_runs_red_fills_nobody_and_costs_both_sides() {
        let (mut sim, a, b, _fridge) = household();
        let loss = sim
            .world()
            .resource::<crate::Content>()
            .0
            .tuning
            .fight_relationship_loss;
        let ticks = sim
            .world()
            .resource::<crate::Content>()
            .0
            .tuning
            .fight_mood_ticks;
        let social_before = (social(&sim, a), social(&sim, b));
        order_fight(&mut sim, a, b);
        tick_until(
            &mut sim,
            |sim| sim.world().get::<Socialising>(a).is_some(),
            "the fight",
        );
        assert_eq!(
            sim.world().get::<Socialising>(a).unwrap().interaction,
            1,
            "the order names the fight"
        );
        let first_topic = crate::social_episode::bubble(sim.world(), a.index_u32());
        assert!(first_topic.0 >= 33 && first_topic.1 == -1.0);
        assert_eq!(
            crate::social_episode::bubble(sim.world(), b.index_u32()),
            first_topic
        );
        let ended = tick_until(
            &mut sim,
            |sim| sim.world().get::<Socialising>(a).is_none(),
            "the end of the fight",
        );
        assert!(
            social(&sim, a) <= social_before.0 + 1e-3,
            "a fight fills nobody"
        );
        assert!(
            social(&sim, b) <= social_before.1 + 1e-3,
            "a fight fills nobody"
        );
        for (me, other) in [(a, b), (b, a)] {
            let felt = feeling(&sim, me, other);
            assert!(
                (felt + loss).abs() < 0.01,
                "each side loses the tuned feeling: {felt} vs -{loss}"
            );
            let id = *sim.world().get::<SimId>(me).unwrap();
            assert_eq!(
                sim.world()
                    .resource::<Fights>()
                    .entries()
                    .iter()
                    .find(|(who, _)| *who == id),
                Some(&(id, ended + u64::from(ticks))),
                "the moodlet ends the tuned ticks after the fight"
            );
            assert!(sim
                .mood_of(me.index_u32())
                .unwrap()
                .moodlets
                .iter()
                .any(|m| m.label == crate::mood::HAD_A_FIGHT));
        }
        assert!(
            sim.world().get::<Target>(a).is_none() && sim.world().get::<Reserved>(b).is_none(),
            "the end releases the partner as a chat's does"
        );
        assert!(
            sim.world()
                .get::<IntentQueue>(a)
                .is_none_or(IntentQueue::is_empty),
            "the order is popped once"
        );
        let diagnostics = sim
            .world()
            .resource::<crate::relationship_effects::RelationshipDiagnostics>();
        assert_eq!(
            diagnostics
                .effects
                .iter()
                .filter(|e| e.cause == crate::relationship_effects::RelationshipCause::Fight)
                .count(),
            2
        );
    }

    /// The listener's missed chore names the topic when there is one. On
    /// the shipped lot, so the board keeps the planted duty: it refuses a
    /// key that names no real surface.
    #[test]
    fn a_fight_over_a_missed_chore_shows_that_chore() {
        let mut sim = test_content::without_owned_books(Sim::new_from_shipped_lot());
        crate::chores::ensure(sim.world_mut());
        let fight = fight_index(sim.world().resource::<crate::Content>().0).unwrap();
        let mut people: Vec<(u32, Entity)> = sim
            .world_mut()
            .query::<(Entity, &SimId)>()
            .iter(sim.world())
            .map(|(e, id)| (id.0, e))
            .collect();
        people.sort();
        let (a, (b_id, b)) = (people[0].1, people[1]);
        let counter = sim
            .world_mut()
            .query::<(Entity, &terri_core::SmartObject)>()
            .iter(sim.world())
            .find(|(_, o)| sim.world().resource::<crate::Content>().0.object(o.0).id == "counter")
            .unwrap()
            .0;
        let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
        crate::chores::add(&mut state.surfaces, counter.index_u32(), 1000);
        state.episodes.push(terri_core::chores::ChoreEpisode {
            id: 900,
            key: terri_core::chores::ChoreKey {
                kind: ChoreKind::CounterSurfaces,
                target: crate::room_regions::RoomRegions::from_world(sim.world())
                    .at((1, 0))
                    .unwrap(),
            },
            owner: b_id,
            day: 0,
            decision: None,
            outcome: DutyOutcome::Missed,
            performer: None,
            completed_at: None,
            settled: true,
            needed: true,
            unavailable: false,
        });
        sim.world_mut().insert_resource(state);
        let affected = *sim.world().get::<SimId>(a).unwrap();
        crate::social_conflicts::remember(
            sim.world_mut(),
            affected,
            SimId(b_id),
            GrievanceKind::Chore,
            GrievanceSubject::None,
            0.25,
        );
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::TalkToFirst {
                agent: a.index_u32(),
                target: b.index_u32(),
                interaction: fight,
            });
        for _ in 0..2000 {
            sim.tick();
            if sim.world().get::<Socialising>(a).is_some() {
                break;
            }
        }
        assert_eq!(
            sim.world().get::<Socialising>(a).map(|s| s.interaction),
            Some(fight),
            "the fight order is served within 2000 ticks"
        );
        assert_eq!(
            crate::social_episode::bubble(sim.world(), a.index_u32()),
            (Reason::code(Some(Reason::OtherChore)), -1.0)
        );
        assert_eq!(
            crate::social_episode::bubble(sim.world(), b.index_u32()),
            (Reason::code(Some(Reason::OtherChore)), -1.0)
        );
        assert_eq!(
            sim.world()
                .resource::<crate::social_episode::SocialEpisodes>()
                .topics[&a]
                .tag,
            "fight-chore"
        );
    }

    /// A partner pulled away by an order ends the fight with nothing
    /// recorded, exactly as an interrupted chat earns nothing.
    #[test]
    fn an_interrupted_fight_changes_nothing() {
        let (mut sim, a, b, fridge) = household();
        order_fight(&mut sim, a, b);
        tick_until(
            &mut sim,
            |sim| sim.world().get::<Socialising>(a).is_some(),
            "the fight",
        );
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObjectFirst {
                agent: b.index_u32(),
                object: fridge.index_u32(),
                interaction: 0,
            });
        tick_until(
            &mut sim,
            |sim| sim.world().get::<Socialising>(a).is_none(),
            "the interruption",
        );
        // Standing together still pays ordinary proximity; the fight itself
        // left no loss, no moodlet and no effect record.
        assert!(feeling(&sim, a, b) >= 0.0);
        assert!(feeling(&sim, b, a) >= 0.0);
        assert!(sim.world().resource::<Fights>().entries().is_empty());
        assert!(sim
            .world()
            .resource::<crate::relationship_effects::RelationshipDiagnostics>()
            .effects
            .iter()
            .all(|e| e.cause != crate::relationship_effects::RelationshipCause::Fight));
    }

    /// [AL-record] kind 3: a finished fight is one line naming both sides,
    /// the fight topic and both losses.
    #[test]
    fn fight_completion_logs_reason_and_both_losses() {
        use crate::activity_log::{opinion_units, LogKind, ACTIONS, SOCIAL};
        let (mut sim, a, b, _fridge) = household();
        order_fight(&mut sim, a, b);
        tick_until(
            &mut sim,
            |sim| sim.world().get::<Socialising>(a).is_some(),
            "the fight",
        );
        // A player's fight takes a reason of its own; the line names it.
        let tag = sim
            .world()
            .resource::<crate::social_episode::SocialEpisodes>()
            .topics[&a]
            .tag
            .clone();
        assert!(
            Reason::from_tag_current(&tag).is_some(),
            "{tag} is a fight reason"
        );
        tick_until(
            &mut sim,
            |sim| sim.world().get::<Socialising>(a).is_none(),
            "the end of the fight",
        );
        let pack = sim.world().resource::<crate::Content>().0;
        let records: Vec<_> = sim.activity_log().records().copied().collect();
        let fights: Vec<_> = records
            .iter()
            .filter(|r| r.kind() == Some(LogKind::FightDone))
            .collect();
        assert_eq!(fights.len(), 1, "{records:?}");
        assert!(records.iter().all(|r| r.kind() != Some(LogKind::ChatDone)));
        let record = fights[0];
        let (a_id, b_id) = (
            *sim.world().get::<SimId>(a).unwrap(),
            *sim.world().get::<SimId>(b).unwrap(),
        );
        assert_eq!((record.actor(), record.other()), (a_id.0, b_id.0));
        assert_eq!(record.triggers(), ACTIONS | SOCIAL);
        assert_eq!(record.label2(), sim.activity_log().label(pack, &tag));
        assert_ne!(record.label2(), crate::activity_log::NONE);
        let loss = |me: SimId, other: SimId| {
            sim.relationship_effects()
                .iter()
                .find(|e| {
                    e.cause == crate::relationship_effects::RelationshipCause::Fight
                        && e.affected == me
                        && e.responsible == other
                })
                .unwrap()
                .actual
        };
        assert_eq!(record.value(2), opinion_units(loss(a_id, b_id)));
        assert_eq!(record.value(3), opinion_units(loss(b_id, a_id)));
        assert!(record.value(2) < 0 && record.value(3) < 0);
    }

    #[test]
    fn issue314_extended_running_fight_roundtrips_only_in_v20() {
        let (mut sim, a, b, _) = household();
        order_fight(&mut sim, a, b);
        tick_until(
            &mut sim,
            |s| s.world().get::<Socialising>(a).is_some(),
            "the player argument",
        );
        let saved = sim.save_snapshot_v20();
        assert_eq!(saved.conflicts.fights.len(), 1);
        assert!(saved.conflicts.fights[0].topic_code >= 33);
        let hash = sim.world_hash();
        let rng = sim.world().resource::<SimRng>().clone();
        assert!(
            sim.load_snapshot_v19(saved.legacy.clone()).is_err(),
            "the frozen reader refuses the extended topic"
        );
        assert_eq!(sim.world_hash(), hash, "historical rejection is atomic");
        sim.load_snapshot_v20(saved.clone()).unwrap();
        assert_eq!(sim.world_hash(), hash);
        assert_eq!(sim.world().resource::<SimRng>(), &rng);
        let mut missing = saved;
        missing.conflicts.fights.clear();
        assert!(
            sim.load_snapshot_v20(missing).is_err(),
            "current saves cannot erase the argument's cause and provenance"
        );
        assert_eq!(sim.world_hash(), hash);
    }

    #[test]
    fn issue314_player_fight_supersedes_only_the_exact_pending_system_fight() {
        let (mut sim, a, b, _) = household();
        let mut pack = sim.world().resource::<crate::Content>().0.clone();
        pack.tuning.fight_chance_per_tick = 1.;
        sim.world_mut()
            .insert_resource(crate::Content(Box::leak(Box::new(pack))));
        let a_id = *sim.world().get::<SimId>(a).unwrap();
        let b_id = *sim.world().get::<SimId>(b).unwrap();
        let grievance = crate::social_conflicts::remember(
            sim.world_mut(),
            a_id,
            b_id,
            GrievanceKind::PrivacyStart,
            GrievanceSubject::None,
            0.25,
        )
        .unwrap();
        provoke(sim.world_mut());
        let system = sim.world().get::<IntentQueue>(a).unwrap().entries()[0].id;
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::TalkToFirst {
                agent: a.index_u32(),
                target: b.index_u32(),
                interaction: 1,
            });
        tick_until(
            &mut sim,
            |s| s.world().get::<Socialising>(a).is_some(),
            "the player's superseding fight",
        );
        let context = &sim
            .world()
            .resource::<crate::social_conflicts::State>()
            .fights[&a];
        let player = context.order_id.unwrap();
        assert_ne!(player, system);
        assert!(!context.autonomous);
        assert_eq!(context.grievance, Some(grievance));
        let queue = sim.world().get::<IntentQueue>(a).unwrap();
        assert!(queue.order(system).is_none());
        assert!(queue.order(player).is_some());
        let saved = sim.save_snapshot_v20();
        let hash = sim.world_hash();
        sim.load_snapshot_v20(saved).unwrap();
        assert_eq!(sim.world_hash(), hash);
    }

    #[test]
    fn issue314_incoming_player_fight_cooldown_withdraws_only_the_waiting_system_order() {
        let (mut sim, a, b, _) = household();
        let id = sim
            .world_mut()
            .resource_mut::<terri_core::SimIdAllocator>()
            .issue();
        let c = sim
            .world_mut()
            .spawn((
                Agent,
                id,
                Position { x: 5., y: 5. },
                Needs::all_at(90.),
                Relationships::default(),
            ))
            .id();
        let mut pack = sim.world().resource::<crate::Content>().0.clone();
        pack.tuning.fight_chance_per_tick = 1.;
        sim.world_mut()
            .insert_resource(crate::Content(Box::leak(Box::new(pack))));
        let a_id = *sim.world().get::<SimId>(a).unwrap();
        crate::social_conflicts::remember(
            sim.world_mut(),
            a_id,
            id,
            GrievanceKind::PrivacyStart,
            GrievanceSubject::None,
            0.25,
        );
        provoke(sim.world_mut());
        let automatic = sim.world().get::<IntentQueue>(a).unwrap().entries()[0].id;
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::TalkToFirst {
                agent: b.index_u32(),
                target: a.index_u32(),
                interaction: 1,
            });
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::TalkTo {
                agent: c.index_u32(),
                target: b.index_u32(),
                interaction: 1,
            });
        tick_until(
            &mut sim,
            |s| {
                s.world()
                    .get::<Socialising>(b)
                    .is_some_and(|talk| talk.partner == a)
            },
            "the incoming player fight",
        );
        let protected = sim.world().get::<IntentQueue>(c).unwrap().entries()[0].id;
        assert!(
            sim.world()
                .get::<IntentQueue>(a)
                .unwrap()
                .order(automatic)
                .is_some(),
            "the automatic request initially waits"
        );
        tick_until(
            &mut sim,
            |s| s.world().get::<Socialising>(b).is_none(),
            "the completed incoming player fight",
        );
        assert!(sim
            .world()
            .resource::<Fights>()
            .active(a_id, sim.world().resource::<SimClock>().tick));
        assert!(
            sim.world()
                .get::<IntentQueue>(a)
                .unwrap()
                .order(automatic)
                .is_none(),
            "fresh cooldown withdraws that exact automatic order before contact"
        );
        assert!(
            sim.world()
                .get::<IntentQueue>(c)
                .unwrap()
                .order(protected)
                .is_some(),
            "the waiting player's order retains its exact identity"
        );
        assert!(!sim
            .world()
            .resource::<crate::social_conflicts::State>()
            .pending_fights
            .contains_key(&a));
        let saved = sim.save_snapshot_v20();
        let hash = sim.world_hash();
        sim.load_snapshot_v20(saved).unwrap();
        assert_eq!(sim.world_hash(), hash);
        tick_until(
            &mut sim,
            |s| {
                s.world()
                    .get::<Socialising>(c)
                    .is_some_and(|talk| talk.partner == b)
            },
            "the protected player's next fight",
        );
        let context = &sim
            .world()
            .resource::<crate::social_conflicts::State>()
            .fights[&c];
        assert!(!context.autonomous && context.order_id == Some(protected));
    }

    #[test]
    fn issue314_sold_source_is_retained_only_until_player_completion_or_paused_cancel() {
        for cancel in [false, true] {
            let (mut sim, a, b, source) = household();
            assert_eq!(
                crate::placement::sale::validate_sale(sim.world(), source.index_u32()).err(),
                Some(crate::placement::PlacementRefusal::UnsupportedLayout)
            );
            sim.world_mut()
                .resource_mut::<terri_core::TileGrid>()
                .set_blocked(7, 3, true);
            assert_eq!(
                crate::placement::sale::validate_sale(sim.world(), source.index_u32()).err(),
                Some(crate::placement::PlacementRefusal::NotForSale)
            );
            let mut pack = sim.world().resource::<crate::Content>().0.clone();
            pack.objects[0].price = Some(100);
            sim.world_mut()
                .insert_resource(crate::Content(Box::leak(Box::new(pack))));
            assert!(
                crate::placement::sale::validate_sale(sim.world(), source.index_u32()).is_ok(),
                "the source has an accounted footprint and a sale price before the fight"
            );
            let a_id = *sim.world().get::<SimId>(a).unwrap();
            let b_id = *sim.world().get::<SimId>(b).unwrap();
            crate::social_conflicts::remember(
                sim.world_mut(),
                a_id,
                b_id,
                GrievanceKind::Nuisance,
                GrievanceSubject::Nuisance {
                    object: source.index_u32(),
                    kind: NuisanceKind::Other,
                },
                0.25,
            );
            order_fight(&mut sim, a, b);
            tick_until(
                &mut sim,
                |s| s.world().get::<Socialising>(a).is_some(),
                "the sourced player fight",
            );
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::SellObject {
                    object: source.index_u32(),
                });
            sim.flush_commands();
            assert!(
                sim.world().get_entity(source).is_err(),
                "the sale must really remove the source"
            );
            assert!(
                sim.world().get::<Socialising>(a).is_some(),
                "a sale preserves the player's running argument"
            );
            assert_eq!(sim.save_snapshot_v20().conflicts.grievances.len(), 1);
            if cancel {
                let tick = sim.world().resource::<SimClock>().tick;
                sim.world_mut()
                    .resource_mut::<CommandQueue>()
                    .push(SimCommand::CancelIntents {
                        agent: a.index_u32(),
                    });
                sim.flush_commands();
                assert_eq!(
                    sim.world().resource::<SimClock>().tick,
                    tick,
                    "paused cancellation advances no time"
                );
            } else {
                tick_until(
                    &mut sim,
                    |s| s.world().get::<Socialising>(a).is_none(),
                    "actual fight completion",
                );
            }
            let saved = sim.save_snapshot_v20();
            assert!(saved.conflicts.fights.is_empty());
            assert!(
                saved.conflicts.grievances.is_empty(),
                "unpinning removes the retired physical source in the same flush/tick"
            );
            let hash = sim.world_hash();
            sim.load_snapshot_v20(saved).unwrap();
            assert_eq!(sim.world_hash(), hash);
        }
    }

    #[test]
    fn issue314_third_party_duty_owner_death_preserves_a_running_player_fight() {
        let (mut sim, a, b, _) = household();
        let id = sim
            .world_mut()
            .resource_mut::<terri_core::SimIdAllocator>()
            .issue();
        let third = sim
            .world_mut()
            .spawn((
                Agent,
                id,
                terri_core::SimName("Third".into()),
                Position { x: 8., y: 5. },
                Needs::all_at(90.),
            ))
            .id();
        let a_id = *sim.world().get::<SimId>(a).unwrap();
        let b_id = *sim.world().get::<SimId>(b).unwrap();
        crate::social_conflicts::remember(
            sim.world_mut(),
            a_id,
            b_id,
            GrievanceKind::Chore,
            GrievanceSubject::Chore(terri_core::save_v20::ChoreObligation {
                key: terri_core::chores::ChoreKey {
                    kind: ChoreKind::Dishes,
                    target: 0,
                },
                owner: id.0,
                actionable_since: 0,
            }),
            0.25,
        );
        order_fight(&mut sim, a, b);
        tick_until(
            &mut sim,
            |s| s.world().get::<Socialising>(a).is_some(),
            "the historical chore fight",
        );
        let mut pack = sim.world().resource::<crate::Content>().0.clone();
        pack.tuning.death_after_ticks = 1;
        sim.world_mut()
            .insert_resource(crate::Content(Box::leak(Box::new(pack))));
        sim.world_mut()
            .get_mut::<Needs>(third)
            .unwrap()
            .set(NeedId::Hunger, 0.);
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = true;
        crate::mortality::tick(sim.world_mut());
        assert!(sim.world().get_entity(third).is_err());
        assert_eq!(sim.death_records().len(), 1);
        assert!(sim.world().get::<Socialising>(a).is_some());
        let saved = sim.save_snapshot_v20();
        let hash = sim.world_hash();
        assert_eq!(saved.conflicts.grievances.len(), 1);
        sim.load_snapshot_v20(saved).unwrap();
        assert_eq!(sim.world_hash(), hash);
    }

    #[test]
    fn issue314_bare_player_fight_roundtrips_without_invented_sim_ids() {
        let (mut sim, a, b, _) = household();
        sim.world_mut().entity_mut(a).remove::<SimId>();
        sim.world_mut().entity_mut(b).remove::<SimId>();
        order_fight(&mut sim, a, b);
        tick_until(
            &mut sim,
            |s| s.world().get::<Socialising>(a).is_some(),
            "the bare actors' fight",
        );
        let saved = sim.save_snapshot_v20();
        let hash = sim.world_hash();
        assert_eq!(
            saved.conflicts.fights[0].initiator,
            terri_core::save_v17::SavedOrderActor::Entity(a.index_u32())
        );
        assert_eq!(
            saved.conflicts.fights[0].recipient,
            terri_core::save_v17::SavedOrderActor::Entity(b.index_u32())
        );
        sim.load_snapshot_v20(saved.clone()).unwrap();
        assert_eq!(sim.world_hash(), hash);
        let mut invalid = saved;
        invalid.conflicts.fights[0].initiator = terri_core::save_v17::SavedOrderActor::Sim(0);
        assert!(sim.load_snapshot_v20(invalid).is_err());
        assert_eq!(sim.world_hash(), hash);
    }

    #[test]
    fn issue314_published_player_fight_keeps_its_old_topic_and_unhashed_legacy_context() {
        let (mut sim, a, b, _) = household();
        let mut pack = sim.world().resource::<crate::Content>().0.clone();
        pack.tuning.fight_rules = terri_data::FightRules::Published;
        sim.world_mut()
            .insert_resource(crate::Content(Box::leak(Box::new(pack))));
        order_fight(&mut sim, a, b);
        tick_until(
            &mut sim,
            |s| s.world().get::<Socialising>(a).is_some(),
            "the published-policy player fight",
        );
        assert_eq!(
            crate::social_episode::bubble(sim.world(), a.index_u32()),
            (Reason::NONE_CODE, -1.)
        );
        let saved = sim.save_snapshot_v20();
        assert!(saved.conflicts.fights[0].legacy && saved.conflicts.fights[0].grievance.is_none());
        let mut hash = FnvHasher::default();
        crate::social_conflicts::hash(sim.world(), &mut hash);
        assert_eq!(
            hash.finish(),
            FnvHasher::default().finish(),
            "compatibility metadata changes no published-policy computation"
        );
        let before = sim.world_hash();
        sim.load_snapshot_v20(saved).unwrap();
        assert_eq!(sim.world_hash(), before);
    }

    #[test]
    fn issue314_published_overlap_keeps_both_exact_contexts_and_imports_old_records() {
        let (mut sim, first, second, _) = household();
        let mut pack = sim.world().resource::<crate::Content>().0.clone();
        pack.tuning.fight_rules = terri_data::FightRules::Published;
        pack.tuning.fight_chance_per_tick = 1.;
        sim.world_mut()
            .insert_resource(crate::Content(Box::leak(Box::new(pack))));
        crate::chores::ensure(sim.world_mut());
        crate::chores::prune(sim.world_mut());
        let mut chores = sim.world_mut().remove_resource::<SavedChores>().unwrap();
        let assignment = chores
            .assignments
            .iter()
            .find(|row| row.key.kind == ChoreKind::Floors)
            .unwrap()
            .clone();
        let (a, b) = if sim.world().get::<SimId>(first).unwrap().0 == assignment.owner {
            (second, first)
        } else {
            (first, second)
        };
        let key = assignment.key;
        let cells = sim.world().resource::<terri_core::TileGrid>().width()
            * sim.world().resource::<terri_core::TileGrid>().height();
        chores.floors = (0..cells as u32).map(|cell| (cell, 1000)).collect();
        let day_ticks = u64::from(sim.world().resource::<crate::Content>().0.tuning.day_ticks);
        let missed = chores
            .episodes
            .iter_mut()
            .find(|row| row.key == key && row.day == 0)
            .unwrap();
        missed.decision = None;
        missed.outcome = DutyOutcome::Missed;
        missed.settled = true;
        missed.needed = true;
        missed.unavailable = false;
        let declined = chores.next_episode;
        chores.next_episode += 1;
        chores.episodes.push(terri_core::chores::ChoreEpisode {
            id: declined,
            key,
            owner: assignment.owner,
            day: 1,
            decision: Some(false),
            outcome: DutyOutcome::Skipped,
            performer: None,
            completed_at: None,
            settled: false,
            needed: true,
            unavailable: false,
        });
        sim.world_mut().insert_resource(chores);
        crate::neglect::refresh(sim.world_mut());
        sim.world_mut().resource_mut::<SimClock>().tick = day_ticks + 120;
        let b_id = *sim.world().get::<SimId>(b).unwrap();
        sim.world_mut()
            .get_mut::<Relationships>(a)
            .unwrap()
            .bump(b_id, -1.);
        provoke(sim.world_mut());
        let system = sim.world().get::<IntentQueue>(a).unwrap().entries()[0].id;
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::TalkToFirst {
                agent: a.index_u32(),
                target: b.index_u32(),
                interaction: 1,
            });
        tick_until(
            &mut sim,
            |s| s.world().get::<Socialising>(a).is_some(),
            "the published overlapping player fight",
        );
        let chores = sim.world().resource::<SavedChores>();
        assert!(
            chores.tasks.is_empty(),
            "the saved daily decline prevents unrelated floor work"
        );
        assert_eq!(
            chores
                .episodes
                .iter()
                .find(|row| row.id == declined)
                .unwrap()
                .decision,
            Some(false)
        );
        let saved = sim.save_snapshot_v20();
        let original = saved.legacy.clone();
        let hash = sim.world_hash();
        assert_eq!(saved.conflicts.fights.len(), 2);
        assert_eq!(saved.conflicts.fights[0].order_id, Some(system));
        assert!(saved.conflicts.fights[0].autonomous && !saved.conflicts.fights[1].autonomous);
        assert!(saved
            .conflicts
            .fights
            .iter()
            .all(|row| row.legacy && row.grievance.is_none()));
        sim.load_snapshot_v20(saved.clone()).unwrap();
        assert_eq!(sim.world_hash(), hash);
        assert_eq!(
            sim.world()
                .resource::<crate::social_conflicts::State>()
                .pending_fights
                .len(),
            1
        );
        assert_eq!(
            sim.world()
                .resource::<crate::social_conflicts::State>()
                .fights
                .len(),
            1
        );
        for remove in 0..2 {
            let mut missing = saved.clone();
            missing.conflicts.fights.remove(remove);
            assert!(
                sim.load_snapshot_v20(missing).is_err(),
                "neither exact context can stand in for the other"
            );
        }
        sim.load_snapshot_v19(original.clone()).unwrap();
        assert_eq!(
            sim.save_snapshot_v19(),
            original,
            "old adoption preserves every frozen field"
        );
        assert_eq!(sim.save_snapshot_v20().conflicts.fights.len(), 2);
    }
}
