//! Remembered topic preferences in the topic draw and at completion: issue
//! 359.
use super::*;
use crate::topic_memory::{Memory, TopicMemory};

/// The chat fixture with A as sociable as anyone can be, a reader, and B
/// someone whose true feeling about reading is `listener`.
fn reading_chat(listener: f32) -> (Sim, Entity, Entity) {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.objects[0].interactions[0].tags = vec!["reading".into()];
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    let mut satisfaction = [1.; 7];
    satisfaction[NeedId::Social.index()] = 3.;
    sim.world_mut().entity_mut(a).insert((
        Hobbies(vec!["reading".into()]),
        Personality::with_dispositions([1.; 7], satisfaction, vec![]),
    ));
    sim.world_mut()
        .entity_mut(b)
        .insert(Personality::with_dispositions(
            [1.; 7],
            [1.; 7],
            vec![(pack.find("fridge").unwrap(), 0, (listener + 1.) / 2.)],
        ));
    (sim, a, b)
}

fn ids(sim: &Sim, a: Entity, b: Entity) -> (SimId, SimId) {
    (
        *sim.world().get::<SimId>(a).unwrap(),
        *sim.world().get::<SimId>(b).unwrap(),
    )
}

fn remember(sim: &mut Sim, (knower, other): (SimId, SimId), preference: f32) {
    let tick = sim.world().resource::<terri_core::SimClock>().tick;
    sim.world_mut().resource_mut::<TopicMemory>().remember(
        Memory {
            knower,
            other,
            tag: "reading".into(),
            preference,
            tick,
        },
        100,
    );
}

/// A remembered dislike pulls a topic's weight down to the least factor at
/// full strength and sociability. The same dislike only guessed leaves the
/// weight where it was with no interest at all: a guess never pushes.
#[test]
fn a_remembered_dislike_lowers_the_weight_and_a_guessed_one_does_not() {
    let (mut sim, a, b) = reading_chat(-1.);
    let pack = sim.world().resource::<Content>().0;
    let sociable = |sim: &Sim| {
        sociability(
            pack,
            &crate::subjects::preferences_of(sim.world(), pack, a),
            sim.world().get::<Personality>(a),
            sim.world().get::<terri_core::Skills>(a),
        )
    };
    assert_eq!(sociable(&sim), 1.);
    let guessed = Steering::new(sim.world(), pack, (a, b), 1.).weight("reading", 0.5, -1.);
    assert_eq!(guessed, topic_weight(0.5, -1., 1.));
    assert_eq!(guessed, 0.5, "a guessed dislike holds nothing back");
    let pair = ids(&sim, a, b);
    remember(&mut sim, pair, -1.);
    let remembered = Steering::new(sim.world(), pack, (a, b), 1.).weight("reading", 0.5, -1.);
    assert!(
        (remembered - 0.5 * pack.tuning.topic_memory_min_factor).abs() < 1e-6,
        "{remembered}"
    );
    // A remembered like pulls as hard as the true one would.
    remember(&mut sim, pair, 1.);
    let liked = Steering::new(sim.world(), pack, (a, b), 1.).weight("reading", 0.5, -1.);
    assert_eq!(liked, topic_weight(0.5, 1., 1.));
}

/// What A remembers changes only the weight. B's true dislike still sets
/// the chat's listener preference, the bubble and the completion penalty,
/// even when A wrongly remembers B loving the topic.
#[test]
fn the_listeners_true_preference_still_decides_the_outcome() {
    let (mut sim, a, b) = reading_chat(-1.);
    let pair = ids(&sim, a, b);
    remember(&mut sim, pair, 1.);
    start(&mut sim, a, b, 3);
    begin_topics(sim.world_mut());
    let topic = &sim.world().resource::<SocialEpisodes>().topics[&a];
    assert_eq!(
        (
            topic.tag.as_str(),
            topic.initiator_preference,
            topic.listener_preference
        ),
        ("reading", 0.5, -1.)
    );
    let before = sim.world().get::<Relationships>(b).unwrap().feeling(pair.0);
    for _ in 0..3 {
        sim.world_mut()
            .run_system_once(crate::systems::social::tick_social)
            .unwrap();
    }
    let after = sim.world().get::<Relationships>(b).unwrap().feeling(pair.0);
    assert!((after - before + 0.02).abs() < 0.000001, "{before} {after}");
}

/// A completed chat teaches each side the other's true preference: A, as
/// sociable as anyone, always remembers, and the wrong memory is replaced.
#[test]
fn a_completed_chat_teaches_the_true_preference() {
    let (mut sim, a, b) = reading_chat(-1.);
    let pair = ids(&sim, a, b);
    remember(&mut sim, pair, 1.);
    sim.world_mut().resource_mut::<terri_core::SimClock>().tick = 77;
    start(&mut sim, a, b, 1);
    begin_topics(sim.world_mut());
    sim.world_mut()
        .run_system_once(crate::systems::social::tick_social)
        .unwrap();
    let memory = sim.world().resource::<TopicMemory>();
    let learned = memory.get(pair.0, pair.1, "reading").unwrap();
    assert_eq!((learned.preference, learned.tick), (-1., 77));
    if let Some(back) = memory.get(pair.1, pair.0, "reading") {
        assert_eq!((back.preference, back.tick), (0.5, 77));
    }
}

/// Smalltalk, the fallback with no topic, teaches nothing.
#[test]
fn smalltalk_teaches_nothing() {
    let (mut sim, a, b) = chat_fixture();
    let mut satisfaction = [1.; 7];
    satisfaction[NeedId::Social.index()] = 3.;
    for person in [a, b] {
        sim.world_mut()
            .entity_mut(person)
            .insert(Personality::with_dispositions(
                [1.; 7],
                satisfaction,
                vec![],
            ));
    }
    start(&mut sim, a, b, 1);
    begin_topics(sim.world_mut());
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().topics[&a].tag,
        SMALLTALK_TAG
    );
    sim.world_mut()
        .run_system_once(crate::systems::social::tick_social)
        .unwrap();
    assert!(sim.world().resource::<TopicMemory>().is_empty());
}
