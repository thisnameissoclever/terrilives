use super::*;
use terri_core::{
    ChainState, Entity, Habituation, Personality, Satisfaction, SimId, SmartObject, StepWork,
};

use super::browser_books::ModelFactRow as ModelFact;

fn spawn_on_grid(sim: &mut Sim, position: Position, object: terri_core::ObjectDefId) -> Entity {
    let pack = sim.world().resource::<Content>().0;
    let definition = pack.object(object);
    let footprint = definition.footprint_at(definition.base_facing);
    for y in 0..footprint.depth {
        for x in 0..footprint.width {
            assert!(
                sim.world()
                    .resource::<TileGrid>()
                    .is_walkable(position.x as i32 + x as i32, position.y as i32 + y as i32),
                "fixture furniture overlaps"
            );
        }
    }
    let entity = sim.spawn_object(position, object);
    for y in 0..footprint.depth {
        for x in 0..footprint.width {
            sim.world_mut().resource_mut::<TileGrid>().set_blocked(
                position.x as usize + x as usize,
                position.y as usize + y as usize,
                true,
            );
        }
    }
    entity
}

fn fixture(model: &str, hob: &str) -> (SimHandle, Entity, Entity) {
    let content = Content(Box::leak(Box::new(
        postcard::from_bytes(include_bytes!(
            "../../terri-data/tests/fixtures/inherited-runtime.pack"
        ))
        .unwrap(),
    )));
    let mut pack = content.0.clone();
    pack.decay_per_tick = [0.0; 7];
    pack.tuning.neglect_bleed_per_tick = 0.0;
    pack.tuning.satisfaction_mood_per_tick = 0.0;
    pack.lot.front_door = None;
    pack.portals.clear();
    let id = pack.find(model).unwrap();
    let content = Content(Box::leak(Box::new(pack)));
    let mut sim = Sim::new_with_lot_and_content(24, 24, content);
    sim.world_mut()
        .insert_resource(terri_core::layout::SavedLayout::EdgeWallsV1 { edges: vec![] });
    let mut household = vec![content.0.household[0].clone()];
    household[0].x = 0.0;
    household[0].y = 3.0;
    household[0].career = None;
    household[0].hobbies.clear();
    household[0].traits.clear();
    household[0].needs = [50.0; 7];
    sim.spawn_household(&content.0.personalities, &household, &content.0.traits);
    let person = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .next()
        .unwrap()
        .0;
    sim.world_mut()
        .get_mut::<Personality>(person)
        .unwrap()
        .satisfaction = [1.0; 7];
    let fridge = spawn_on_grid(&mut sim, Position { x: 3.0, y: 3.0 }, id);
    for (model, x) in [("counter", 7.0), (hob, 9.0), ("dining_table", 12.0)] {
        spawn_on_grid(
            &mut sim,
            Position { x, y: 3.0 },
            content.0.find(model).unwrap(),
        );
    }
    assert!(
        terri_sim::placement::sale::validate_sale(sim.world(), fridge.index_u32()).is_ok(),
        "fixture layout, furniture and collision grid must agree before a recipe starts"
    );
    (SimHandle { sim }, person, fridge)
}

fn order(handle: &mut SimHandle, person: Entity, object: Entity, row: u32) {
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: person.index_u32(),
            object: object.index_u32(),
            interaction: row,
        });
}

fn round_trip(handle: &mut SimHandle) {
    let saved = handle.sim.save_snapshot_v6();
    let bytes = handle.save_bytes();
    let hash = handle.world_hash();
    assert!(
        handle.load_bytes(&bytes),
        "public V6 load must accept its own state"
    );
    assert_eq!(handle.sim.save_snapshot_v6(), saved);
    assert_eq!(handle.world_hash(), hash);
    assert_eq!(handle.save_bytes(), bytes);
}

