use super::*;
use terri_core::{save_v17::SavedOrderActor, save_v32::SavedHobbyMood};

#[test]
fn malformed_hobby_mood_rows_leave_the_running_game_unchanged() {
    let mut live = SimHandle::from_lot();
    let original = live.save_bytes();
    let hash = live.world_hash();
    let snapshot = decode_current(&original);
    let inactive = SavedHobbyMood {
        actor: SavedOrderActor::Sim(0),
        minutes: 1,
    };
    let cases = [
        vec![inactive],
        vec![SavedHobbyMood {
            minutes: 0,
            ..inactive
        }],
        vec![SavedHobbyMood {
            minutes: u16::MAX,
            ..inactive
        }],
        vec![SavedHobbyMood {
            actor: SavedOrderActor::Sim(u32::MAX),
            ..inactive
        }],
        vec![inactive, inactive],
    ];
    for rows in cases {
        let mut invalid = snapshot.clone();
        invalid.hobby_mood = rows;
        let mut bytes = SAVE_MAGIC.to_vec();
        bytes.extend(SAVE_SCHEMA_VERSION.to_le_bytes());
        bytes.extend(postcard::to_allocvec(&invalid).unwrap());
        assert!(!live.load_bytes(&bytes), "{:?}", invalid.hobby_mood);
        assert_eq!(live.save_bytes(), original);
        assert_eq!(live.world_hash(), hash);
    }
}

#[test]
fn v31_payload_loads_with_empty_hobby_mood_and_rejects_a_v32_tail() {
    let mut live = SimHandle::from_lot();
    let original = live.save_bytes();
    let current = decode_current(&original);
    let mut legacy = SAVE_MAGIC.to_vec();
    legacy.extend(31u16.to_le_bytes());
    legacy.extend(postcard::to_allocvec(&current.previous).unwrap());
    assert!(live.load_bytes(&legacy));
    assert!(decode_current(&live.save_bytes()).hobby_mood.is_empty());
    assert_eq!(live.save_bytes(), original);

    legacy.push(0);
    assert!(!live.load_bytes(&legacy));
    assert_eq!(live.save_bytes(), original);
}
