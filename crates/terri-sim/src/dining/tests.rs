use super::*;
use crate::Sim;
use terri_core::{Carrying, Needs, Relationships, SimClock};

fn ready() -> (Sim, Vec<Entity>, Entity) {
    let mut sim = Sim::new_from_shipped_lot();
    let pack = sim.world().resource::<Content>().0;
    let chain = pack
        .chains
        .iter()
        .position(|c| c.id == "cook_dinner")
        .unwrap() as u32;
    let dinner = pack.item_kinds.iter().position(|k| k == "dinner").unwrap() as u32;
    let mut people: Vec<_> = sim
        .world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(sim.world())
        .collect();
    people.sort_by_key(|e| e.index_u32());
    for person in &people {
        sim.world_mut()
            .entity_mut(*person)
            .remove::<terri_core::Career>()
            .remove::<Target>()
            .remove::<Path>()
            .insert((
                ChainState {
                    step: 5,
                    ..ChainState::begin(chain)
                },
                Carrying(dinner),
                Needs::all_at(100.0),
            ));
    }
    let table = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| pack.object(o.0).id == "dining_table")
        .unwrap()
        .0;
    sim.world_mut().insert_resource(SavedDomestic::default());
    (sim, people, table)
}

#[test]
fn simultaneous_diners_claim_two_real_chairs_and_the_third_stands() {
    let (mut sim, people, table) = ready();
    sim.world_mut()
        .entity_mut(people[0])
        .insert(terri_core::Selected);
    advance(sim.world_mut());
    let d = &sim.world().resource::<SavedDining>().diners;
    assert_eq!(d.len(), 3);
    assert_eq!(d.iter().filter(|d| d.chair.is_some()).count(), 2);
    assert_eq!(d.iter().filter(|d| d.chair.is_none()).count(), 1);
    assert!(sim.world().get::<Reserved>(table).is_some());
    assert!(claim(sim.world(), people[0].index_u32())
        .unwrap()
        .chair
        .is_some());
    assert!(claim(sim.world(), people[1].index_u32())
        .unwrap()
        .chair
        .is_some());
    assert!(claim(sim.world(), people[2].index_u32())
        .unwrap()
        .chair
        .is_none());
    for (i, diner) in d.iter().enumerate() {
        assert!(!d[..i].iter().any(|prior| prior.endpoint == diner.endpoint));
        if let Some(chair) = diner.chair {
            assert!(setting_for(sim.world(), table, entity(sim.world(), chair).unwrap()).is_some());
        }
    }
    let snapshot = sim.save_snapshot_v5();
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v5(snapshot).unwrap();
    assert_eq!(sim.world_hash(), restored.world_hash());
    assert!(people
        .iter()
        .all(|p| sim.world().get::<Target>(*p).is_some()));
}

#[test]
fn seated_art_targets_the_claimed_chair_while_food_keeps_the_table_target() {
    let (mut sim, people, table) = ready();
    advance(sim.world_mut());
    let diner = claim(sim.world(), people[0].index_u32()).unwrap().clone();
    let chair = entity(sim.world(), diner.chair.unwrap()).unwrap();
    sim.world_mut()
        .entity_mut(people[0])
        .remove::<Path>()
        .insert((
            Position {
                x: diner.endpoint.0 as f32,
                y: diner.endpoint.1 as f32,
            },
            StepWork {
                remaining_ticks: 10,
            },
        ));
    let pose = projection(sim.world(), people[0]).unwrap();
    let position = sim.world().get::<Position>(chair).unwrap();
    assert_eq!((pose.x, pose.y), (position.x, position.y));
    assert_eq!(pose.target_entity, chair.index_u32());
    assert_eq!(sim.world().get::<Target>(people[0]).unwrap().object, table);
    assert_eq!(
        pose.visual_action,
        crate::render_buffer::visual_action::SEATED_EAT
    );
    assert_eq!(pose.activity, crate::render_buffer::activity::EATING);
    sim.sync_render_buffer();
    let row = sim
        .render_buffer()
        .ids
        .iter()
        .position(|id| *id == people[0].index_u32())
        .unwrap();
    assert_eq!(
        sim.render_buffer().meal_tables.len(),
        sim.render_buffer().ids.len()
    );
    assert_eq!(sim.render_buffer().meal_tables[row], table.index_u32());
    assert_eq!(
        sim.render_buffer().interaction_targets[row],
        chair.index_u32()
    );
    assert_eq!(sim.render_buffer().sound_actions[row], 0);
    sim.world_mut().entity_mut(people[0]).remove::<StepWork>();
    sim.sync_render_buffer();
    assert_eq!(sim.render_buffer().meal_tables[row], u32::MAX);
}

