use super::*;
use crate::{Content, Sim};
use terri_core::{Agent, CommandQueue, Facing, ObjectFacing, Path, Position, Reserved, SimCommand, SmartObject, TileGrid};

fn place(sim: &mut Sim, object:u32, origin:(u32,u32), facing:Facing) {
    sim.world_mut().resource_mut::<CommandQueue>().push(SimCommand::PlaceObject {object,x:origin.0,y:origin.1,facing});
    sim.flush_commands();
}

fn valid_move(sim:&Sim, object:u32, facing:Facing) -> (u32,u32) {
    let entity = object_definition(sim.world(),object).unwrap().0;
    let pos = sim.world().get::<Position>(entity).unwrap();
    let lot = &sim.world().resource::<Content>().0.lot;
    (0..lot.height).flat_map(|y| (0..lot.width).map(move |x| (x,y)))
        .find(|&(x,y)| (x as f32,y as f32) != (pos.x,pos.y) && validate_placement(sim.world(),object,(x,y),facing).is_ok()).expect("fixture has a movable object")
}

fn fixture() -> (Sim, u32) {
    let mut pack = terri_data::pack().clone();
    pack.lot.width = 7;
    pack.lot.height = 7;
    pack.lot.walls = (0..7).filter(|&y| y != 3).map(|y| (3, y)).collect();
    pack.lot.placements.clear();
    pack.lot.front_door = Some((6, 3));
    pack.portals[0].position = (6, 3);
    pack.portals[0].inward = (5, 3);
    let pack = Box::leak(Box::new(pack));
    let mut sim = Sim::new_from_lot(&pack.lot, &pack.objects);
    sim.world_mut().insert_resource(Content(pack));
    let id = pack.find("fridge").unwrap();
    let entity = sim.spawn_object(Position {x:0.0,y:0.0}, id);
    sim.world_mut().resource_mut::<TileGrid>().set_blocked(0, 0, true);
    (sim, entity.index_u32())
}

fn facing(sim: &Sim, object: u32) -> Facing {
    object_definition(sim.world(),object).unwrap().2
}

fn refusal(sim: &mut Sim, object: u32, origin: (u32, u32), facing: Facing, expected: PlacementRefusal) {
    let before = sim.save_snapshot();
    assert_eq!(validate_placement(sim.world(), object, origin, facing).unwrap_err(), expected);
    assert_eq!(sim.save_snapshot(), before, "preview wrote state");
    sim.world_mut().resource_mut::<CommandQueue>().push(SimCommand::PlaceObject {object, x: origin.0, y: origin.1, facing});
    sim.flush_commands();
    assert_eq!(sim.world().resource::<LotEditState>().last_result, Some(PlacementResult {object, reason: Some(expected)}));
    assert_eq!(sim.save_snapshot(), before, "refused transaction wrote state");
}

#[test]
fn placement_refuses_wall_and_furniture_without_writes() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    refusal(&mut sim, object, (3, 0), f, PlacementRefusal::WallOverlap);
    let other = sim.spawn_object(Position {x:2.0,y:0.0}, terri_data::pack().find("fridge").unwrap());
    assert_ne!(other.index_u32(), object);
    sim.world_mut().resource_mut::<TileGrid>().set_blocked(2, 0, true);
    refusal(&mut sim, object, (2, 0), f, PlacementRefusal::FurnitureOverlap);
}

