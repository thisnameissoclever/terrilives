//! A read-only mood projection derived from the world the save already owns.
//!
//! Mood has no stored component. The HUD and the once-per-tick satisfaction
//! contribution share the same projection of needs, conditions, relationships,
//! grief and occupied-item waiting. Only the satisfaction ledger accumulates.

use bevy_ecs::prelude::*;
use terri_core::{
    Agent, NeedId, Needs, Position, Relationships, SimId, SimName, SmartObject, Traits,
};
use terri_data::CompiledTraitKind;

use crate::{Content, Sim};

/// One active reason the derived overall mood moved.
#[derive(Debug, Clone, PartialEq)]
pub struct Moodlet {
    pub label: String,
    pub score: f32,
}

/// One sim's current derived mood and its ordered causes.
#[derive(Debug, Clone, PartialEq)]
pub struct MoodSnapshot {
    pub overall_score: f32,
    pub overall_label: &'static str,
    pub moodlets: Vec<Moodlet>,
}

impl Sim {
    /// Derives the current mood of one live sim without changing the world.
    ///
    /// A raw entity index is all the boundary owns. Requiring `Agent`,
    /// `Needs` and `Position` makes this return `None` for furniture, stale
    /// indices and incomplete non-sim fixtures. Traits and relationships are
    /// optional because their absence is neutral.
    pub fn mood_of(&self, index: u32) -> Option<MoodSnapshot> {
        derive_mood(&self.world, index)
    }
}