#[test]
fn inherited_runtime_public_recipe_values_origin_and_final_v6() {
    for (model, row, expected, gains, reward) in [
        ("fridge", 0, vec![20, 30, 35], [40.0, 0.0, 0.0], 0.0),
        (
            "fixture_fridge",
            0,
            vec![21, 32, 38],
            [17.0, 9.0, -6.0],
            4.0,
        ),
        ("fixture_fridge", 1, vec![], [23.0, 7.0, -5.0], 5.0),
    ] {
        let (mut handle, person, fridge) = fixture(model, "fixture_hob");
        let pack = handle.sim.world().resource::<Content>().0;
        let definition = pack.find(model).unwrap();
        let action = &pack.object(definition).interactions[row as usize];
        let facts: Vec<ModelFact> = postcard::from_bytes(&handle.model_metadata()).unwrap();
        let facts = &facts.iter().find(|f| f.1 == model).unwrap().14;
        assert_eq!(facts.len(), 2, "bound recipes have one public row each");
        assert_eq!(facts[row as usize].2, action.duration_ticks);
        assert_eq!(facts[row as usize].5, action.advertises);
        assert_eq!(
            facts[row as usize].6,
            action.satisfaction * Satisfaction::REWARD_SCALE
        );
        assert!(facts[row as usize]
            .8
            .iter()
            .any(|role| role == "prep_surface"));
        let expected = if expected.is_empty() {
            action.recipe.as_ref().unwrap().steps.clone()
        } else {
            expected
        };
        assert_eq!(
            handle
                .sim
                .interaction_labels(fridge.index_u32())
                .unwrap()
                .len(),
            2
        );
        let before = *handle.sim.world().get::<Needs>(person).unwrap();
        let satisfaction = handle
            .sim
            .world()
            .get::<Satisfaction>(person)
            .unwrap()
            .value();
        order(&mut handle, person, fridge, row);
        let mut work = vec![0; expected.len()];
        let mut saved_stages = std::collections::BTreeSet::new();
        let mut active = false;
        let mut completed = false;
        for _ in 0..2000 {
            handle.tick();
            if let Some(state) = handle.sim.world().get::<ChainState>(person).copied() {
                active = true;
                if let Some(step) = handle.sim.world().get::<StepWork>(person) {
                    work[state.step as usize] =
                        work[state.step as usize].max(step.remaining_ticks + 1);
                    if saved_stages.insert(state.step) {
                        round_trip(&mut handle);
                    }
                }
                let current = handle.sim.world().get::<Needs>(person).unwrap();
                assert_eq!(
                    current.get(NeedId::Hunger),
                    before.get(NeedId::Hunger),
                    "no reward before eating finishes"
                );
            } else if active {
                completed = true;
                break;
            }
        }
        assert!(completed, "{model}/{row} must finish");
        assert_eq!(
            work, expected,
            "actual sampled work must match compiled values"
        );
        assert_eq!(work.iter().sum::<u32>(), action.duration_ticks);
        let recipe = pack
            .chains
            .iter()
            .find(|chain| chain.id == action.recipe.as_ref().unwrap().recipe)
            .unwrap();
        let standing_ticks: u32 = recipe
            .steps
            .iter()
            .zip(&work)
            .filter(|(step, _)| step.consumes.is_some())
            .map(|(_, ticks)| *ticks)
            .sum();
        let after = handle.sim.world().get::<Needs>(person).unwrap();
        for (need, gain) in [NeedId::Hunger, NeedId::Comfort, NeedId::Hygiene]
            .into_iter()
            .zip(gains)
        {
            let expected = gain
                - if need == NeedId::Comfort {
                    standing_ticks as f32
                        * pack
                            .tuning
                            .need_interactions
                            .standing_meal_comfort_cost_per_tick
                } else {
                    0.
                };
            assert!(
                (after.get(need) - before.get(need) - expected).abs() < 0.001,
                "{model}/{row}: {need:?}"
            );
        }
        assert!(
            (handle
                .sim
                .world()
                .get::<Satisfaction>(person)
                .unwrap()
                .value()
                - satisfaction
                - reward * Satisfaction::REWARD_SCALE)
                .abs()
                < 0.00001
        );
        let habits = handle.sim.world().get::<Habituation>(person).unwrap();
        assert_eq!(
            habits.get(definition, row),
            pack.tuning.habituation_per_use - pack.tuning.habituation_decay_per_tick
        );
        if model != "fridge" {
            assert_eq!(habits.get(pack.find("fridge").unwrap(), row), 0.0);
        }
        assert!(handle.sim.save_snapshot_v6().chain_origins.is_empty());
        round_trip(&mut handle);
    }
}

