//! Transactional appearance envelope and creator command ordering.
use super::SaveError;
use crate::{character_draft, Sim};
use terri_core::{
    character::CharacterPronouns, save_v10::SavedCharacterAppearance, Agent, CommandQueue,
    SaveSnapshotV10, SimCommand, SimId,
};

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV10 {
    SaveSnapshotV10 {
        legacy: super::v6::capture(sim),
        social: super::social::capture(sim.world()),
        characters: characters(sim),
        command_order: sim
            .world()
            .resource::<CommandQueue>()
            .as_slice()
            .iter()
            .filter(|command| {
                !matches!(command, SimCommand::ConfirmedOrder { .. })
                    && !super::v18::left_out_of_records(command)
            })
            .map(|command| match command {
                SimCommand::Character(command) => Some(command.as_ref().clone()),
                _ => None,
            })
            .collect(),
    }
}

fn characters(sim: &Sim) -> Vec<SavedCharacterAppearance> {
    let world = sim.world();
    let mut characters = world
        .try_query::<(terri_core::Entity, &Agent, &SimId)>()
        .map_or_else(Vec::new, |mut query| {
            query
                .iter(world)
                .map(|(entity, _, id)| SavedCharacterAppearance {
                    sim: id.0,
                    appearance: world
                        .get::<terri_core::appearance::CharacterAppearanceV1>(entity)
                        .cloned()
                        .unwrap_or_else(|| character_draft::legacy_appearance(id.0)),
                    pronouns: world
                        .get::<CharacterPronouns>(entity)
                        .map_or_else(String::new, |value| value.0.clone()),
                })
                .collect()
        });
    characters.sort_by_key(|row| row.sim);
    characters
}

pub(crate) fn restore(
    snapshot: SaveSnapshotV10,
    content: &'static terri_data::ContentPack,
    portals: super::Carried,
) -> Result<Sim, SaveError> {
    validate_characters(&snapshot.characters, &snapshot.command_order, content)?;
    let candidate =
        super::v6::restore_with_social(snapshot.legacy, snapshot.social, content, portals)?;
    restore_characters(candidate, snapshot.characters, snapshot.command_order)
}

fn validate_characters(
    characters: &[SavedCharacterAppearance],
    command_order: &[Option<terri_core::command::CharacterCommand>],
    content: &terri_data::ContentPack,
) -> Result<(), SaveError> {
    if characters.len() > super::MAX_ENTITIES
        || super::exceeds_limit(
            command_order.len(),
            content.tuning.max_queued_commands as usize,
        )
        || characters.windows(2).any(|rows| rows[0].sim >= rows[1].sim)
    {
        return Err(SaveError::InvalidValue);
    }
    for row in characters {
        row.appearance
            .validate()
            .map_err(|_| SaveError::InvalidValue)?;
        if row.pronouns.chars().count() > 64 {
            return Err(SaveError::InvalidValue);
        }
    }
    for command in command_order.iter().flatten() {
        command
            .validate_structure()
            .map_err(|_| SaveError::InvalidValue)?;
    }
    Ok(())
}

fn restore_characters(
    mut candidate: Sim,
    characters: Vec<SavedCharacterAppearance>,
    command_order: Vec<Option<terri_core::command::CharacterCommand>>,
) -> Result<Sim, SaveError> {
    if crate::household::household_size(candidate.world()) != characters.len() {
        return Err(SaveError::InvalidValue);
    }
    for row in characters {
        let entity = crate::edit::living_entity(candidate.world(), row.sim)
            .ok_or(SaveError::InvalidValue)?;
        candidate
            .world_mut()
            .entity_mut(entity)
            .insert((row.appearance, CharacterPronouns(row.pronouns)));
    }
    let ordinary: Vec<_> = candidate
        .world_mut()
        .resource_mut::<CommandQueue>()
        .drain()
        .collect();
    if command_order.iter().filter(|row| row.is_none()).count() != ordinary.len() {
        return Err(SaveError::InvalidValue);
    }
    let mut ordinary = ordinary.into_iter();
    for row in command_order {
        let command = match row {
            Some(command) => SimCommand::Character(Box::new(command)),
            None => ordinary.next().ok_or(SaveError::InvalidValue)?,
        };
        candidate
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(command);
    }
    Ok(candidate)
}

pub(crate) fn restore_legacy_character_v9(
    snapshot: terri_core::save_v10::LegacyCharacterSnapshotV9,
    content: &'static terri_data::ContentPack,
    portals: super::Carried,
) -> Result<Sim, SaveError> {
    validate_characters(&snapshot.characters, &snapshot.command_order, content)?;
    let candidate = super::v6::restore(snapshot.legacy, content, portals)?;
    restore_characters(candidate, snapshot.characters, snapshot.command_order)
}