fn derive_mood(world: &World, index: u32) -> Option<MoodSnapshot> {
    let pack = world.get_resource::<Content>()?.0;
    let mut subject_query = world.try_query_filtered::<(
        Entity,
        &Needs,
        &Position,
        Option<&Traits>,
        Option<&Relationships>,
    ), With<Agent>>()?;
    let (subject, needs, position, traits, relationships) = subject_query
        .iter(world)
        .find(|(entity, ..)| entity.index_u32() == index)?;

    let mut moodlets = Vec::new();
    for need in NeedId::ALL {
        let level = needs.get(need);
        let (low_label, critical_label) = need_labels(need);
        if level <= pack.tuning.mood_critical_need_level {
            moodlets.push(Moodlet {
                label: critical_label.to_string(),
                score: -pack.tuning.mood_critical_need_penalty,
            });
        } else if level <= pack.tuning.mood_low_need_level {
            moodlets.push(Moodlet {
                label: low_label.to_string(),
                score: -pack.tuning.mood_low_need_penalty,
            });
        }
    }

    if NeedId::ALL
        .into_iter()
        .all(|need| needs.get(need) >= pack.tuning.mood_needs_met_level)
    {
        moodlets.push(Moodlet {
            label: "Needs met".to_string(),
            score: pack.tuning.mood_needs_met_bonus,
        });
    }

    if let Some(traits) = traits {
        for &(trait_index, severity) in traits.entries() {
            if severity.partial_cmp(&pack.tuning.mood_condition_min_severity)
                != Some(std::cmp::Ordering::Greater)
            {
                continue;
            }
            let Some(definition) = pack.traits.get(trait_index as usize) else {
                continue;
            };
            if matches!(&definition.kind, CompiledTraitKind::Condition { .. }) {
                moodlets.push(Moodlet {
                    label: definition.label.clone(),
                    score: -pack.tuning.mood_condition_penalty * severity,
                });
            }
        }
    }

    let mut nearby = Vec::new();
    if let Some(relationships) = relationships {
        let mut people_query =
            world.try_query_filtered::<(Entity, &SimId, &SimName, &Position), With<Agent>>()?;
        for (other, sim_id, name, other_position) in people_query.iter(world) {
            if other == subject {
                continue;
            }
            let feeling = relationships.feeling(*sim_id);
            if !feeling.is_finite() || feeling.abs() < pack.tuning.mood_relationship_min_affinity {
                continue;
            }
            let dx = other_position.x - position.x;
            let dy = other_position.y - position.y;
            let distance = (dx * dx + dy * dy).sqrt();
            if !distance.is_finite() || distance >= pack.tuning.mood_relationship_radius {
                continue;
            }
            nearby.push((
                sim_id.0,
                other.index_u32(),
                name.0.as_str(),
                feeling,
                distance,
            ));
        }
    }
    // SimId is the contract. Entity index is only a deterministic tie
    // breaker for an invalid world containing duplicate stable ids.
    nearby.sort_unstable_by_key(|(sim_id, entity_index, ..)| (*sim_id, *entity_index));
    for (_, _, name, feeling, distance) in nearby {
        moodlets.push(Moodlet {
            label: if feeling.is_sign_positive() {
                format!("Comforted by {name}")
            } else {
                format!("Uneasy around {name}")
            },
            score: pack.tuning.mood_relationship_strength
                * feeling
                * (1.0 - distance / pack.tuning.mood_relationship_radius),
        });
    }

    if world.get::<SimId>(subject).is_some() && has_bed_shortage(world) {
        moodlets.push(Moodlet {
            label: "Not enough beds".to_string(),
            score: -20.0,
        });
    }

    let now = world.resource::<terri_core::SimClock>().tick;
    let subject_id = world.get::<SimId>(subject);
    for death in world
        .resource::<terri_core::save::SavedMortality>()
        .deaths
        .as_slice()
    {
        if subject_id.is_none_or(|id| id.0 >= death.issued_sim_ids) {
            continue;
        }
        let feeling = relationships.map_or(0.0, |r| r.feeling(SimId(death.sim_id)));
        if feeling <= pack.tuning.grief_hated_affinity {
            continue;
        }
        let closeness = feeling.max(0.0);
        let duration = (f64::from(pack.tuning.grief_min_ticks)
            + f64::from(pack.tuning.grief_ticks - pack.tuning.grief_min_ticks)
                * f64::from(closeness))
        .round() as u64;
        let elapsed = now.saturating_sub(death.tick);
        if elapsed >= duration {
            continue;
        }
        let strength = if feeling < 0.0 {
            pack.tuning.grief_min_score * (1.0 - feeling / pack.tuning.grief_hated_affinity)
        } else {
            pack.tuning.grief_min_score
                + (pack.tuning.grief_max_score - pack.tuning.grief_min_score) * closeness
        };
        moodlets.push(Moodlet {
            label: format!("Grieving {}", death.name),
            score: -strength * (1.0 - elapsed as f32 / duration as f32),
        });
    }

    if let Some(penalty) = crate::waiting::penalty(world, subject, needs) {
        moodlets.push(Moodlet {
            label: "Waiting for an item".into(),
            score: -penalty,
        });
    }

    if let Some(penalty) = crate::domestic::mood_penalty(world, subject) {
        moodlets.push(Moodlet {
            label: "Dirty dishes".into(),
            score: -penalty,
        });
    }
    let overall_score = moodlets
        .iter()
        .map(|moodlet| moodlet.score)
        .sum::<f32>()
        .clamp(-100.0, 100.0);
    Some(MoodSnapshot {
        overall_score,
        overall_label: overall_label(overall_score),
        moodlets,
    })
}

/// Integrates current mood once per simulation tick. A neutral band prevents
/// small fluctuations from accumulating; the ledger preserves sustained effects.
pub(crate) fn accrue_satisfaction(world: &mut World) {
    let tuning = world.resource::<Content>().0.tuning;
    let people: Vec<_> = world
        .query_filtered::<Entity, (With<Agent>, With<terri_core::Satisfaction>)>()
        .iter(world)
        .collect();
    let changes: Vec<_> = people
        .into_iter()
        .filter_map(|person| {
            let mood = derive_mood(world, person.index_u32())?;
            let delta = satisfaction_change(mood.overall_score, &tuning);
            Some((person, delta))
        })
        .collect();
    for (person, delta) in changes {
        world
            .get_mut::<terri_core::Satisfaction>(person)
            .unwrap()
            .add(delta);
    }
}

fn satisfaction_change(score: f32, tuning: &terri_data::Tuning) -> f32 {
    let excess = (score.abs() - tuning.satisfaction_mood_neutral_band).max(0.0);
    score.signum() * excess / (100.0 - tuning.satisfaction_mood_neutral_band)
        * tuning.satisfaction_mood_per_tick
}