#[test]
fn inherited_runtime_current_origins_reject_transactionally() {
    let (mut handle, person, fridge) = fixture("fixture_fridge", "fixture_hob");
    order(&mut handle, person, fridge, 1);
    handle.tick();
    let snapshot = handle.sim.save_snapshot_v6();
    assert_eq!(snapshot.chain_origins.len(), 1);
    let bytes = handle.save_bytes();
    let hash = handle.world_hash();
    let mut cases = Vec::new();
    let mut bad = snapshot.clone();
    bad.chain_origins.clear();
    cases.push(bad);
    let mut bad = snapshot.clone();
    bad.chain_origins.push(bad.chain_origins[0].clone());
    cases.push(bad);
    let mut bad = snapshot.clone();
    bad.chain_origins[0].person = fridge.index_u32();
    cases.push(bad);
    for action in ["unknown", "grab_snack"] {
        let mut bad = snapshot.clone();
        if let terri_core::save_v6::ChainOrigin::Action { action: id, .. } =
            &mut bad.chain_origins[0].origin
        {
            *id = action.into();
        }
        cases.push(bad);
    }
    for bad in cases {
        assert!(handle.sim.load_snapshot_v6(bad).is_err());
        assert_eq!(handle.save_bytes(), bytes);
        assert_eq!(handle.world_hash(), hash);
    }
    let pack = handle.sim.world().resource::<Content>().0;
    let replacement = spawn_on_grid(
        &mut handle.sim,
        Position { x: 6.0, y: 7.0 },
        pack.find("fridge").unwrap(),
    );
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: person.index_u32(),
            object: replacement.index_u32(),
            interaction: 1,
        });
    handle.tick();
    assert!(
        matches!(&handle.sim.save_snapshot_v6().chain_origins[0].origin, terri_core::save_v6::ChainOrigin::Action { model, action, .. } if model=="fridge" && action=="cook_dinner")
    );
    round_trip(&mut handle);
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: person.index_u32(),
        });
    handle.flush_commands();
    assert!(handle.sim.save_snapshot_v6().chain_origins.is_empty());
}

#[test]
fn inherited_runtime_removed_actions_do_not_appear_from_station_role() {
    let (mut handle, person, station) = fixture("fixture_station", "fixture_hob");
    assert!(handle
        .sim
        .interaction_labels(station.index_u32())
        .unwrap()
        .is_empty());
    order(&mut handle, person, station, 1);
    handle.tick();
    assert!(handle.sim.world().get::<ChainState>(person).is_none());
}

#[test]
fn inherited_runtime_death_releases_selected_appliance_origin() {
    let (mut handle, person, fridge) = fixture("fixture_fridge", "fixture_hob");
    order(&mut handle, person, fridge, 0);
    handle.tick();
    assert_eq!(handle.sim.save_snapshot_v6().chain_origins.len(), 1);
    let threshold = handle
        .sim
        .world()
        .resource::<Content>()
        .0
        .tuning
        .death_after_ticks;
    *handle.sim.world_mut().get_mut::<Needs>(person).unwrap() = Needs::all_at(0.0);
    handle
        .sim
        .world_mut()
        .resource_mut::<terri_core::save::SavedMortality>()
        .counts = vec![(person.index_u32(), threshold - 1)];
    handle.tick();
    assert!(handle.sim.world().get_entity(person).is_err());
    assert!(handle.sim.save_snapshot_v6().chain_origins.is_empty());
    assert!(
        terri_sim::placement::sale::validate_sale(handle.sim.world(), fridge.index_u32()).is_ok()
    );
    round_trip(&mut handle);
}

#[test]
fn inherited_runtime_origin_owner_requires_a_living_agent() {
    let (mut handle, person, fridge) = fixture("fixture_fridge", "fixture_hob");
    order(&mut handle, person, fridge, 1);
    handle.tick();
    let before = handle.save_bytes();
    let hash = handle.world_hash();
    let mut bad = handle.sim.save_snapshot_v6();
    let actor = bad
        .legacy
        .world
        .entities
        .iter_mut()
        .find(|e| e.index == person.index_u32())
        .unwrap();
    let progress = actor.chain.take().unwrap();
    actor.target = None;
    actor.path = None;
    actor.step_work_ticks = None;
    actor.carrying = None;
    let sim_id = actor.sim_id.unwrap();
    bad.legacy.boundaries.retain(|b| b.actor != sim_id);
    let object = bad
        .legacy
        .world
        .entities
        .iter_mut()
        .find(|e| e.index == fridge.index_u32())
        .unwrap();
    assert!(!object.agent);
    object.needs = Some([50.0; 7]);
    object.chain = Some(progress);
    object.reserved = false;
    bad.chain_origins[0].person = fridge.index_u32();
    assert!(
        handle.sim.load_snapshot_v6(bad).is_err(),
        "needs on a furniture entity do not make it a living recipe owner"
    );
    assert_eq!(handle.save_bytes(), before);
    assert_eq!(handle.world_hash(), hash);
}

