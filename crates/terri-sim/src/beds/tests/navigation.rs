use super::*;
use bevy_ecs::system::RunSystemOnce;
use terri_core::{Facing, ObjectFacing, Path, TileGrid};

fn serve(sim: &mut Sim) {
    sim.world_mut()
        .run_system_once(crate::systems::action::serve_intents)
        .unwrap();
}

#[test]
fn new_orders_claim_distinct_authored_sides_at_every_facing() {
    let endpoints = [
        ((7, 6), (7, 8)),
        ((8, 7), (6, 7)),
        ((7, 8), (7, 6)),
        ((6, 7), (8, 7)),
    ];
    for (facing, (first_end, second_end)) in Facing::ALL.into_iter().zip(endpoints) {
        let (mut sim, bed, [first, second, third]) = fixture();
        sim.world_mut().entity_mut(bed).insert(ObjectFacing(facing));
        for agent in [first, second, third] {
            order(&mut sim, agent, bed, 0);
        }
        serve(&mut sim);
        for (agent, ordinal, endpoint) in [(first, 0, first_end), (second, 1, second_end)] {
            assert_eq!(
                sim.world().get::<SleepPlace>(agent),
                Some(&SleepPlace(ordinal))
            );
            assert_eq!(
                sim.world().get::<Path>(agent).unwrap().steps.last(),
                Some(&endpoint),
                "{facing:?}"
            );
        }
        assert!(sim.world().get::<Target>(third).is_none());
        assert!(sim.world().get::<Blocked>(third).is_some());
    }
}

#[test]
fn an_unreachable_assignment_falls_back_for_blocked_tiles_and_contact_edges() {
    for wall_edge in [false, true] {
        let (mut sim, bed, [first, _, _]) = fixture();
        sim.world_mut()
            .resource_mut::<BedAssignments>()
            .set(SimId(0), Some(BedPlace { bed, ordinal: 0 }));
        let mut grid = sim.world_mut().resource_mut::<TileGrid>();
        if wall_edge {
            grid.set_edge_blocked((7, 6), (7, 7), true);
            assert!(
                grid.is_walkable(7, 6),
                "the contact edge alone must deny access"
            );
        } else {
            grid.set_blocked(7, 6, true);
        }
        order(&mut sim, first, bed, 0);
        serve(&mut sim);
        assert_eq!(sim.world().get::<SleepPlace>(first), Some(&SleepPlace(1)));
        assert_eq!(
            sim.world().get::<Path>(first).unwrap().steps.last(),
            Some(&(7, 8))
        );
    }
}

#[test]
fn occupied_reachable_places_wait_but_fully_inaccessible_orders_end() {
    let (mut sim, bed, [first, second, _]) = fixture();
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(7, 6, true);
    order(&mut sim, first, bed, 0);
    serve(&mut sim);
    assert_eq!(sim.world().get::<SleepPlace>(first), Some(&SleepPlace(1)));
    sim.world_mut()
        .resource_mut::<BedAssignments>()
        .set(SimId(1), Some(BedPlace { bed, ordinal: 0 }));
    order(&mut sim, second, bed, 0);
    serve(&mut sim);
    assert!(sim.world().get::<Target>(second).is_none());
    assert!(sim.world().get::<Blocked>(second).is_some());
    assert_eq!(sim.world().get::<IntentQueue>(second).unwrap().len(), 1);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(7, 8, true);
    serve(&mut sim);
    assert!(sim.world().get::<IntentQueue>(second).unwrap().is_empty());
    assert!(sim.world().get::<SleepPlace>(second).is_none());
}

#[test]
fn exact_side_routes_keep_fractional_position_anchoring() {
    let (mut sim, bed, [first, _, _]) = fixture();
    let position = Position { x: 2.25, y: 2.0 };
    sim.world_mut().entity_mut(first).insert(position);
    order(&mut sim, first, bed, 0);
    let grid = sim.world().resource::<TileGrid>();
    let expected = grid
        .anchor_path(
            (position.x, position.y),
            grid.find_path((2, 2), (7, 6)).unwrap(),
        )
        .unwrap();
    serve(&mut sim);
    assert_eq!(sim.world().get::<Path>(first).unwrap().steps, expected);
    assert_eq!(*sim.world().get::<Position>(first).unwrap(), position);
}