/// Count usable sleep places, including occupied beds and people away at work.
fn has_bed_shortage(world: &World) -> bool {
    let pack = world.resource::<Content>().0;
    if pack.sleep_tag.is_empty() {
        return false;
    }
    let people = world
        .try_query_filtered::<&SimId, With<Agent>>()
        .map_or(0, |mut q| q.iter(world).count());
    let beds: usize = world.try_query::<&SmartObject>().map_or(0, |mut q| {
        q.iter(world)
            .map(|object| {
                pack.objects
                    .get(object.0 .0 as usize)
                    .map_or(0, |definition| {
                        definition
                            .interactions
                            .iter()
                            .filter(|i| i.tags.contains(&pack.sleep_tag))
                            .map(|i| usize::from(i.slots))
                            .max()
                            .unwrap_or(0)
                    })
            })
            .sum()
    });
    people > beds
}

fn need_labels(need: NeedId) -> (&'static str, &'static str) {
    match need {
        NeedId::Hunger => ("Hungry", "Starving"),
        NeedId::Energy => ("Tired", "Exhausted"),
        NeedId::Hygiene => ("Needs a wash", "Very dirty"),
        NeedId::Bladder => ("Needs the toilet", "Desperate for the toilet"),
        NeedId::Social => ("Lonely", "Very lonely"),
        NeedId::Fun => ("Bored", "Very bored"),
        NeedId::Comfort => ("Uncomfortable", "Very uncomfortable"),
    }
}