#[test]
fn inherited_runtime_media_requires_gameplay_semantics_and_restores_seats() {
    for (model, activity, seated) in [
        ("fixture_tv", 14, true),
        ("fixture_radio", 18, true),
        ("fixture_label_tv", 14, false),
    ] {
        let (mut handle, person, _) = fixture("fixture_station", "fixture_hob");
        let pack = handle.sim.world().resource::<Content>().0;
        *handle.sim.world_mut().get_mut::<Position>(person).unwrap() = Position { x: 0.0, y: 10.0 };
        let device = spawn_on_grid(
            &mut handle.sim,
            Position { x: 2.0, y: 10.0 },
            pack.find(model).unwrap(),
        );
        let chair = spawn_on_grid(
            &mut handle.sim,
            Position { x: 5.0, y: 10.0 },
            pack.find("armchair").unwrap(),
        );
        terri_sim::apply_object_placement(
            handle.sim.world_mut(),
            chair,
            pack.object(pack.find("armchair").unwrap()),
            Position { x: 5.0, y: 10.0 },
            terri_core::Facing::SouthWest,
        );
        order(&mut handle, person, device, 0);
        let mut active = false;
        for _ in 0..120 {
            handle.tick();
            if handle
                .sim
                .world()
                .get::<terri_core::Eating>(person)
                .is_some()
            {
                active = true;
                break;
            }
        }
        assert!(active);
        let saved = handle.sim.save_snapshot_v6();
        assert_eq!(
            saved
                .seats
                .iter()
                .any(|claim| claim.person == person.index_u32()
                    && claim.furniture == chair.index_u32()
                    && claim.target == device.index_u32()),
            seated
        );
        let secondary = saved.legacy.dining.as_ref().is_some_and(|d| {
            d.diners
                .iter()
                .any(|d| d.person == person.index_u32() && d.chair == Some(chair.index_u32()))
        });
        assert_eq!(secondary, seated);
        handle.sim.sync_render_buffer();
        let render = handle.sim.render_buffer();
        let row = render
            .ids
            .iter()
            .position(|&e| e == person.index_u32())
            .unwrap();
        assert_eq!(render.activities[row], activity);
        if seated {
            assert_eq!(render.visual_actions[row], 8);
            assert_eq!(render.interaction_targets[row], chair.index_u32());
        }
        round_trip(&mut handle);
        handle
            .sim
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::CancelIntents {
                agent: person.index_u32(),
            });
        handle.flush_commands();
        assert!(handle.sim.save_snapshot_v6().seats.is_empty());
    }
}

#[test]
fn inherited_runtime_cooking_front_is_shared_rotated_and_wall_aware() {
    for facing in terri_core::Facing::ALL {
        let mut evidence = Vec::new();
        for model in ["stove", "fixture_hob"] {
            for blocked in [false, true] {
                let (mut handle, person, fridge) = fixture("fixture_fridge", model);
                let pack = handle.sim.world().resource::<Content>().0;
                let hob = handle
                    .sim
                    .world_mut()
                    .query::<(Entity, &SmartObject)>()
                    .iter(handle.sim.world())
                    .find(|(_, o)| pack.object(o.0).id == model)
                    .unwrap()
                    .0;
                terri_sim::apply_object_placement(
                    handle.sim.world_mut(),
                    hob,
                    pack.object(pack.find(model).unwrap()),
                    Position { x: 9.0, y: 3.0 },
                    facing,
                );
                let (dx, dy) = facing.rotate_axis(1, 0);
                let front = (9 + dx, 3 + dy);
                if blocked {
                    handle
                        .sim
                        .world_mut()
                        .resource_mut::<TileGrid>()
                        .set_edge_blocked((9, 3), front, true);
                }
                order(&mut handle, person, fridge, 1);
                let mut cooked = false;
                for _ in 0..850 {
                    handle.tick();
                    let cooking = handle
                        .sim
                        .world()
                        .get::<ChainState>(person)
                        .is_some_and(|c| c.step == 2)
                        && handle.sim.world().get::<StepWork>(person).is_some();
                    if cooking {
                        cooked = true;
                        handle.sim.sync_render_buffer();
                        let render = handle.sim.render_buffer();
                        let row = render
                            .ids
                            .iter()
                            .position(|&e| e == person.index_u32())
                            .unwrap();
                        assert_eq!(
                            (render.positions[row * 2], render.positions[row * 2 + 1]),
                            (front.0 as f32, front.1 as f32)
                        );
                        assert_eq!(render.sound_sources[row], hob.index_u32());
                        evidence.push((
                            render.positions[row * 2],
                            render.positions[row * 2 + 1],
                            render.facings[row],
                            render.sound_actions[row],
                        ));
                        round_trip(&mut handle);
                        break;
                    }
                }
                assert_eq!(cooked, !blocked, "{model} {facing:?}");
                if blocked {
                    assert_eq!(
                        handle.sim.world().get::<ChainState>(person).unwrap().step,
                        2
                    );
                }
            }
        }
        assert_eq!(evidence[0], evidence[1]);
    }
}

