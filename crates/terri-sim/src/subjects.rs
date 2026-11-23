//! Subject interests: what a person likes to talk about beyond the
//! activities around them ([RT-subjects] in
//! `docs/specs/2026-11-22-richer-topics.md`).
//!
//! `interest(person, subject) = clamp(bias + sum(weight * source) +
//! variation * personal(person, subject), -1, 1)`. Nothing here is saved or
//! drawn from `SimRng`: every term is read from the person's saved state or
//! derived from their `SimId`, so two worlds that agree on those agree on
//! every interest, whatever order their entities are in.

use crate::compatibility::{preferences, Preferences};
use crate::{affinity, careers, skills, Content};
use bevy_ecs::prelude::*;
use terri_core::{Affinities, FnvHasher, Hobbies, Personality, SimId, Skills, Traits};
use terri_data::topics::{
    CompiledSubject, CompiledTopic, SubjectSourceKind, TopicKind, SUBJECT_TAG_PREFIX,
    UNKNOWN_SUBJECT_ID,
};
use terri_data::ContentPack;

/// What the Likes and dislikes panel shows for a subject the person does not
/// have, such as Work for someone without a job.
pub(crate) const HIDDEN: &str = "";

/// `personal(person, subject)`, from -1 to 1: FNV-1a 64 over the
/// person's `SimId` as four little-endian bytes and then the subject id's
/// bytes, read as the top 53 bits of the hash.
pub(crate) fn personal(sim: SimId, subject: &str) -> f32 {
    let mut hash = FnvHasher::default();
    hash.write_bytes(&sim.0.to_le_bytes());
    hash.write_bytes(subject.as_bytes());
    let top = hash.finish() >> 11;
    (top as f64 / (1u64 << 53) as f64 * 2.0 - 1.0) as f32
}

/// The saved tag a chat about `row` carries.
pub(crate) fn tag_of(row: &CompiledTopic) -> String {
    format!("{SUBJECT_TAG_PREFIX}{}", row.id)
}

/// Whether the person holds a job.
pub(crate) fn is_employed(world: &World, pack: &ContentPack, person: Entity) -> bool {
    careers::job_of(world, pack, person).is_some()
}

/// `(job_satisfaction - 50) / 50` for an employed person, 0 otherwise.
fn job_value(world: &World, pack: &ContentPack, person: Entity) -> f32 {
    if !is_employed(world, pack, person) {
        return 0.0;
    }
    let satisfaction = world
        .get::<SimId>(person)
        .zip(world.get_resource::<careers::Careers>())
        .and_then(|(sim, careers)| careers.record(*sim))
        .map_or(50.0, |record| record.job_satisfaction);
    (satisfaction - 50.0) / 50.0
}

/// One source's value for one person. A skill or affinity the pack does not
/// have reads 0.
fn source_value(
    world: &World,
    pack: &ContentPack,
    person: Entity,
    prefs: &Preferences,
    kind: SubjectSourceKind,
    key: &str,
) -> f32 {
    match kind {
        SubjectSourceKind::Tag => prefs.get(key).copied().unwrap_or(0.0),
        SubjectSourceKind::Skill => {
            skills::mastery_for_id(world.get::<Skills>(person), pack, key).unwrap_or(0.0)
        }
        SubjectSourceKind::Affinity => pack
            .affinities
            .iter()
            .position(|affinity| affinity.id == key)
            .and_then(|at| {
                world
                    .get::<Affinities>(person)
                    .map(|held| held.value(at as u32))
            })
            .unwrap_or(0.0),
        SubjectSourceKind::Job => job_value(world, pack, person),
    }
}

/// The person's interest in a subject, from -1 to 1. `requires_job` does not
/// enter: a listener without a job still has an interest from the other terms.
pub(crate) fn interest(
    world: &World,
    pack: &ContentPack,
    person: Entity,
    row: &CompiledTopic,
    subject: &CompiledSubject,
    prefs: &Preferences,
) -> f32 {
    let mut total = subject.bias;
    for source in &subject.sources {
        total += source.weight * source_value(world, pack, person, prefs, source.kind, &source.key);
    }
    if let Some(sim) = world.get::<SimId>(person) {
        total += subject.variation * personal(*sim, &row.id);
    }
    total.clamp(-1.0, 1.0)
}

/// A person's authored preferences, as `begin_topics` reads them.
pub(crate) fn preferences_of(world: &World, pack: &ContentPack, person: Entity) -> Preferences {
    preferences(
        pack,
        world.get::<Personality>(person),
        world.get::<Traits>(person),
        world.get::<Hobbies>(person),
    )
}

/// Every subject row in content order with its rules, including the
/// `unknown-subject` row, which is never offered.
pub(crate) fn subject_rows(
    pack: &ContentPack,
) -> impl Iterator<Item = (&CompiledTopic, &CompiledSubject)> {
    pack.topics.iter().filter_map(|row| {
        (row.kind == TopicKind::Subject)
            .then_some(row.subject.as_ref())
            .flatten()
            .map(|subject| (row, subject))
    })
}

/// The subjects the Likes and dislikes panel lists, in content order: every
/// subject row except `unknown-subject`.
pub(crate) fn listed_rows(pack: &ContentPack) -> impl Iterator<Item = &CompiledTopic> {
    subject_rows(pack)
        .map(|(row, _)| row)
        .filter(|row| row.id != UNKNOWN_SUBJECT_ID)
}

/// A subject the initiator offers a listener: its saved tag, the initiator's
/// interest and the listener's.
pub(crate) struct Offer {
    pub tag: String,
    pub mine: f32,
    pub theirs: f32,
}

/// The subjects the initiator offers: those they are employed for, if the
/// subject needs a job, and have a positive interest in, in content order.
/// The listener's interest is read from the same rules, whether or not the
/// listener could offer the subject themselves.
pub(crate) fn offered(
    world: &World,
    pack: &ContentPack,
    (initiator, mine): (Entity, &Preferences),
    (listener, theirs): (Entity, &Preferences),
) -> Vec<Offer> {
    subject_rows(pack)
        .filter(|(_, subject)| !subject.requires_job || is_employed(world, pack, initiator))
        .filter_map(|(row, subject)| {
            let own = interest(world, pack, initiator, row, subject, mine);
            (own > 0.0).then(|| Offer {
                tag: tag_of(row),
                mine: own,
                theirs: interest(world, pack, listener, row, subject, theirs),
            })
        })
        .collect()
}

/// One word per listed subject, aligned with [`listed_rows`]: the band word
/// for the person's interest, or [`HIDDEN`] for a subject they cannot offer.
pub(crate) fn words_of(world: &World, person: Entity) -> Vec<&'static str> {
    let pack = world.resource::<Content>().0;
    let prefs = preferences_of(world, pack, person);
    let employed = is_employed(world, pack, person);
    subject_rows(pack)
        .filter(|(row, _)| row.id != UNKNOWN_SUBJECT_ID)
        .map(|(row, subject)| {
            if subject.requires_job && !employed {
                HIDDEN
            } else {
                affinity::band(
                    interest(world, pack, person, row, subject, &prefs),
                    &pack.tuning,
                )
            }
        })
        .collect()
}

#[cfg(test)]
#[path = "subjects_tests.rs"]
pub(crate) mod tests;
