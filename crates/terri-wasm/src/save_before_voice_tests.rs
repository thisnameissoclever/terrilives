use super::*;

fn source_bytes() -> Vec<u8> {
    let hex: String = include_str!("../tests/fixtures/pre-voice-157.hex")
        .split_whitespace()
        .collect();
    hex.as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}

#[test]
fn actual_pre_voice_save_loads_all_people_and_resaves_with_replay_preserved() {
    let bytes = source_bytes();
    let mut handle = SimHandle::from_lot();
    assert!(
        handle.load_bytes(&bytes),
        "the screenshot's old save must load"
    );
    let restored = handle.sim.save_snapshot_v5();
    assert_eq!(restored.world.tick, 157);
    assert_eq!(restored.world.entities.len(), 37);
    let people: Vec<_> = restored.world.entities.iter().filter(|e| e.agent).collect();
    assert_eq!(people.len(), 3);
    assert!(people.iter().all(|e| e.conversation_voice.is_none()));
    let current = handle.save_bytes();
    assert_eq!(&current[8..10], &[5, 0]);
    let mut resumed = SimHandle::from_lot();
    assert!(resumed.load_bytes(&current));
    assert_eq!(resumed.sim.save_snapshot_v5(), restored);
    for _ in 0..300 {
        handle.tick();
        resumed.tick();
    }
    assert_eq!(
        handle.sim.save_snapshot_v5(),
        resumed.sim.save_snapshot_v5()
    );
}

#[test]
fn pre_voice_wire_shape_is_exactly_the_source_shape_with_only_the_missing_empty_tail() {
    let bytes = source_bytes();
    let mut payload = bytes[SAVE_HEADER_BYTES..].to_vec();
    payload.push(0);
    let (old, rest) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV1BeforeVoice>(&payload).unwrap();
    assert!(rest.is_empty());
    assert_eq!(postcard::to_allocvec(&old).unwrap(), payload);
    let upgraded = old.clone().into_current();
    macro_rules! preserved {
        ($source:expr, $result:expr, $($field:ident),+ $(,)?) => {
            $(assert_eq!($source.$field, $result.$field, stringify!($field));)+
        };
    }
    preserved!(
        old,
        upgraded,
        content_fingerprint,
        tick,
        rng,
        funds,
        issued_sim_ids,
        grid_width,
        grid_height,
        blocked_tiles,
        queued_commands,
        sleep_pressure
    );
    assert_eq!(upgraded.entities.len(), 37);
    for (source, result) in old.entities.iter().zip(&upgraded.entities) {
        preserved!(
            source,
            result,
            index,
            position,
            agent,
            smart_object,
            reserved,
            path,
            target,
            eating,
            restless,
            blocked,
            wander_pause_ticks,
            selected,
            intents,
            needs,
            habituation,
            sim_id,
            sim_name,
            personality,
            relationships,
            socialising,
            satisfaction,
            hobbies,
            traits,
            fumbled_delta_scale,
            career,
            commuting,
            at_work_ticks,
            chain,
            carrying,
            step_work_ticks
        );
    }
    assert!(upgraded
        .entities
        .iter()
        .all(|e| e.conversation_voice.is_none()));
}

#[test]
fn pre_voice_decoder_accepts_complete_rows_with_a_present_empty_tail() {
    let mut bytes = source_bytes();
    bytes.push(0);
    let decoded = super::save_before_voice::decode(&bytes[SAVE_HEADER_BYTES..])
        .expect("the same historical rows may include the later empty tail");
    assert_eq!(decoded.tick, 157);
    assert_eq!(decoded.entities.len(), 37);
    let mut handle = SimHandle::from_lot();
    assert!(handle.load_bytes(&bytes));
    assert_eq!(handle.sim.save_snapshot_v5().world.tick, 157);
}

#[test]
fn pre_voice_padding_never_completes_a_truncated_nonempty_sleep_pressure_list() {
    let mut payload = source_bytes()[SAVE_HEADER_BYTES..].to_vec();
    payload.push(0);
    let (mut source, _) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV1BeforeVoice>(&payload).unwrap();
    let person = source
        .entities
        .iter()
        .find(|entity| entity.agent)
        .unwrap()
        .index;
    source.sleep_pressure = vec![(person, 1)];
    let mut incomplete = postcard::to_allocvec(&source).unwrap();
    assert_eq!(incomplete.pop(), Some(1));
    assert!(super::save_before_voice::decode(&incomplete).is_none());
}

#[test]
fn pre_voice_decoder_rejects_truncation_trailing_bytes_and_unknown_fingerprints() {
    let original = source_bytes();
    let mut trailing = original.clone();
    trailing.push(255);
    for bytes in [&original[..original.len() - 1], trailing.as_slice()] {
        let mut live = SimHandle::from_lot();
        let before = live.save_bytes();
        assert!(!live.load_bytes(bytes));
        assert_eq!(live.save_bytes(), before);
    }
    let mut payload = original[SAVE_HEADER_BYTES..].to_vec();
    payload.push(0);
    let (mut old, _) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV1BeforeVoice>(&payload).unwrap();
    old.content_fingerprint = SimHandle::from_lot()
        .sim
        .save_snapshot()
        .content_fingerprint;
    assert!(
        super::save_before_voice::decode(&postcard::to_allocvec(&old).unwrap()).is_none(),
        "current digests must not claim the pre-voice wire shape"
    );
    old.content_fingerprint = 123;
    assert!(super::save_before_voice::decode(&postcard::to_allocvec(&old).unwrap()).is_none());
}
