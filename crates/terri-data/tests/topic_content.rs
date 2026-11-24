//! The topic compiler's refusals, and the shipped topic rows ([RT-content]).

use terri_data::topics::{compile_topics, CompiledTopic, TopicKind, TopicsFile};
use terri_data::ContentError;

/// The three rows every table needs, so each refusal test names only the
/// row it breaks.
const BASE: &str = r#"
[[topic]]
id = "smalltalk"
kind = "smalltalk"
icon = "Talk"
code = 4
tags = ["smalltalk", "socialising"]

[[topic]]
id = "other"
kind = "activity"
icon = "Use"
label = "something"
code = 7

[[topic]]
id = "unknown-subject"
kind = "subject"
icon = "Talk"
label = "something"
bias = 0.0
variation = 0.0
sources = []
"#;

fn compile(extra: &str) -> Result<Vec<CompiledTopic>, ContentError> {
    let pack = terri_data::pack();
    let source: TopicsFile = toml::from_str(&format!("{BASE}{extra}")).expect("test TOML parses");
    compile_topics(source, &pack.skills, &pack.affinities)
}

fn refusal(extra: &str) -> String {
    match compile(extra) {
        Err(ContentError::InvalidTopicContent { reason, .. }) => reason,
        other => panic!("expected a topic refusal, got {other:?}"),
    }
}

#[test]
fn the_base_rows_compile() {
    let rows = compile("").unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].kind, TopicKind::Smalltalk);
    assert_eq!(rows[2].kind, TopicKind::Subject);
}

#[test]
fn a_duplicate_id_is_refused() {
    let reason = refusal(
        r#"
[[topic]]
id = "other"
kind = "activity"
icon = "Use"
code = 7
"#,
    );
    assert!(reason.contains("unique"), "{reason}");
}

#[test]
fn a_tag_in_two_rows_is_refused() {
    let reason = refusal(
        r#"
[[topic]]
id = "chatting"
kind = "activity"
icon = "Talk"
code = 4
tags = ["socialising"]
"#,
    );
    assert!(reason.contains("socialising"), "{reason}");
}

#[test]
fn a_fight_reason_that_is_also_a_tag_is_refused() {
    let reason = refusal(
        r#"
[[topic]]
id = "row"
kind = "fight"
icon = "Talk"
code = 26
reason = "smalltalk"
"#,
    );
    assert!(reason.contains("smalltalk"), "{reason}");
}

#[test]
fn an_unknown_kind_is_refused() {
    let reason = refusal(
        r#"
[[topic]]
id = "odd"
kind = "gossip"
icon = "Talk"
"#,
    );
    assert!(reason.contains("kind"), "{reason}");
}

#[test]
fn a_missing_field_for_the_kind_is_refused() {
    for (kind, body, missing) in [
        ("activity", "", "code"),
        ("fight", "code = 26", "reason"),
        ("fight", "reason = \"x\"", "code"),
        ("subject", "variation = 0.1\nsources = []", "bias"),
        ("subject", "bias = 0.0\nsources = []", "variation"),
        ("subject", "bias = 0.0\nvariation = 0.1", "sources"),
    ] {
        let reason = refusal(&format!(
            "[[topic]]\nid = \"row\"\nkind = \"{kind}\"\nicon = \"Talk\"\nlabel = \"x\"\n{body}\n"
        ));
        assert!(
            reason.contains(missing),
            "{kind} without {missing}: {reason}"
        );
    }
}

#[test]
fn an_extra_field_for_the_kind_is_refused() {
    for (kind, body, extra) in [
        ("activity", "code = 9\nreason = \"x\"", "reason"),
        ("activity", "code = 9\nbias = 0.1", "bias"),
        ("fight", "code = 26\nreason = \"x\"\ntags = [\"y\"]", "tags"),
        (
            "subject",
            "bias = 0.0\nvariation = 0.0\nsources = []\ncode = 7",
            "code",
        ),
        (
            "subject",
            "bias = 0.0\nvariation = 0.0\nsources = []\ntags = [\"y\"]",
            "tags",
        ),
        (
            "subject",
            "bias = 0.0\nvariation = 0.0\nsources = []\nreason = \"y\"",
            "reason",
        ),
    ] {
        let reason = refusal(&format!(
            "[[topic]]\nid = \"row\"\nkind = \"{kind}\"\nicon = \"Talk\"\nlabel = \"x\"\n{body}\n"
        ));
        assert!(reason.contains(extra), "{kind} with {extra}: {reason}");
    }
}

fn subject(body: &str) -> String {
    format!("[[topic]]\nid = \"trains\"\nkind = \"subject\"\nicon = \"Talk\"\nlabel = \"trains\"\n{body}\n")
}

#[test]
fn a_subject_with_good_sources_compiles() {
    let rows = compile(&subject(
        "bias = 0.1\nvariation = 0.5\nrequires = \"job\"\nsources = [\
         { kind = \"tag\", key = \"exercise\", weight = 0.5 }, \
         { kind = \"skill\", key = \"exercise\", weight = 0.3 }, \
         { kind = \"job\", weight = -0.8 }]",
    ))
    .unwrap();
    let trains = rows.iter().find(|row| row.id == "trains").unwrap();
    let compiled = trains.subject.as_ref().unwrap();
    assert!(compiled.requires_job);
    assert_eq!(compiled.sources.len(), 3);
}