#[test]
fn missing_or_wrong_facing_chairs_cannot_supply_a_seat() {
    let (mut sim, _, table) = ready();
    let chairs: Vec<_> = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .filter(|(_, o)| sim.world().resource::<Content>().0.object(o.0).id == "chair")
        .map(|(e, _)| e)
        .collect();
    for c in chairs {
        let f = sim.world().get::<ObjectFacing>(c).unwrap().0;
        sim.world_mut()
            .entity_mut(c)
            .insert(ObjectFacing(f.turned()));
        assert!(setting_for(sim.world(), table, c).is_none());
    }
    advance(sim.world_mut());
    assert!(sim
        .world()
        .resource::<SavedDining>()
        .diners
        .iter()
        .all(|d| d.chair.is_none()));
}

#[test]
fn dirty_settings_force_standing_and_complain_only_once_across_interruptions() {
    let (mut sim, people, table) = ready();
    let owner = sim.world().get::<SimId>(people[2]).unwrap().0;
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .dishes
        .push(SavedDishes {
            id: 0,
            surface: table.index_u32(),
            owner,
            units: 4,
        });
    sim.world_mut().resource_mut::<SavedDomestic>().next_dish = 1;
    advance(sim.world_mut());
    assert!(sim
        .world()
        .resource::<SavedDining>()
        .diners
        .iter()
        .all(|d| d.chair.is_none()));
    let before = sim
        .world()
        .get::<Relationships>(people[0])
        .unwrap()
        .feeling(SimId(owner));
    assert!(before < 0.0);
    crate::domestic::suspend_cleanup(sim.world_mut(), people[0]);
    assert!(claim(sim.world(), people[0].index_u32()).is_none());
    sim.world_mut()
        .entity_mut(people[0])
        .remove::<Target>()
        .remove::<Path>();
    advance(sim.world_mut());
    assert_eq!(
        before,
        sim.world()
            .get::<Relationships>(people[0])
            .unwrap()
            .feeling(SimId(owner))
    );
}

#[test]
fn forged_endpoint_and_duplicate_chair_fail_transactionally() {
    let (mut sim, _, _) = ready();
    advance(sim.world_mut());
    let snapshot = sim.save_snapshot_v5();
    let original = sim.world_hash();
    let mut forged = snapshot.clone();
    forged.dining.as_mut().unwrap().diners[0].endpoint = (6, 7);
    assert!(sim.load_snapshot_v5(forged).is_err());
    assert_eq!(sim.world_hash(), original);
    let mut duplicate = snapshot.clone();
    let first = duplicate.dining.as_ref().unwrap().diners[0].clone();
    let other = &mut duplicate.dining.as_mut().unwrap().diners[1];
    other.chair = first.chair;
    other.setting = first.setting;
    assert!(sim.load_snapshot_v5(duplicate).is_err());
    assert_eq!(sim.world_hash(), original);
}

#[test]
fn dining_hash_observes_endpoint_setting_and_pending_decision() {
    let (mut sim, _, _) = ready();
    advance(sim.world_mut());
    let before = sim.world_hash();
    sim.world_mut().resource_mut::<SavedDining>().diners[0]
        .endpoint
        .0 += 1;
    assert_ne!(before, sim.world_hash());
    sim.world_mut().resource_mut::<SavedDining>().diners[0]
        .endpoint
        .0 -= 1;
    let original = sim.world_hash();
    sim.world_mut().resource_mut::<SavedDining>().diners[0].setting = Some(3);
    assert_ne!(original, sim.world_hash());
    assert_eq!(sim.world().resource::<SimClock>().tick, 0);
}

