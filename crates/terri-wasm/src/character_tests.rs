use super::*;
use terri_core::{
    character::{CharacterDraftV1, CharacterPatchV1, CharacterResult},
    command::CharacterCommand,
};

#[test]
fn creator_boundary_round_trips_exact_values_and_correlated_results() {
    let mut handle = SimHandle::from_lot();
    let original: Option<CharacterDraftV1> =
        postcard::from_bytes(&handle.character_snapshot(0)).unwrap();
    let original = original.unwrap();
    let mut appearance = original.appearance.clone();
    appearance.body.height = 81;
    let command = SimCommand::Character(Box::new(CharacterCommand::Edit {
        request: 7,
        sim: 0,
        patch: CharacterPatchV1 {
            name: Some("Ann".into()),
            appearance: Some(appearance.clone()),
            ..Default::default()
        },
    }));
    let bytes = postcard::to_allocvec(&command).unwrap();
    assert_eq!(&bytes[..4], &[30, 1, 7, 0]);
    assert!(handle.enqueue_command(&bytes));
    handle.sim.flush_commands();
    let result: Vec<CharacterResult> = postcard::from_bytes(&handle.character_results()).unwrap();
    assert_eq!(
        result,
        vec![CharacterResult {
            request: 7,
            sim: Some(0),
            reason: None
        }]
    );
    let changed: Option<CharacterDraftV1> =
        postcard::from_bytes(&handle.character_snapshot(0)).unwrap();
    let mut expected = original;
    expected.name = "Ann".into();
    expected.appearance = appearance;
    assert_eq!(changed, Some(expected));
    let saved = handle.save_bytes();
    assert_eq!(
        u16::from_le_bytes([saved[SAVE_MAGIC.len()], saved[SAVE_MAGIC.len() + 1]]),
        22
    );
    assert!(handle.load_bytes(&saved));
    assert_eq!(handle.save_bytes(), saved);
}

#[test]
fn creator_boundary_rejects_invalid_float_and_unknown_appearance_before_queueing() {
    let mut handle = SimHandle::from_lot();
    let original: Option<CharacterDraftV1> =
        postcard::from_bytes(&handle.character_snapshot(0)).unwrap();
    let original = original.unwrap();
    let before = handle.save_bytes();
    let mut invalid = original.behavior.clone();
    invalid.drain[0] = terri_core::appearance::F32Bits(f32::NAN.to_bits());
    let command = SimCommand::Character(Box::new(CharacterCommand::Edit {
        request: 1,
        sim: 0,
        patch: CharacterPatchV1 {
            behavior: Some(invalid),
            ..Default::default()
        },
    }));
    assert!(!handle.enqueue_command(&postcard::to_allocvec(&command).unwrap()));
    let mut appearance = original.appearance;
    appearance.hairstyle = "missing".into();
    let command = SimCommand::Character(Box::new(CharacterCommand::Edit {
        request: 2,
        sim: 0,
        patch: CharacterPatchV1 {
            appearance: Some(appearance),
            ..Default::default()
        },
    }));
    assert!(!handle.enqueue_command(&postcard::to_allocvec(&command).unwrap()));
    assert_eq!(handle.save_bytes(), before);
}

#[test]
fn creator_catalog_and_name_patch_wire_contract_are_explicit() {
    let handle = SimHandle::from_lot();
    let catalog: terri_core::character_catalog::CharacterCatalog =
        postcard::from_bytes(&handle.character_catalog()).unwrap();
    assert_eq!(catalog.version, 2);
    assert_eq!(
        catalog
            .self_preservation_bands
            .iter()
            .map(|b| b.weight as u32)
            .sum::<u32>(),
        100
    );
    assert!(!catalog.activities.is_empty());
    assert!(!catalog.skills.is_empty());
    let command = SimCommand::Character(Box::new(CharacterCommand::Edit {
        request: 7,
        sim: 3,
        patch: CharacterPatchV1 {
            name: Some("Ann".into()),
            ..Default::default()
        },
    }));
    assert_eq!(
        postcard::to_allocvec(&command).unwrap(),
        vec![30, 1, 7, 3, 1, 1, 3, 65, 110, 110, 0, 0, 0, 0, 0, 0, 0, 0]
    );
}