#[test]
fn a_weight_outside_minus_one_to_one_is_refused() {
    for weight in ["1.5", "-1.01"] {
        let reason = refusal(&subject(&format!(
            "bias = 0.0\nvariation = 0.1\nsources = [{{ kind = \"job\", weight = {weight} }}]"
        )));
        assert!(reason.contains("weight"), "{reason}");
    }
}

#[test]
fn a_negative_variation_is_refused() {
    let reason = refusal(&subject("bias = 0.0\nvariation = -0.1\nsources = []"));
    assert!(reason.contains("variation"), "{reason}");
}

#[test]
fn an_unknown_skill_affinity_or_requires_is_refused() {
    for (body, word) in [
        (
            "sources = [{ kind = \"skill\", key = \"no_such\", weight = 0.1 }]",
            "skill",
        ),
        (
            "sources = [{ kind = \"affinity\", key = \"no_such\", weight = 0.1 }]",
            "affinity",
        ),
        ("requires = \"pet\"\nsources = []", "requires"),
        (
            "sources = [{ kind = \"mood\", key = \"x\", weight = 0.1 }]",
            "kind",
        ),
    ] {
        let reason = refusal(&subject(&format!("bias = 0.0\nvariation = 0.1\n{body}")));
        assert!(reason.contains(word), "{body}: {reason}");
    }
}

#[test]
fn the_fixed_rows_are_required() {
    for (without, name) in [
        ("smalltalk", "smalltalk"),
        ("other", "other"),
        ("unknown-subject", "unknown-subject"),
    ] {
        let source = BASE
            .split("[[topic]]")
            .filter(|row| !row.contains(&format!("id = \"{without}\"")))
            .collect::<Vec<_>>()
            .join("[[topic]]");
        let pack = terri_data::pack();
        let parsed: TopicsFile = toml::from_str(&source).unwrap();
        match compile_topics(parsed, &pack.skills, &pack.affinities) {
            Err(ContentError::InvalidTopicContent { reason, .. }) => {
                assert!(reason.contains(name), "{reason}")
            }
            other => panic!("expected a refusal without {name}, got {other:?}"),
        }
    }
}

#[test]
fn an_activity_code_outside_the_saved_range_is_refused() {
    for code in [2, 6, 24] {
        let reason = refusal(&format!(
            "[[topic]]\nid = \"row\"\nkind = \"activity\"\nicon = \"Talk\"\ncode = {code}\n"
        ));
        assert!(reason.contains("code"), "{code}: {reason}");
    }
}

#[test]
fn the_shipped_rows_are_present() {
    let rows = &terri_data::pack().topics;
    for fixed in ["smalltalk", "other", "unknown-subject"] {
        assert!(rows.iter().any(|row| row.id == fixed), "{fixed}");
    }
    assert!(
        rows.iter()
            .filter(|row| row.kind == TopicKind::Fight)
            .count()
            >= 9
    );
}

fn word_of(tag: &str) -> (u32, &'static str) {
    let rows = &terri_data::pack().topics;
    let found = terri_data::topics::resolve_topic(rows, tag);
    (
        found.render_value(),
        rows[usize::from(found.row)].label.as_str(),
    )
}

#[test]
fn saved_tags_resolve_to_their_rows() {
    let rows = &terri_data::pack().topics;
    let id_of = |tag: &str| {
        rows[usize::from(terri_data::topics::resolve_topic(rows, tag).row)]
            .id
            .as_str()
    };
    assert_eq!(id_of("food"), "eating");
    assert_eq!(id_of("socialising"), "smalltalk");
    assert_eq!(id_of("smalltalk"), "smalltalk");
    assert_eq!(id_of("bathroom_privacy"), "bathroom-privacy");
    assert_eq!(id_of("fight-privacy"), "fight-privacy");
    assert_eq!(id_of("fight"), "fight");
    assert_eq!(id_of("never-heard-of-it"), "other");
    assert_eq!(id_of("subject:trains"), "trains");
    assert_eq!(id_of("subject:the-weather"), "unknown-subject");
    assert_eq!(id_of("subject:unknown-subject"), "unknown-subject");
    // A subject tag never reaches an activity row, so `food` is not a subject.
    assert_eq!(id_of("subject:food"), "unknown-subject");
    assert_eq!(id_of("fight-random-xyz"), "other");
}

#[test]
fn a_random_fight_draws_its_activity_row_with_the_fight_bit() {
    let rows = &terri_data::pack().topics;
    let plain = terri_data::topics::resolve_topic(rows, "cooking");
    let random = terri_data::topics::resolve_topic(rows, "fight-random-23");
    assert_eq!(random.row, plain.row);
    assert!(random.random_fight && !plain.random_fight);
    assert_eq!(
        random.render_value(),
        plain.render_value() | terri_data::topics::RANDOM_FIGHT_BIT
    );
    let (_, word) = word_of("fight-random-7");
    assert_eq!(
        word, "",
        "a random fight about the generic code names no subject"
    );
}

#[test]
fn a_label_or_icon_with_a_tab_or_line_break_is_refused() {
    for (field, value) in [("label", "a\\tb"), ("label", "a\\nb"), ("icon", "Ta\\tlk")] {
        let (label, icon) = if field == "label" {
            (value, "Talk")
        } else {
            ("x", value)
        };
        let reason = refusal(&format!(
            "[[topic]]\nid = \"row\"\nkind = \"activity\"\nlabel = \"{label}\"\nicon = \"{icon}\"\ncode = 9\n"
        ));
        assert!(reason.contains("tab"), "{field}: {reason}");
    }
}