#[test]
fn tableless_shared_diners_finish_together_and_every_transition_loads() {
    let (mut sim, people, table) = ready();
    let pack = sim.world().resource::<Content>().0;
    let counter = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| pack.object(o.0).id == "counter")
        .unwrap()
        .0;
    let position = *sim.world().get::<Position>(table).unwrap();
    let f = crate::placed_footprint(
        pack,
        sim.world().get::<SmartObject>(table).unwrap().0,
        sim.world().get::<ObjectFacing>(table),
    );
    for y in 0..f.depth {
        for x in 0..f.width {
            sim.world_mut().resource_mut::<TileGrid>().set_blocked(
                position.x as usize + x as usize,
                position.y as usize + y as usize,
                false,
            );
        }
    }
    sim.world_mut().despawn(table);
    let cook = sim.world().get::<SimId>(people[0]).unwrap().0;
    let mut guests: Vec<_> = people[1..]
        .iter()
        .map(|p| sim.world().get::<SimId>(*p).unwrap().0)
        .collect();
    guests.sort_unstable();
    let shared = pack
        .chains
        .iter()
        .position(|c| c.id == crate::domestic::SHARED)
        .unwrap() as u32;
    for p in &people {
        let mut personality = sim
            .world_mut()
            .get_mut::<terri_core::Personality>(*p)
            .unwrap();
        personality.drain = [0.0; 7];
        sim.world_mut()
            .get_mut::<Needs>(*p)
            .unwrap()
            .set(terri_core::NeedId::Hunger, 30.0);
    }
    for p in &people[1..] {
        sim.world_mut().entity_mut(*p).insert(ChainState {
            step: 1,
            ..ChainState::begin(shared)
        });
    }
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .meals
        .push(SavedMeal {
            cook,
            counter: counter.index_u32(),
            table: None,
            guests: guests.clone(),
            claimed: guests.clone(),
            collected: guests,
            eaten: vec![],
            scale: 1.0,
            tick: 0,
            dining_started: false,
        });
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .serving_meals
        .push((cook, 0));
    let mut saw_group = false;
    for _ in 0..250 {
        sim.tick();
        if let Some(d) = sim.world().get_resource::<SavedDining>() {
            assert!(d.diners.iter().all(|d| d.chair.is_none()));
            saw_group |= !d.tableless.is_empty();
        }
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
        assert_eq!(restored.world_hash(), sim.world_hash());
        if people.iter().all(|p| {
            sim.world()
                .get::<Needs>(*p)
                .unwrap()
                .get(terri_core::NeedId::Hunger)
                > 70.0
        }) {
            break;
        }
    }
    assert!(saw_group);
    assert!(people.iter().all(|p| sim
        .world()
        .get::<Needs>(*p)
        .unwrap()
        .get(terri_core::NeedId::Hunger)
        > 70.0));
}

#[test]
fn claimed_chairs_refuse_move_rotation_and_sale_until_released() {
    let (mut sim, _, _) = ready();
    advance(sim.world_mut());
    let chair = sim
        .world()
        .resource::<SavedDining>()
        .diners
        .iter()
        .find_map(|d| d.chair)
        .unwrap();
    let e = entity(sim.world(), chair).unwrap();
    let p = *sim.world().get::<Position>(e).unwrap();
    let f = sim.world().get::<ObjectFacing>(e).unwrap().0;
    let before = sim.world_hash();
    for facing in [f, f.turned()] {
        assert!(matches!(
            crate::placement::validate_placement(
                sim.world(),
                chair,
                (p.x as u32, p.y as u32),
                facing
            ),
            Err(crate::placement::PlacementRefusal::InUse)
        ));
    }
    assert!(matches!(
        crate::placement::sale::validate_sale(sim.world(), chair),
        Err(crate::placement::PlacementRefusal::InUse)
    ));
    assert_eq!(before, sim.world_hash());
}

#[test]
fn paused_cancel_clears_complaints_and_round_trips_before_another_tick() {
    let (mut sim, people, table) = ready();
    let owner = sim.world().get::<SimId>(people[2]).unwrap().0;
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .dishes
        .push(SavedDishes {
            id: 0,
            surface: table.index_u32(),
            owner,
            units: 4,
        });
    sim.world_mut().resource_mut::<SavedDomestic>().next_dish = 1;
    advance(sim.world_mut());
    assert!(!sim.world().resource::<SavedDining>().complaints.is_empty());
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::CancelIntents {
            agent: people[0].index_u32(),
        });
    sim.flush_commands();
    assert!(!sim
        .world()
        .resource::<SavedDining>()
        .complaints
        .iter()
        .any(|(p, _)| *p == people[0].index_u32()));
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

