//! Subjects in the topic draw ([RT-subjects] "In conversations" in
//! `docs/specs/2026-11-22-richer-topics.md`).
//!
//! Each test sets its own subject rows on a copy of the shipped pack, so the
//! authored weights can be tuned without moving them.

use super::*;
use crate::subjects::tests::{rule, subject_row};
use terri_core::Career;
use terri_data::topics::{CompiledTopic, SubjectSourceKind, TopicKind};

/// A world on the shipped pack whose only subjects are `rows`, with two
/// people ready to talk: `a` begins, `b` listens.
fn world_with_subjects(rows: Vec<CompiledTopic>) -> (Sim, Entity, Entity) {
    let mut sim = Sim::new_with_lot(12, 8);
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.topics
        .retain(|row| row.kind != TopicKind::Subject || row.id == "unknown-subject");
    pack.topics.extend(rows);
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    let mut create = |x| {
        let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
        sim.world_mut()
            .spawn((
                Agent,
                id,
                terri_core::Position { x, y: 1. },
                Needs::all_at(90.),
                Relationships::default(),
            ))
            .id()
    };
    let a = create(1.);
    let b = create(7.);
    assert!(!crate::fights::is_fight(
        &sim.world().resource::<Content>().0.social[0]
    ));
    start(&mut sim, a, b, 30);
    (sim, a, b)
}

fn begin(sim: &mut Sim) {
    sim.world_mut()
        .resource_mut::<SocialEpisodes>()
        .topics
        .clear();
    begin_topics(sim.world_mut());
}

fn topic_of(sim: &Sim, initiator: Entity) -> Topic {
    sim.world().resource::<SocialEpisodes>().topics[&initiator].clone()
}

#[test]
fn a_chat_with_only_a_subject_to_offer_is_about_the_subject() {
    let (mut sim, a, b) = world_with_subjects(vec![subject_row(
        "tester",
        rule(0.5, 0.0, &[(SubjectSourceKind::Tag, "reading", 0.4)]),
    )]);
    sim.world_mut()
        .entity_mut(b)
        .insert(Hobbies(vec!["reading".into()]));
    begin(&mut sim);
    let topic = topic_of(&sim, a);
    assert_eq!(topic.tag, "subject:tester");
    assert_eq!(topic.code, 7, "a subject saves as the generic code");
    assert_eq!(topic.initiator_preference, 0.5);
    assert!((topic.listener_preference - 0.7).abs() < 1e-6);
    let rows = &sim.world().resource::<Content>().0.topics;
    assert_eq!(rows[usize::from(topic.row)].id, "tester");
    assert_eq!(topic.render_value(), u32::from(topic.row) + 1);
}

#[test]
fn a_listener_can_dislike_a_subject_the_initiator_likes() {
    let pack = terri_data::pack();
    // An action with a tag, and a listener whose disposition for it is zero,
    // which reads as a preference of -1 for the tag.
    let (object, action, tag) = pack
        .objects
        .iter()
        .enumerate()
        .find_map(|(object, definition)| {
            definition
                .interactions
                .iter()
                .enumerate()
                .find_map(|(action, interaction)| {
                    interaction
                        .tags
                        .first()
                        .map(|tag| (object, action as u32, tag.clone()))
                })
        })
        .expect("the shipped pack has a tagged action");
    let (mut sim, a, b) = world_with_subjects(vec![subject_row(
        "tester",
        rule(0.5, 0.0, &[(SubjectSourceKind::Tag, &tag, 0.8)]),
    )]);
    sim.world_mut()
        .entity_mut(b)
        .insert(Personality::with_dispositions(
            [1.; 7],
            [1.; 7],
            vec![(terri_core::ObjectDefId(object as u32), action, 0.)],
        ));
    begin(&mut sim);
    let topic = topic_of(&sim, a);
    assert_eq!(topic.tag, "subject:tester");
    assert_eq!(topic.initiator_preference, 0.5);
    assert!((topic.listener_preference - -0.3).abs() < 1e-6, "{topic:?}");
}