fn overall_label(score: f32) -> &'static str {
    if score <= -50.0 {
        "Miserable"
    } else if score <= -15.0 {
        "Low"
    } else if score < 15.0 {
        "Okay"
    } else if score < 50.0 {
        "Good"
    } else {
        "Great"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_content;
    use terri_core::{SmartObject, NEED_MAX};
    use terri_data::{CompiledTrait, ContentPack};

    /// A condition's label is projected as a moodlet, in the same list as
    /// the need moodlets. A trait called "Lonely" would put two rows reading
    /// "Lonely" in one person's Mood panel, with different scores and no way
    /// to tell them apart. Every trait is checked and not only conditions,
    /// because the Traits panel and the Mood panel sit in the same sheet.
    #[test]
    fn no_trait_label_repeats_a_need_moodlet() {
        let mut taken: Vec<&str> = vec!["Needs met"];
        for need in NeedId::ALL {
            let (low, critical) = need_labels(need);
            taken.extend([low, critical]);
        }
        assert_eq!(
            taken.len(),
            15,
            "seven needs, two labels each, and the all-clear"
        );
        for trait_def in &terri_data::pack().traits {
            assert!(
                !taken
                    .iter()
                    .any(|label| label.eq_ignore_ascii_case(trait_def.label.trim())),
                "trait '{}' is labelled '{}', which the Mood panel already uses for a need",
                trait_def.id,
                trait_def.label
            );
        }
    }

    #[test]
    fn mood_contribution_has_a_neutral_band_and_a_signed_linear_rate() {
        let tuning = test_content::tuning();
        for score in [-15.0, -10.0, 0.0, 10.0, 15.0] {
            assert_eq!(satisfaction_change(score, &tuning), 0.0);
        }
        for (score, expected) in [
            (-100.0, -0.025),
            (-57.5, -0.0125),
            (57.5, 0.0125),
            (100.0, 0.025),
        ] {
            assert_eq!(satisfaction_change(score, &tuning), expected);
        }
    }

    #[test]
    fn mood_reads_and_paused_commands_do_not_accrue_satisfaction() {
        let mut sim = Sim::new_from_shipped_lot();
        let before = sim.world_hash();
        let people: Vec<_> = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .collect();
        for _ in 0..20 {
            for person in &people {
                assert!(sim.mood_of(person.index_u32()).is_some());
            }
            sim.flush_commands();
        }
        assert_eq!(sim.world_hash(), before);
    }

    #[test]
    fn the_full_tick_applies_mood_after_death_and_never_to_the_dead() {
        let mut sim = Sim::new_with_lot(8, 8);
        let bed = terri_data::pack()
            .objects
            .iter()
            .position(|object| object.id == "double_bed")
            .unwrap();
        sim.world_mut()
            .spawn(SmartObject(terri_core::ObjectDefId(bed as u32)));
        let victim = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                SimName("Alex".into()),
                Position { x: 1.0, y: 1.0 },
                Needs::all_at(100.0),
            ))
            .id();
        sim.world_mut()
            .get_mut::<Needs>(victim)
            .unwrap()
            .set(NeedId::Hunger, 0.0);
        let mut ledger = terri_core::Satisfaction::default();
        ledger.add(100.0);
        let mut feelings = Relationships::default();
        feelings.bump(SimId(0), 1.0);
        let survivor = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                SimName("Jo".into()),
                Position { x: 2.0, y: 1.0 },
                Needs::all_at(100.0),
                ledger,
                feelings,
            ))
            .id();
        sim.world_mut()
            .insert_resource(terri_core::SimIdAllocator::resumed(2));
        let threshold = sim.world().resource::<Content>().0.tuning.death_after_ticks;
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .counts = vec![(victim.index_u32(), threshold - 1)];
        sim.tick();
        assert!(sim.world().get_entity(victim).is_err());
        assert!(sim
            .mood_of(survivor.index_u32())
            .unwrap()
            .moodlets
            .iter()
            .any(|m| m.label == "Grieving Alex"));
        assert_eq!(
            sim.world()
                .get::<terri_core::Satisfaction>(survivor)
                .unwrap()
                .value(),
            100.0
        );
        // Without grief this same comfortable survivor gains satisfaction.
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .deaths
            .clear();
        sim.tick();
        assert!(
            sim.world()
                .get::<terri_core::Satisfaction>(survivor)
                .unwrap()
                .value()
                > 100.0
        );
    }

    #[test]
    fn sustained_mood_changes_satisfaction_in_both_directions() {
        let mut sim = Sim::new();
        let happy = subject(&mut sim, Needs::all_at(100.0));
        let sad = subject(&mut sim, Needs::all_at(25.0));
        let neutral = subject(&mut sim, Needs::all_at(55.0));
        for person in [happy, sad, neutral] {
            let mut ledger = terri_core::Satisfaction::default();
            ledger.add(100.0);
            sim.world_mut().entity_mut(person).insert(ledger);
        }
        // Fixed needs isolate mood from neglect, decay, work and hobbies.
        super::accrue_satisfaction(sim.world_mut());
        let read = |sim: &Sim, person| {
            sim.world()
                .get::<terri_core::Satisfaction>(person)
                .unwrap()
                .value()
        };
        let first_happy = read(&sim, happy);
        let first_sad = read(&sim, sad);
        assert!(first_happy > 100.0 && first_happy < 100.1);
        assert!(first_sad < 100.0 && first_sad > 99.9);
        for _ in 1..1440 {
            super::accrue_satisfaction(sim.world_mut());
        }
        assert!(read(&sim, happy) > first_happy + 1.0);
        assert!(read(&sim, sad) < first_sad - 10.0);
        assert_eq!(read(&sim, neutral), 100.0);
    }

    fn subject(sim: &mut Sim, needs: Needs) -> Entity {
        sim.world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, needs))
            .id()
    }

    fn mood(sim: &Sim, entity: Entity) -> MoodSnapshot {
        sim.mood_of(entity.index_u32())
            .expect("the fixture entity is a live sim")
    }

    #[test]
    fn bed_shortage_counts_sleep_slots_and_clears_when_capacity_returns() {
        let mut sim = Sim::new_from_shipped_lot();
        let people: Vec<Entity> = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .collect();
        let beds: Vec<Entity> = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .filter(|(_, o)| {
                terri_data::pack()
                    .object(o.0)
                    .interactions
                    .iter()
                    .any(|i| i.tags.contains(&terri_data::pack().sleep_tag))
            })
            .map(|(e, _)| e)
            .collect();
        for bed in beds {
            sim.world_mut().despawn(bed);
        }
        for person in &people {
            let mood = sim.mood_of(person.index_u32()).unwrap();
            assert!(mood
                .moodlets
                .iter()
                .any(|m| m.label == "Not enough beds" && m.score == -20.0));
        }
        let pack = terri_data::pack();
        let double = pack
            .objects
            .iter()
            .position(|o| o.id == "double_bed")
            .unwrap();
        let one = sim
            .world_mut()
            .spawn(SmartObject(terri_core::ObjectDefId(double as u32)))
            .id();
        assert!(
            has_bed_shortage(sim.world()),
            "one double bed cannot sleep three people"
        );
        sim.world_mut()
            .spawn(SmartObject(terri_core::ObjectDefId(double as u32)));
        assert!(
            !has_bed_shortage(sim.world()),
            "two double beds provide four places"
        );
        for person in &people {
            assert!(!sim
                .mood_of(person.index_u32())
                .unwrap()
                .moodlets
                .iter()
                .any(|m| m.label == "Not enough beds"));
        }
        sim.world_mut().despawn(one);
        assert!(has_bed_shortage(sim.world()));
        sim.world_mut().despawn(people[0]);
        assert!(
            !has_bed_shortage(sim.world()),
            "only living household members need beds"
        );
    }

    fn condition(label: &str) -> CompiledTrait {
        CompiledTrait {
            id: label.to_lowercase().replace(' ', "_"),
            label: label.to_string(),
            tag: "resting".to_string(),
            kind: CompiledTraitKind::Condition {
                accrual_scale: 0.5,
                manage_per_completion: 0.01,
                start_severity: 0.5,
            },
            description: String::new(),
        }
    }

    fn capability(label: &str) -> CompiledTrait {
        CompiledTrait {
            id: label.to_lowercase().replace(' ', "_"),
            label: label.to_string(),
            tag: "cooking".to_string(),
            kind: CompiledTraitKind::Capability {
                start_level: 0.25,
                fail_delta_scale: 0.0,
                learn_per_attempt: 0.01,
            },
            description: String::new(),
        }
    }

    fn disposition(label: &str) -> CompiledTrait {
        CompiledTrait {
            id: label.to_lowercase().replace(' ', "_"),
            label: label.to_string(),
            tag: "reading".to_string(),
            kind: CompiledTraitKind::Disposition {
                score_multiplier: 1.5,
            },
            description: String::new(),
        }
    }

    fn pack_with_traits(traits: Vec<CompiledTrait>) -> &'static ContentPack {
        let base = test_content::pack(Vec::new());
        Box::leak(Box::new(ContentPack {
            traits,
            ..base.clone()
        }))
    }

    #[test]
    fn need_thresholds_use_the_exact_plain_labels_and_scores() {
        let pack = test_content::pack(Vec::new());
        let mut sim = test_content::sim_with(8, 8, pack);
        let subject = subject(&mut sim, Needs::all_at(NEED_MAX));
        let labels = [
            ("Hungry", "Starving"),
            ("Tired", "Exhausted"),
            ("Needs a wash", "Very dirty"),
            ("Needs the toilet", "Desperate for the toilet"),
            ("Lonely", "Very lonely"),
            ("Bored", "Very bored"),
            ("Uncomfortable", "Very uncomfortable"),
        ];

        for (need, (low, critical)) in NeedId::ALL.into_iter().zip(labels) {
            for (level, expected_label, expected_score) in [
                (20.0, critical, -25.0),
                (20.001, low, -12.0),
                (40.0, low, -12.0),
            ] {
                let mut needs = Needs::all_at(NEED_MAX);
                needs.set(need, level);
                sim.world_mut().entity_mut(subject).insert(needs);
                let snapshot = mood(&sim, subject);
                assert_eq!(
                    snapshot.moodlets,
                    vec![Moodlet {
                        label: expected_label.to_string(),
                        score: expected_score,
                    }],
                    "{} at {level} must use its own threshold label",
                    need.as_str()
                );
            }

            let mut needs = Needs::all_at(NEED_MAX);
            needs.set(need, 40.001);
            sim.world_mut().entity_mut(subject).insert(needs);
            assert!(
                mood(&sim, subject).moodlets.is_empty(),
                "{} just above the low boundary must be inactive",
                need.as_str()
            );
        }
    }

    #[test]
    fn need_moodlets_follow_need_id_order_and_needs_met_includes_seventy() {
        let pack = test_content::pack(Vec::new());
        let mut sim = test_content::sim_with(8, 8, pack);
        let mut needs = Needs::all_at(NEED_MAX);
        for (offset, need) in NeedId::ALL.into_iter().enumerate() {
            needs.set(need, if offset % 2 == 0 { 20.0 } else { 40.0 });
        }
        let subject = subject(&mut sim, needs);
        let snapshot = mood(&sim, subject);
        assert_eq!(
            snapshot
                .moodlets
                .iter()
                .map(|moodlet| moodlet.label.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Starving",
                "Tired",
                "Very dirty",
                "Needs the toilet",
                "Very lonely",
                "Bored",
                "Very uncomfortable",
            ]
        );
        assert_eq!(
            snapshot
                .moodlets
                .iter()
                .map(|moodlet| moodlet.score)
                .collect::<Vec<_>>(),
            vec![-25.0, -12.0, -25.0, -12.0, -25.0, -12.0, -25.0]
        );
        assert_eq!(snapshot.overall_score, -100.0, "the sum clamps at -100");

        sim.world_mut()
            .entity_mut(subject)
            .insert(Needs::all_at(70.0));
        assert_eq!(
            mood(&sim, subject).moodlets,
            vec![Moodlet {
                label: "Needs met".to_string(),
                score: 20.0,
            }]
        );
        let mut almost = Needs::all_at(70.0);
        almost.set(NeedId::Comfort, 69.999);
        sim.world_mut().entity_mut(subject).insert(almost);
        assert!(mood(&sim, subject).moodlets.is_empty());
    }

    #[test]
    fn overall_labels_include_each_exact_boundary() {
        assert_eq!(overall_label(-50.0), "Miserable");
        assert_eq!(overall_label(-49.999), "Low");
        assert_eq!(overall_label(-15.0), "Low");
        assert_eq!(overall_label(-14.999), "Okay");
        assert_eq!(overall_label(14.999), "Okay");
        assert_eq!(overall_label(15.0), "Good");
        assert_eq!(overall_label(49.999), "Good");
        assert_eq!(overall_label(50.0), "Great");
    }

    #[test]
    fn every_generic_condition_contributes_in_trait_index_order_above_the_cutoff() {
        let pack = pack_with_traits(vec![
            condition("Paperwork allergy"),
            disposition("Night owl"),
            condition("Jet lag"),
            capability("Learning to cook"),
            condition("Barely present"),
        ]);
        let mut sim = test_content::sim_with(8, 8, pack);
        let subject = subject(&mut sim, Needs::all_at(50.0));
        sim.world_mut()
            .entity_mut(subject)
            .insert(Traits::from_entries(vec![
                (4, 0.05),
                (3, 0.9),
                (2, 0.2),
                (1, 0.8),
                (0, 0.5),
            ]));

        let snapshot = mood(&sim, subject);
        assert_eq!(
            snapshot.moodlets,
            vec![
                Moodlet {
                    label: "Paperwork allergy".to_string(),
                    score: -15.0,
                },
                Moodlet {
                    label: "Jet lag".to_string(),
                    score: -6.0,
                },
            ],
            "condition kind and content label drive mood; ids and other kinds do not"
        );
        assert_eq!(snapshot.overall_score, -21.0);
        assert_eq!(snapshot.overall_label, "Low");
    }

    #[test]
    fn relationship_moodlets_are_directional_proximity_bounded_and_sim_id_sorted() {
        let pack = test_content::pack(Vec::new());
        let mut sim = test_content::sim_with(12, 12, pack);
        let subject = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(50),
                SimName("Subject".to_string()),
                Position { x: 1.0, y: 1.0 },
                Needs::all_at(50.0),
                Relationships::default(),
            ))
            .id();

        let people = [
            (7, "Close friend", 1.0, 1.0),
            (2, "Awkward neighbour", 3.0, 1.0),
            (5, "Distant friend", 4.0, 1.0),
            (3, "At the boundary", 5.0, 1.0),
            (4, "Near stranger", 1.0, 2.0),
            (8, "Exactly known", 1.0, 2.0),
        ];
        let mut entities = Vec::new();
        for (sim_id, name, x, y) in people {
            entities.push(
                sim.world_mut()
                    .spawn((
                        Agent,
                        SimId(sim_id),
                        SimName(name.to_string()),
                        Position { x, y },
                        Needs::all_at(50.0),
                        Relationships::default(),
                    ))
                    .id(),
            );
        }
        // Named but not an Agent, and an Agent without a name, are not
        // live named sims for this projection.
        sim.world_mut().spawn((
            SimId(1),
            SimName("A labelled chair".to_string()),
            Position { x: 1.0, y: 1.0 },
        ));
        sim.world_mut().spawn((
            Agent,
            SimId(6),
            Position { x: 1.0, y: 1.0 },
            Needs::all_at(50.0),
        ));

        {
            let mut relationships = sim
                .world_mut()
                .get_mut::<Relationships>(subject)
                .expect("subject carries the directional map");
            relationships.bump(SimId(7), 1.0);
            relationships.bump(SimId(2), -0.8);
            relationships.bump(SimId(5), 0.5);
            relationships.bump(SimId(3), 1.0);
            relationships.bump(SimId(4), 0.099);
            relationships.bump(SimId(8), 0.1);
            relationships.bump(SimId(1), 1.0);
            relationships.bump(SimId(6), 1.0);
        }
        // Reciprocal feelings are deliberately opposite. Only Subject's map
        // may contribute.
        for (entity, reciprocal) in entities.into_iter().zip([-1.0, 1.0, -1.0, -1.0, 1.0, -1.0]) {
            sim.world_mut()
                .get_mut::<Relationships>(entity)
                .expect("other carries a map")
                .bump(SimId(50), reciprocal);
        }

        let snapshot = mood(&sim, subject);
        assert_eq!(
            snapshot
                .moodlets
                .iter()
                .map(|moodlet| moodlet.label.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Uneasy around Awkward neighbour",
                "Comforted by Distant friend",
                "Comforted by Close friend",
                "Comforted by Exactly known",
                "Not enough beds",
            ],
            "query and spawn order must collapse to stable SimId order"
        );
        let scores = snapshot
            .moodlets
            .iter()
            .map(|moodlet| moodlet.score)
            .collect::<Vec<_>>();
        assert!((scores[0] - -6.0).abs() < 1e-6);
        assert!((scores[1] - 1.875).abs() < 1e-6);
        assert!((scores[2] - 15.0).abs() < 1e-6);
        assert!((scores[3] - 1.125).abs() < 1e-6);
        assert_eq!(scores[4], -20.0);
        assert!((snapshot.overall_score - -8.0).abs() < 1e-6);
    }

    #[test]
    fn missing_stale_and_non_sim_indices_return_none_and_the_read_is_pure() {
        let pack = test_content::pack(vec![test_content::object(
            "chair",
            &[(NeedId::Comfort, 10.0)],
            5,
        )]);
        let mut sim = test_content::sim_with(8, 8, pack);
        let subject = subject(&mut sim, Needs::all_at(NEED_MAX));
        let object = sim
            .world_mut()
            .spawn((
                Position { x: 2.0, y: 2.0 },
                SmartObject(terri_core::ObjectDefId(0)),
            ))
            .id();
        let stale = sim
            .world_mut()
            .spawn((Agent, Position { x: 3.0, y: 3.0 }, Needs::all_at(50.0)))
            .id();
        let stale_index = stale.index_u32();
        assert!(sim.world_mut().despawn(stale));
        let before = sim.save_snapshot();

        assert!(sim.mood_of(u32::MAX).is_none());
        assert!(sim.mood_of(stale_index).is_none());
        assert!(sim.mood_of(object.index_u32()).is_none());
        assert!(sim.mood_of(subject.index_u32()).is_some());
        assert_eq!(
            sim.save_snapshot(),
            before,
            "a projection read must not create state that Save V1 could persist"
        );
    }
}