#[test]
fn all_stove_facings_route_cooks_to_the_actual_front_and_project_there() {
    let mut sim = Sim::new_from_shipped_lot();
    let pack = sim.world().resource::<Content>().0;
    let person = sim
        .world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(sim.world())
        .next()
        .unwrap();
    let stove = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| pack.object(o.0).id == "stove")
        .unwrap()
        .0;
    let recipe = pack
        .chains
        .iter()
        .position(|c| c.id == "cook_dinner")
        .unwrap() as u32;
    // Open fixture space verifies every facing independently of house walls.
    sim.world_mut().insert_resource(TileGrid::new(20, 20));
    sim.world_mut()
        .entity_mut(stove)
        .insert(Position { x: 10.0, y: 10.0 });
    for (facing, expected, direction) in [
        (terri_core::Facing::SouthEast, (11, 10), 2),
        (terri_core::Facing::SouthWest, (10, 11), 4),
        (terri_core::Facing::NorthWest, (9, 10), 1),
        (terri_core::Facing::NorthEast, (10, 9), 3),
    ] {
        sim.world_mut()
            .entity_mut(stove)
            .insert(ObjectFacing(facing));
        sim.world_mut()
            .entity_mut(person)
            .remove::<Path>()
            .remove::<Target>()
            .remove::<StepWork>()
            .insert((
                Position { x: 4.0, y: 4.0 },
                ChainState {
                    step: 3,
                    ..ChainState::begin(recipe)
                },
            ));
        sim.world_mut().entity_mut(stove).remove::<Reserved>();
        let mut schedule = Schedule::default();
        schedule.add_systems(crate::systems::chain::advance_chains);
        schedule.run(sim.world_mut());
        assert_eq!(
            sim.world()
                .get::<Path>(person)
                .unwrap()
                .steps
                .last()
                .copied(),
            Some(expected)
        );
        let route = crate::domestic::boundary_route(
            pack,
            None,
            person,
            sim.world().get::<SimId>(person).copied(),
            *sim.world().get::<ChainState>(person).unwrap(),
            stove,
            sim.world().get::<SmartObject>(stove).unwrap().0,
            sim.world().get::<ObjectFacing>(stove),
            *sim.world().get::<Position>(stove).unwrap(),
            *sim.world().get::<Position>(person).unwrap(),
            sim.world().resource::<TileGrid>(),
            true,
            &[],
        )
        .unwrap();
        assert_eq!(
            route.last(),
            Some(&expected),
            "privacy routes preserve stove contact"
        );
        sim.world_mut().entity_mut(person).remove::<Path>().insert((
            Position {
                x: expected.0 as f32,
                y: expected.1 as f32,
            },
            StepWork {
                remaining_ticks: 10,
            },
        ));
        let pose = crate::cooking_projection(sim.world(), person).unwrap();
        assert_eq!(
            (pose.x, pose.y, pose.facing),
            (expected.0 as f32, expected.1 as f32, direction)
        );
    }
}

#[test]
fn privacy_routes_preserve_exact_seated_and_standing_claims_and_reload() {
    let (mut sim, people, _) = ready();
    advance(sim.world_mut());
    let pack = sim.world().resource::<Content>().0;
    for person in people {
        let diner = claim(sim.world(), person.index_u32()).unwrap().clone();
        let station = entity(sim.world_mut(), diner.station).unwrap();
        let occupants = crate::domestic::boundary_occupants(sim.world_mut());
        let original = sim.world().resource::<TileGrid>().clone();
        let route = |grid: &TileGrid| {
            crate::domestic::boundary_route(
                pack,
                sim.world().get_resource::<SavedDomestic>(),
                person,
                sim.world().get::<SimId>(person).copied(),
                *sim.world().get::<ChainState>(person).unwrap(),
                station,
                sim.world().get::<SmartObject>(station).unwrap().0,
                sim.world().get::<ObjectFacing>(station),
                *sim.world().get::<Position>(station).unwrap(),
                *sim.world().get::<Position>(person).unwrap(),
                grid,
                false,
                &occupants,
            )
        };
        let start = sim.world().get::<Position>(person).unwrap();
        let start = (start.x.round() as i32, start.y.round() as i32);
        assert_eq!(
            route(&original).unwrap().last().copied().unwrap_or(start),
            diner.endpoint
        );
        let mut blocked = original.clone();
        blocked.set_blocked(diner.endpoint.0 as usize, diner.endpoint.1 as usize, true);
        assert!(
            route(&blocked).is_none(),
            "privacy cannot substitute a different setting"
        );
        let steps = route(&original).unwrap();
        sim.world_mut()
            .entity_mut(person)
            .insert(Path { steps, cursor: 0 });
        let mut replay = Sim::new_from_shipped_lot();
        replay.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
        assert_eq!(replay.world_hash(), sim.world_hash());
    }
}

