use super::*;
use crate::{Content, Sim};

const DAY: u64 = 1440;

fn memory(knower: u32, other: u32, tag: &str, preference: f32, tick: u64) -> Memory {
    Memory {
        knower: SimId(knower),
        other: SimId(other),
        tag: tag.into(),
        preference,
        tick,
    }
}

fn keys(list: &TopicMemory) -> Vec<(u32, u32, String, u64)> {
    list.entries()
        .iter()
        .map(|m| (m.knower.0, m.other.0, m.tag.clone(), m.tick))
        .collect()
}

/// The shipped fade is 42 game days: whole at the start, half left after
/// 21 days, nothing at 42, and a memory with no strength left is pruned.
#[test]
fn strength_fades_over_forty_two_days() {
    let pack = terri_data::pack();
    assert_eq!(pack.tuning.day_ticks as u64, DAY);
    let fade = fade_ticks(pack);
    assert_eq!(fade, 42 * DAY);
    assert_eq!(strength(100, 100, fade), 1.0);
    assert_eq!(strength(100, 100 + 21 * DAY, fade), 0.5);
    assert_eq!(strength(100, 100 + 42 * DAY, fade), 0.0);
    assert!(strength(100, 100 + 42 * DAY - 1, fade) > 0.0);
    assert_eq!(strength(100, 100 + 43 * DAY, fade), 0.0);
    // A clock read before the memory, which a load refuses, reads as fresh
    // rather than above 1.
    assert_eq!(strength(100, 50, fade), 1.0);
    assert_eq!(strength(0, 0, 0), 0.0);

    let mut list = TopicMemory::default();
    list.remember(memory(1, 2, "reading", 0.5, 0), 10);
    list.remember(memory(1, 3, "reading", 0.5, DAY), 10);
    list.expire(42 * DAY - 1, fade);
    assert_eq!(list.entries().len(), 2);
    list.expire(42 * DAY, fade);
    assert_eq!(keys(&list), vec![(1, 3, "reading".into(), DAY)]);
}

/// A later chat on the same topic with the same person replaces the value
/// and the tick, so the fade starts again; other keys stay apart.
#[test]
fn a_later_chat_refreshes_the_memory() {
    let mut list = TopicMemory::default();
    list.remember(memory(1, 2, "reading", -0.75, 10), 10);
    list.remember(memory(2, 1, "reading", 0.25, 10), 10);
    list.remember(memory(1, 2, "exercise", 0.5, 10), 10);
    list.remember(memory(1, 2, "reading", 0.5, 900), 10);
    assert_eq!(list.entries().len(), 3);
    let refreshed = list.get(SimId(1), SimId(2), "reading").unwrap();
    assert_eq!((refreshed.preference, refreshed.tick), (0.5, 900));
    assert_eq!(
        list.get(SimId(2), SimId(1), "reading").unwrap().preference,
        0.25
    );
    // Rows stay strictly ascending by knower, other and tag.
    assert_eq!(
        keys(&list),
        vec![
            (1, 2, "exercise".into(), 10),
            (1, 2, "reading".into(), 900),
            (2, 1, "reading".into(), 10),
        ]
    );
}

/// A full list drops its oldest memory first, and among the oldest the
/// smallest key, so it never holds more rows than a save can load. A
/// refresh of a held key evicts nothing.
#[test]
fn a_full_list_evicts_the_oldest_then_the_smallest_key() {
    let mut list = TopicMemory::default();
    list.remember(memory(3, 1, "a", 0.0, 5), 3);
    list.remember(memory(2, 1, "a", 0.0, 5), 3);
    list.remember(memory(1, 2, "a", 0.0, 9), 3);
    list.remember(memory(1, 2, "a", 0.5, 9), 3);
    assert_eq!(list.entries().len(), 3);
    list.remember(memory(4, 1, "a", 0.0, 10), 3);
    assert_eq!(
        keys(&list),
        vec![
            (1, 2, "a".into(), 9),
            (3, 1, "a".into(), 5),
            (4, 1, "a".into(), 10),
        ]
    );
    list.remember(memory(5, 1, "a", 0.0, 11), 3);
    assert_eq!(
        keys(&list),
        vec![
            (1, 2, "a".into(), 9),
            (4, 1, "a".into(), 10),
            (5, 1, "a".into(), 11),
        ]
    );
    let mut none = TopicMemory::default();
    none.remember(memory(1, 2, "a", 0.0, 1), 0);
    assert!(none.is_empty());
}

/// Learning uses the save loader's own cap, so a list can never grow past
/// what a load accepts.
#[test]
fn learning_stops_at_the_save_loaders_cap() {
    let mut list = TopicMemory::from_sorted(
        (0..crate::save::MAX_LIST_ENTRIES as u32)
            .map(|at| {
                memory(
                    1 + at / 1000,
                    100_000,
                    &format!("t{:04}", at % 1000),
                    0.0,
                    7,
                )
            })
            .collect(),
    );
    let tuning = terri_data::Tuning {
        topic_memory_remember_floor: 1.0,
        ..terri_data::pack().tuning
    };
    let pack = terri_data::pack();
    let topic = crate::social_episode::Topic::new(pack, 8, "reading".into(), 0.5, 0.25);
    learn(
        &mut list,
        &tuning,
        (SimId(200_000), SimId(1), &topic),
        0.25,
        0.0,
        9,
    );
    assert_eq!(list.entries().len(), crate::save::MAX_LIST_ENTRIES);
    assert!(list.get(SimId(200_000), SimId(1), "reading").is_some());
    assert!(list.get(SimId(1), SimId(100_000), "t0000").is_none());
}

