use super::*;
use terri_core::{Agent, Needs, Path, Position, NEED_MAX};
use terri_sim::render_buffer::facing;

fn facing_of(handle: &SimHandle, person: u32) -> u32 {
    let buffer = handle.sim.render_buffer();
    let index = buffer
        .ids
        .iter()
        .position(|id| *id == person)
        .expect("walker");
    buffer.facings[index]
}

fn samples_of(handle: &SimHandle, person: u32) -> ((f32, f32), (f32, f32)) {
    let buffer = handle.sim.render_buffer();
    let index = buffer
        .ids
        .iter()
        .position(|id| *id == person)
        .expect("walker");
    (
        (
            buffer.prev_positions[index * 2],
            buffer.prev_positions[index * 2 + 1],
        ),
        (buffer.positions[index * 2], buffer.positions[index * 2 + 1]),
    )
}

#[test]
fn public_save_bytes_keep_a_corner_walkers_incoming_direction() {
    let mut source = SimHandle::new(16, 16);
    let agent = source
        .sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 2.0, y: 2.0 },
            Needs::all_at(NEED_MAX),
            Path {
                steps: vec![(3, 2), (3, 3)],
                cursor: 0,
            },
        ))
        .id();
    source.sim.sync_render_buffer();
    for _ in 0..4 {
        source.tick();
    }
    let person = agent.index_u32();
    let (previous, current) = samples_of(&source, person);
    assert_ne!(previous, current);
    assert_eq!(facing_of(&source, person), facing::POSITIVE_Y);

    let bytes = source.save_bytes();
    assert_eq!(
        &bytes[SAVE_MAGIC.len()..SAVE_HEADER_BYTES],
        &SAVE_SCHEMA_VERSION.to_le_bytes()
    );
    let mut loaded = SimHandle::new(1, 1);
    assert!(loaded.load_bytes(&bytes));
    assert_eq!(samples_of(&loaded, person), (current, current));
    assert_eq!(facing_of(&loaded, person), facing::POSITIVE_X);
    assert_eq!(loaded.save_bytes(), bytes);
    assert_eq!(loaded.world_hash(), source.world_hash());

    let older = source.sim.save_snapshot_v33();
    let mut older_bytes = SAVE_MAGIC.to_vec();
    older_bytes.extend(33u16.to_le_bytes());
    older_bytes.extend(postcard::to_allocvec(&older).unwrap());
    assert!(loaded.load_bytes(&older_bytes));
    assert_eq!(loaded.world_hash(), source.world_hash());
    assert_eq!(facing_of(&loaded, person), facing::POSITIVE_Y);
    // Saving again before the next step records nothing, so the next load
    // still uses the next leg.
    let resaved = loaded.save_bytes();
    let (snapshot, tail) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV34>(&resaved[SAVE_HEADER_BYTES..])
            .unwrap();
    assert!(tail.is_empty());
    assert!(snapshot.walk_steps.is_empty());
    assert!(loaded.load_bytes(&resaved));
    assert_eq!(facing_of(&loaded, person), facing::POSITIVE_Y);
}

#[test]
fn a_walk_step_that_matches_the_saved_position_does_not_load() {
    let mut source = SimHandle::new(16, 16);
    source.sim.world_mut().spawn((
        Agent,
        Position { x: 2.0, y: 2.0 },
        Needs::all_at(NEED_MAX),
        Path {
            steps: vec![(3, 2), (3, 3)],
            cursor: 0,
        },
    ));
    source.sim.sync_render_buffer();
    for _ in 0..4 {
        source.tick();
    }
    let bytes = source.save_bytes();
    let (mut snapshot, tail) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV34>(&bytes[SAVE_HEADER_BYTES..])
            .unwrap();
    assert!(tail.is_empty());
    snapshot.walk_steps[0].x = 3.0;
    snapshot.walk_steps[0].y = 2.0;
    let mut bad = SAVE_MAGIC.to_vec();
    bad.extend(SAVE_SCHEMA_VERSION.to_le_bytes());
    bad.extend(postcard::to_allocvec(&snapshot).unwrap());

    let mut target = SimHandle::new(16, 16);
    let before = target.world_hash();
    assert!(!target.load_bytes(&bad));
    assert_eq!(target.world_hash(), before);
    assert!(target.load_bytes(&bytes));
}
