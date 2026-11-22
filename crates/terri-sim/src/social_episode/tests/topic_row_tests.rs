//! Topic rows against the codes saves already hold ([RT-identity] 1 and 6 in
//! `docs/specs/2026-11-22-richer-topics.md`).

use super::*;
use crate::fights::Reason;
use terri_data::topics::{resolve_topic, TopicKind, RANDOM_FIGHT_BIT};

fn rows() -> &'static [terri_data::topics::CompiledTopic] {
    &terri_data::pack().topics
}

fn row_id(tag: &str) -> &'static str {
    &rows()[usize::from(resolve_topic(rows(), tag).row)].id
}

/// The words a random fight about each activity code has always shown; the
/// generic codes 4 and 7 name no subject.
const RANDOM_FIGHT_WORDS: [(u32, &str); 20] = [
    (3, "eating"),
    (4, ""),
    (5, "sleep"),
    (7, ""),
    (8, "reading"),
    (9, "exercise"),
    (10, "the aquarium"),
    (11, "comfort"),
    (12, "showers"),
    (13, "the toilet"),
    (14, "TV"),
    (15, "lounging"),
    (16, "washing"),
    (17, "cleaning"),
    (18, "music"),
    (19, "letters"),
    (20, "baths"),
    (21, "ingredients"),
    (22, "preparing food"),
    (23, "cooking"),
];

#[test]
fn every_topic_row_code_matches_its_saved_code() {
    for row in rows() {
        match row.kind {
            TopicKind::Smalltalk | TopicKind::Activity => {
                for tag in &row.tags {
                    // Small talk is the one tag the legacy list does not know:
                    // it saves as code 4 by rule, not by `tag_code`.
                    let saved = if tag == "smalltalk" { 4 } else { tag_code(tag) };
                    assert_eq!(row.code, saved, "{} tag {tag}", row.id);
                }
            }
            TopicKind::Fight => {
                let reason = Reason::from_tag_current(&row.reason)
                    .unwrap_or_else(|| panic!("{} names no fight reason", row.id));
                assert_eq!(row.code, Reason::code(reason), "{}", row.id);
            }
            TopicKind::Subject => assert_eq!(row.code, 0, "{}", row.id),
        }
    }
}

#[test]
fn every_legacy_tag_and_fight_reason_has_a_row() {
    for (tag, code) in TOPIC_CODES {
        let row = &rows()[usize::from(resolve_topic(rows(), tag).row)];
        assert_eq!(row.code, code, "{tag}");
        assert_ne!(row.id, "other", "{tag} fell through to the generic row");
    }
    for reason in Reason::all() {
        if matches!(reason, Some(Reason::Random(_))) {
            continue; // Random fights draw an activity row, tested below.
        }
        let tag = Reason::tag(reason);
        let row = &rows()[usize::from(resolve_topic(rows(), tag).row)];
        assert_eq!(row.kind, TopicKind::Fight, "{tag}");
        assert_eq!(row.code, Reason::code(reason), "{tag}");
    }
}

#[test]
fn random_fight_topics_resolve_to_their_activity_row() {
    let mut seen = 0;
    for reason in Reason::all() {
        let Some(Reason::Random(code)) = reason else {
            continue;
        };
        let tag = Reason::tag(reason);
        let found = resolve_topic(rows(), tag);
        let row = &rows()[usize::from(found.row)];
        assert!(found.random_fight, "{tag}");
        assert!(
            matches!(row.kind, TopicKind::Smalltalk | TopicKind::Activity),
            "{tag} resolved to a {:?} row",
            row.kind
        );
        assert_eq!(row.code, u32::from(code), "{tag}");
        assert_eq!(
            found.render_value(),
            (u32::from(found.row) + 1) | RANDOM_FIGHT_BIT,
            "{tag}"
        );
        let words = RANDOM_FIGHT_WORDS
            .iter()
            .find(|(known, _)| *known == u32::from(code))
            .unwrap_or_else(|| panic!("no recorded word for code {code}"));
        assert_eq!(row.label, words.1, "{tag}");
        seen += 1;
    }
    assert_eq!(seen, RANDOM_FIGHT_WORDS.len());
}

#[test]
fn a_chat_about_a_tag_and_a_random_fight_about_its_code_share_a_row() {
    assert_eq!(row_id("fight-random-9"), row_id("exercise"));
    assert_eq!(row_id("fight-random-14"), row_id("tv"));
    assert_eq!(row_id("fight-random-4"), row_id("smalltalk"));
}

#[test]
fn a_topic_made_for_a_tag_carries_its_resolved_row() {
    let pack = terri_data::pack();
    let chat = Topic::new(pack, 3, "food".into(), 0.5, 0.25);
    assert_eq!(rows()[usize::from(chat.row)].id, "eating");
    assert_eq!(chat.render_value(), u32::from(chat.row) + 1);
    let fight = Topic::new(pack, 42, "fight-random-12".into(), -1., -1.);
    assert_eq!(rows()[usize::from(fight.row)].id, "showers");
    assert_eq!(fight.render_value() & RANDOM_FIGHT_BIT, RANDOM_FIGHT_BIT);
    assert_eq!(
        fight.render_value() & !RANDOM_FIGHT_BIT,
        u32::from(fight.row) + 1
    );
}