/// Cosmetic evidence is separate from the autonomous-choice state hash.
pub(crate) fn appearance_hash(sim: &Sim) -> u64 {
    let mut hash = terri_core::FnvHasher::default();
    for row in characters(sim) {
        hash.write_u64(u64::from(row.sim));
        terri_core::character_hash::appearance(&mut hash, &row.appearance);
        hash.write_u64(row.pronouns.len() as u64);
        hash.write_bytes(row.pronouns.as_bytes());
    }
    hash.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::appearance::CharacterAppearanceV1;
    use terri_core::{character::CharacterPatchV1, command::CharacterCommand};

    #[test]
    fn appearance_and_interleaved_queued_edits_survive_exact_round_trip() {
        let current = Sim::new_from_shipped_lot();
        let mut sim = restore(
            current.save_snapshot_v10(),
            terri_data::pack(),
            crate::save::Carried::default(),
        )
        .unwrap();
        let mut appearance = CharacterAppearanceV1::default();
        appearance.body.height = 87;
        appearance.hairstyle = "wave".into();
        let patch = CharacterPatchV1 {
            appearance: Some(appearance),
            pronouns: Some("they/them".into()),
            ..Default::default()
        };
        character_draft::edit_character(sim.world_mut(), 0, &patch).unwrap();
        let edit = CharacterCommand::Edit {
            request: 7,
            sim: 0,
            patch: CharacterPatchV1 {
                name: Some("Renamed".into()),
                ..Default::default()
            },
        };
        let mut draft = terri_core::character::CharacterDraftV1::neutral("Mira");
        draft.affinities = terri_data::pack()
            .affinities
            .iter()
            .map(|kind| terri_core::character::AffinityDraft {
                id: kind.id.clone(),
                value: terri_core::appearance::F32Bits::new(0.125).unwrap(),
            })
            .collect();
        character_draft::validate_character_values(terri_data::pack(), &draft, None).unwrap();
        let create = CharacterCommand::Create { request: 8, draft };
        let commands = vec![
            SimCommand::Select(None),
            SimCommand::Character(Box::new(edit.clone())),
            SimCommand::Select(None),
            SimCommand::Character(Box::new(create.clone())),
            SimCommand::Select(None),
        ];
        for command in &commands {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(command.clone());
        }
        let before = capture(&sim);
        let unboxed_order: Vec<Option<CharacterCommand>> =
            vec![None, Some(edit), None, Some(create), None];
        assert_eq!(before.command_order, unboxed_order);
        let hash = sim.world_hash();
        let art = appearance_hash(&sim);
        let rng = sim.world().resource::<terri_core::SimRng>().clone();
        let mut restored = restore(
            before.clone(),
            terri_data::pack(),
            crate::save::Carried::default(),
        )
        .unwrap();
        assert_eq!(capture(&restored), before);
        assert_eq!(restored.world_hash(), hash);
        assert_eq!(appearance_hash(&restored), art);
        assert_eq!(restored.world().resource::<terri_core::SimRng>(), &rng);
        assert_eq!(
            restored.world().resource::<CommandQueue>().as_slice(),
            commands
        );
        sim.flush_commands();
        restored.flush_commands();
        assert_eq!(capture(&restored), capture(&sim));
        assert_eq!(restored.world_hash(), sim.world_hash());
        assert_eq!(
            restored.world().resource::<terri_core::SimRng>(),
            sim.world().resource::<terri_core::SimRng>()
        );
        assert_eq!(crate::household::household_size(sim.world()), 4);
    }

    #[test]
    fn malformed_appearance_and_missing_people_are_refused() {
        let sim = Sim::new_from_shipped_lot();
        let mut bad = capture(&sim);
        bad.characters[0].appearance.body.height = 101;
        assert!(restore(bad, terri_data::pack(), crate::save::Carried::default()).is_err());
        let mut bad = capture(&sim);
        bad.characters.pop();
        assert!(restore(bad, terri_data::pack(), crate::save::Carried::default()).is_err());
        let mut bad = capture(&sim);
        bad.command_order.push(None);
        assert!(restore(bad, terri_data::pack(), crate::save::Carried::default()).is_err());
    }

    #[test]
    fn historical_appearance_mapping_is_deterministic_without_rng_changes() {
        let sim = Sim::new_from_shipped_lot();
        let before = sim.world().resource::<terri_core::SimRng>().clone();
        let rows = capture(&sim).characters;
        assert_eq!(
            rows.iter()
                .find(|row| row.sim == 0)
                .unwrap()
                .appearance
                .colors
                .shirt,
            [62, 117, 164]
        );
        assert_eq!(
            rows.iter()
                .find(|row| row.sim == 2)
                .unwrap()
                .appearance
                .colors
                .shirt,
            [168, 71, 62]
        );
        assert_eq!(&before, sim.world().resource::<terri_core::SimRng>());
    }
}
