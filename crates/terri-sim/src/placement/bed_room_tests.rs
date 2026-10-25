//! Beds go inside rooms: issue 298, [WB-beds] in
//! `docs/specs/2026-10-18-wages-and-bills.md`.
use super::purchase::{validate_purchase, Purchase};
use super::*;
use crate::build_transaction::BuildCommitError;
use crate::{Content, Sim};
use terri_core::layout::{EdgeAxis, WallLine, WallState};
use terri_core::{CommandQueue, Funds, SimCommand};
use terri_data::ContentPack;

fn pack() -> &'static ContentPack {
    terri_data::pack()
}

/// The shipped lot and furniture with nobody home and money to spend.
fn house() -> Sim {
    house_on(pack().lot.clone())
}

fn house_on(lot: terri_data::CompiledLot) -> Sim {
    let mut sim = Sim::new_from_lot_and_content(&lot, Content(pack()));
    sim.world_mut()
        .insert_resource(Funds::from_dollars(100_000));
    sim
}

/// The shipped lot with the double bed standing on the yard tile (16, 0),
/// as a save from before the rule may hold it.
fn yard_bed_house() -> Sim {
    let mut lot = pack().lot.clone();
    let bed = pack().find("double_bed").unwrap();
    let placement = lot
        .placements
        .iter_mut()
        .find(|placement| placement.object == bed)
        .unwrap();
    placement.x = 16.0;
    placement.y = 0.0;
    house_on(lot)
}

fn entity_of(sim: &mut Sim, id: &str) -> Entity {
    let definition = pack().find(id).unwrap();
    let mut entities: Vec<Entity> = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .filter(|(_, object)| object.0 == definition)
        .map(|(entity, _)| entity)
        .collect();
    entities.sort_by_key(|e| e.index());
    entities[0]
}

fn bed_purchase(x: u32, y: u32) -> Purchase {
    let definition = pack().find("double_bed").unwrap();
    Purchase {
        definition: definition.0,
        x,
        y,
        facing: pack().object(definition).base_facing,
    }
}

fn issue(sim: &mut Sim, command: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(command);
    sim.flush_commands();
}

/// The south wall of the bedroom, between (0, 11) and the yard at (0, 12):
/// opening it opens the bedroom to the yard.
fn bedroom_south_wall(state: WallState) -> SimCommand {
    SimCommand::SetWallEdge {
        axis: EdgeAxis::Horizontal,
        x: 0,
        y: 12,
        state,
    }
}

/// [WB-beds]: buying a bed whose tiles would be in the yard is refused as
/// outside a room, after every other check passes.
#[test]
fn buying_a_bed_on_a_yard_tile_is_refused_as_outside_room() {
    let sim = house();
    assert_eq!(
        validate_purchase(sim.world(), bed_purchase(16, 0)).err(),
        Some(PlacementRefusal::OutsideRoom)
    );
    assert_eq!(PlacementRefusal::OutsideRoom as u32, 21);
    assert_eq!(PlacementRefusal::BedOutside as u32, 22);
}

/// [WB-beds]: a bed bought with every tile inside a room is allowed. The
/// first such spot in row order is in the house; none is in the yard.
#[test]
fn buying_a_bed_in_a_room_is_allowed() {
    let sim = house();
    let topology = crate::rooms::RoomTopology::from_world(sim.world()).unwrap();
    let footprint = pack().object(pack().find("double_bed").unwrap()).footprint;
    let allowed: Vec<(u32, u32)> = (0..16u32)
        .flat_map(|y| (0..20u32).map(move |x| (x, y)))
        .filter(|(x, y)| validate_purchase(sim.world(), bed_purchase(*x, *y)).is_ok())
        .collect();
    assert!(!allowed.is_empty(), "the house has room for a double bed");
    for origin in &allowed {
        assert!(topology.footprint_indoors(*origin, footprint), "{origin:?}");
    }
}

/// [WB-beds]: moving a bed onto the yard is refused, and a chair, which has
/// no such rule, may stand there.
#[test]
fn moving_a_bed_onto_the_yard_is_refused() {
    let mut sim = house();
    let bed = entity_of(&mut sim, "double_bed");
    let facing = pack()
        .object(pack().find("double_bed").unwrap())
        .base_facing;
    assert_eq!(
        validate_placement(sim.world(), bed.index_u32(), (16, 0), facing).err(),
        Some(PlacementRefusal::OutsideRoom)
    );
}

#[test]
fn a_non_bed_object_may_stand_outdoors() {
    let mut sim = house();
    let chair = entity_of(&mut sim, "chair");
    let facing = pack().object(pack().find("chair").unwrap()).base_facing;
    assert!(validate_placement(sim.world(), chair.index_u32(), (16, 0), facing).is_ok());
}

