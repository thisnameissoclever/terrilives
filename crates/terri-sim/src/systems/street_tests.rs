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

/// A worker saved at work on the exit with no way home is refused, as a
/// worker at the door with a wall across its step home always was.
#[test]
fn a_worker_saved_at_work_on_a_walled_in_exit_is_refused() {
    use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
    let mut sim = Sim::new_from_shipped_lot();
    let tim = worker(&mut sim);
    walk(&mut sim, tim, |sim| {
        sim.world().get::<AtWork>(tim).is_some()
    });
    let mut saved = sim.save_snapshot_v5();
    let SavedLayout::EdgeWallsV1 { edges } = &mut saved.layout else {
        panic!("the shipped house has edge walls");
    };
    for (axis, x, y) in [
        (EdgeAxis::Vertical, 19, 2),
        (EdgeAxis::Horizontal, 19, 2),
        (EdgeAxis::Horizontal, 19, 3),
    ] {
        edges.push(WallEdge {
            axis,
            x,
            y,
            doorway: false,
        });
    }
    let mut loaded = Sim::new_from_shipped_lot();
    assert_eq!(
        loaded.load_snapshot_v5(saved),
        Err(crate::SaveError::InvalidGrid)
    );
}