#[test]
fn placement_refuses_unknown_bounds_direction_in_use_sim_and_path() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    refusal(&mut sim, u32::MAX, (1, 0), f, PlacementRefusal::UnknownObject);
    refusal(&mut sim, object, (u32::MAX, 0), f, PlacementRefusal::OutOfBounds);
    let entity = object_definition(sim.world(),object).unwrap().0;
    sim.world_mut().entity_mut(entity).insert(Reserved);
    refusal(&mut sim, object, (1, 0), f, PlacementRefusal::InUse);
    sim.world_mut().entity_mut(entity).remove::<Reserved>();
    let person = sim.world_mut().spawn((Agent, Position {x:1.0,y:0.0})).id();
    refusal(&mut sim, person.index_u32(), (1, 0), f, PlacementRefusal::UnknownObject);
    refusal(&mut sim, object, (1, 0), f, PlacementRefusal::SimOverlap);
    sim.world_mut().entity_mut(person).insert((Position {x:1.0,y:1.0}, Path {steps:vec![(1,0)], cursor:0}));
    refusal(&mut sim, object, (1, 0), f, PlacementRefusal::BlockedRoute);
    let mut pack = sim.world().resource::<Content>().0.clone();
    let id = sim.world().get::<SmartObject>(entity).unwrap().0;
    pack.objects[id.0 as usize].facing_sprites.0[Facing::NorthEast.code() as usize] = None;
    sim.world_mut().insert_resource(Content(Box::leak(Box::new(pack))));
    refusal(&mut sim, object, (1, 0), Facing::NorthEast, PlacementRefusal::UnsupportedFacing);
}

#[test]
fn placement_refuses_disconnected_approaches_door_and_landing() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    refusal(&mut sim, object, (3, 3), f, PlacementRefusal::InaccessibleInteraction);
    refusal(&mut sim, object, (6, 3), f, PlacementRefusal::BlockedDoor);
    refusal(&mut sim, object, (5, 3), f, PlacementRefusal::BlockedLanding);
}

#[test]
fn placement_refuses_unowned_grid_and_accepts_authored_wall_provenance() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    assert!(validate_placement(sim.world(), object, (1, 0), f).is_ok());
    sim.world_mut().resource_mut::<TileGrid>().set_blocked(2, 2, true);
    refusal(&mut sim, object, (1, 0), f, PlacementRefusal::UnsupportedLayout);
}

#[test]
fn placement_commits_atomically_preserves_identity_queues_and_wall_cells() {
    let (mut sim, object) = fixture();
    let f = facing(&sim,object);
    let (entity,definition,_) = object_definition(sim.world(),object).unwrap();
    let before = sim.save_snapshot();
    let plan = validate_placement(sim.world(),object,(1,0),f).unwrap();
    assert_eq!((plan.origin,plan.facing,plan.footprint),((1,0),f,definition.footprint_at(f)));
    place(&mut sim,object,(1,0),f);
    assert_eq!(sim.world().get::<Position>(entity),Some(&Position{x:1.0,y:0.0}));
    assert_eq!(sim.world().get::<SmartObject>(entity),Some(&SmartObject(terri_data::pack().find("fridge").unwrap())));
    assert_eq!(sim.world().resource::<LotEditState>().revision,1);
    assert!(sim.world().resource::<TileGrid>().is_walkable(0,0));
    assert!(!sim.world().resource::<TileGrid>().is_walkable(1,0));
    for &(x,y) in &sim.world().resource::<Content>().0.lot.walls { assert!(!sim.world().resource::<TileGrid>().is_walkable(x as i32,y as i32)); }
    assert_eq!(sim.save_snapshot().rng,before.rng);
    let after = sim.save_snapshot();
    place(&mut sim,object,(1,0),f);
    assert_eq!(sim.world().resource::<LotEditState>().revision,1,"no-op bumped revision");
    assert_eq!(sim.save_snapshot(),after);
    assert!(validate_placement(sim.world(),object,(0,0),f).is_ok(),"moved provenance stays editable");
}

