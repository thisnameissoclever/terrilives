use super::*;
use render_buffer::{activity, visual_action};
use terri_core::{Agent, ChainState, Eating, Path, Position, SmartObject, StepWork, Target};

fn projection(sim: &Sim, person: Entity) -> (u32, u32) {
    let buffer = sim.render_buffer();
    let row = buffer
        .ids
        .iter()
        .position(|&id| id == person.index_u32())
        .unwrap();
    (buffer.activities[row], buffer.visual_actions[row])
}

#[test]
fn authored_activity_codes_are_append_only() {
    assert_eq!(
        [
            activity::NONE,
            activity::WALKING,
            activity::WAITING,
            activity::EATING,
            activity::TALKING,
            activity::SLEEPING,
            activity::AT_WORK,
            activity::USING_OBJECT,
            activity::READING,
            activity::EXERCISING,
            activity::WATCHING_FISH,
            activity::SITTING,
            activity::SHOWERING,
            activity::USING_TOILET,
            activity::WATCHING_TV,
            activity::LOUNGING,
            activity::WASHING_HANDS,
            activity::WASHING_DISHES,
            activity::LISTENING_RADIO,
            activity::CORRESPONDENCE,
            activity::BATHING,
            activity::GETTING_INGREDIENTS,
            activity::PREPARING_FOOD,
            activity::COOKING,
        ],
        std::array::from_fn::<_, 24, _>(|index| index as u32)
    );
}

#[test]
fn authored_ordinary_activity_rejects_each_malformed_identity() {
    let pack = terri_data::pack();
    let shower = pack.find("shower").unwrap();
    let toilet = pack.find("toilet").unwrap();
    for case in 0..9 {
        let mut sim = Sim::new_with_lot(16, 16);
        let item = sim.spawn_object(Position { x: 5.0, y: 5.0 }, shower);
        let person = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 5.0 },
                Eating {
                    object: shower,
                    interaction: 0,
                    remaining_ticks: 10,
                },
                Target {
                    object: item,
                    interaction: 0,
                },
            ))
            .id();
        match case {
            0 => {
                sim.world_mut().entity_mut(person).remove::<Target>();
            }
            1 => {
                sim.world_mut()
                    .get_mut::<Target>(person)
                    .unwrap()
                    .interaction = 1;
            }
            2 => {
                sim.world_mut().get_mut::<Eating>(person).unwrap().object = toilet;
            }
            3 => {
                sim.world_mut().entity_mut(item).remove::<SmartObject>();
            }
            4 => {
                sim.world_mut().entity_mut(item).remove::<Position>();
            }
            5 => {
                sim.world_mut()
                    .get_mut::<Target>(person)
                    .unwrap()
                    .interaction = systems::chain::CHAIN_STEP;
            }
            6 => {
                sim.world_mut().entity_mut(person).insert(StepWork {
                    remaining_ticks: 10,
                });
            }
            7 => {
                sim.world_mut()
                    .get_mut::<Target>(person)
                    .unwrap()
                    .interaction = 99;
                sim.world_mut()
                    .get_mut::<Eating>(person)
                    .unwrap()
                    .interaction = 99;
            }
            8 => {
                sim.world_mut().despawn(item);
            }
            _ => unreachable!(),
        }
        sim.sync_render_buffer();
        assert_eq!(
            projection(&sim, person),
            (activity::USING_OBJECT, visual_action::NONE),
            "malformed ordinary identity case {case}"
        );
    }
}