#[test]
fn creator_queue_loads_pre_box_save_and_reproduces_its_completed_bytes() {
    let queued = include_bytes!("../tests/fixtures/command-memory/queued-edit-pre-box-v9.sav");
    let completed =
        include_bytes!("../tests/fixtures/command-memory/completed-edit-pre-box-v9.sav");
    let mut handle = SimHandle::from_lot();
    assert!(handle.load_bytes(queued));
    assert_legacy_character_projection(&handle, queued);
    assert_eq!(
        handle
            .sim
            .world()
            .resource::<terri_core::CommandQueue>()
            .as_slice(),
        &[
            SimCommand::Select(None),
            SimCommand::Character(Box::new(CharacterCommand::Edit {
                request: 7,
                sim: 0,
                patch: CharacterPatchV1 {
                    name: Some("Ann".into()),
                    ..Default::default()
                },
            })),
            SimCommand::Select(None),
        ],
    );
    let rng = handle.sim.world().resource::<terri_core::SimRng>().clone();
    handle.flush_commands();
    assert_legacy_character_projection(&handle, completed);
    assert_eq!(handle.sim.world().resource::<terri_core::SimRng>(), &rng);
    let changed: Option<CharacterDraftV1> =
        postcard::from_bytes(&handle.character_snapshot(0)).unwrap();
    assert_eq!(changed.unwrap().name, "Ann");
}

/// A historical fixture re-expressed under today's content: the action
/// manifest names today's social vocabulary (Fight joined Chat in issue 248)
/// and the world carries today's content digest. Saving rebuilds the
/// manifest from the pack and a restore rewrites the digest; nothing else
/// about the fixture may change, so every other byte must still match.
fn with_current_content(
    handle: &SimHandle,
    mut legacy: terri_core::save_v6::SaveSnapshotV6,
) -> Vec<u8> {
    let pack = handle.sim.world().resource::<terri_sim::Content>().0;
    legacy.actions.social = pack.social.iter().map(|a| a.id.clone()).collect();
    legacy.legacy.world.content_fingerprint = handle
        .sim
        .save_snapshot_v6()
        .legacy
        .world
        .content_fingerprint;
    postcard::to_allocvec(&legacy).unwrap()
}

/// The schema-nine fixture bytes as today's content would have written them.
fn legacy_character_bytes_under_current_content(handle: &SimHandle, bytes: &[u8]) -> Vec<u8> {
    let (fixture, rest) = postcard::take_from_bytes::<
        terri_core::save_v10::LegacyCharacterSnapshotV9,
    >(&bytes[SAVE_HEADER_BYTES..])
    .unwrap();
    assert!(rest.is_empty());
    let legacy = with_current_content(handle, fixture.legacy);
    let (reread, _) =
        postcard::take_from_bytes::<terri_core::save_v6::SaveSnapshotV6>(&legacy).unwrap();
    postcard::to_allocvec(&terri_core::save_v10::LegacyCharacterSnapshotV9 {
        legacy: reread,
        characters: fixture.characters,
        command_order: fixture.command_order,
    })
    .unwrap()
}

fn assert_legacy_character_projection(handle: &SimHandle, bytes: &[u8]) {
    let saved = handle.sim.save_snapshot_v10();
    let legacy = terri_core::save_v10::LegacyCharacterSnapshotV9 {
        legacy: saved.legacy,
        characters: saved.characters,
        command_order: saved.command_order,
    };
    assert_eq!(
        postcard::to_allocvec(&legacy).unwrap(),
        legacy_character_bytes_under_current_content(handle, bytes)
    );
}

#[test]
fn authentic_local_v9_saves_migrate_to_combined_v10_with_stable_continuation() {
    for bytes in [
        include_bytes!("../tests/fixtures/schema-v9/local-character-0.sav").as_slice(),
        include_bytes!("../tests/fixtures/schema-v9/local-character-400.sav").as_slice(),
        include_bytes!("../tests/fixtures/schema-v9/local-character-1200.sav").as_slice(),
    ] {
        let mut loaded = SimHandle::from_lot();
        assert!(loaded.load_bytes(bytes));
        assert_legacy_character_projection(&loaded, bytes);
        let saved = loaded.save_bytes();
        let _ = decode_current(&saved);
        let mut resumed = SimHandle::from_lot();
        assert!(resumed.load_bytes(&saved));
        for _ in 0..300 {
            loaded.tick();
            resumed.tick();
        }
        assert_eq!(loaded.save_bytes(), resumed.save_bytes());
        assert_eq!(loaded.appearance_hash(), resumed.appearance_hash());
    }
}