#[test]
fn placement_cancel_before_edit_flushes_deferred_release_and_joined_matches_split() {
    use terri_core::{Intent,IntentQueue,Target};
    let setup = || {
        let (mut sim,object) = fixture();
        let entity = object_definition(sim.world(),object).unwrap().0;
        let mut queue = IntentQueue::default();
        queue.push(Intent{object:entity,interaction:0});
        let agent = sim.world_mut().spawn((Agent,Position{x:1.0,y:1.0},Target{object:entity,interaction:0},queue)).id();
        sim.world_mut().entity_mut(entity).insert(Reserved);
        (sim,object,agent.index_u32())
    };
    let (mut joined,object,agent) = setup();
    let (mut split,_,_) = setup();
    let f = facing(&joined,object);
    let commands = [SimCommand::Select(Some(agent)),SimCommand::CancelIntents{agent},SimCommand::PlaceObject{object,x:1,y:0,facing:f},SimCommand::UseObject{agent,object,interaction:0}];
    for command in &commands { joined.world_mut().resource_mut::<CommandQueue>().push(command.clone()); }
    joined.flush_commands();
    for command in &commands { split.world_mut().resource_mut::<CommandQueue>().push(command.clone()); split.flush_commands(); }
    assert_eq!(joined.save_snapshot(),split.save_snapshot());
    assert_eq!(joined.world().resource::<LotEditState>().last_result.unwrap().reason,None);
    assert_eq!(joined.save_snapshot().tick,0);
    let agent_entity = joined.world_mut().query::<(Entity,&Agent)>().iter(joined.world()).next().unwrap().0;
    assert_eq!(joined.world().get::<IntentQueue>(agent_entity).unwrap().as_slice()[0].object.index_u32(),object);
    let (mut reversed,object,agent) = setup();
    place(&mut reversed,object,(1,0),f);
    assert_eq!(reversed.world().resource::<LotEditState>().last_result.unwrap().reason,Some(PlacementRefusal::InUse));
    reversed.world_mut().resource_mut::<CommandQueue>().push(SimCommand::CancelIntents{agent});
    reversed.flush_commands();
    assert_eq!(reversed.world().resource::<LotEditState>().revision,0);
}

#[test]
fn placement_reseeds_only_edited_furniture_preserving_fractional_walking_sample() {
    let (mut sim,object) = fixture();
    let f = facing(&sim,object);
    let agent = sim.world_mut().spawn((Agent,Position{x:1.0,y:1.0},Path{steps:vec![(2,1)],cursor:0})).id();
    sim.sync_render_buffer();
    sim.world_mut().entity_mut(agent).insert(Position{x:1.25,y:1.0});
    sim.sync_render_buffer();
    let slot = sim.render_buffer().ids.iter().position(|&id| id == agent.index_u32()).unwrap()*2;
    let before = (sim.render_buffer().prev_positions[slot],sim.render_buffer().positions[slot]);
    assert_eq!(before,(1.0,1.25));
    place(&mut sim,object,(0,1),f);
    assert_eq!(sim.world().resource::<LotEditState>().last_result.unwrap().reason,None);
    sim.sync_render_buffer_after_commands();
    let render = sim.render_buffer();
    let moved = render.ids.iter().position(|&id| id == object).unwrap()*2;
    assert_eq!(&render.prev_positions[moved..moved+2],&render.positions[moved..moved+2]);
    assert_eq!(render.positions[moved+1],1.0);
    assert_eq!((render.prev_positions[slot],render.positions[slot]),before);
    let alpha = 0.37;
    assert_eq!(render.prev_positions[slot]*(1.0-alpha)+render.positions[slot]*alpha,1.0+0.25*alpha);
    assert!(sim.world().resource::<LotEditState>().discontinuities.is_empty());
}

