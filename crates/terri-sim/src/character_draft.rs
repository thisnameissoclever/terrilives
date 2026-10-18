//! Content-aware creator validation. Application and command results use this same gate.
use terri_core::appearance::F32Bits;
use terri_core::character::CharacterDraftV1;
use terri_data::{CompiledTraitKind, ContentPack};
mod application;
mod catalog;
pub use application::{create_character, edit_character, legacy_appearance, snapshot};
pub(crate) use application::{ensure_appearance_components, hash_hobby_changes};
pub use catalog::catalog;

pub use terri_core::character::CharacterResult;

#[derive(bevy_ecs::prelude::Resource, Default, Clone)]
pub struct CharacterResults(pub Vec<CharacterResult>);

pub(crate) fn commit(
    world: &mut bevy_ecs::prelude::World,
    command: &terri_core::command::CharacterCommand,
) {
    use terri_core::command::CharacterCommand;
    let (request, result) = match command {
        CharacterCommand::Create { request, draft } => (*request, create_character(world, draft)),
        CharacterCommand::Edit {
            request,
            sim,
            patch,
        } => (*request, edit_character(world, *sim, patch).map(|_| *sim)),
    };
    if result.is_ok() {
        let mut state = world.resource_mut::<crate::placement::LotEditState>();
        state.revision = state.revision.saturating_add(1);
    }
    world
        .get_resource_or_insert_with(CharacterResults::default)
        .0
        .push(CharacterResult {
            request,
            sim: result.as_ref().ok().copied(),
            reason: result.err().map(|reason| reason as u8),
        });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CharacterRefusal {
    UnknownPerson = 1,
    HouseholdFull = 2,
    BadName = 3,
    InvalidAppearance = 4,
    InvalidBehavior = 5,
    InvalidTraits = 6,
    InvalidAffinities = 7,
    InvalidHobbies = 8,
    InvalidSkills = 9,
    InvalidTies = 10,
    NoWayIn = 11,
    InvalidVersion = 12,
    InvalidStructure = 13,
}

/// Preserve an exact old value outside an editor domain, never admit a new outlier.
fn editable_range(value: F32Bits, low: f32, high: f32, original: Option<F32Bits>) -> bool {
    value.in_range(low, high) || original == Some(value)
}

pub fn validate_character_values(
    pack: &ContentPack,
    draft: &CharacterDraftV1,
    original: Option<&CharacterDraftV1>,
) -> Result<(), CharacterRefusal> {
    draft.validate_structure().map_err(|field| match field {
        "version" => CharacterRefusal::InvalidVersion,
        "name" => CharacterRefusal::BadName,
        field if field.starts_with("appearance") => CharacterRefusal::InvalidAppearance,
        field if field.starts_with("behavior") => CharacterRefusal::InvalidBehavior,
        "traits" => CharacterRefusal::InvalidTraits,
        "affinities" => CharacterRefusal::InvalidAffinities,
        "hobbies" => CharacterRefusal::InvalidHobbies,
        "skills" => CharacterRefusal::InvalidSkills,
        "ties" => CharacterRefusal::InvalidTies,
        _ => CharacterRefusal::InvalidStructure,
    })?;
    if draft.name.trim().chars().count() > pack.tuning.housemate_name_max_chars as usize
        && original.is_none_or(|old| old.name != draft.name)
    {
        return Err(CharacterRefusal::BadName);
    }
    for i in 0..terri_core::NEED_COUNT {
        if !editable_range(
            draft.behavior.drain[i],
            0.5,
            1.5,
            original.map(|old| old.behavior.drain[i]),
        ) && !pack
            .personalities
            .iter()
            .any(|preset| preset.drain[i].to_bits() == draft.behavior.drain[i].0)
            || !editable_range(
                draft.behavior.recovery[i],
                0.5,
                1.5,
                original.map(|old| old.behavior.recovery[i]),
            ) && !pack
                .personalities
                .iter()
                .any(|preset| preset.satisfaction[i].to_bits() == draft.behavior.recovery[i].0)
        {
            return Err(CharacterRefusal::InvalidBehavior);
        }
    }
    let offset = draft.behavior.chronotype_offset_ticks;
    let hour = terri_core::TICKS_PER_SIM_HOUR as i32;
    if (offset < -3 * hour || offset > 3 * hour || offset % (hour / 2) != 0)
        && original.is_none_or(|old| old.behavior.chronotype_offset_ticks != offset)
        && !pack
            .personalities
            .iter()
            .any(|preset| preset.chronotype_offset_ticks == offset)
    {
        return Err(CharacterRefusal::InvalidBehavior);
    }
    for route in &draft.behavior.dispositions {
        let known = pack
            .objects
            .iter()
            .find(|object| object.id == route.object)
            .is_some_and(|object| {
                object
                    .interactions
                    .iter()
                    .any(|action| action.id == route.action)
            });
        let old = original
            .and_then(|old| {
                old.behavior
                    .dispositions
                    .iter()
                    .find(|r| r.object == route.object && r.action == route.action)
            })
            .map(|r| r.weight);
        let authored = pack
            .personalities
            .iter()
            .flat_map(|preset| &preset.dispositions)
            .any(|(object, action, weight)| {
                let definition = &pack.objects[object.0 as usize];
                definition.id == route.object
                    && definition.interactions[*action as usize].id == route.action
                    && weight.to_bits() == route.weight.0
            });
        if !known || !editable_range(route.weight, 0.0, 2.0, old) && !authored {
            return Err(CharacterRefusal::InvalidBehavior);
        }
    }
    if draft.traits.len() > pack.tuning.housemate_max_traits as usize
        && !draft.traits.iter().all(|trait_| {
            original.is_some_and(|old| old.traits.iter().any(|old| old.id == trait_.id))
        })
    {
        return Err(CharacterRefusal::InvalidTraits);
    }
    for worn in &draft.traits {
        let definition = pack
            .traits
            .iter()
            .find(|trait_| trait_.id == worn.id)
            .ok_or(CharacterRefusal::InvalidTraits)?;
        if !worn.state.in_range(0.0, 1.0)
            || matches!(definition.kind, CompiledTraitKind::Disposition { .. })
                && worn.state.value() != 0.0
        {
            return Err(CharacterRefusal::InvalidTraits);
        }
    }
    if draft.affinities.len() != pack.affinities.len()
        || draft
            .affinities
            .iter()
            .any(|row| !pack.affinities.iter().any(|kind| kind.id == row.id))
    {
        return Err(CharacterRefusal::InvalidAffinities);
    }
    let tags: std::collections::BTreeSet<&str> = pack
        .objects
        .iter()
        .flat_map(|object| &object.interactions)
        .chain(pack.social.iter())
        .flat_map(|action| action.tags.iter().map(String::as_str))
        .collect();
    if draft.hobbies.iter().any(|tag| {
        !tags.contains(tag.as_str()) && original.is_none_or(|old| !old.hobbies.contains(tag))
    }) {
        return Err(CharacterRefusal::InvalidHobbies);
    }
    let ladder = crate::skills::Ladder::from_tuning(&pack.tuning);
    for skill in &draft.skills {
        let definition = pack
            .skills
            .iter()
            .find(|s| s.id == skill.id)
            .ok_or(CharacterRefusal::InvalidSkills)?;
        let unchanged = original.is_some_and(|old| {
            old.skills
                .iter()
                .any(|s| s.id == skill.id && s.practice == skill.practice)
        });
        if !unchanged
            && !(0..=definition.levels)
                .any(|level| ladder.cumulative(level).to_bits() == skill.practice.0)
        {
            return Err(CharacterRefusal::InvalidSkills);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::appearance::F32Bits;
    use terri_core::character::{AffinityDraft, CharacterDraftV1, DispositionDraft, SkillDraft};

    fn draft() -> CharacterDraftV1 {
        let mut draft = CharacterDraftV1::neutral("Mira");
        draft.affinities = terri_data::pack()
            .affinities
            .iter()
            .map(|kind| AffinityDraft {
                id: kind.id.clone(),
                value: F32Bits::new(0.0).unwrap(),
            })
            .collect();
        draft
    }

    #[test]
    fn creator_domains_preserve_unchanged_custom_values_and_reject_new_outliers() {
        let pack = terri_data::pack();
        let mut before = draft();
        before.behavior.drain[2] = F32Bits::new(0.123_456_7).unwrap();
        let mut changed = before.clone();
        changed.name = "New name".into();
        assert!(validate_character_values(pack, &changed, Some(&before)).is_ok());
        assert!(validate_character_values(pack, &changed, None).is_err());
        changed.behavior.drain[2] = F32Bits::new(0.234_567_8).unwrap();
        assert!(validate_character_values(pack, &changed, Some(&before)).is_err());
        assert_eq!(before.behavior.drain[2].value(), 0.123_456_7);
    }

    #[test]
    fn creator_checks_content_identifiers_and_explicit_skill_levels() {
        let pack = terri_data::pack();
        let mut input = draft();
        assert!(validate_character_values(pack, &input, None).is_ok());
        input.behavior.dispositions.push(DispositionDraft {
            object: "missing".into(),
            action: "read".into(),
            weight: F32Bits::new(1.0).unwrap(),
        });
        assert!(validate_character_values(pack, &input, None).is_err());
        input.behavior.dispositions.clear();
        input.skills.push(SkillDraft {
            id: "reading".into(),
            practice: F32Bits::new(0.013_579).unwrap(),
        });
        assert!(validate_character_values(pack, &input, None).is_err());
        let original = input.clone();
        assert!(validate_character_values(pack, &input, Some(&original)).is_ok());
        input.skills[0].practice = F32Bits::new(0.0).unwrap();
        assert!(validate_character_values(pack, &input, None).is_ok());
        input.affinities.pop();
        assert!(validate_character_values(pack, &input, None).is_err());
    }

    #[test]
    fn legacy_trait_counts_and_authoritative_preset_values_remain_editable() {
        let mut pack = terri_data::pack().clone();
        let mut input = draft();
        input.hobbies = vec!["retired_tag".into()];
        input.traits = pack
            .traits
            .iter()
            .take(2)
            .map(|kind| terri_core::character::TraitDraft {
                id: kind.id.clone(),
                state: F32Bits::new(crate::household::authored_trait_state(kind)).unwrap(),
            })
            .collect();
        pack.tuning.housemate_max_traits = 1;
        assert!(validate_character_values(&pack, &input, Some(&input)).is_ok());
        assert!(validate_character_values(&pack, &input, None).is_err());
        input.hobbies.clear();
        input.traits.clear();
        pack.personalities[0].drain[0] = 0.4;
        pack.personalities[0].satisfaction[0] = 1.7;
        pack.personalities[0].chronotype_offset_ticks = 210;
        input.behavior.drain[0] = F32Bits::new(0.4).unwrap();
        input.behavior.recovery[0] = F32Bits::new(1.7).unwrap();
        input.behavior.chronotype_offset_ticks = 210;
        assert!(validate_character_values(&pack, &input, None).is_ok());
        input.behavior.drain[0] = F32Bits::new(0.3).unwrap();
        assert!(validate_character_values(&pack, &input, None).is_err());
    }
}
