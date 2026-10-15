use super::{CharacterCommand, SimCommand};
use crate::character::{CharacterDraftV1, CharacterPatchV1};

#[test]
fn creator_payload_does_not_inflate_every_queued_command() {
    let command_bytes = std::mem::size_of::<SimCommand>();
    eprintln!(
        "SimCommand bytes: {command_bytes}; CharacterCommand bytes: {}",
        std::mem::size_of::<CharacterCommand>()
    );
    assert!(
        command_bytes <= 128,
        "Selections and other small commands must not carry an inline creator payload: {command_bytes} bytes"
    );
}

#[test]
fn creator_commands_keep_code_thirty_and_the_unboxed_payload_bytes() {
    let mut draft = CharacterDraftV1::neutral("Mira");
    draft.pronouns = "they/them".into();
    draft.appearance.body.height = 87;
    draft.behavior.shyness = 73;
    draft.hobbies.push("cooking".into());
    draft.ties.push((300, None));
    let patch = CharacterPatchV1 {
        version: 1,
        name: Some(draft.name.clone()),
        pronouns: Some(draft.pronouns.clone()),
        appearance: Some(draft.appearance.clone()),
        behavior: Some(draft.behavior.clone()),
        traits: Some(draft.traits.clone()),
        affinities: Some(draft.affinities.clone()),
        hobbies: Some(draft.hobbies.clone()),
        skills: Some(draft.skills.clone()),
        ties: Some(draft.ties.clone()),
    };
    for character in [
        CharacterCommand::Create {
            request: 300,
            draft,
        },
        CharacterCommand::Edit {
            request: 301,
            sim: 129,
            patch,
        },
    ] {
        character.validate_structure().unwrap();
        let mut expected = vec![30];
        expected.extend(postcard::to_allocvec(&character).unwrap());
        let command = SimCommand::Character(character.clone().into());
        let actual = postcard::to_allocvec(&command).unwrap();
        assert_eq!(actual, expected);
        assert_eq!(
            postcard::from_bytes::<SimCommand>(&expected).unwrap(),
            command
        );
        let payload: CharacterCommand = postcard::from_bytes(&actual[1..]).unwrap();
        assert_eq!(payload, character);
        assert_eq!(
            crate::character_hash::command(&payload),
            crate::character_hash::command(&character)
        );
        for cut in 0..expected.len() {
            assert!(postcard::from_bytes::<SimCommand>(&expected[..cut]).is_err());
        }
    }
}
