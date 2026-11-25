use super::*;
use terri_core::{save_v17::SavedOrderActor, save_v33::SavedHobbyMood};

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
fn v31_payload_loads_with_empty_hobby_mood_and_rejects_a_hobby_tail() {
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

#[test]
fn private_v32_keeps_accumulated_hobby_mood_and_continues_in_v33() {
    let mut source = SimHandle::new(12, 12);
    let aquarium = source
        .sim
        .world()
        .resource::<Content>()
        .0
        .find("reference_shelf")
        .unwrap();
    let object = source.sim.spawn_object(Position { x: 4., y: 4. }, aquarium);
    let actor = source.sim.spawn_agent(Position { x: 3., y: 4. }, 50.);
    source.sim.world_mut().entity_mut(actor).insert((
        terri_core::Needs::all_at(50.),
        terri_core::Hobbies(vec!["aquarium".into()]),
    ));
    source
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: object.index_u32(),
            interaction: 0,
        });
    source.flush_commands();
    let snapshot = (0..100)
        .find_map(|_| {
            source.tick();
            let snapshot = decode_current(&source.save_bytes());
            (snapshot.hobby_mood.len() == 1 && snapshot.hobby_mood[0].minutes == 2)
                .then_some(snapshot)
        })
        .expect("watching the fish awarded two minutes of hobby mood");
    let mut private_v32 = SAVE_MAGIC.to_vec();
    private_v32.extend(32u16.to_le_bytes());
    private_v32.extend(postcard::to_allocvec(&snapshot.previous).unwrap());
    private_v32.extend(postcard::to_allocvec(&snapshot.hobby_mood).unwrap());

    let mut restored = SimHandle::new(12, 12);
    assert!(restored.load_bytes(&private_v32));
    assert_eq!(restored.save_bytes(), source.save_bytes());
    assert_eq!(restored.world_hash(), source.world_hash());
    restored.tick();
    assert_eq!(
        decode_current(&restored.save_bytes()).hobby_mood[0].minutes,
        3
    );
    source.tick();
    assert_eq!(restored.save_bytes(), source.save_bytes());
}

#[test]
fn v32_refuses_truncated_trailing_or_invalid_hobby_rows_without_loading_the_prefix() {
    let mut live = SimHandle::new(12, 12);
    let original = live.save_bytes();
    let source = SimHandle::from_lot();
    let snapshot = decode_current(&source.save_bytes());
    let mut public_v32 = SAVE_MAGIC.to_vec();
    public_v32.extend(32u16.to_le_bytes());
    public_v32.extend(postcard::to_allocvec(&snapshot.previous).unwrap());
    let invalid_row = SavedHobbyMood {
        actor: SavedOrderActor::Sim(0),
        minutes: 0,
    };
    for tail in [
        vec![1],
        vec![0, 0],
        postcard::to_allocvec(&vec![invalid_row]).unwrap(),
    ] {
        let mut invalid = public_v32.clone();
        invalid.extend(&tail);
        assert!(!live.load_bytes(&invalid), "rejected hobby bytes {tail:?}");
        assert_eq!(live.save_bytes(), original);
    }
    assert!(live.load_bytes(&public_v32));
    assert_eq!(live.save_bytes(), source.save_bytes());
}
