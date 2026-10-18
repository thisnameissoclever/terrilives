use super::*;

#[test]
fn public_people_have_distinct_saved_identities_and_can_complete_a_chat_after_reload() {
    let mut source = SimHandle::new(16, 16);
    source.spawn_agent(1., 1., 80.);
    source.spawn_agent(4., 1., 80.);
    assert_eq!(
        source
            .sim
            .world()
            .resource::<terri_core::SimIdAllocator>()
            .issued(),
        2
    );
    let ids: Vec<_> = source
        .sim
        .world_mut()
        .query::<&terri_core::SimId>()
        .iter(source.sim.world())
        .map(|id| id.0)
        .collect();
    assert_eq!(ids, vec![0, 1]);
    assert!(source.enqueue_command(&[4, 0, 1, 0]));
    for _ in 0..6 {
        source.tick();
    }
    let mut loaded = SimHandle::new(16, 16);
    assert!(loaded.load_bytes(&source.save_bytes()));
    for _ in 0..60 {
        source.tick();
        loaded.tick();
        assert_eq!(source.world_hash(), loaded.world_hash());
    }
}

#[test]
fn public_random_people_use_the_creation_bands() {
    for seed in 0..64 {
        let mut source = SimHandle::new(8, 8);
        source
            .sim
            .world_mut()
            .insert_resource(terri_core::SimRng::from_seed(seed));
        source.spawn_agent(1., 1., 80.);
        let value = source
            .sim
            .world_mut()
            .query::<&terri_core::SelfPreservation>()
            .iter(source.sim.world())
            .next()
            .unwrap()
            .0;
        assert!(
            (11..=95).contains(&value),
            "Public creation produced {value} at seed {seed}"
        );
    }
}

#[test]
fn rejected_public_person_creation_consumes_no_identity_or_randomness() {
    let mut handle = SimHandle::from_lot();
    let grid = handle.sim.world().resource::<TileGrid>();
    let cell = (0..grid.height())
        .flat_map(|y| (0..grid.width()).map(move |x| (x, y)))
        .find(|(x, y)| !grid.is_walkable(*x as i32, *y as i32))
        .unwrap();
    let before = handle.save_bytes();
    let hash = handle.world_hash();
    handle.spawn_agent(cell.0 as f32, cell.1 as f32, 80.);
    assert_eq!(handle.save_bytes(), before);
    assert_eq!(handle.world_hash(), hash);
}
use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};

fn handle_with_edge(axis: EdgeAxis, x: u32, y: u32, doorway: bool) -> SimHandle {
    let mut handle = SimHandle::new(8, 8);
    let mut snapshot = handle.sim.save_snapshot_v2();
    snapshot.layout = SavedLayout::EdgeWallsV1 {
        edges: vec![WallEdge {
            axis,
            x,
            y,
            doorway,
        }],
    };
    handle.sim.load_snapshot_v2(snapshot).unwrap();
    assert_eq!(handle.wall_layout_kind(), 1);
    let content = handle.sim.world().resource::<Content>().0;
    let bed = content.find("double_bed").unwrap();
    assert_eq!(
        content.object(bed).footprint,
        terri_core::Footprint { width: 2, depth: 2 }
    );
    handle
}

#[test]
fn spawn_object_accepts_solid_edges_on_each_perimeter_side() {
    for (axis, x, y) in [
        (EdgeAxis::Vertical, 3, 3),
        (EdgeAxis::Vertical, 5, 3),
        (EdgeAxis::Horizontal, 3, 3),
        (EdgeAxis::Horizontal, 3, 5),
        (EdgeAxis::Vertical, 4, 5),
    ] {
        let mut handle = handle_with_edge(axis, x, y, false);
        assert!(
            handle.spawn_object(3.0, 3.0, "double_bed"),
            "perimeter {axis:?}({x},{y})"
        );
        assert_eq!(handle.entity_count(), 1);
        let snapshot = handle.sim.save_snapshot_v2();
        assert_eq!(snapshot.world.entities.len(), 1);
        assert_eq!(
            snapshot.world.entities[0].smart_object.as_deref(),
            Some("double_bed")
        );
        assert_eq!(
            snapshot.world.entities[0].position,
            Some(terri_core::SavedPosition { x: 3.0, y: 3.0 })
        );
        let bytes = handle.save_bytes();
        let mut restored = SimHandle::new(1, 1);
        assert!(restored.load_bytes(&bytes));
        assert_eq!(restored.save_bytes(), bytes);
    }
}

#[test]
fn spawn_object_refuses_each_internal_wall_without_changing_world_or_render_buffers() {
    for (axis, x, y) in [(EdgeAxis::Vertical, 4, 3), (EdgeAxis::Horizontal, 3, 4)] {
        let mut handle = handle_with_edge(axis, x, y, false);
        assert!(handle.spawn_object(0.0, 0.0, "fridge"));
        let before = handle.save_bytes();
        let count = handle.entity_count();
        let positions = handle.positions_ptr();
        let previous = handle.prev_positions_ptr();
        assert!(
            !handle.spawn_object(3.0, 3.0, "double_bed"),
            "internal {axis:?}({x},{y})"
        );
        assert_eq!(handle.save_bytes(), before);
        assert_eq!(handle.entity_count(), count);
        assert_eq!(handle.positions_ptr(), positions);
        assert_eq!(handle.prev_positions_ptr(), previous);

        let mut doorway = handle_with_edge(axis, x, y, true);
        assert!(doorway.spawn_object(3.0, 3.0, "double_bed"));
        assert_eq!(doorway.entity_count(), 1);
        let bytes = doorway.save_bytes();
        let mut restored = SimHandle::new(1, 1);
        assert!(restored.load_bytes(&bytes));
        assert_eq!(restored.save_bytes(), bytes);
    }
}