#[test]
fn autonomy_keeps_one_candidate_and_chooses_safety_before_assignment() {
    for danger in [false, true] {
        let (mut sim, bed, [first, second, third]) = fixture();
        sim.world_mut().despawn(second);
        sim.world_mut().despawn(third);
        let mut pack = sim.world().resource::<crate::Content>().0.clone();
        pack.objects[0].interactions.truncate(1);
        pack.tuning.death_after_ticks = 100;
        pack.tuning.idle_threshold = 0.0;
        pack.tuning.wander_pause_ticks = 1000;
        pack.tuning.choice_temperature = 0.0001;
        pack.tuning.choice_exploration = 0.0;
        sim.world_mut()
            .insert_resource(crate::Content(Box::leak(Box::new(pack))));
        sim.world_mut()
            .entity_mut(first)
            .insert(Position { x: 7.0, y: 8.0 });
        let mut needs = Needs::all_at(70.0);
        needs.set(NeedId::Energy, 10.0);
        if danger {
            needs.set(NeedId::Hunger, 0.0);
        }
        sim.world_mut().entity_mut(first).insert(needs);
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = danger;
        sim.world_mut()
            .resource_mut::<BedAssignments>()
            .set(SimId(0), Some(BedPlace { bed, ordinal: 0 }));
        sim.world_mut()
            .run_system_once(crate::systems::action::select_action)
            .unwrap();
        let decisions = &sim
            .world()
            .resource::<crate::systems::autonomy::DecisionTelemetry>()
            .0;
        assert_eq!(decisions.len(), 1);
        assert_eq!(
            decisions[0]
                .choices
                .iter()
                .filter(|row| row.0 == bed.index_u32() && row.1 == 0)
                .count(),
            1,
            "two places cannot double a bed's selection weight"
        );
        assert_eq!(
            sim.world().get::<SleepPlace>(first),
            Some(&SleepPlace(if danger { 1 } else { 0 }))
        );
        let endpoint = sim
            .world()
            .get::<Path>(first)
            .unwrap()
            .steps
            .last()
            .copied()
            .unwrap_or((7, 8));
        assert_eq!(endpoint, if danger { (7, 8) } else { (7, 6) });
    }
}

#[test]
fn authored_access_filters_each_tile_and_uses_a_stable_nearest_endpoint() {
    let pack = terri_data::pack();
    let definition = pack.object(pack.find("double_bed").unwrap());
    let mut grid = TileGrid::new(10, 10);
    for x in 4..6 {
        for y in 4..6 {
            grid.set_blocked(x, y, true);
        }
    }
    grid.set_blocked(4, 3, true);
    let field = grid.distance_field((2, 2)).unwrap();
    let access = super::super::navigation::Access::new(
        definition,
        &pack.sleep_tag,
        Facing::SouthEast,
        (4, 4),
        &field,
    );
    let route = access
        .for_admission(Admission::Sleep {
            ordinal: 0,
            preference: Preference::Unassigned,
        })
        .unwrap();
    assert_eq!(
        route.route.path(&grid, (2, 2)).unwrap().last(),
        Some(&(5, 3))
    );
    grid.set_edge_blocked((5, 3), (5, 4), true);
    let field = grid.distance_field((2, 2)).unwrap();
    let access = super::super::navigation::Access::new(
        definition,
        &pack.sleep_tag,
        Facing::SouthEast,
        (4, 4),
        &field,
    );
    assert!(access
        .for_admission(Admission::Sleep {
            ordinal: 0,
            preference: Preference::Unassigned
        })
        .is_none());
    assert!(access
        .for_admission(Admission::Sleep {
            ordinal: 1,
            preference: Preference::Unassigned
        })
        .is_some());
}