#[test]
fn inherited_runtime_origin_outlives_sold_fridge_and_survives_preemption() {
    let (mut handle, person, fridge) = fixture("fixture_fridge", "fixture_hob");
    let pack = handle.sim.world().resource::<Content>().0;
    spawn_on_grid(
        &mut handle.sim,
        Position { x: 4.0, y: 6.0 },
        pack.find("fixture_station").unwrap(),
    );
    let mut needs = terri_core::Needs::all_at(100.0);
    needs.set(terri_core::NeedId::Hunger, 0.0);
    *handle
        .sim
        .world_mut()
        .get_mut::<terri_core::Needs>(person)
        .unwrap() = needs;
    for _ in 0..150 {
        handle.tick();
        if handle
            .sim
            .world()
            .get::<ChainState>(person)
            .is_some_and(|c| c.step == 1)
        {
            break;
        }
    }
    assert_eq!(
        handle.sim.world().get::<ChainState>(person).unwrap().step,
        1
    );
    assert_eq!(handle.sim.queued_orders_of(person.index_u32()), 0);
    assert!(handle.sim.save_snapshot_v6().recipe_orders.is_empty());
    assert!(handle.sim.save_snapshot_v6().chain_origins.iter().any(|origin|
        matches!(&origin.origin, terri_core::save_v6::ChainOrigin::Action { model, action, .. }
            if model == "fixture_fridge" && action == "grab_snack")));
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SellObject {
            object: fridge.index_u32(),
        });
    handle.flush_commands();
    assert!(
        handle.sim.world().get_entity(fridge).is_err(),
        "ingredient source must be sellable after collection: {:?}",
        handle
            .sim
            .world()
            .resource::<terri_sim::placement::LotEditState>()
            .last_sale_result
    );
    let saved = handle.sim.save_snapshot_v6();
    assert!(saved
        .actions
        .objects
        .iter()
        .any(|o| o.model == "fixture_fridge"));
    assert!(saved
        .legacy
        .world
        .entities
        .iter()
        .all(|e| e.smart_object.as_deref() != Some("fixture_fridge")));
    round_trip(&mut handle);
    let toilet = spawn_on_grid(
        &mut handle.sim,
        Position { x: 5.0, y: 8.0 },
        pack.find("toilet").unwrap(),
    );
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: person.index_u32(),
            object: toilet.index_u32(),
            interaction: 0,
        });
    handle.tick();
    round_trip(&mut handle);
    for _ in 0..600 {
        handle.tick();
        if handle.sim.world().get::<ChainState>(person).is_none() {
            break;
        }
    }
    assert!(handle.sim.world().get::<ChainState>(person).is_none());
    assert!(
        handle
            .sim
            .world()
            .get::<Habituation>(person)
            .unwrap()
            .get(pack.find("fixture_fridge").unwrap(), 0)
            > 0.0
    );
    assert_eq!(
        handle
            .sim
            .world()
            .get::<Habituation>(person)
            .unwrap()
            .get(pack.find("fridge").unwrap(), 0),
        0.0
    );
    round_trip(&mut handle);
}