/// A chat on a topic already remembered refreshes the memory even when the
/// roll for a new memory would miss, and the same roll still stops a new
/// memory.
#[test]
fn a_held_memory_is_refreshed_without_the_roll() {
    let tuning = terri_data::Tuning {
        topic_memory_remember_floor: 0.0,
        ..terri_data::pack().tuning
    };
    let pack = terri_data::pack();
    let topic = crate::social_episode::Topic::new(pack, 8, "reading".into(), 0.5, -0.75);
    let miss = (1..1000u64)
        .find(|&tick| !remembers(SimId(1), SimId(2), "reading", tick, 0.0))
        .expect("a roll that misses");
    let mut fresh = TopicMemory::default();
    learn(
        &mut fresh,
        &tuning,
        (SimId(1), SimId(2), &topic),
        -0.75,
        0.0,
        miss,
    );
    assert!(fresh.is_empty(), "the roll misses a new memory");
    let mut held = TopicMemory::default();
    held.remember(memory(1, 2, "reading", 0.5, 0), 10);
    learn(
        &mut held,
        &tuning,
        (SimId(1), SimId(2), &topic),
        -0.75,
        0.0,
        miss,
    );
    let refreshed = held.get(SimId(1), SimId(2), "reading").unwrap();
    assert_eq!((refreshed.preference, refreshed.tick), (-0.75, miss));
}

/// Death removes every memory the dead person held and every memory about
/// them, and leaves the rest.
#[test]
fn forgetting_covers_both_directions() {
    let mut list = TopicMemory::default();
    for (knower, other) in [(1, 2), (2, 1), (2, 3), (3, 1), (3, 2)] {
        list.remember(memory(knower, other, "reading", 0.5, 1), 10);
    }
    list.forget(SimId(2));
    assert_eq!(keys(&list), vec![(3, 1, "reading".into(), 1)]);
}

/// The same death through the simulation's removal of a person.
#[test]
fn a_death_removes_the_dead_persons_memories_and_memories_of_them() {
    let mut sim = Sim::new_from_shipped_lot();
    let mut people: Vec<_> = sim
        .world_mut()
        .query::<(bevy_ecs::entity::Entity, &SimId)>()
        .iter(sim.world())
        .map(|(entity, id)| (*id, entity))
        .collect();
    people.sort();
    assert!(people.len() >= 3);
    let ids: Vec<u32> = people.iter().map(|(id, _)| id.0).collect();
    let mut list = TopicMemory::default();
    for &knower in &ids[..3] {
        for &other in &ids[..3] {
            if knower != other {
                list.remember(memory(knower, other, "reading", 0.5, 0), 100);
            }
        }
    }
    sim.world_mut().insert_resource(list);
    crate::mortality::remove_person(sim.world_mut(), people[1].1);
    let left = sim.world().resource::<TopicMemory>();
    assert_eq!(
        keys(left),
        vec![
            (ids[0], ids[2], "reading".into(), 0),
            (ids[2], ids[0], "reading".into(), 0),
        ]
    );
}

/// The chance rises from the floor at no sociability to certainty at full
/// sociability, and the hashed roll follows it: across many chats the
/// remembered share tracks the chance, and a higher chance remembers every
/// chat a lower one does.
#[test]
fn the_chance_to_remember_rises_with_sociability() {
    let floor = terri_data::pack().tuning.topic_memory_remember_floor;
    assert_eq!(remember_chance(floor, 0.0), floor);
    assert_eq!(remember_chance(floor, 1.0), 1.0);
    assert!((remember_chance(floor, 0.5) - (floor + (1.0 - floor) * 0.5)).abs() < 1e-6);
    let count = |sociability: f32| {
        (0..3000u64)
            .filter(|&tick| {
                remembers(
                    SimId(1),
                    SimId(2),
                    "reading",
                    tick,
                    remember_chance(floor, sociability),
                )
            })
            .count()
    };
    let (low, middle, high) = (count(0.0), count(0.5), count(1.0));
    assert!((850..1150).contains(&low), "about a third: {low}");
    assert!((1850..2150).contains(&middle), "about two thirds: {middle}");
    assert_eq!(high, 3000);
    for tick in 0..3000u64 {
        if remembers(
            SimId(1),
            SimId(2),
            "reading",
            tick,
            remember_chance(floor, 0.0),
        ) {
            assert!(remembers(
                SimId(1),
                SimId(2),
                "reading",
                tick,
                remember_chance(floor, 0.5)
            ));
        }
    }
    // The two directions of one chat roll apart.
    let differ = (0..3000u64)
        .filter(|&tick| {
            remembers(SimId(1), SimId(2), "reading", tick, 0.5)
                != remembers(SimId(2), SimId(1), "reading", tick, 0.5)
        })
        .count();
    assert!(differ > 1000, "{differ}");
}

