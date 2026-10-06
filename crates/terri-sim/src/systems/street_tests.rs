//! [OS-street] in `docs/specs/2026-09-22-the-outside.md`: commuters walk out
//! through the yard to the street and home again, on the shipped lot.

use crate::Sim;
use bevy_ecs::prelude::*;
use terri_core::{Agent, AtWork, Career, Commuting, Position};

/// The one worker in the shipped household.
fn worker(sim: &mut Sim) -> Entity {
    let mut query = sim
        .world_mut()
        .query_filtered::<Entity, (With<Agent>, With<Career>)>();
    query
        .iter(sim.world())
        .next()
        .expect("the household has a worker")
}

fn at(sim: &Sim, entity: Entity) -> (f32, f32) {
    let position = sim.world().get::<Position>(entity).unwrap();
    (position.x, position.y)
}

/// Ticks until `done`, recording the worker's position on every tick; the
/// bound keeps a broken commute from spinning.
fn walk(sim: &mut Sim, entity: Entity, done: impl Fn(&Sim) -> bool) -> Vec<(f32, f32)> {
    let mut seen = Vec::new();
    for _ in 0..3_000 {
        sim.tick();
        seen.push(at(sim, entity));
        if done(sim) {
            return seen;
        }
    }
    panic!("the commute never finished");
}

/// Out through the front door and across the yard to the street's exit, at
/// work there out of sight, then home along a path back through the door to
/// the landing, paid once.
#[test]
fn a_commute_walks_out_to_the_street_and_home_through_the_door() {
    let mut sim = Sim::new_from_shipped_lot();
    let tim = worker(&mut sim);
    let out = walk(&mut sim, tim, |sim| {
        sim.world().get::<AtWork>(tim).is_some()
    });
    assert_eq!(at(&sim, tim), (19.0, 2.0), "at work on the street's exit");
    assert!(
        out.iter().any(|&(x, y)| x > 15.0 && x < 16.0 && y == 2.0),
        "left through the front door"
    );
    let funds = sim.world().resource::<terri_core::Funds>().0;
    let home = walk(&mut sim, tim, |sim| {
        sim.world().get::<AtWork>(tim).is_none() && sim.world().get::<Commuting>(tim).is_none()
    });
    assert_eq!(at(&sim, tim), (15.0, 3.0), "home on the landing");
    assert!(
        home.iter().any(|&(x, y)| x > 15.0 && x < 16.0 && y == 2.0),
        "came in through the front door"
    );
    assert!(home.iter().any(|&(x, _)| x > 17.0), "walked the yard");
    let pay = sim.world().resource::<crate::Content>().0.careers[0].pay as i64;
    assert_eq!(sim.world().resource::<terri_core::Funds>().0, funds + pay);
}

/// A worker caught mid-step on the door tile when the shift starts still
/// goes out to the street, clocks in there and is paid once. The shipped
/// walls make the commute step onto the tile's centre first, so this lot
/// never read the start as an arrival; the test pins that it stays so
/// whichever way the commute is routed. The position is set on the tick
/// before the shift, as an interrupted wander would leave it, and the
/// clock-in is observed rather than predicted
/// ([L-career-tests-follow-events-not-guessed-ticks]).
#[test]
fn a_worker_mid_step_on_the_door_at_shift_start_still_goes_to_the_street() {
    let mut sim = Sim::new_from_shipped_lot();
    let tim = worker(&mut sim);
    let content = sim.world().resource::<crate::Content>().0;
    let shift_start = u64::from(content.careers[0].shift_start);
    let pay = i64::from(content.careers[0].pay);
    for _ in 1..shift_start {
        sim.tick();
    }
    assert_eq!(
        sim.world().resource::<terri_core::SimClock>().tick,
        shift_start - 1,
        "one tick per Sim::tick"
    );
    sim.world_mut()
        .entity_mut(tim)
        .remove::<terri_core::Path>()
        .insert(Position { x: 15.3, y: 2.0 });
    let funds = sim.world().resource::<terri_core::Funds>().0;

    walk(&mut sim, tim, |sim| {
        sim.world().get::<AtWork>(tim).is_some()
    });

    assert_eq!(at(&sim, tim), (19.0, 2.0), "at work on the street's exit");
    assert_eq!(
        sim.world().resource::<terri_core::Funds>().0,
        funds,
        "clocking in pays nothing"
    );
    walk(&mut sim, tim, |sim| {
        sim.world().get::<AtWork>(tim).is_none() && sim.world().get::<Commuting>(tim).is_none()
    });
    assert_eq!(at(&sim, tim), (15.0, 3.0), "home on the landing");
    assert_eq!(
        sim.world().resource::<terri_core::Funds>().0,
        funds + pay,
        "the one shift pays once"
    );
}