#[test]
fn every_shipped_chain_step_projects_activity_only_while_running_at_its_exact_station() {
    let pack = terri_data::pack();
    assert_eq!(
        pack.chains.len(),
        4,
        "new chains need activity and icon review"
    );
    for (chain_index, chain) in pack.chains.iter().enumerate() {
        let expected: &[(u32, u32)] = match chain.id.as_str() {
            "cook_dinner" => &[
                (activity::GETTING_INGREDIENTS, visual_action::NONE),
                (activity::PREPARING_FOOD, visual_action::PREPARE),
                (activity::COOKING, visual_action::COOK),
                (activity::COOKING, visual_action::COOK),
                (activity::PREPARING_FOOD, visual_action::PREPARE),
                (activity::EATING, visual_action::EAT),
            ],
            "prepare_snack" => &[
                (activity::GETTING_INGREDIENTS, visual_action::NONE),
                (activity::PREPARING_FOOD, visual_action::PREPARE),
                (activity::EATING, visual_action::EAT),
            ],
            "clean_dishes" => &[
                (activity::WASHING_DISHES, visual_action::PREPARE),
                (activity::WASHING_DISHES, visual_action::WASH),
            ],
            "eat_shared_meal" => &[
                (activity::PREPARING_FOOD, visual_action::PREPARE),
                (activity::EATING, visual_action::EAT),
            ],
            id => panic!("unreviewed activity chain {id}"),
        };
        assert_eq!(chain.steps.len(), expected.len());
        for (index, (&(expected, pose), step)) in expected.iter().zip(&chain.steps).enumerate() {
            assert!(
                step.activity.is_some(),
                "each shipped step needs authored identity"
            );
            let definition = pack
                .objects
                .iter()
                .position(|object| object.roles.contains(&step.role))
                .unwrap();
            let mut sim = Sim::new_with_lot(16, 16);
            let station = sim.spawn_object(
                Position { x: 5.0, y: 5.0 },
                terri_data::ObjectDefId(definition as u32),
            );
            let person = sim
                .world_mut()
                .spawn((
                    Agent,
                    Position { x: 4.0, y: 5.0 },
                    ChainState {
                        chain: chain_index as u32,
                        step: index as u32,
                        fumble_scale: 1.0,
                    },
                    Target {
                        object: station,
                        interaction: systems::chain::CHAIN_STEP,
                    },
                ))
                .id();
            sim.sync_render_buffer();
            assert_eq!(
                projection(&sim, person),
                (activity::NONE, visual_action::NONE),
                "resumable progress alone is not running work"
            );
            sim.world_mut().entity_mut(person).insert(StepWork {
                remaining_ticks: 10,
            });
            let before = sim.save_snapshot_v5();
            let before_hash = sim.world_hash();
            sim.sync_render_buffer();
            assert_eq!(
                projection(&sim, person),
                (expected, pose),
                "{} step {index}",
                chain.id
            );
            assert_eq!(sim.save_snapshot_v5(), before);
            assert_eq!(sim.world_hash(), before_hash);
            sim.world_mut().entity_mut(person).remove::<StepWork>();
            sim.sync_render_buffer();
            assert_eq!(
                projection(&sim, person),
                (activity::NONE, visual_action::NONE),
                "completed or paused step clears its bubble"
            );
        }
    }
}

#[test]
fn authored_chain_activity_rejects_each_malformed_station_contract() {
    let pack = terri_data::pack();
    let stove = pack.find("stove").unwrap();
    let fridge = pack.find("fridge").unwrap();
    for case in 0..9 {
        let mut sim = Sim::new_with_lot(16, 16);
        let station = sim.spawn_object(Position { x: 5.0, y: 5.0 }, stove);
        let person = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 5.0 },
                ChainState {
                    chain: 0,
                    step: 2,
                    fumble_scale: 1.0,
                },
                StepWork {
                    remaining_ticks: 10,
                },
                Target {
                    object: station,
                    interaction: systems::chain::CHAIN_STEP,
                },
            ))
            .id();
        match case {
            0 => {
                sim.world_mut().entity_mut(person).remove::<Target>();
            }
            1 => {
                sim.world_mut().entity_mut(person).remove::<ChainState>();
            }
            2 => {
                sim.world_mut().get_mut::<ChainState>(person).unwrap().chain = 99;
            }
            3 => {
                sim.world_mut().get_mut::<ChainState>(person).unwrap().step = 99;
            }
            4 => {
                sim.world_mut()
                    .get_mut::<Target>(person)
                    .unwrap()
                    .interaction = 0;
            }
            5 => {
                sim.world_mut().get_mut::<SmartObject>(station).unwrap().0 = fridge;
            }
            6 => {
                sim.world_mut().entity_mut(station).remove::<Position>();
            }
            7 => {
                sim.world_mut().entity_mut(station).remove::<SmartObject>();
            }
            8 => {
                sim.world_mut().entity_mut(person).insert(Eating {
                    object: stove,
                    interaction: 0,
                    remaining_ticks: 10,
                });
            }
            _ => unreachable!(),
        }
        sim.sync_render_buffer();
        assert_eq!(
            projection(&sim, person),
            (activity::USING_OBJECT, visual_action::NONE),
            "malformed chain contract case {case}"
        );
    }
}

