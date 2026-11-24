//! Conversation topics compiled from `content/topics.toml` ([RT-content] in
//! `docs/specs/2026-11-22-richer-topics.md`).
//!
//! A topic's row is its place in the file. Saves keep the activity `code` and
//! the `tag`; the row is derived from them at creation and at load, so no save
//! holds a row number and the content fingerprint does not read this.

use crate::error::ContentError;
use crate::pack::{CompiledAffinityKind, CompiledSkill};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// A subject's saved tag is this prefix and the subject's id.
pub const SUBJECT_TAG_PREFIX: &str = "subject:";
/// A random fight's saved tag is this prefix and the activity code it draws.
pub const RANDOM_FIGHT_TAG_PREFIX: &str = "fight-random-";
/// Set in a render value for a random fight, which draws its activity row's
/// art in the fight's red.
#[allow(dead_code)]
pub const RANDOM_FIGHT_BIT: u32 = 1 << 16;
/// The row id every unknown chat tag resolves to.
pub const OTHER_ID: &str = "other";
/// The row id small talk resolves to.
pub const SMALLTALK_ID: &str = "smalltalk";
/// The row id a subject tag resolves to when content no longer has it.
pub const UNKNOWN_SUBJECT_ID: &str = "unknown-subject";

/// The saved activity codes a chat topic may carry (3 to 23, never 6).
const CHAT_CODES: std::ops::RangeInclusive<u32> = 3..=23;
const FIGHT_CODES: std::ops::RangeInclusive<u32> = 24..=53;
/// A render value is `row + 1` in sixteen bits, so a row must fit below it.
const MAX_ROWS: usize = 0xfffe;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TopicKind {
    Smalltalk,
    Activity,
    Fight,
    Subject,
}