#[test]
fn historical_in_flight_diners_adopt_standing_claims_before_resaving() {
    let (mut sim, people, table) = ready();
    advance(sim.world_mut());
    for person in &people[1..] {
        sim.world_mut()
            .entity_mut(*person)
            .remove::<ChainState>()
            .remove::<Target>()
            .remove::<Path>()
            .remove::<StepWork>()
            .remove::<Carrying>();
    }
    let pack = sim.world().resource::<Content>().0;
    let position = *sim.world().get::<Position>(people[0]).unwrap();
    let table_pos = *sim.world().get::<Position>(table).unwrap();
    let footprint = crate::placed_footprint(
        pack,
        sim.world().get::<SmartObject>(table).unwrap().0,
        sim.world().get::<ObjectFacing>(table),
    );
    let steps = sim
        .world()
        .resource::<TileGrid>()
        .find_path_adjacent(
            (position.x.round() as i32, position.y.round() as i32),
            (table_pos.x.round() as i32, table_pos.y.round() as i32),
            footprint,
        )
        .unwrap();
    if !steps.is_empty() {
        sim.world_mut()
            .entity_mut(people[0])
            .insert(Path { steps, cursor: 0 });
    }
    let mut historical = sim.save_snapshot_v5();
    historical.dining = None;
    let mut migrated = Sim::new_from_shipped_lot();
    migrated.load_snapshot_v5(historical).unwrap();
    assert_eq!(migrated.world().resource::<SavedDining>().diners.len(), 1);
    assert!(migrated
        .world()
        .resource::<SavedDining>()
        .diners
        .iter()
        .all(|d| d.chair.is_none()));
    for _ in 0..40 {
        let mut replay = Sim::new_from_shipped_lot();
        replay
            .load_snapshot_v5(migrated.save_snapshot_v5())
            .unwrap();
        assert_eq!(replay.world_hash(), migrated.world_hash());
        migrated.tick();
    }
}

#[test]
fn washing_a_blocking_pile_while_someone_dines_clears_annoyance_and_remains_loadable() {
    let (mut sim, _, table) = ready();
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .dishes
        .push(SavedDishes {
            id: 0,
            surface: table.index_u32(),
            owner: 2,
            units: 4,
        });
    sim.world_mut().resource_mut::<SavedDomestic>().next_dish = 1;
    advance(sim.world_mut());
    assert!(sim
        .world()
        .resource::<SavedDining>()
        .diners
        .iter()
        .any(|d| !d.obstructing.is_empty()));
    // Washing removes the attributed record; maintain is called synchronously by washing.
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .dishes
        .clear();
    maintain(sim.world_mut());
    assert!(sim
        .world()
        .resource::<SavedDining>()
        .diners
        .iter()
        .all(|d| d.obstructing.is_empty()));
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(sim.world_hash(), loaded.world_hash());
}

#[test]
fn cancelling_the_last_tableless_guest_while_paused_clears_the_batch_marker() {
    let (mut sim, people, _) = ready();
    let pack = sim.world().resource::<Content>().0;
    let shared = pack
        .chains
        .iter()
        .position(|c| c.id == crate::domestic::SHARED)
        .unwrap() as u32;
    let counter = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| pack.object(o.0).id == "counter")
        .unwrap()
        .0;
    let cook = sim.world().get::<SimId>(people[0]).unwrap().0;
    let guest = sim.world().get::<SimId>(people[1]).unwrap().0;
    sim.world_mut().entity_mut(people[1]).insert(ChainState {
        step: 1,
        ..ChainState::begin(shared)
    });
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .meals
        .push(SavedMeal {
            cook,
            counter: counter.index_u32(),
            table: None,
            guests: vec![guest],
            claimed: vec![guest],
            collected: vec![guest],
            eaten: vec![],
            scale: 1.0,
            tick: 0,
            dining_started: true,
        });
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .serving_meals
        .push((cook, 0));
    maintain(sim.world_mut());
    sim.world_mut()
        .resource_mut::<SavedDining>()
        .tableless
        .push((cook, 0));
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::CancelIntents {
            agent: people[1].index_u32(),
        });
    sim.flush_commands();
    assert!(sim.world().resource::<SavedDining>().tableless.is_empty());
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(sim.world_hash(), loaded.world_hash());
}