#[test]
fn both_v9_envelopes_refuse_trailing_truncated_and_invalid_state_transactionally() {
    let source = SimHandle::from_lot();
    let mut social = SAVE_MAGIC.to_vec();
    social.extend(9u16.to_le_bytes());
    social.extend(postcard::to_allocvec(&source.sim.save_snapshot_v9()).unwrap());
    let local = include_bytes!("../tests/fixtures/schema-v9/local-character-0.sav").to_vec();
    for bytes in [social, local] {
        let mut live = SimHandle::from_lot();
        let before = live.save_bytes();
        let mut trailing = bytes.clone();
        trailing.push(0);
        assert!(!live.load_bytes(&trailing));
        assert!(!live.load_bytes(&bytes[..bytes.len() - 1]));
        assert_eq!(live.save_bytes(), before);
    }
    let mut live = SimHandle::from_lot();
    let before = live.save_bytes();
    let mut invalid = source.sim.save_snapshot_v9();
    invalid.social.rendezvous.push((u32::MAX, 0));
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend(9u16.to_le_bytes());
    bytes.extend(postcard::to_allocvec(&invalid).unwrap());
    assert!(!live.load_bytes(&bytes));
    assert_eq!(live.save_bytes(), before);
    let mut invalid: terri_core::save_v10::LegacyCharacterSnapshotV9 = postcard::from_bytes(
        &include_bytes!("../tests/fixtures/schema-v9/local-character-0.sav")[SAVE_HEADER_BYTES..],
    )
    .unwrap();
    invalid.characters[0].appearance.body.height = 101;
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend(9u16.to_le_bytes());
    bytes.extend(postcard::to_allocvec(&invalid).unwrap());
    assert!(!live.load_bytes(&bytes));
    assert_eq!(live.save_bytes(), before);
}

#[test]
fn ambiguous_valid_v9_candidates_are_refused_without_adoption() {
    let mut live = SimHandle::from_lot();
    let before = live.save_bytes();
    let social = live.sim.save_snapshot_v9();
    let combined = live.sim.save_snapshot_v10();
    let character = terri_core::save_v10::LegacyCharacterSnapshotV9 {
        legacy: combined.legacy,
        characters: combined.characters,
        command_order: combined.command_order,
    };
    assert!(live
        .sim
        .load_historical_v9_candidates(Some(social), Some(character))
        .is_err());
    assert_eq!(live.save_bytes(), before);
}

#[test]
fn authentic_main_v9_social_saves_migrate_without_losing_episode_state() {
    for bytes in [
        include_bytes!("../tests/fixtures/schema-v9/main-social-0.sav").as_slice(),
        include_bytes!("../tests/fixtures/schema-v9/main-social-400.sav").as_slice(),
        include_bytes!("../tests/fixtures/schema-v9/main-social-1200.sav").as_slice(),
        include_bytes!("../tests/fixtures/schema-v9/main-social-active.sav").as_slice(),
    ] {
        let mut loaded = SimHandle::from_lot();
        assert!(loaded.load_bytes(bytes));
        let (fixture, rest) =
            postcard::take_from_bytes::<terri_core::SaveSnapshotV9>(&bytes[SAVE_HEADER_BYTES..])
                .unwrap();
        assert!(rest.is_empty());
        let expected = terri_core::SaveSnapshotV9 {
            legacy: postcard::from_bytes(&with_current_content(&loaded, fixture.legacy)).unwrap(),
            social: fixture.social,
        };
        assert_eq!(
            postcard::to_allocvec(&loaded.sim.save_snapshot_v9()).unwrap(),
            postcard::to_allocvec(&expected).unwrap()
        );
        let current = loaded.save_bytes();
        let mut resumed = SimHandle::from_lot();
        assert!(resumed.load_bytes(&current));
        for _ in 0..300 {
            loaded.tick();
            resumed.tick();
        }
        assert_eq!(loaded.save_bytes(), resumed.save_bytes());
    }
}
