//! The lingering lift of liked furniture and schema twenty-three across the
//! browser boundary: issue 344, [OA-presence] in
//! `docs/specs/2026-10-06-object-affinities.md`.
use super::*;
use terri_core::{SaveSnapshotV22, SimClock, SimId};
use terri_sim::presence_fade::PresenceFade;

const NOON: &[u8] = include_bytes!("../tests/fixtures/presence-v22/new-game-day-one-noon.sav");
const EVENING: &[u8] =
    include_bytes!("../tests/fixtures/presence-v22/new-game-two-days-evening.sav");

/// Main's schema-22 saves, which have no place for a fading lift, load
/// with none, save as schema 23 with an empty list after the same schema-22
/// payload, load again without change and go on identically.
#[test]
fn main_schema_twenty_two_saves_load_with_no_fade_and_save_as_twenty_three() {
    for (name, bytes) in [("noon", NOON), ("evening", EVENING)] {
        assert_eq!(&bytes[8..10], &22u16.to_le_bytes(), "{name}");
        let (original, tail) =
            postcard::take_from_bytes::<SaveSnapshotV22>(&bytes[SAVE_HEADER_BYTES..]).unwrap();
        assert!(tail.is_empty(), "{name}");
        let mut migrated = SimHandle::from_lot();
        assert!(migrated.load_bytes(bytes), "{name}");
        assert!(
            migrated
                .sim
                .world()
                .resource::<PresenceFade>()
                .entries()
                .is_empty(),
            "{name}: an older save has nothing fading"
        );
        let current = migrated.save_bytes();
        assert_eq!(&current[8..10], &23u16.to_le_bytes(), "{name}");
        let saved = decode_current(&current);
        assert!(saved.presence_fade.is_empty(), "{name}");
        assert_eq!(saved.legacy, original, "{name}: the schema-22 part is kept");

        let mut resumed = SimHandle::from_lot();
        assert!(resumed.load_bytes(&current), "{name}");
        assert_eq!(resumed.save_bytes(), current, "{name}");
        for tick in 0..120 {
            migrated.tick();
            resumed.tick();
            assert_eq!(
                migrated.world_hash(),
                resumed.world_hash(),
                "{name}: diverged {tick} ticks after load"
            );
        }
        assert_eq!(migrated.save_bytes(), resumed.save_bytes(), "{name}");
    }
}

/// A fading lift crosses a save and a load byte for byte and keeps the world
/// digest, and every kind of bad row refuses the load and leaves the running
/// handle exactly as it was.
#[test]
fn schema_twenty_three_carries_the_fades_and_refuses_bad_rows() {
    let mut source = SimHandle::from_lot();
    let now = source.sim.world().resource::<SimClock>().tick;
    {
        let mut fade = source.sim.world_mut().resource_mut::<PresenceFade>();
        fade.refresh(SimId(1), 0, now, 120);
        fade.refresh(SimId(1), 1, now, 60);
        fade.refresh(SimId(2), 0, now, 30);
    }
    let bytes = source.save_bytes();
    assert_eq!(&bytes[8..10], &23u16.to_le_bytes());
    let saved = decode_current(&bytes);
    let rows: Vec<(u32, &str, u64)> = saved
        .presence_fade
        .iter()
        .map(|row| (row.sim, row.kind.as_str(), row.end_tick))
        .collect();
    assert_eq!(
        rows,
        vec![
            (1, "aquarium", now + 60),
            (1, "plants", now + 120),
            (2, "plants", now + 30)
        ]
    );

    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&bytes));
    assert_eq!(loaded.save_bytes(), bytes);
    assert_eq!(loaded.world_hash(), source.world_hash());
    assert_ne!(
        loaded.world_hash(),
        SimHandle::from_lot().world_hash(),
        "the fades are in the digest"
    );

    let mut bad_rows = Vec::new();
    for edit in [
        (|rows: &mut Vec<terri_core::save_v23::SavedPresenceFade>| rows[2].sim = 99)
            as fn(&mut Vec<terri_core::save_v23::SavedPresenceFade>),
        |rows| rows[1].kind = "television".into(),
        |rows| rows[0].kind = "gardens".into(),
        |rows| rows[0].end_tick = 0,
        |rows| rows[0].end_tick = u64::MAX,
        |rows| rows.swap(0, 1),
        |rows| rows.push(rows[0].clone()),
    ] {
        let mut bad = saved.clone();
        edit(&mut bad.presence_fade);
        let mut payload = SAVE_MAGIC.to_vec();
        payload.extend(23u16.to_le_bytes());
        payload.extend(postcard::to_allocvec(&bad).unwrap());
        bad_rows.push(payload);
    }
    let before = loaded.save_bytes();
    let hash = loaded.world_hash();
    for (index, bad) in bad_rows.iter().enumerate() {
        assert!(!loaded.load_bytes(bad), "bad row case {index}");
        assert_eq!(loaded.save_bytes(), before, "bad row case {index}");
        assert_eq!(loaded.world_hash(), hash, "bad row case {index}");
    }
}

/// A save the game itself makes, while a fade is running, loads and goes on
/// exactly as the world that was never reloaded: the shipped lot is ticked
/// until some fade is on the list, saved, loaded into a second handle, and
/// both are ticked for 250 more ticks (longer than the longest shipped fade,
/// 228) with the world hash compared every tick and the saved bytes at the
/// end. Saves taken along the way must also pass load validation.
#[test]
fn a_fade_in_a_game_made_save_survives_a_reload_and_runs_out_identically() {
    let mut original = SimHandle::from_lot();
    let mut ticks = 0;
    while original
        .sim
        .world()
        .resource::<PresenceFade>()
        .entries()
        .is_empty()
    {
        assert!(ticks < 5_000, "no fade appeared in the shipped lot");
        original.tick();
        ticks += 1;
    }
    let bytes = original.save_bytes();
    assert!(!decode_current(&bytes).presence_fade.is_empty());
    let mut reloaded = SimHandle::from_lot();
    assert!(reloaded.load_bytes(&bytes));
    assert_eq!(reloaded.world_hash(), original.world_hash());
    let mut scratch = SimHandle::from_lot();
    for tick in 1..=250 {
        original.tick();
        reloaded.tick();
        assert_eq!(
            reloaded.world_hash(),
            original.world_hash(),
            "diverged {tick} ticks after the reload"
        );
        if tick % 10 == 0 {
            assert!(
                scratch.load_bytes(&original.save_bytes()),
                "the game's own save was refused {tick} ticks after the reload"
            );
        }
    }
    assert_eq!(reloaded.save_bytes(), original.save_bytes());
}