#[test]
fn inherited_runtime_directed_recipe_keeps_its_source_until_order_completion() {
    let (mut handle, person, fridge) = fixture("fixture_fridge", "fixture_hob");
    order(&mut handle, person, fridge, 0);
    for _ in 0..150 {
        handle.tick();
        if handle
            .sim
            .world()
            .get::<ChainState>(person)
            .is_some_and(|chain| chain.step == 1)
        {
            break;
        }
    }
    assert_eq!(
        handle.sim.world().get::<ChainState>(person).unwrap().step,
        1
    );
    assert_eq!(handle.sim.queued_orders_of(person.index_u32()), 1);
    assert_eq!(
        terri_sim::placement::sale::validate_sale(handle.sim.world(), fridge.index_u32()).err(),
        Some(terri_sim::placement::PlacementRefusal::InUse)
    );
    round_trip(&mut handle);
    for _ in 0..600 {
        handle.tick();
        if handle.sim.world().get::<ChainState>(person).is_none() {
            break;
        }
    }
    assert!(handle.sim.world().get::<ChainState>(person).is_none());
    assert_eq!(handle.sim.queued_orders_of(person.index_u32()), 0);
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SellObject {
            object: fridge.index_u32(),
        });
    handle.flush_commands();
    assert!(handle.sim.world().get_entity(fridge).is_err());
    round_trip(&mut handle);
}

#[test]
fn inherited_runtime_selected_fridge_is_visited_before_nearer_competitor() {
    let (mut handle, person, selected) = fixture("fixture_fridge", "fixture_hob");
    let pack = handle.sim.world().resource::<Content>().0;
    let other = spawn_on_grid(
        &mut handle.sim,
        Position { x: 1.0, y: 3.0 },
        pack.find("fridge").unwrap(),
    );
    order(&mut handle, person, selected, 0);
    handle.tick();
    assert_eq!(
        handle
            .sim
            .world()
            .get::<terri_core::Target>(person)
            .unwrap()
            .object,
        selected
    );
    assert_ne!(selected, other);
    let saved = handle.sim.save_snapshot_v6();
    assert_eq!(
        saved.chain_origins[0].selected_use,
        terri_core::save_v6::SavedSelectedUse::Station(selected.index_u32())
    );
    round_trip(&mut handle);
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SellObject {
            object: selected.index_u32(),
        });
    handle.flush_commands();
    assert!(handle.sim.world().get_entity(selected).is_ok());
    for _ in 0..120 {
        handle.tick();
        if handle
            .sim
            .world()
            .get::<ChainState>(person)
            .is_some_and(|c| c.step > 0)
        {
            break;
        }
    }
    assert_eq!(
        handle.sim.save_snapshot_v6().chain_origins[0].selected_use,
        terri_core::save_v6::SavedSelectedUse::Complete
    );
}

#[test]
fn inherited_runtime_fixture_collision_is_required_for_sale_validation() {
    let (mut handle, _, fridge) = fixture("fixture_fridge", "fixture_hob");
    assert!(!handle.sim.world().resource::<TileGrid>().is_walkable(3, 3));
    assert!(
        terri_sim::placement::sale::validate_sale(handle.sim.world(), fridge.index_u32()).is_ok()
    );
    handle
        .sim
        .world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(3, 3, false);
    assert!(matches!(
        terri_sim::placement::sale::validate_sale(handle.sim.world(), fridge.index_u32()),
        Err(terri_sim::placement::PlacementRefusal::UnsupportedLayout)
    ));
    handle
        .sim
        .world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(3, 3, true);
    assert!(
        terri_sim::placement::sale::validate_sale(handle.sim.world(), fridge.index_u32()).is_ok()
    );
}

#[test]
fn inherited_runtime_autonomy_scores_resolved_values_not_recipe_defaults() {
    let mut choices = Vec::new();
    for changed_defaults in [false, true] {
        let (mut handle, person, fridge) = fixture("fixture_fridge", "fixture_hob");
        if changed_defaults {
            let mut pack = handle.sim.world().resource::<Content>().0.clone();
            let recipe = pack
                .chains
                .iter_mut()
                .find(|c| c.id == "prepare_snack")
                .unwrap();
            for step in &mut recipe.steps {
                step.duration_ticks *= 2;
            }
            recipe.advertises = vec![(NeedId::Hunger as u8, 99.0)];
            recipe.satisfaction = 99.0;
            handle
                .sim
                .world_mut()
                .insert_resource(Content(Box::leak(Box::new(pack))));
        }
        handle.tick();
        let telemetry = &handle
            .sim
            .world()
            .resource::<terri_sim::systems::autonomy::DecisionTelemetry>()
            .0;
        let decision = telemetry
            .iter()
            .find(|d| d.agent == person.index_u32())
            .unwrap();
        assert!(decision
            .choices
            .iter()
            .any(
                |(object, row, _, _, probability)| *object == fridge.index_u32()
                    && *row == 0
                    && *probability > 0.0
            ));
        choices.push(decision.choices.clone());
    }
    assert_eq!(
        choices[0], choices[1],
        "resolved action values govern actual autonomous utilities and probabilities"
    );
}