/// A worker saved at work on the street's exit loads, since it has a path
/// home, and plays on as the unsaved game does.
#[test]
fn a_worker_saved_at_work_on_the_street_loads_and_plays_on() {
    let mut sim = Sim::new_from_shipped_lot();
    let tim = worker(&mut sim);
    walk(&mut sim, tim, |sim| {
        sim.world().get::<AtWork>(tim).is_some()
    });
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    for _ in 0..600 {
        sim.tick();
        loaded.tick();
        assert_eq!(loaded.world_hash(), sim.world_hash());
    }
}

/// The shipped worker saved at work on the street's exit, with the house's
/// east wall at (16, 3) made a doorway so the straight line from the exit to
/// the landing crosses no wall. `shut` blocks the tiles round the exit, so
/// there is no path home from it while the straight line stays clear: the
/// two judgements the loader can make then disagree, which is what lets a
/// test tell which one it made.
fn saved_at_work_on_the_exit(shut: bool) -> terri_core::SaveSnapshotV5 {
    use terri_core::layout::{EdgeAxis, SavedLayout};
    let mut sim = Sim::new_from_shipped_lot();
    let tim = worker(&mut sim);
    walk(&mut sim, tim, |sim| {
        sim.world().get::<AtWork>(tim).is_some()
    });
    let mut saved = sim.save_snapshot_v5();
    let SavedLayout::EdgeWallsV1 { edges } = &mut saved.layout else {
        panic!("the shipped house has edge walls");
    };
    edges
        .iter_mut()
        .find(|edge| (edge.axis, edge.x, edge.y) == (EdgeAxis::Vertical, 16, 3))
        .expect("the house's east wall")
        .doorway = true;
    let width = saved.world.grid_width as usize;
    for (x, y) in [(18, 2), (19, 1), (19, 3)] {
        saved.world.blocked_tiles[y * width + x] = shut;
    }
    saved
}

/// A worker saved at work on the exit with no path home is refused, even
/// where the straight line home crosses no wall: a doorway on (16, 3) clears
/// the line, and blocked tiles round the exit leave no path (review finding
/// [S3]).
#[test]
fn a_worker_saved_at_work_on_a_shut_in_exit_is_refused() {
    assert_eq!(
        Sim::new_from_shipped_lot().load_snapshot_v5(saved_at_work_on_the_exit(false)),
        Ok(()),
        "the straight line and a path are both clear"
    );
    assert_eq!(
        Sim::new_from_shipped_lot().load_snapshot_v5(saved_at_work_on_the_exit(true)),
        Err(crate::SaveError::InvalidGrid)
    );
}