#[test]
fn work_is_offered_only_by_employed_people() {
    let mut work = rule(0.5, 0.0, &[(SubjectSourceKind::Job, "", 0.0)]);
    work.requires_job = true;
    let (mut sim, a, b) = world_with_subjects(vec![subject_row("work", work)]);
    begin(&mut sim);
    assert_eq!(
        (topic_of(&sim, a).tag.as_str(), topic_of(&sim, a).code),
        ("smalltalk", 4),
        "an unemployed initiator has nothing to offer"
    );
    // The listener's job never matters for the offer.
    sim.world_mut().entity_mut(b).insert(Career(0));
    begin(&mut sim);
    assert_eq!(topic_of(&sim, a).tag, "smalltalk");
    sim.world_mut().entity_mut(a).insert(Career(0));
    begin(&mut sim);
    assert_eq!(topic_of(&sim, a).tag, "subject:work");
    // An employed initiator with an unemployed listener still talks about
    // work, and the listener's interest comes from the other terms.
    sim.world_mut().entity_mut(b).remove::<Career>();
    begin(&mut sim);
    let topic = topic_of(&sim, a);
    assert_eq!(topic.tag, "subject:work");
    assert_eq!(topic.listener_preference, 0.5);
}

#[test]
fn topic_draw_spends_one_value_and_includes_subjects() {
    let (mut sim, a, _) = world_with_subjects(vec![
        subject_row("tester", rule(0.5, 0.0, &[])),
        subject_row("other", rule(0.25, 0.0, &[])),
    ]);
    sim.world_mut()
        .entity_mut(a)
        .insert(Hobbies(vec!["reading".into()]));
    let mut chosen = std::collections::BTreeMap::new();
    for seed in 0..300 {
        sim.world_mut().insert_resource(SimRng::from_seed(seed));
        let mut expected = SimRng::from_seed(seed);
        expected.next_f32();
        begin(&mut sim);
        assert_eq!(
            *sim.world().resource::<SimRng>(),
            expected,
            "seed {seed}: exactly one draw"
        );
        *chosen.entry(topic_of(&sim, a).tag).or_insert(0) += 1;
    }
    let count = |tag: &str| chosen.get(tag).copied().unwrap_or(0);
    // Reading is worth 0.5 and the subjects 0.5 and 0.25, so each is chosen
    // in proportion to those weights, give or take the seeds' spread.
    assert!(count("reading") > 60, "{chosen:?}");
    assert!(count("subject:tester") > 60, "{chosen:?}");
    assert!(count("subject:other") > 30, "{chosen:?}");
    assert!(
        count("subject:tester") > count("subject:other"),
        "{chosen:?}"
    );
}

#[test]
fn a_chat_with_nothing_to_offer_is_still_small_talk_with_no_draw() {
    let (mut sim, a, _) = world_with_subjects(vec![subject_row("tester", rule(-0.5, 0.0, &[]))]);
    let before = sim.world().resource::<SimRng>().clone();
    begin(&mut sim);
    let topic = topic_of(&sim, a);
    assert_eq!((topic.code, topic.tag.as_str()), (4, "smalltalk"));
    assert_eq!(*sim.world().resource::<SimRng>(), before);
}

#[test]
fn subjects_do_not_change_compatibility() {
    let (sim, a, b) = world_with_subjects(vec![
        subject_row(
            "tester",
            rule(0.5, 0.9, &[(SubjectSourceKind::Tag, "reading", 0.4)]),
        ),
        subject_row("other", rule(0.25, 0.1, &[])),
    ]);
    let pack = sim.world().resource::<Content>().0;
    let bare = {
        let mut bare = pack.clone();
        bare.topics.retain(|row| row.kind != TopicKind::Subject);
        bare
    };
    for (who, other) in [(a, b), (b, a)] {
        let read = |pack: &terri_data::ContentPack| {
            let mine = crate::subjects::preferences_of(sim.world(), pack, who);
            let theirs = crate::subjects::preferences_of(sim.world(), pack, other);
            (crate::compatibility::between(&mine, &theirs), mine, theirs)
        };
        let with = read(pack);
        let without = read(&bare);
        assert_eq!(with, without);
        assert!(with.1.keys().all(|tag| !tag.starts_with("subject:")));
    }
}