impl TopicKind {
    /// The word `topics.toml` and the wasm topic table use.
    pub fn name(self) -> &'static str {
        match self {
            Self::Smalltalk => "smalltalk",
            Self::Activity => "activity",
            Self::Fight => "fight",
            Self::Subject => "subject",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        [Self::Smalltalk, Self::Activity, Self::Fight, Self::Subject]
            .into_iter()
            .find(|kind| kind.name() == name)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SubjectSourceKind {
    Tag,
    Skill,
    Affinity,
    Job,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledSubjectSource {
    pub kind: SubjectSourceKind,
    /// A tag, a skill id or an affinity id; empty for the job source.
    pub key: String,
    pub weight: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledSubject {
    pub bias: f32,
    pub variation: f32,
    /// Only an employed person offers the subject.
    pub requires_job: bool,
    pub sources: Vec<CompiledSubjectSource>,
}

/// One topic. Fields a kind does not use are empty or zero.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledTopic {
    pub id: String,
    pub kind: TopicKind,
    /// The player word after "about"; empty for a topic with no subject.
    pub label: String,
    /// The name of a conversation bubble sprite.
    pub icon: String,
    /// The frozen saved code (smalltalk, activity and fight rows).
    pub code: u32,
    /// The saved tags that resolve to this row (smalltalk and activity rows).
    pub tags: Vec<String>,
    /// The fight reason tag (fight rows).
    pub reason: String,
    pub subject: Option<CompiledSubject>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopicsFile {
    pub topic: Vec<TopicDef>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubjectSourceDef {
    pub kind: String,
    #[serde(default)]
    pub key: Option<String>,
    pub weight: f32,
}

/// One `[[topic]]` as authored. Every field a kind may omit is optional so
/// the compiler can say which one is missing or extra.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopicDef {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub label: String,
    pub icon: String,
    pub code: Option<u32>,
    pub tags: Option<Vec<String>>,
    pub reason: Option<String>,
    pub sources: Option<Vec<SubjectSourceDef>>,
    pub variation: Option<f32>,
    pub bias: Option<f32>,
    pub requires: Option<String>,
}

fn invalid(context: impl Into<String>, reason: impl Into<String>) -> ContentError {
    ContentError::InvalidTopicContent {
        context: context.into(),
        reason: reason.into(),
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
}

fn present<T>(value: &Option<T>) -> bool {
    value.is_some()
}

/// Refuses a field the kind does not use, naming it.
fn forbid(def: &TopicDef, fields: &[(&str, bool)]) -> Result<(), ContentError> {
    match fields.iter().find(|(_, set)| *set) {
        Some((name, _)) => Err(invalid(
            &def.id,
            format!("{} topics cannot have `{name}`", def.kind),
        )),
        None => Ok(()),
    }
}

fn require<T>(def: &TopicDef, name: &str, value: &Option<T>) -> Result<(), ContentError> {
    if value.is_none() {
        return Err(invalid(
            &def.id,
            format!("{} topics need `{name}`", def.kind),
        ));
    }
    Ok(())
}

fn compile_source(
    topic: &str,
    def: &SubjectSourceDef,
    skills: &[CompiledSkill],
    affinities: &[CompiledAffinityKind],
) -> Result<CompiledSubjectSource, ContentError> {
    if !def.weight.is_finite() || !(-1.0..=1.0).contains(&def.weight) {
        return Err(invalid(topic, "a source weight must be from -1 to 1"));
    }
    let key = def.key.clone().unwrap_or_default();
    let kind = match def.kind.as_str() {
        "tag" if !key.is_empty() => SubjectSourceKind::Tag,
        "skill" if skills.iter().any(|skill| skill.id == key) => SubjectSourceKind::Skill,
        "affinity" if affinities.iter().any(|kind| kind.id == key) => SubjectSourceKind::Affinity,
        "job" if key.is_empty() => SubjectSourceKind::Job,
        "tag" => return Err(invalid(topic, "a tag source needs a `key`")),
        "skill" => return Err(invalid(topic, format!("unknown skill '{key}'"))),
        "affinity" => return Err(invalid(topic, format!("unknown affinity '{key}'"))),
        "job" => return Err(invalid(topic, "a job source takes no `key`")),
        other => return Err(invalid(topic, format!("unknown source kind '{other}'"))),
    };
    Ok(CompiledSubjectSource {
        kind,
        key,
        weight: def.weight,
    })
}

fn compile_subject(
    def: &TopicDef,
    skills: &[CompiledSkill],
    affinities: &[CompiledAffinityKind],
) -> Result<CompiledSubject, ContentError> {
    forbid(
        def,
        &[
            ("code", present(&def.code)),
            ("tags", present(&def.tags)),
            ("reason", present(&def.reason)),
        ],
    )?;
    require(def, "bias", &def.bias)?;
    require(def, "variation", &def.variation)?;
    require(def, "sources", &def.sources)?;
    if def.label.trim().is_empty() {
        return Err(invalid(&def.id, "a subject needs a label"));
    }
    let (bias, variation) = (def.bias.unwrap_or(0.0), def.variation.unwrap_or(0.0));
    if !bias.is_finite() || !(-1.0..=1.0).contains(&bias) {
        return Err(invalid(&def.id, "bias must be from -1 to 1"));
    }
    if !variation.is_finite() || variation < 0.0 {
        return Err(invalid(&def.id, "variation cannot be negative"));
    }
    let requires_job = match def.requires.as_deref() {
        None => false,
        Some("job") => true,
        Some(other) => {
            return Err(invalid(
                &def.id,
                format!("unknown requires value '{other}'"),
            ))
        }
    };
    let sources = def
        .sources
        .iter()
        .flatten()
        .map(|source| compile_source(&def.id, source, skills, affinities))
        .collect::<Result<_, _>>()?;
    Ok(CompiledSubject {
        bias,
        variation,
        requires_job,
        sources,
    })
}

fn compile_row(
    def: &TopicDef,
    kind: TopicKind,
    skills: &[CompiledSkill],
    affinities: &[CompiledAffinityKind],
) -> Result<CompiledTopic, ContentError> {
    let subject_fields = [
        ("sources", present(&def.sources)),
        ("variation", present(&def.variation)),
        ("bias", present(&def.bias)),
        ("requires", present(&def.requires)),
    ];
    let (code, tags, reason, subject) = match kind {
        TopicKind::Subject => (
            0,
            Vec::new(),
            String::new(),
            Some(compile_subject(def, skills, affinities)?),
        ),
        TopicKind::Fight => {
            forbid(def, &[("tags", present(&def.tags))])?;
            forbid(def, &subject_fields)?;
            require(def, "code", &def.code)?;
            require(def, "reason", &def.reason)?;
            let code = def.code.unwrap_or(0);
            if !FIGHT_CODES.contains(&code) {
                return Err(invalid(&def.id, "a fight code must be from 24 to 53"));
            }
            let reason = def.reason.clone().unwrap_or_default();
            if reason.is_empty() {
                return Err(invalid(&def.id, "a fight reason cannot be empty"));
            }
            (code, Vec::new(), reason, None)
        }
        TopicKind::Smalltalk | TopicKind::Activity => {
            forbid(def, &[("reason", present(&def.reason))])?;
            forbid(def, &subject_fields)?;
            require(def, "code", &def.code)?;
            let code = def.code.unwrap_or(0);
            if !CHAT_CODES.contains(&code) || code == 6 {
                return Err(invalid(&def.id, "a chat code must be from 3 to 23, not 6"));
            }
            (
                code,
                def.tags.clone().unwrap_or_default(),
                String::new(),
                None,
            )
        }
    };
    Ok(CompiledTopic {
        id: def.id.clone(),
        kind,
        label: def.label.clone(),
        icon: def.icon.clone(),
        code,
        tags,
        reason,
        subject,
    })
}

/// Every saved tag and fight reason is one name for one row, so a tag may
/// appear once across the whole file.
fn check_tags_unique(rows: &[CompiledTopic]) -> Result<(), ContentError> {
    let mut seen = BTreeSet::new();
    for row in rows {
        for tag in row
            .tags
            .iter()
            .chain(Some(&row.reason).filter(|r| !r.is_empty()))
        {
            if tag.is_empty() || !seen.insert(tag.as_str()) {
                return Err(invalid(
                    &row.id,
                    format!("tag or reason '{tag}' must be non-empty and appear once"),
                ));
            }
        }
    }
    Ok(())
}

fn check_fixed_rows(rows: &[CompiledTopic]) -> Result<(), ContentError> {
    for (id, kind) in [
        (SMALLTALK_ID, TopicKind::Smalltalk),
        (OTHER_ID, TopicKind::Activity),
        (UNKNOWN_SUBJECT_ID, TopicKind::Subject),
    ] {
        if !rows.iter().any(|row| row.id == id && row.kind == kind) {
            return Err(invalid(
                id,
                format!("the table needs a {} row with id '{id}'", kind.name()),
            ));
        }
    }
    Ok(())
}

/// Compiles `topics.toml`. Needs the compiled skills and affinity kinds a
/// subject's sources name.
pub fn compile_topics(
    source: TopicsFile,
    skills: &[CompiledSkill],
    affinities: &[CompiledAffinityKind],
) -> Result<Vec<CompiledTopic>, ContentError> {
    if source.topic.len() > MAX_ROWS {
        return Err(invalid("topics", "too many topic rows"));
    }
    let mut ids = BTreeSet::new();
    let mut rows = Vec::new();
    for def in &source.topic {
        if !valid_id(&def.id) || !ids.insert(def.id.as_str()) {
            return Err(invalid(&def.id, "topic ids must be valid and unique"));
        }
        let kind = TopicKind::parse(&def.kind)
            .ok_or_else(|| invalid(&def.id, format!("unknown kind '{}'", def.kind)))?;
        if def.icon.trim().is_empty() {
            return Err(invalid(&def.id, "a topic needs an icon"));
        }
        // The wasm table is one tab separated line per row.
        let breaks = |text: &str| text.contains(['\t', '\n', '\r']);
        if breaks(&def.icon) || breaks(&def.label) {
            return Err(invalid(
                &def.id,
                "an icon or label cannot hold a tab or line break",
            ));
        }
        rows.push(compile_row(def, kind, skills, affinities)?);
    }
    check_tags_unique(&rows)?;
    check_fixed_rows(&rows)?;
    Ok(rows)
}

/// A topic's row, and whether it is a random fight, which draws its row's
/// art in a fight's red.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TopicRef {
    pub row: u16,
    pub random_fight: bool,
}

impl TopicRef {
    #[allow(dead_code)]
    /// The render column's value: `row + 1`, with [`RANDOM_FIGHT_BIT`] for a
    /// random fight. Zero is outside a chat.
    pub fn render_value(self) -> u32 {
        (u32::from(self.row) + 1)
            | if self.random_fight {
                RANDOM_FIGHT_BIT
            } else {
                0
            }
    }
}

/// Whether a saved tag names a random fight.
#[allow(dead_code)]
pub fn is_random_fight_tag(tag: &str) -> bool {
    tag.starts_with(RANDOM_FIGHT_TAG_PREFIX)
}

// The runtime lookups below are never called by the build script, which
// includes this file, and are live code in the library.
#[allow(dead_code)]
fn row_of_id(rows: &[CompiledTopic], id: &str) -> Option<u16> {
    rows.iter().position(|row| row.id == id).map(|at| at as u16)
}

/// The activity a random fight about code `code` draws: the first smalltalk
/// or activity row in file order with that code.
#[allow(dead_code)]
fn row_of_code(rows: &[CompiledTopic], code: u32) -> Option<u16> {
    rows.iter()
        .position(|row| {
            matches!(row.kind, TopicKind::Smalltalk | TopicKind::Activity) && row.code == code
        })
        .map(|at| at as u16)
}

/// The row a saved tag resolves to. A table without rows, such as a test
/// fixture's, resolves everything to row 0.
#[allow(dead_code)]
pub fn resolve_topic(rows: &[CompiledTopic], tag: &str) -> TopicRef {
    let plain = |row: Option<u16>| TopicRef {
        row: row.unwrap_or(0),
        random_fight: false,
    };
    if let Some(id) = tag.strip_prefix(SUBJECT_TAG_PREFIX) {
        let found = row_of_id(rows, id).filter(|&at| rows[at as usize].kind == TopicKind::Subject);
        return plain(found.or_else(|| row_of_id(rows, UNKNOWN_SUBJECT_ID)));
    }
    if let Some(at) = rows
        .iter()
        .position(|row| row.kind == TopicKind::Fight && row.reason == tag)
    {
        return plain(Some(at as u16));
    }
    if let Some(code) = tag.strip_prefix(RANDOM_FIGHT_TAG_PREFIX) {
        let drawn = code
            .bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| code.parse().ok())
            .flatten()
            .and_then(|code| row_of_code(rows, code));
        if let Some(row) = drawn {
            return TopicRef {
                row,
                random_fight: true,
            };
        }
    }
    let tagged = rows.iter().position(|row| {
        matches!(row.kind, TopicKind::Smalltalk | TopicKind::Activity)
            && row.tags.iter().any(|known| known == tag)
    });
    plain(
        tagged
            .map(|at| at as u16)
            .or_else(|| row_of_id(rows, OTHER_ID)),
    )
}
