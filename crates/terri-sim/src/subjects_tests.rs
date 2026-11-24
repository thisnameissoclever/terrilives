//! Subject interest ([RT-subjects] in `docs/specs/2026-11-22-richer-topics.md`).

use super::*;
use crate::Sim;
use terri_core::{Agent, Career, SimIdAllocator};
use terri_data::topics::CompiledSubjectSource;

pub(crate) fn subject_row(id: &str, subject: CompiledSubject) -> CompiledTopic {
    CompiledTopic {
        id: id.into(),
        kind: TopicKind::Subject,
        label: id.into(),
        icon: "Talk".into(),
        code: 0,
        tags: Vec::new(),
        reason: String::new(),
        subject: Some(subject),
    }
}

pub(crate) fn rule(
    bias: f32,
    variation: f32,
    sources: &[(SubjectSourceKind, &str, f32)],
) -> CompiledSubject {
    CompiledSubject {
        bias,
        variation,
        requires_job: false,
        sources: sources
            .iter()
            .map(|&(kind, key, weight)| CompiledSubjectSource {
                kind,
                key: key.into(),
                weight,
            })
            .collect(),
    }
}

fn person(sim: &mut Sim) -> Entity {
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    sim.world_mut().spawn((Agent, id)).id()
}

fn interest_in(sim: &Sim, person: Entity, id: &str, subject: &CompiledSubject) -> f32 {
    let pack = sim.world().resource::<Content>().0;
    let prefs = preferences_of(sim.world(), pack, person);
    interest(
        sim.world(),
        pack,
        person,
        &subject_row(id, subject.clone()),
        subject,
        &prefs,
    )
}

fn close(left: f32, right: f32) {
    assert!((left - right).abs() < 1e-5, "{left} is not {right}");
}

