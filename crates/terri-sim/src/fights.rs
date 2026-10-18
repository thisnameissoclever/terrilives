//! Fights - issue 248. A fight is a conversation that fills nobody: both
//! bubbles go red, both participants think less of each other when it
//! ends, and both carry a Had a fight moodlet for a while. A player can
//! order one; a person starts one alone only against someone they can
//! barely stand, and only over a chore that person missed and left undone.
use bevy_ecs::prelude::*;
use terri_core::{
    chores::{ChoreKind, DutyOutcome, SavedChores},
    Agent, FnvHasher, Intent, IntentQueue, Needs, Relationships, Reserved, SimClock, SimId, SimRng,
    Socialising,
};
use terri_data::{CompiledInteraction, ContentPack};

use crate::moodlet_timers::MoodletTimers;

/// The activity tag that marks a social interaction as a fight.
pub const FIGHT_TAG: &str = "fighting";

/// Who had a fight and the tick their Had a fight moodlet ends. Saved in
/// schema twelve; in the world hash whenever it holds anything.
///
/// `provoked` watches a trigger's front order until execution or redirection,
/// so withdrawal removes that entry without touching a player's identical order.
/// `system_orders` retains its provenance through execution and queue changes;
/// schema fifteen saves those exact identities separately from player orders.
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
}

impl Reason {
    /// The topic code the browser maps to artwork: 24 and 25 for the two
    /// reasons, 26 for a fight the player started with no reason.
    pub const NONE_CODE: u32 = 26;
    pub fn code(reason: Option<Self>) -> u32 {
        match reason {
            Some(Self::Dishes) => 24,
            Some(Self::OtherChore) => 25,
            None => Self::NONE_CODE,
        }
    }
    pub fn tag(reason: Option<Self>) -> &'static str {
        match reason {
            Some(Self::Dishes) => "fight-dishes",
            Some(Self::OtherChore) => "fight-chore",
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
}

/// A chore `owner` was assigned, did not do, and whose mess is still there:
/// a settled Missed episode on the board whose key still needs work. The
/// latest such episode wins, and the dishes name themselves.
pub(crate) fn reason_against(world: &World, owner: SimId) -> Option<Reason> {
    let state = world.get_resource::<SavedChores>()?;
    state
        .episodes
        .iter()
        .rev()
        .filter(|e| e.owner == owner.0 && e.settled && e.outcome == DutyOutcome::Missed)
        .find(|e| crate::chores::work_needed(world, state, e.key, e.owner))
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
fn approachable(world: &mut World, person: Entity) -> bool {
    world.get::<terri_core::AtWork>(person).is_none()
        && world.get::<terri_core::Commuting>(person).is_none()
        && world.get::<Socialising>(person).is_none()
        && !world
            .query::<&Socialising>()
            .iter(world)
            .any(|talk| talk.partner == person)
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

/// Starts fights nobody ordered. Each tick, in id order, every idle person
/// without a running Had a fight moodlet looks at every other living
/// person, in id order: a feeling at or below the tuned threshold and a
/// reason against them earn one seeded draw, and a draw under the tuned
/// chance pushes a Fight order to the front of the initiator's queue,
/// which is then served exactly as a player's order is. The first draw
/// that passes ends the initiator's search this tick. Orders this made
/// earlier are withdrawn first when they can no longer be served.
pub(crate) fn provoke(world: &mut World) {
    let pack = world.resource::<crate::Content>().0;
    let Some(fight) = fight_index(pack) else {
        return;
    };
    retract(world);
    let threshold = pack.tuning.fight_affinity_threshold;
    let chance = pack.tuning.fight_chance_per_tick;
    let now = world.resource::<SimClock>().tick;
    let Some(mut query) = world.try_query_filtered::<(Entity, &SimId), With<Agent>>() else {
        return;
    };
    let mut people: Vec<(SimId, Entity)> = query
        .iter(world)
        .filter(|(e, _)| world.get::<Needs>(*e).is_some())
        .map(|(e, id)| (*id, e))
        .collect();
    people.sort_by_key(|(id, _)| *id);
    for &(id, person) in &people {
        if !idle(world, person) || world.resource::<Fights>().active(id, now) {
            continue;
        }
        let Some(feelings) = world.get::<Relationships>(person) else {
            continue;
        };
        let grudges: Vec<(SimId, Entity)> = people
            .iter()
            .filter(|(other_id, other)| {
                *other != person && feelings.feeling(*other_id) <= threshold
            })
            .copied()
            .collect();
        for (other_id, other) in grudges {
            if !approachable(world, other) || reason_against(world, other_id).is_none() {
                continue;
            }
            if world.resource_mut::<SimRng>().next_f32() >= chance {
                continue;
            }
            let intent = Intent {
                cleanup: None,
                chore: None,
                object: other,
                interaction: fight,
            };
            let mut entity = world.entity_mut(person);
            let id = match entity.get_mut::<IntentQueue>() {
                Some(mut queue) => queue.insert_order(intent, None, true),
                None => {
                    let mut queue = IntentQueue::default();
                    let id = queue.insert_order(intent, None, true);
                    entity.insert(queue);
                    id
                }
            };
            if let Some(id) = id {
                world.resource_mut::<Fights>().restore_order(person, id);
            }
            break;
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
        crate::chores::add(&mut state.surfaces, 7, 1000);
        state.episodes.push(terri_core::chores::ChoreEpisode {
            id: 1,
            key: terri_core::chores::ChoreKey {
                kind: ChoreKind::Surfaces,
                target: 7,
            },
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
    }

    fn queued_fight(sim: &Sim, person: Entity, target: Entity) -> bool {
        sim.world()
            .get::<IntentQueue>(person)
            .and_then(|q| q.front())
            .is_some_and(|i| i.object == target && i.interaction == 1)
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
        assert!(!queued_fight(&sim, a, b));
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
        panic!("{what} never happened in 600 ticks");
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
        assert_eq!(
            crate::social_episode::bubble(sim.world(), a.index_u32()),
            (Reason::NONE_CODE, -1.0)
        );
        assert_eq!(
            crate::social_episode::bubble(sim.world(), b.index_u32()),
            (Reason::NONE_CODE, -1.0)
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
        assert_eq!(
            reason_against(sim.world(), SimId(b_id)),
            Some(Reason::OtherChore)
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
}
