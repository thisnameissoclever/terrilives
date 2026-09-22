use super::*;
use terri_core::{
    layout::{EdgeAxis, SavedLayout, WallEdge},
    Facing, ObjectFacing, SaveSnapshotV3,
};

fn rotated_tub() -> (Sim, Entity) {
    let mut sim = Sim::new_with_lot(8, 8);
    let content = terri_data::pack();
    let id = content.find("bathtub").unwrap();
    assert!(content.object(id).supports(Facing::SouthEast));
    let origin = Position { x: 2.0, y: 2.0 };
    let tub = sim.spawn_object(origin, id);
    crate::apply_object_placement(
        sim.world_mut(),
        tub,
        content.object(id),
        origin,
        Facing::SouthEast,
    );
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(2, 2, true);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(3, 2, true);
    // This wall borders the rotated 2x1 rectangle. The authored 1x2 crosses it.
    sim.world_mut().insert_resource(SavedLayout::EdgeWallsV1 {
        edges: vec![WallEdge {
            axis: EdgeAxis::Horizontal,
            x: 2,
            y: 3,
            doorway: false,
        }],
    });
    (sim, tub)
}

fn assert_refused_unchanged(live: &mut Sim, invalid: SaveSnapshotV3) {
    let before = live.save_snapshot_v3();
    let hash = live.world_hash();
    assert!(live.load_snapshot_v3(invalid).is_err());
    assert_eq!(live.save_snapshot_v3(), before);
    assert_eq!(live.world_hash(), hash);
}

#[test]
fn v3_restores_rotation_before_testing_rectangles_against_saved_edges() {
    let (source, tub) = rotated_tub();
    let saved = source.save_snapshot_v3();
    let mut live = Sim::new_from_shipped_lot();
    live.load_snapshot_v3(saved.clone()).unwrap();
    assert_eq!(live.save_snapshot_v3(), saved);
    assert_eq!(
        live.world().get::<ObjectFacing>(tub),
        Some(&ObjectFacing(Facing::SouthEast))
    );
    let render = live.render_buffer();
    let row = render
        .ids
        .iter()
        .position(|&id| id == tub.index_u32())
        .unwrap();
    assert_eq!(
        (render.footprint_widths[row], render.footprint_depths[row]),
        (2, 1)
    );
    assert_eq!(&render.positions[row * 2..row * 2 + 2], &[2.5, 2.0]);
    assert_eq!(&render.prev_positions[row * 2..row * 2 + 2], &[2.5, 2.0]);
    let mut crossed = saved;
    crossed.layout = SavedLayout::EdgeWallsV1 {
        edges: vec![WallEdge {
            axis: EdgeAxis::Vertical,
            x: 3,
            y: 2,
            doorway: false,
        }],
    };
    assert_refused_unchanged(&mut live, crossed);
}

#[test]
fn v3_routes_and_active_contacts_use_the_restored_rectangle() {
    for walking in [true, false] {
        let (mut source, tub) = rotated_tub();
        source.world_mut().entity_mut(tub).insert(Reserved);
        let agent = source
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 2.0 },
                Target {
                    object: tub,
                    interaction: 0,
                },
            ))
            .id();
        if walking {
            source.world_mut().entity_mut(agent).insert(Path {
                steps: vec![],
                cursor: 0,
            });
        } else {
            let id = terri_data::pack().find("bathtub").unwrap();
            source.world_mut().entity_mut(agent).insert(Eating {
                object: id,
                interaction: 0,
                remaining_ticks: 2,
            });
        }
        let saved = source.save_snapshot_v3();
        let mut live = Sim::new();
        live.load_snapshot_v3(saved.clone()).unwrap();
        assert_eq!(live.save_snapshot_v3(), saved);
        let mut wrong_contact = saved;
        wrong_contact
            .world
            .entities
            .iter_mut()
            .find(|e| e.index == agent.index_u32())
            .unwrap()
            .position = Some(SavedPosition { x: 4.0, y: 3.0 });
        assert_refused_unchanged(&mut live, wrong_contact);
    }
}

#[test]
fn v3_corrupt_architecture_and_facing_codes_do_not_replace_live_state() {
    let (source, tub) = rotated_tub();
    let valid = source.save_snapshot_v3();
    let mut live = Sim::new_from_shipped_lot();
    for entries in [
        vec![(tub.index_u32(), 255)],
        vec![(tub.index_u32(), 0); 2],
        vec![(9999, 0)],
    ] {
        let mut invalid = valid.clone();
        invalid.object_facings = entries;
        assert_refused_unchanged(&mut live, invalid);
    }
    let mut invalid = valid;
    invalid.layout = SavedLayout::EdgeWallsV1 {
        edges: vec![WallEdge {
            axis: EdgeAxis::Vertical,
            x: u32::MAX,
            y: 1,
            doorway: false,
        }],
    };
    assert_refused_unchanged(&mut live, invalid);
}

#[test]
fn v3_portal_return_validation_and_scene_activation_survive_restore() {
    let source = Sim::new_from_shipped_lot();
    let valid = source.save_snapshot_v3();
    let mut active = Sim::new_from_shipped_lot();
    active.load_snapshot_v3(valid.clone()).unwrap();
    // The front door, then a door in each of the three vertical doorways
    // ([DR-derived]).
    assert_eq!(active.portal_buffer().states.len(), 4);
    let mut blank = Sim::new();
    blank.load_snapshot_v3(valid.clone()).unwrap();
    assert!(blank.portal_buffer().states.is_empty());
    let mut invalid = valid;
    invalid.layout = SavedLayout::EdgeWallsV1 {
        edges: vec![WallEdge {
            axis: EdgeAxis::Horizontal,
            x: 15,
            y: 3,
            doorway: false,
        }],
    };
    assert_refused_unchanged(&mut active, invalid.clone());
    assert_refused_unchanged(&mut blank, invalid);
}
