//! A read-only mood projection derived from the world the save already owns.
//!
//! Mood deliberately has no component and no schedule step. Needs, mutable
//! conditions, positions, names and directional relationships are the state;
//! this module merely turns one coherent read of them into presentation data.

use bevy_ecs::prelude::*;
use terri_core::{Agent, NeedId, Needs, Position, Relationships, SimId, SimName, Traits};
use terri_data::CompiledTraitKind;

use crate::{Content, Sim};

const CRITICAL_NEED_SCORE: f32 = -25.0;
const LOW_NEED_SCORE: f32 = -12.0;
const NEEDS_MET_SCORE: f32 = 20.0;
const CONDITION_SCORE_AT_FULL_SEVERITY: f32 = -30.0;
const RELATIONSHIP_SCORE_AT_FULL_STRENGTH: f32 = 15.0;
const RELATIONSHIP_RADIUS: f32 = 4.0;

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
        let pack = self.world.get_resource::<Content>()?.0;
        let mut subject_query = self.world.try_query_filtered::<(
            Entity,
            &Needs,
            &Position,
            Option<&Traits>,
            Option<&Relationships>,
        ), With<Agent>>()?;
        let (subject, needs, position, traits, relationships) = subject_query
            .iter(&self.world)
            .find(|(entity, ..)| entity.index_u32() == index)?;

        let mut moodlets = Vec::new();
        for need in NeedId::ALL {
            let level = needs.get(need);
            let (low_label, critical_label) = need_labels(need);
            if level <= 20.0 {
                moodlets.push(Moodlet {
                    label: critical_label.to_string(),
                    score: CRITICAL_NEED_SCORE,
                });
            } else if level <= 40.0 {
                moodlets.push(Moodlet {
                    label: low_label.to_string(),
                    score: LOW_NEED_SCORE,
                });
            }
        }

        if NeedId::ALL.into_iter().all(|need| needs.get(need) >= 70.0) {
            moodlets.push(Moodlet {
                label: "Needs met".to_string(),
                score: NEEDS_MET_SCORE,
            });
        }

        if let Some(traits) = traits {
            for &(trait_index, severity) in traits.entries() {
                if severity.partial_cmp(&0.05) != Some(std::cmp::Ordering::Greater) {
                    continue;
                }
                let Some(definition) = pack.traits.get(trait_index as usize) else {
                    continue;
                };
                if matches!(&definition.kind, CompiledTraitKind::Condition { .. }) {
                    moodlets.push(Moodlet {
                        label: definition.label.clone(),
                        score: CONDITION_SCORE_AT_FULL_SEVERITY * severity,
                    });
                }
            }
        }

        let mut nearby = Vec::new();
        if let Some(relationships) = relationships {
            let mut people_query = self
                .world
                .try_query_filtered::<(Entity, &SimId, &SimName, &Position), With<Agent>>()?;
            for (other, sim_id, name, other_position) in people_query.iter(&self.world) {
                if other == subject {
                    continue;
                }
                let feeling = relationships.feeling(*sim_id);
                if !feeling.is_finite() || feeling.abs() < 0.1 {
                    continue;
                }
                let dx = other_position.x - position.x;
                let dy = other_position.y - position.y;
                let distance = (dx * dx + dy * dy).sqrt();
                if !distance.is_finite() || distance >= RELATIONSHIP_RADIUS {
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
                score: RELATIONSHIP_SCORE_AT_FULL_STRENGTH
                    * feeling
                    * (1.0 - distance / RELATIONSHIP_RADIUS),
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

    fn subject(sim: &mut Sim, needs: Needs) -> Entity {
        sim.world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, needs))
            .id()
    }

    fn mood(sim: &Sim, entity: Entity) -> MoodSnapshot {
        sim.mood_of(entity.index_u32())
            .expect("the fixture entity is a live sim")
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
                (20.0, critical, CRITICAL_NEED_SCORE),
                (20.001, low, LOW_NEED_SCORE),
                (40.0, low, LOW_NEED_SCORE),
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
                score: NEEDS_MET_SCORE,
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
        assert!((snapshot.overall_score - 12.0).abs() < 1e-6);
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