#[test]
fn missing_activity_does_not_guess_from_label_tags_or_sprite() {
    let shipped = terri_data::pack();
    let shower = shipped.find("shower").unwrap();
    let mut pack = shipped.clone();
    let interaction = &mut pack.objects[shower.0 as usize].interactions[0];
    interaction.activity = None;
    interaction.label = "Taking a shower".into();
    interaction.tags = vec!["showering".into()];
    pack.chains[0].steps[2].activity = None;
    let pack = Box::leak(Box::new(pack));
    let mut sim = test_content::sim_with(16, 16, pack);
    let item = sim.spawn_object(Position { x: 5.0, y: 5.0 }, shower);
    let ordinary = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 4.0, y: 5.0 },
            Eating {
                object: shower,
                interaction: 0,
                remaining_ticks: 10,
            },
            Target {
                object: item,
                interaction: 0,
            },
        ))
        .id();
    let stove = sim.spawn_object(Position { x: 10.0, y: 10.0 }, pack.find("stove").unwrap());
    let cook = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 9.0, y: 10.0 },
            ChainState {
                chain: 0,
                step: 2,
                fumble_scale: 1.0,
            },
            StepWork {
                remaining_ticks: 10,
            },
            Target {
                object: stove,
                interaction: systems::chain::CHAIN_STEP,
            },
        ))
        .id();
    sim.sync_render_buffer();
    for (person, pose) in [(ordinary, visual_action::NONE), (cook, visual_action::COOK)] {
        assert_eq!(projection(&sim, person), (activity::USING_OBJECT, pose));
    }
}

#[test]
fn authored_body_action_and_active_state_outrank_indicator_metadata_and_stale_waiting() {
    let shipped = terri_data::pack();
    let mut pack = shipped.clone();
    for object in &mut pack.objects {
        for interaction in &mut object.interactions {
            interaction.activity = Some(terri_data::CompiledActivity::Bathing);
        }
    }
    let pack = Box::leak(Box::new(pack));
    for (object, expected) in [
        ("fridge", activity::EATING),
        ("bed", activity::SLEEPING),
        ("bookshelf", activity::READING),
        ("reading_chair", activity::READING),
        ("armchair", activity::SITTING),
        ("moving_box", activity::EXERCISING),
        ("reference_shelf", activity::WATCHING_FISH),
    ] {
        let mut sim = test_content::sim_with(16, 16, pack);
        let definition = pack.find(object).unwrap();
        let item = sim.spawn_object(Position { x: 5.0, y: 5.0 }, definition);
        let person = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 5.0 },
                Eating {
                    object: definition,
                    interaction: 0,
                    remaining_ticks: 10,
                },
                Target {
                    object: item,
                    interaction: 0,
                },
                terri_core::Blocked,
                waiting::WaitingNeeds(1, item),
                Path {
                    steps: vec![(4, 6)],
                    cursor: 0,
                },
            ))
            .id();
        sim.sync_render_buffer();
        assert_eq!(
            projection(&sim, person).0,
            expected,
            "{object} body action owns activity before metadata or waiting"
        );
    }
}

#[test]
fn contested_item_waiting_reports_waiting_after_active_work_and_walking() {
    let mut sim = Sim::new_with_lot(16, 16);
    let shower = terri_data::pack().find("shower").unwrap();
    let item = sim.spawn_object(Position { x: 5.0, y: 5.0 }, shower);
    let person = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 4.0, y: 5.0 },
            terri_core::Blocked,
            waiting::WaitingNeeds(1, item),
        ))
        .id();
    sim.sync_render_buffer();
    assert_eq!(
        projection(&sim, person),
        (activity::WAITING, visual_action::NONE)
    );
    sim.world_mut().entity_mut(person).insert(Path {
        steps: vec![(4, 6)],
        cursor: 0,
    });
    sim.sync_render_buffer();
    assert_eq!(projection(&sim, person).0, activity::WALKING);
    sim.world_mut().entity_mut(person).insert((
        Eating {
            object: shower,
            interaction: 0,
            remaining_ticks: 10,
        },
        Target {
            object: item,
            interaction: 0,
        },
    ));
    sim.sync_render_buffer();
    assert_eq!(
        projection(&sim, person),
        (activity::SHOWERING, visual_action::NONE)
    );
    sim.world_mut()
        .entity_mut(person)
        .remove::<(Eating, Target, Path, waiting::WaitingNeeds)>();
    sim.sync_render_buffer();
    assert_eq!(
        projection(&sim, person),
        (activity::NONE, visual_action::NONE),
        "an old Blocked marker is not a current item wait"
    );
}