#[test]
fn personal_is_fnv1a_over_the_sim_id_then_the_subject_id() {
    // Worked by hand with the 64-bit FNV-1a constants over the bytes
    // 01 00 00 00 and "trains": the hash, then its top 53 bits as -1 to 1.
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in [1u8, 0, 0, 0].into_iter().chain(*b"trains") {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    assert_eq!(hash, 0xc5c4_1c23_369a_29d7);
    close(personal(SimId(1), "trains"), 0.545_047_3);
    close(personal(SimId(7), "work"), 0.831_257_4);
}

#[test]
fn personal_stays_in_range_and_differs_by_person_and_subject() {
    let mut seen = std::collections::BTreeSet::new();
    for sim in 0..200 {
        for subject in ["trains", "bicycling", "gardening", "weather", "work"] {
            let value = personal(SimId(sim), subject);
            assert!((-1.0..1.0).contains(&value), "{sim} {subject}: {value}");
            seen.insert(value.to_bits());
        }
    }
    assert!(seen.len() > 990, "values collide: {}", seen.len());
}

#[test]
fn a_tag_source_reads_the_persons_preference_for_the_tag() {
    let mut sim = Sim::new_with_lot(12, 8);
    let reader = person(&mut sim);
    sim.world_mut()
        .entity_mut(reader)
        .insert(Hobbies(vec!["exercise".into()]));
    let other = person(&mut sim);
    let subject = rule(0.0, 0.0, &[(SubjectSourceKind::Tag, "exercise", 0.5)]);
    close(interest_in(&sim, reader, "bicycling", &subject), 0.25);
    close(interest_in(&sim, other, "bicycling", &subject), 0.0);
}

#[test]
fn a_skill_source_reads_mastery_from_zero_to_one() {
    let mut sim = Sim::new_with_lot(12, 8);
    let pack = sim.world().resource::<Content>().0;
    let at = pack
        .skills
        .iter()
        .position(|skill| skill.id == "exercise")
        .expect("the shipped pack has an exercise skill");
    let master = person(&mut sim);
    sim.world_mut()
        .entity_mut(master)
        .insert(Skills::from_entries(vec![(at as u32, 1.0e6)]));
    let novice = person(&mut sim);
    let subject = rule(0.0, 0.0, &[(SubjectSourceKind::Skill, "exercise", 0.3)]);
    close(interest_in(&sim, master, "bicycling", &subject), 0.3);
    close(interest_in(&sim, novice, "bicycling", &subject), 0.0);
}

#[test]
fn an_affinity_source_reads_the_saved_value_from_minus_one_to_one() {
    let mut sim = Sim::new_with_lot(12, 8);
    let pack = sim.world().resource::<Content>().0;
    let at = pack
        .affinities
        .iter()
        .position(|kind| kind.id == "plants")
        .expect("the shipped pack has a plants affinity");
    let mut values = vec![0.0; pack.affinities.len()];
    let fond = person(&mut sim);
    values[at] = 0.5;
    sim.world_mut()
        .entity_mut(fond)
        .insert(Affinities::from_values(values.clone()));
    let averse = person(&mut sim);
    values[at] = -1.0;
    sim.world_mut()
        .entity_mut(averse)
        .insert(Affinities::from_values(values));
    let subject = rule(0.0, 0.0, &[(SubjectSourceKind::Affinity, "plants", 0.6)]);
    close(interest_in(&sim, fond, "gardening", &subject), 0.3);
    close(interest_in(&sim, averse, "gardening", &subject), -0.6);
}

#[test]
fn a_job_source_reads_satisfaction_for_an_employed_person_only() {
    let mut sim = Sim::new_with_lot(12, 8);
    let subject = rule(0.0, 0.0, &[(SubjectSourceKind::Job, "", 0.8)]);
    let jobless = person(&mut sim);
    close(interest_in(&sim, jobless, "work", &subject), 0.0);
    let pack = sim.world().resource::<Content>().0;
    assert!(!pack.careers.is_empty());
    for (satisfaction, expected) in [(100.0, 0.8), (50.0, 0.0), (0.0, -0.8), (75.0, 0.4)] {
        let worker = person(&mut sim);
        let id = *sim.world().get::<SimId>(worker).unwrap();
        sim.world_mut().entity_mut(worker).insert(Career(0));
        let mut record = careers::Record::new(&pack.careers[0]);
        record.job_satisfaction = satisfaction;
        sim.world_mut()
            .resource_mut::<careers::Careers>()
            .records
            .insert(id, record);
        close(interest_in(&sim, worker, "work", &subject), expected);
    }
    // An employed person with no record reads the middling start, 50.
    let unrecorded = person(&mut sim);
    sim.world_mut().entity_mut(unrecorded).insert(Career(0));
    close(interest_in(&sim, unrecorded, "work", &subject), 0.0);
}

#[test]
fn a_source_the_pack_lacks_reads_zero() {
    let mut sim = Sim::new_with_lot(12, 8);
    let someone = person(&mut sim);
    let subject = rule(
        0.2,
        0.0,
        &[
            (SubjectSourceKind::Skill, "no-such-skill", 1.0),
            (SubjectSourceKind::Affinity, "no-such-kind", 1.0),
            (SubjectSourceKind::Tag, "no-such-tag", 1.0),
        ],
    );
    close(interest_in(&sim, someone, "odd", &subject), 0.2);
}

#[test]
fn subject_interest_stays_within_range() {
    let mut sim = Sim::new_with_lot(12, 8);
    let mut seen = Vec::new();
    for (bias, variation, weight) in [(1.0, 5.0, 1.0), (-1.0, 5.0, -1.0), (0.0, 0.0, 0.0)] {
        let subject = rule(
            bias,
            variation,
            &[
                (SubjectSourceKind::Tag, "exercise", weight),
                (SubjectSourceKind::Skill, "exercise", weight),
            ],
        );
        for _ in 0..50 {
            let someone = person(&mut sim);
            sim.world_mut()
                .entity_mut(someone)
                .insert(Hobbies(vec!["exercise".into()]));
            let value = interest_in(&sim, someone, "extreme", &subject);
            assert!((-1.0..=1.0).contains(&value), "{value}");
            seen.push(value);
        }
    }
    assert!(seen.contains(&1.0) && seen.contains(&-1.0));
}

#[test]
fn subject_interest_is_independent_of_entity_order() {
    // The same people, by SimId, are spawned in two orders, the second
    // among entities that are made and removed (archetype churn), so the
    // entity indices and archetype tables differ between the worlds.
    let subject = rule(
        0.1,
        0.6,
        &[
            (SubjectSourceKind::Tag, "exercise", 0.5),
            (SubjectSourceKind::Skill, "exercise", 0.3),
        ],
    );
    let read = |reverse: bool| {
        let mut sim = Sim::new_with_lot(12, 8);
        let mut ids: Vec<u32> = (0..12).collect();
        if reverse {
            ids.reverse();
        }
        let mut people = Vec::new();
        for id in ids {
            if reverse {
                let churn = sim.world_mut().spawn((Agent, Career(0))).id();
                sim.world_mut().despawn(churn);
            }
            let hobbies = if id % 2 == 0 {
                Hobbies(vec!["exercise".into()])
            } else {
                Hobbies(Vec::new())
            };
            let entity = sim.world_mut().spawn((Agent, SimId(id), hobbies)).id();
            people.push((id, entity));
        }
        let mut values: Vec<_> = people
            .iter()
            .map(|&(id, entity)| (id, interest_in(&sim, entity, "bicycling", &subject)))
            .collect();
        values.sort_by_key(|&(id, _)| id);
        values
    };
    let forward = read(false);
    assert_eq!(forward, read(true));
    assert!(forward.windows(2).any(|pair| pair[0].1 != pair[1].1));
}