#[test]
fn current_dining_records_cannot_omit_a_claim_or_a_dirty_setting() {
    let (mut sim, _, table) = ready();
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .dishes
        .push(SavedDishes {
            id: 0,
            surface: table.index_u32(),
            owner: 2,
            units: 4,
        });
    sim.world_mut().resource_mut::<SavedDomestic>().next_dish = 1;
    advance(sim.world_mut());
    let snapshot = sim.save_snapshot_v5();
    let before = sim.world_hash();
    for field in 0..2 {
        let mut forged = snapshot.clone();
        let state = forged.dining.as_mut().unwrap();
        if field == 0 {
            state.diners.remove(0);
        } else {
            state.settings.remove(0);
        }
        assert!(sim.load_snapshot_v5(forged).is_err());
        assert_eq!(sim.world_hash(), before);
    }
}

#[test]
fn hash_observes_every_future_dining_decision_field() {
    let (mut sim, people, table) = ready();
    advance(sim.world_mut());
    let mut state = sim.world().resource::<SavedDining>().clone();
    state.settings = vec![(0, 0)];
    state.opportunities = vec![SavedCleanupOpportunity {
        person: people[0].index_u32(),
        room: 0,
        known: vec![0],
        pending: true,
    }];
    state.complaints = vec![(people[0].index_u32(), vec![0])];
    state.tableless = vec![(0, 42)];
    state.diners[0].obstructing = vec![0];
    sim.world_mut().insert_resource(state.clone());
    let before = sim.world_hash();
    for field in 0..18 {
        let mut changed = state.clone();
        match field {
            0 => changed.diners[0].person += 1,
            1 => changed.diners[0].station = table.index_u32() + 1,
            2 => changed.diners[0].chair = None,
            3 => changed.diners[0].setting = None,
            4 => changed.diners[0].endpoint.0 += 1,
            5 => changed.diners[0].endpoint.1 += 1,
            6 => changed.diners[0].obstructing.clear(),
            7 => changed.settings[0].0 += 1,
            8 => changed.settings[0].1 += 1,
            9 => changed.opportunities[0].person += 1,
            10 => changed.opportunities[0].room += 1,
            11 => changed.opportunities[0].pending = false,
            12 => changed.opportunities[0].known.clear(),
            13 => changed.complaints[0].0 += 1,
            14 => changed.complaints[0].1.clear(),
            15 => changed.tableless[0].0 += 1,
            16 => changed.tableless[0].1 += 1,
            _ => changed.diners.pop().map(|_| ()).unwrap(),
        }
        sim.world_mut().insert_resource(changed);
        assert_ne!(
            before,
            sim.world_hash(),
            "dining hash ignores field {field}"
        );
        sim.world_mut().insert_resource(state.clone());
        assert_eq!(before, sim.world_hash());
    }
}

#[test]
fn one_dirty_chair_setting_leaves_the_other_physical_seat_available() {
    let (mut sim, people, table) = ready();
    advance(sim.world_mut());
    let dirty = sim
        .world()
        .resource::<SavedDining>()
        .diners
        .iter()
        .find_map(|d| d.setting)
        .unwrap();
    sim.world_mut().insert_resource(SavedDining {
        settings: vec![(0, dirty)],
        ..SavedDining::default()
    });
    sim.world_mut().entity_mut(table).remove::<Reserved>();
    for p in &people {
        sim.world_mut()
            .entity_mut(*p)
            .remove::<Target>()
            .remove::<Path>();
    }
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .dishes
        .push(SavedDishes {
            id: 0,
            surface: table.index_u32(),
            owner: 2,
            units: 1,
        });
    sim.world_mut().resource_mut::<SavedDomestic>().next_dish = 1;
    advance(sim.world_mut());
    let diners = &sim.world().resource::<SavedDining>().diners;
    assert_eq!(diners.iter().filter(|d| d.chair.is_some()).count(), 1);
    assert!(diners.iter().all(|d| d.setting != Some(dirty)));
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(sim.world_hash(), loaded.world_hash());
}