#[test]
fn placement_save_reload_keeps_rotated_rectangles_sockets_foregrounds_and_pending_commands() {
    let mut sim = Sim::new_from_shipped_lot();
    for name in ["desk","bathtub","reading_chair"] {
        let definition = sim.world().resource::<Content>().0.find(name).unwrap();
        let entity = sim.world_mut().query::<(Entity,&SmartObject)>().iter(sim.world()).find(|(_,o)| o.0 == definition).unwrap().0;
        let (_,def,base) = object_definition(sim.world(),entity.index_u32()).unwrap();
        let direction = def.next_supported_facing(base).unwrap();
        let origin = valid_move(&sim,entity.index_u32(),direction);
        let before = sim.world_hash();
        place(&mut sim,entity.index_u32(),origin,direction);
        assert_eq!(sim.world().resource::<LotEditState>().last_result.unwrap().reason,None);
        assert_ne!(sim.world_hash(),before);
        assert_eq!(crate::placed_footprint(sim.world().resource::<Content>().0,definition,sim.world().get::<ObjectFacing>(entity)),def.footprint_at(direction));
        let expected = def.sockets_at(origin.0 as f32,origin.1 as f32,direction);
        assert_eq!(sim.world().get::<crate::ResolvedActionSockets>(entity).map(|s|s.0.as_slice()).unwrap_or(&[]),expected);
        assert_eq!(sim.world().get::<crate::ForegroundSprite>(entity).map(|s|s.0),def.facing_foreground_sprites.get(direction));
    }
    let object = sim.save_snapshot().entities.iter().find(|e|e.smart_object.is_some()).unwrap().index;
    let f = facing(&sim,object);
    let origin = valid_move(&sim,object,f);
    let hash = sim.world_hash();
    sim.world_mut().resource_mut::<CommandQueue>().push(SimCommand::PlaceObject{object,x:origin.0,y:origin.1,facing:f});
    assert_ne!(sim.world_hash(),hash,"hash ignores queued placement");
    let snapshot = sim.save_snapshot();
    let mut loaded = Sim::new();
    loaded.load_snapshot(snapshot.clone()).unwrap();
    assert_eq!(loaded.save_snapshot(),snapshot);
    assert_eq!(loaded.world_hash(),sim.world_hash());
    loaded.flush_commands(); sim.flush_commands();
    assert_eq!(loaded.save_snapshot(),sim.save_snapshot());
    assert_eq!(loaded.world_hash(),sim.world_hash());
    assert!(validate_placement(loaded.world(),object,origin,f).is_ok(),"headless restore keeps gameplay editing");
}

#[test]
fn placement_revalidates_preview_after_an_intervening_reservation() {
    let (mut sim,object) = fixture();
    let f = facing(&sim,object);
    assert!(validate_placement(sim.world(),object,(1,0),f).is_ok());
    let entity = object_definition(sim.world(),object).unwrap().0;
    sim.world_mut().entity_mut(entity).insert(Reserved);
    refusal(&mut sim,object,(1,0),f,PlacementRefusal::InUse);
}

#[test]
fn placement_rejects_overlap_in_current_layout_and_uses_nonnegative_truncation() {
    let (mut sim,object) = fixture();
    let f = facing(&sim,object);
    let entity = object_definition(sim.world(),object).unwrap().0;
    sim.world_mut().entity_mut(entity).insert(Position{x:0.75,y:0.75});
    assert!(validate_placement(sim.world(),object,(1,0),f).is_ok());
    sim.spawn_object(Position{x:0.0,y:0.0},terri_data::pack().find("fridge").unwrap());
    refusal(&mut sim,object,(1,0),f,PlacementRefusal::UnsupportedLayout);
}

#[test]
fn placement_keeps_returning_worker_on_door_landing_without_second_pay() {
    use terri_core::{AtWork,Career,Commuting};
    let mut sim = Sim::new_from_shipped_lot();
    let object = sim.save_snapshot().entities.iter().find(|e|e.smart_object.as_deref()==Some("fridge")).unwrap().index;
    let f = facing(&sim,object);
    let origin = valid_move(&sim,object,f);
    place(&mut sim,object,origin,f);
    assert_eq!(sim.world().resource::<LotEditState>().last_result.unwrap().reason,None);
    let worker = sim.world_mut().query_filtered::<Entity,(With<Agent>,With<Career>)>().iter(sim.world()).next().unwrap();
    sim.world_mut().entity_mut(worker).insert((Position{x:15.0,y:2.0},AtWork{remaining_ticks:1}));
    sim.tick();
    let paid = sim.funds();
    assert!(sim.world().get::<Commuting>(worker).is_some());
    let mut arrived = false;
    for _ in 0..20 {
        sim.tick();
        assert_eq!(sim.funds(),paid);
        if sim.world().get::<Commuting>(worker).is_none() { arrived = true; break; }
    }
    assert!(arrived);
    assert_eq!(sim.world().get::<Position>(worker),Some(&Position{x:15.0,y:3.0}));
}