#[test]
fn inherited_runtime_second_sink_keeps_selected_washing_stage_and_variable_work() {
    let (mut handle, person, fridge) = fixture("fixture_fridge", "fixture_hob");
    order(&mut handle, person, fridge, 0);
    let mut active = false;
    for _ in 0..300 {
        handle.tick();
        if handle.sim.world().get::<ChainState>(person).is_some() {
            active = true;
        } else if active {
            break;
        }
    }
    let pack = handle.sim.world().resource::<Content>().0;
    let selected = spawn_on_grid(
        &mut handle.sim,
        Position { x: 15.0, y: 8.0 },
        pack.find("fixture_sink").unwrap(),
    );
    spawn_on_grid(
        &mut handle.sim,
        Position { x: 5.0, y: 3.0 },
        pack.find("kitchen_sink").unwrap(),
    );
    assert_eq!(
        handle.sim.interaction_labels(selected.index_u32()).unwrap(),
        ["Wash hands", "Clean dishes"]
    );
    let units: u32 = handle
        .sim
        .save_snapshot_v6()
        .legacy
        .domestic
        .as_ref()
        .unwrap()
        .dishes
        .iter()
        .map(|d| d.units)
        .sum();
    assert_eq!(units, 2);
    let before = *handle.sim.world().get::<Needs>(person).unwrap();
    let satisfaction = handle
        .sim
        .world()
        .get::<Satisfaction>(person)
        .unwrap()
        .value();
    order(&mut handle, person, selected, 1);
    let mut work = [0, 0];
    let mut stages = std::collections::BTreeSet::new();
    let mut active = false;
    for _ in 0..500 {
        handle.tick();
        if let Some(chain) = handle.sim.world().get::<ChainState>(person).copied() {
            active = true;
            if let Some(step) = handle.sim.world().get::<StepWork>(person) {
                work[chain.step as usize] = work[chain.step as usize].max(step.remaining_ticks + 1);
                if chain.step == 1 {
                    assert_eq!(
                        handle
                            .sim
                            .world()
                            .get::<terri_core::Target>(person)
                            .unwrap()
                            .object,
                        selected
                    );
                }
                if stages.insert(chain.step) {
                    round_trip(&mut handle);
                }
            }
        } else if active {
            break;
        }
    }
    assert_eq!(work, [27, 43]);
    assert!(handle
        .sim
        .save_snapshot_v6()
        .legacy
        .domestic
        .unwrap()
        .dishes
        .is_empty());
    let after = handle.sim.world().get::<Needs>(person).unwrap();
    assert!((after.get(NeedId::Hygiene) - before.get(NeedId::Hygiene) - 11.0).abs() < 0.001);
    assert!((after.get(NeedId::Comfort) - before.get(NeedId::Comfort) + 4.0).abs() < 0.001);
    assert!(
        (handle
            .sim
            .world()
            .get::<Satisfaction>(person)
            .unwrap()
            .value()
            - satisfaction
            - 0.006)
            .abs()
            < 0.00001
    );
    round_trip(&mut handle);
}