/// The loader judges a saved worker to be on the exit within a hundredth of
/// a tile on each axis, and from the straight line beyond that: with the
/// exit shut in, a worker inside the tolerance is refused for want of a
/// path and one outside it loads on the clear line
/// ([L-door-arrival-needs-independent-axis-tests]). A nonzero tile cannot
/// place the exact boundary in f32; `on_tile_is_inclusive_at_a_hundredth_on_each_axis`
/// pins that on the origin tile.
#[test]
fn a_saved_worker_is_judged_on_the_exit_within_a_hundredth_on_each_axis() {
    let saved = saved_at_work_on_the_exit(true);
    let index = worker(&mut Sim::new_from_shipped_lot()).index_u32();
    for (case, x, y, expected) in [
        ("x inside", 18.995, 2.0, Err(crate::SaveError::InvalidGrid)),
        ("y inside", 19.0, 2.005, Err(crate::SaveError::InvalidGrid)),
        ("x outside below", 18.98, 2.0, Ok(())),
        ("x outside above", 19.02, 2.0, Ok(())),
        ("y outside below", 19.0, 1.98, Ok(())),
        ("y outside above", 19.0, 2.02, Ok(())),
    ] {
        let mut moved = saved.clone();
        let position = moved
            .world
            .entities
            .iter_mut()
            .find(|entity| entity.index == index)
            .and_then(|entity| entity.position.as_mut())
            .expect("the worker is saved with a position");
        position.x = x;
        position.y = y;
        assert_eq!(
            Sim::new_from_shipped_lot().load_snapshot_v5(moved),
            expected,
            "{case}"
        );
    }
}

/// Review finding [S1]: a house saved with furniture on the street's exit,
/// by a build that had the yard and no street, still sends its worker to
/// work, by the door; and edits elsewhere on the lot are not refused for an
/// exit the door could not reach before them.
#[test]
fn furniture_saved_on_the_exit_sends_the_worker_by_the_door() {
    use terri_core::{CommandQueue, SimCommand};
    let mut sim = Sim::new_from_shipped_lot();
    let chair = sim
        .world()
        .resource::<crate::Content>()
        .0
        .find("chair")
        .unwrap();
    sim.spawn_object(Position { x: 19.0, y: 2.0 }, chair);
    sim.world_mut()
        .resource_mut::<terri_core::TileGrid>()
        .set_blocked(19, 2, true);
    sim.world_mut().insert_resource(terri_core::Funds(1_000));
    let facing = sim
        .world()
        .resource::<crate::Content>()
        .0
        .object(chair)
        .base_facing;
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::BuyObject {
            definition: chair.0,
            x: 5,
            y: 8,
            facing,
        });
    sim.flush_commands();
    let bought = sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_purchase_result;
    assert_eq!(
        bought.map(|result| result.reason),
        Some(None),
        "an edit elsewhere"
    );
    let tim = worker(&mut sim);
    walk(&mut sim, tim, |sim| {
        sim.world().get::<AtWork>(tim).is_some()
    });
    assert_eq!(at(&sim, tim), (15.0, 2.0), "at work by the door");
}

/// Review finding [S10]: a worker saved at work a hair short of the exit
/// counts as on it, and its way home is judged from the exit tile, as the
/// walk home starts there. Shut the exit off from (18, 2) and the rest, and
/// the save is refused, though (18, 2) itself has a path home.
#[test]
fn a_worker_saved_just_short_of_the_exit_is_judged_from_the_exit() {
    use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
    let mut sim = Sim::new_from_shipped_lot();
    let tim = worker(&mut sim);
    walk(&mut sim, tim, |sim| {
        sim.world().get::<AtWork>(tim).is_some()
    });
    let mut saved = sim.save_snapshot_v5();
    let index = tim.index_u32();
    saved
        .world
        .entities
        .iter_mut()
        .find(|entity| entity.index == index)
        .and_then(|entity| entity.position.as_mut())
        .expect("the worker is saved with a position")
        .x = 18.995;
    let SavedLayout::EdgeWallsV1 { edges } = &mut saved.layout else {
        panic!("the shipped house has edge walls");
    };
    edges.push(WallEdge {
        axis: EdgeAxis::Vertical,
        x: 19,
        y: 2,
        doorway: false,
    });
    let width = saved.world.grid_width as usize;
    for (x, y) in [(19, 1), (19, 3)] {
        saved.world.blocked_tiles[y * width + x] = true;
    }
    assert_eq!(
        Sim::new_from_shipped_lot().load_snapshot_v5(saved),
        Err(crate::SaveError::InvalidGrid)
    );
}