/// A guess is exact at full sociability, pure noise at none, and the same
/// every time it is made, since it leaves the tick out.
#[test]
fn a_guess_gets_closer_with_sociability_and_stays_the_same() {
    let empty = TopicMemory::default();
    let clock = (5000, 42 * DAY);
    let at = |s: f32, now: u64| {
        belief(
            &empty,
            (SimId(1), SimId(2), "reading"),
            -0.5,
            s,
            (now, clock.1),
        )
        .value
    };
    assert_eq!(at(1.0, 5000), -0.5);
    let noise = guess_noise(SimId(1), SimId(2), "reading");
    assert!((-1.0..1.0).contains(&noise));
    assert_eq!(at(0.0, 5000), noise);
    assert_eq!(at(0.0, 99_999), noise);
    assert!((at(0.5, 5000) - (0.5 * -0.5 + 0.5 * noise)).abs() < 1e-6);
    assert_ne!(noise, guess_noise(SimId(2), SimId(1), "reading"));
    let spread: Vec<f32> = (0..400)
        .map(|other| guess_noise(SimId(1), SimId(other), "reading"))
        .collect();
    assert!(spread.iter().any(|&n| n < -0.5) && spread.iter().any(|&n| n > 0.5));
}

/// A remembered dislike holds a topic back by the avoidance times
/// sociability, strength and dislike, never below the least factor. A
/// guessed dislike, however strong, holds nothing back.
#[test]
fn only_a_remembered_dislike_holds_a_topic_back() {
    let tuning = terri_data::pack().tuning;
    let (avoidance, least) = (
        tuning.topic_memory_avoidance,
        tuning.topic_memory_min_factor,
    );
    let fade = 42 * DAY;
    let mut list = TopicMemory::default();
    list.remember(memory(1, 2, "reading", -1.0, 0), 10);
    let remembered = belief(&list, (SimId(1), SimId(2), "reading"), -1.0, 1.0, (0, fade));
    assert_eq!((remembered.strength, remembered.remembered), (1.0, -1.0));
    // 1 - 0.9 is a hair above 0.1 in binary floats, so compare closely.
    assert!((avoidance_factor(remembered, 1.0, avoidance, least) - least).abs() < 1e-6);
    let half = belief(
        &list,
        (SimId(1), SimId(2), "reading"),
        -1.0,
        1.0,
        (21 * DAY, fade),
    );
    assert!((avoidance_factor(half, 1.0, avoidance, least) - (1.0 - avoidance * 0.5)).abs() < 1e-6);
    // The same dislike only guessed: a full-strength guess of -1.
    let guessed = belief(
        &TopicMemory::default(),
        (SimId(1), SimId(2), "reading"),
        -1.0,
        1.0,
        (0, fade),
    );
    assert_eq!(guessed.value, -1.0);
    assert_eq!(avoidance_factor(guessed, 1.0, avoidance, least), 1.0);
    // A remembered like holds nothing back either.
    let mut liked = TopicMemory::default();
    liked.remember(memory(1, 2, "reading", 1.0, 0), 10);
    let liked = belief(&liked, (SimId(1), SimId(2), "reading"), 1.0, 1.0, (0, fade));
    assert_eq!(avoidance_factor(liked, 1.0, avoidance, least), 1.0);
}

/// An empty list adds nothing to the hash; any memory moves it.
#[test]
fn an_empty_list_hashes_nothing() {
    let mut before = FnvHasher::default();
    before.write_u64(7);
    let mut after = before;
    TopicMemory::default().hash_into(&mut after, b"topic-memory-v1");
    assert_eq!(before.finish(), after.finish());
    let mut list = TopicMemory::default();
    list.remember(memory(1, 2, "reading", 0.5, 3), 10);
    list.hash_into(&mut after, b"topic-memory-v1");
    assert_ne!(before.finish(), after.finish());
}

/// Two worlds from the same seed remember the same things and hash alike,
/// and the household does remember chats.
#[test]
fn the_same_seed_remembers_the_same_things() {
    let run = || {
        let mut sim = Sim::new_from_shipped_lot();
        for _ in 0..3 * DAY {
            sim.tick();
        }
        sim
    };
    let (a, b) = (run(), run());
    let memories = a.world().resource::<TopicMemory>();
    assert!(!memories.is_empty(), "three days of chats leave memories");
    assert_eq!(memories, b.world().resource::<TopicMemory>());
    assert_eq!(a.world_hash(), b.world_hash());
    let pack = a.world().resource::<Content>().0;
    let now = a.world().resource::<terri_core::SimClock>().tick;
    for memory in memories.entries() {
        assert_ne!(memory.knower, memory.other);
        assert!(memory.tick <= now);
        assert!((-1.0..=1.0).contains(&memory.preference));
        assert_ne!(memory.tag, crate::social_episode::SMALLTALK_TAG);
        assert!(strength(memory.tick, now, fade_ticks(pack)) > 0.0);
    }
}