#[test]
fn inherited_runtime_published_blocked_and_suspended_initial_use_migrates_explicitly() {
    for suspended in [false, true] {
        let content = Content::pre_books();
        let mut old = SimHandle {
            sim: Sim::new_household_with_content(content, content.0.tuning.rng_seed),
        };
        let mut people: Vec<_> = old
            .sim
            .world_mut()
            .query::<(Entity, &Agent)>()
            .iter(old.sim.world())
            .map(|(e, _)| e)
            .collect();
        people.sort_by_key(|e| e.index_u32());
        let fridge = old
            .sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(old.sim.world())
            .find(|(_, o)| content.0.object(o.0).id == "fridge")
            .unwrap()
            .0;
        let actor = if suspended { people[0] } else { people[1] };
        if !suspended {
            order(&mut old, people[0], fridge, 0);
        }
        order(&mut old, actor, fridge, 1);
        old.tick();
        if suspended {
            let toilet = old
                .sim
                .world_mut()
                .query::<(Entity, &SmartObject)>()
                .iter(old.sim.world())
                .find(|(_, o)| content.0.object(o.0).id == "toilet")
                .unwrap()
                .0;
            old.sim
                .world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObjectFirst {
                    agent: actor.index_u32(),
                    object: toilet.index_u32(),
                    interaction: 0,
                });
            old.tick();
        }
        assert_eq!(old.sim.world().get::<ChainState>(actor).unwrap().step, 0);
        assert!(old
            .sim
            .world()
            .get::<terri_core::Target>(actor)
            .is_none_or(|t| t.interaction != u32::MAX));
        let source = old.sim.save_snapshot_v5();
        let mut source_control =
            Sim::new_household_with_content(content, content.0.tuning.rng_seed);
        source_control
            .load_snapshot_v5(source.clone())
            .unwrap_or_else(|error| panic!("frozen source suspended={suspended}: {error:?}"));
        let mut bytes = SAVE_MAGIC.to_vec();
        bytes.extend_from_slice(&5u16.to_le_bytes());
        bytes.extend(postcard::to_allocvec(&source).unwrap());
        let mut current = SimHandle::from_lot();
        assert!(
            current.load_bytes(&bytes),
            "suspended={suspended}; direct migration: {:?}",
            current
                .sim
                .load_legacy_snapshot(terri_sim::LegacySnapshot::V5(Box::new(source.clone())))
        );
        let saved = current.sim.save_snapshot_v6();
        let origin = saved
            .chain_origins
            .iter()
            .find(|o| o.person == actor.index_u32())
            .unwrap();
        assert_eq!(
            origin.selected_use,
            terri_core::save_v6::SavedSelectedUse::LegacyPending
        );
        assert_eq!(saved.legacy.world.rng, current_v5(source.clone()).world.rng);
        assert_eq!(saved.legacy.world.funds, source.world.funds);
        round_trip(&mut current);
        let mut bound = false;
        for _ in 0..1000 {
            current.tick();
            if current
                .sim
                .save_snapshot_v6()
                .chain_origins
                .iter()
                .any(|o| {
                    o.person == actor.index_u32()
                        && matches!(
                            o.selected_use,
                            terri_core::save_v6::SavedSelectedUse::Station(_)
                        )
                })
            {
                bound = true;
                break;
            }
        }
        assert!(
            bound,
            "legacy pending source-model use must eventually bind"
        );
        round_trip(&mut current);
    }
}

#[test]
fn inherited_runtime_published_sink_row_one_maps_to_current_bound_action() {
    let content = Content::pre_books();
    let mut old = Sim::new_household_with_content(content, content.0.tuning.rng_seed);
    let actor = old
        .world_mut()
        .query::<(Entity, &Agent)>()
        .iter(old.world())
        .next()
        .unwrap()
        .0;
    let sink = old
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(old.world())
        .find(|(_, o)| content.0.object(o.0).id == "kitchen_sink")
        .unwrap()
        .0;
    old.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: actor.index_u32(),
            object: sink.index_u32(),
            interaction: 1,
        });
    let fridge = old
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(old.world())
        .find(|(_, o)| content.0.object(o.0).id == "fridge")
        .unwrap()
        .0;
    old.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: actor.index_u32(),
            object: fridge.index_u32(),
            interaction: 0,
        });
    old.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: fridge.index_u32(),
            interaction: 1,
        });
    let source = old.save_snapshot_v5();
    let mut current = SimHandle::from_lot();
    current
        .sim
        .load_legacy_snapshot(terri_sim::LegacySnapshot::V5(Box::new(source)))
        .unwrap();
    let pack = current.sim.world().resource::<Content>().0;
    assert_eq!(
        pack.object(pack.find("kitchen_sink").unwrap()).interactions[1]
            .recipe
            .as_ref()
            .unwrap()
            .recipe,
        "clean_dishes"
    );
    assert_eq!(
        current.sim.interaction_labels(sink.index_u32()).unwrap(),
        ["Wash hands", "Clean dishes"]
    );
    assert!(matches!(
        current.sim.world().resource::<CommandQueue>().as_slice()[0],
        SimCommand::UseObject { interaction: 1, .. }
    ));
    let commands = current.sim.world().resource::<CommandQueue>().as_slice();
    assert_eq!(commands.len(), 3);
    assert!(
        matches!(commands[1], SimCommand::UseObject { interaction:0, object, .. } if object==fridge.index_u32())
    );
    assert!(
        matches!(commands[2], SimCommand::UseObjectFirst { interaction:1, object, .. } if object==fridge.index_u32())
    );
    round_trip(&mut current);
}
