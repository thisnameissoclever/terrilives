use terri_core::{appearance::F32Bits, character::DispositionDraft, character_catalog::*};
use terri_data::{AffinityReach, CompiledTraitKind, ContentPack};

pub fn catalog(pack: &ContentPack) -> CharacterCatalog {
    let bits = |value: f32| F32Bits(value.to_bits());
    let ladder = crate::skills::Ladder::from_tuning(&pack.tuning);
    let mut hobby_tags = std::collections::BTreeSet::new();
    for action in pack
        .objects
        .iter()
        .flat_map(|object| &object.interactions)
        .chain(pack.social.iter())
    {
        hobby_tags.extend(action.tags.iter().cloned());
    }
    CharacterCatalog {
        version: 2,
        name_limit: pack.tuning.housemate_name_max_chars,
        max_traits: pack.tuning.housemate_max_traits,
        max_household: crate::household::MAX_HOUSEHOLD_SIZE as u32,
        self_preservation_bands: pack
            .tuning
            .autonomy
            .unwrap_or_default()
            .creation_instinct_bands
            .iter()
            .map(|b| CreatorInstinctBand {
                min: b.min,
                max: b.max,
                weight: b.weight,
            })
            .collect(),
        traits: pack
            .traits
            .iter()
            .map(|trait_| {
                let (kind, weights) = match trait_.kind {
                    CompiledTraitKind::Disposition { score_multiplier } => (
                        "disposition",
                        vec![CreatorWeight {
                            tag: trait_.tag.clone(),
                            value: bits(score_multiplier),
                        }],
                    ),
                    CompiledTraitKind::Capability { .. } => ("capability", Vec::new()),
                    CompiledTraitKind::Condition { .. } => ("condition", Vec::new()),
                };
                CreatorTrait {
                    id: trait_.id.clone(),
                    label: trait_.label.clone(),
                    description: trait_.description.clone(),
                    kind: kind.into(),
                    initial_state: bits(crate::household::authored_trait_state(trait_)),
                    weights,
                }
            })
            .collect(),
        affinities: pack
            .affinities
            .iter()
            .map(|kind| CreatorPreference {
                id: kind.id.clone(),
                label: crate::household::personality_label(&kind.label),
                description: match kind.reach {
                    AffinityReach::Presence => "Affects mood when these objects are in the room.",
                    AffinityReach::Use => {
                        "Dislike can cause annoyance when somebody else uses these objects."
                    }
                }
                .into(),
            })
            .collect(),
        skills: pack
            .skills
            .iter()
            .map(|skill| CreatorSkill {
                id: skill.id.clone(),
                label: skill.label.clone(),
                description: skill.description.clone(),
                thresholds: (0..=skill.levels)
                    .map(|level| bits(ladder.cumulative(level)))
                    .collect(),
            })
            .collect(),
        hobbies: hobby_tags
            .into_iter()
            .map(|id| CreatorHobby {
                label: crate::household::personality_label(&id),
                id,
            })
            .collect(),
        activities: pack
            .objects
            .iter()
            .flat_map(|object| {
                object.interactions.iter().map(|action| CreatorActivity {
                    object: object.id.clone(),
                    action: action.id.clone(),
                    label: format!("{} ({})", action.label, object.name),
                    tags: action.tags.clone(),
                })
            })
            .collect(),
        personalities: pack
            .personalities
            .iter()
            .map(|personality| CreatorPersonality {
                id: personality.id.clone(),
                label: crate::household::personality_label(&personality.id),
                description: personality.description.clone(),
                values: CreatorPresetValues {
                    cleanliness: bits(personality.cleanliness),
                    chronotype_offset_ticks: personality.chronotype_offset_ticks,
                    drain: personality.drain.map(bits),
                    recovery: personality.satisfaction.map(bits),
                    dispositions: personality
                        .dispositions
                        .iter()
                        .map(|(object, action, weight)| {
                            let definition = &pack.objects[object.0 as usize];
                            DispositionDraft {
                                object: definition.id.clone(),
                                action: definition.interactions[*action as usize].id.clone(),
                                weight: bits(*weight),
                            }
                        })
                        .collect(),
                },
            })
            .collect(),
    }
}