/// [WB-beds]: inside a Build session the check reads the draft, so a bed can
/// go into a room built earlier in the same session.
#[test]
fn a_bed_may_go_into_a_room_built_earlier_in_the_same_session() {
    let mut sim = house();
    sim.begin_build().unwrap();
    // Two columns of the yard strip east of the house, south of the front
    // door, its doorway on its north side; the third column stays a way
    // through, so every part of the yard still reaches the door.
    let corner = || (6..10u32).flat_map(|y| (16..18u32).map(move |x| (x, y)));
    let before: Vec<(u32, u32)> = corner()
        .filter(|(x, y)| validate_purchase(sim.world(), bed_purchase(*x, *y)).is_ok())
        .collect();
    assert!(before.is_empty(), "the yard corner is not a room yet");
    assert!(corner().any(
        |(x, y)| validate_purchase(sim.world(), bed_purchase(x, y)).err()
            == Some(PlacementRefusal::OutsideRoom)
    ));
    issue(
        &mut sim,
        SimCommand::BuildRoom {
            x0: 16,
            y0: 6,
            x1: 17,
            y1: 9,
            doorway: Some(WallLine {
                axis: EdgeAxis::Horizontal,
                x: 16,
                y: 6,
            }),
        },
    );
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_room_result
            .and_then(|r| r.reason),
        None,
        "the yard room is built"
    );
    let after: Vec<(u32, u32)> = corner()
        .filter(|(x, y)| validate_purchase(sim.world(), bed_purchase(*x, *y)).is_ok())
        .collect();
    assert!(!after.is_empty(), "the new room takes a double bed");
}

/// [WB-beds]: Confirm refuses a batch that opens the bedroom to the yard and
/// so leaves its bed outside, naming the bed, and the draft stays open and
/// unchanged.
#[test]
fn confirm_refuses_a_batch_that_leaves_an_indoor_bed_outside() {
    let mut sim = house();
    let bed = entity_of(&mut sim, "double_bed");
    sim.begin_build().unwrap();
    issue(&mut sim, bedroom_south_wall(WallState::Open));
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_wall_result
            .and_then(|r| r.reason),
        None,
        "inside a session the edit itself is allowed"
    );
    assert_eq!(
        sim.prepare_build_commit(crate::rooms::RoomChoices::default())
            .err(),
        Some(BuildCommitError::BedOutside {
            object: bed.index_u32()
        })
    );
}

#[test]
fn confirm_keeps_the_draft_unchanged_when_refused() {
    let mut sim = house();
    sim.begin_build().unwrap();
    issue(&mut sim, bedroom_south_wall(WallState::Open));
    let draft = sim.save_snapshot_v22();
    assert!(sim
        .prepare_build_commit(crate::rooms::RoomChoices::default())
        .is_err());
    assert!(sim.build_active());
    assert!(sim.build_dirty());
    assert_eq!(sim.save_snapshot_v22(), draft);
    // Putting the wall back lets the same session confirm.
    issue(&mut sim, bedroom_south_wall(WallState::Wall));
    let token = sim
        .prepare_build_commit(crate::rooms::RoomChoices::default())
        .expect("the bedroom is whole again")
        .token;
    sim.commit_build(token).unwrap();
}

/// [WB-beds]: the rule is judged on the final layout, so a batch that takes a
/// wall down and puts it back confirms.
#[test]
fn confirm_allows_a_batch_that_removes_and_rebuilds_walls_around_a_bed() {
    let mut sim = house();
    sim.begin_build().unwrap();
    issue(&mut sim, bedroom_south_wall(WallState::Open));
    issue(&mut sim, bedroom_south_wall(WallState::Wall));
    assert!(sim
        .prepare_build_commit(crate::rooms::RoomChoices::default())
        .is_ok());
}

/// [WB-beds]: a bed already outside before the session that stays where it
/// is does not stop an unrelated batch from confirming.
#[test]
fn confirm_ignores_a_bed_already_outside_in_the_baseline_that_did_not_move() {
    let mut sim = yard_bed_house();
    sim.begin_build().unwrap();
    let chair = pack().find("chair").unwrap();
    issue(
        &mut sim,
        SimCommand::BuyObject {
            definition: chair.0,
            x: 17,
            y: 14,
            facing: pack().object(chair).base_facing,
        },
    );
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_purchase_result
            .and_then(|r| r.reason),
        None
    );
    let token = sim
        .prepare_build_commit(crate::rooms::RoomChoices::default())
        .expect("an untouched outdoor bed does not block Confirm")
        .token;
    sim.commit_build(token).unwrap();
}

/// [WB-beds]: that outdoor bed may move into a room, and may not move to
/// another yard tile.
#[test]
fn that_outdoor_bed_can_move_into_a_room_but_not_to_another_yard_tile() {
    let mut sim = yard_bed_house();
    let bed = entity_of(&mut sim, "double_bed");
    let facing = pack()
        .object(pack().find("double_bed").unwrap())
        .base_facing;
    assert_eq!(
        validate_placement(sim.world(), bed.index_u32(), (16, 3), facing).err(),
        Some(PlacementRefusal::OutsideRoom)
    );
    assert!(
        validate_placement(sim.world(), bed.index_u32(), (0, 8), facing).is_ok(),
        "back to the bedroom"
    );
}