#[test]
fn load_rebuilds_every_new_ordinary_activity_before_the_next_tick() {
    let pack = terri_data::pack();
    for (object, expected) in [
        ("shower", activity::SHOWERING),
        ("toilet", activity::USING_TOILET),
        ("television", activity::WATCHING_TV),
        ("sofa", activity::SITTING),
        ("sink", activity::WASHING_HANDS),
        ("kitchen_sink", activity::WASHING_HANDS),
        ("dining_table", activity::SITTING),
        ("long_sofa", activity::LOUNGING),
        ("radio", activity::LISTENING_RADIO),
        ("double_bed", activity::SLEEPING),
        ("desk", activity::CORRESPONDENCE),
        ("bathtub", activity::BATHING),
    ] {
        let mut source = Sim::new_with_lot(16, 16);
        let definition = pack.find(object).unwrap();
        let item = source.spawn_object(Position { x: 5.0, y: 5.0 }, definition);
        let person = source
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 5.0 },
                Eating {
                    object: definition,
                    interaction: 0,
                    remaining_ticks: 10,
                },
                Target {
                    object: item,
                    interaction: 0,
                },
            ))
            .id();
        if !pack.sleep_tag.is_empty()
            && pack.object(definition).interactions[0]
                .tags
                .contains(&pack.sleep_tag)
        {
            source
                .world_mut()
                .entity_mut(person)
                .insert(terri_core::SleepPlace(0));
        }
        let mut restored = Sim::new_from_shipped_lot();
        restored
            .load_snapshot_v5(source.save_snapshot_v5())
            .unwrap();
        let person = restored
            .world()
            .entities()
            .resolve_from_index(person.index());
        assert_eq!(
            projection(&restored, person),
            (
                expected,
                if object == "double_bed" {
                    visual_action::SLEEP
                } else if object == "toilet" {
                    visual_action::USE_TOILET
                } else if matches!(object, "television" | "radio") {
                    visual_action::WATCH
                } else if object == "sofa" {
                    visual_action::SIT
                } else {
                    visual_action::NONE
                },
            ),
            "{object} activity must rebuild on Load"
        );
    }
}

#[test]
fn load_rebuilds_every_chain_step_activity_before_the_next_tick() {
    let pack = terri_data::pack();
    let expected = [
        activity::GETTING_INGREDIENTS,
        activity::PREPARING_FOOD,
        activity::COOKING,
        activity::COOKING,
        activity::PREPARING_FOOD,
        activity::EATING,
    ];
    for (index, (step, &expected)) in pack.chains[0].steps.iter().zip(&expected).enumerate() {
        let definition = pack
            .objects
            .iter()
            .position(|object| object.roles.contains(&step.role))
            .unwrap();
        let mut source = Sim::new_with_lot(16, 16);
        let station = source.spawn_object(
            Position { x: 5.0, y: 5.0 },
            terri_data::ObjectDefId(definition as u32),
        );
        let person = source
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 5.0 },
                ChainState {
                    chain: 0,
                    step: index as u32,
                    fumble_scale: 1.0,
                },
                StepWork {
                    remaining_ticks: 10,
                },
                Target {
                    object: station,
                    interaction: systems::chain::CHAIN_STEP,
                },
            ))
            .id();
        if index != 0 {
            let kind = pack
                .item_kinds
                .iter()
                .position(|kind| kind == if index >= 3 { "dinner" } else { "ingredients" })
                .unwrap();
            source
                .world_mut()
                .entity_mut(person)
                .insert(terri_core::Carrying(kind as u32));
        }
        let mut restored = Sim::new_from_shipped_lot();
        restored
            .load_snapshot_v5(source.save_snapshot_v5())
            .unwrap();
        let person = restored
            .world()
            .entities()
            .resolve_from_index(person.index());
        assert_eq!(
            projection(&restored, person),
            (
                expected,
                [
                    visual_action::NONE,
                    visual_action::PREPARE,
                    visual_action::COOK,
                    visual_action::COOK,
                    visual_action::PREPARE,
                    visual_action::EAT
                ][index]
            ),
            "dinner step {index} must rebuild on Load"
        );
    }
}