/// The owner's decision of 2026-10-24: selecting an outdoor bed from an
/// older save previews it where it stands, which is no move and no refusal;
/// moving or turning it outdoors is still refused.
#[test]
fn an_outdoor_bed_staying_where_it_stands_is_not_refused() {
    let mut sim = yard_bed_house();
    let bed = entity_of(&mut sim, "double_bed");
    let definition = pack().object(pack().find("double_bed").unwrap());
    let current = sim
        .world()
        .get::<terri_core::ObjectFacing>(bed)
        .map_or(definition.base_facing, |f| f.0);
    assert!(validate_placement(sim.world(), bed.index_u32(), (16, 0), current).is_ok());
    let turned = terri_core::Facing::ALL
        .into_iter()
        .find(|f| *f != current && definition.supports(*f))
        .expect("the bed turns");
    assert_eq!(
        validate_placement(sim.world(), bed.index_u32(), (16, 0), turned).err(),
        Some(PlacementRefusal::OutsideRoom),
        "turning it in place is a move"
    );
    assert_eq!(
        validate_placement(sim.world(), bed.index_u32(), (16, 3), current).err(),
        Some(PlacementRefusal::OutsideRoom)
    );
}

/// [WB-beds]: outside a Build session a single wall edit that would leave a
/// bed outside is refused, and the wall stays.
#[test]
fn a_single_wall_edit_outside_a_session_that_leaves_a_bed_outside_is_refused() {
    let mut sim = house();
    let layout = sim
        .world()
        .resource::<terri_core::layout::SavedLayout>()
        .clone();
    issue(&mut sim, bedroom_south_wall(WallState::Open));
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_wall_result
            .and_then(|r| r.reason),
        Some(PlacementRefusal::BedOutside)
    );
    assert_eq!(
        sim.world().resource::<terri_core::layout::SavedLayout>(),
        &layout
    );
    // A wall elsewhere that leaves every bed inside is allowed.
    issue(
        &mut sim,
        SimCommand::SetWallEdge {
            axis: EdgeAxis::Vertical,
            x: 17,
            y: 14,
            state: WallState::Wall,
        },
    );
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_wall_result
            .and_then(|r| r.reason),
        None
    );
}

/// [WB-beds]: the room tool asks the same question of its finished layout. A
/// room adds walls, which never open a room, so the shared check is shown
/// on the layouts a room and a wall removal would produce.
#[test]
fn the_room_and_wall_check_reads_the_layout_an_edit_would_produce() {
    let sim = house();
    let layout = sim
        .world()
        .resource::<terri_core::layout::SavedLayout>()
        .clone();
    assert!(!edit_leaves_a_bed_outside(sim.world(), &layout));
    let opened = match &layout {
        terri_core::layout::SavedLayout::EdgeWallsV1 { edges } => {
            terri_core::layout::SavedLayout::EdgeWallsV1 {
                edges: edges
                    .iter()
                    .copied()
                    .filter(|e| !(e.axis == EdgeAxis::Horizontal && e.x == 0 && e.y == 12))
                    .collect(),
            }
        }
        other => panic!("the shipped lot is edge-based: {other:?}"),
    };
    assert!(edit_leaves_a_bed_outside(sim.world(), &opened));
    let yard = yard_bed_house();
    let yard_layout = yard
        .world()
        .resource::<terri_core::layout::SavedLayout>()
        .clone();
    assert!(
        !edit_leaves_a_bed_outside(yard.world(), &yard_layout),
        "a bed already outside does not count"
    );
}

/// [WB-beds]: an older world with a bed outdoors keeps it where it is
/// through a save and load, and a person can still sleep in it.
#[test]
fn an_older_save_with_an_outdoor_bed_loads_and_the_bed_still_works() {
    let source = yard_bed_house();
    let mut loaded = house();
    loaded
        .load_snapshot_v21(source.save_snapshot_v21())
        .expect("an outdoor bed loads");
    let bed = entity_of(&mut loaded, "double_bed");
    assert_eq!(
        *loaded.world().get::<Position>(bed).unwrap(),
        Position { x: 16.0, y: 0.0 }
    );
    let person = loaded.spawn_agent(Position { x: 17.0, y: 5.0 }, 100.0);
    loaded.world_mut().entity_mut(person).insert((
        terri_core::IntentQueue::default(),
        terri_core::Needs::all_at(100.0),
    ));
    let sleep = pack()
        .object(pack().find("double_bed").unwrap())
        .interactions
        .iter()
        .position(|a| a.tags.iter().any(|t| t == &pack().sleep_tag))
        .unwrap() as u32;
    issue(
        &mut loaded,
        SimCommand::UseObject {
            agent: person.index_u32(),
            object: bed.index_u32(),
            interaction: sleep,
        },
    );
    let mut slept = false;
    for _ in 0..300 {
        loaded.tick();
        if loaded
            .world()
            .get::<terri_core::Eating>(person)
            .is_some_and(|eating| eating.interaction == sleep)
        {
            slept = true;
            break;
        }
    }
    assert!(slept, "a person sleeps in the outdoor bed");
}
