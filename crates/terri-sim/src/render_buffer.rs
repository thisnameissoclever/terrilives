//! The only simulation state that crosses into JavaScript.
//!
//! This module knows nothing about JavaScript, WASM, or `wasm-bindgen`.
//! It produces flat typed arrays; `terri-wasm` is the only crate allowed
//! to hand pointers to them across the boundary.

/// Struct-of-arrays snapshot of render-relevant state, laid out so
/// JavaScript can view it directly with no copying and no per-entity
/// objects. See [D11].
#[derive(Debug, Default)]
pub struct RenderBuffer {
    /// Interleaved [x0, y0, x1, y1, ...] for the current tick.
    pub positions: Vec<f32>,
    /// Same layout, previous tick. The renderer interpolates between them.
    pub prev_positions: Vec<f32>,
    /// 0 = agent, 1 = smart object.
    pub kinds: Vec<u32>,
    pub count: usize,
}

#[cfg(test)]
mod tests {
    use crate::Sim;
    use bevy_ecs::prelude::*;
    use terri_core::{Agent, Eating, Hunger, Position, SmartObject};

    fn a_smart_object() -> SmartObject {
        SmartObject {
            hunger_delta: 40.0,
            duration_ticks: 15,
            slots: 1,
        }
    }

    /// Entity indices in the raw order `sync_render_buffer`'s query
    /// yields them, with no sorting applied. This is precisely the order
    /// the buffer must NOT inherit, so comparing it against ascending
    /// index order is how the slot-stability test below proves it is
    /// exercising a real ordering difference rather than passing
    /// decoratively.
    fn raw_render_order(sim: &mut Sim) -> Vec<u32> {
        let mut state = sim.world_mut().query::<(Entity, &Position, Has<Agent>)>();
        state
            .iter(sim.world())
            .map(|(entity, _, _)| entity.index_u32())
            .collect()
    }

    #[test]
    fn render_buffer_matches_world_state() {
        let mut sim = Sim::new_with_lot(16, 16);
        sim.world_mut()
            .spawn((Position { x: 4.0, y: 5.0 }, a_smart_object()));
        sim.world_mut()
            .spawn((Agent, Position { x: 1.0, y: 2.0 }, Hunger(50.0)));

        sim.sync_render_buffer();
        let buf = sim.render_buffer();

        assert_eq!(buf.count, 2);
        assert_eq!(buf.positions.len(), 4);
        assert_eq!(buf.kinds.len(), 2);
        // Sorted by entity index, so the object spawned first comes first.
        assert_eq!(buf.positions[0], 4.0);
        assert_eq!(buf.positions[1], 5.0);
        assert_eq!(buf.kinds[0], 1);
        assert_eq!(buf.kinds[1], 0);
    }

    #[test]
    fn prev_positions_lag_by_one_sync() {
        // THREE syncs, not two, and the third one is the whole test.
        //
        // The mechanism under test is the `std::mem::swap` at the top of
        // `sync_render_buffer`. Delete it and `prev_positions` is written
        // only by the reseed branch, which fires solely when the row count
        // changes. Trace the first two syncs with the swap deleted: sync 1
        // reseeds (0 != 2) and leaves prev holding frame 1; sync 2 finds
        // the lengths equal, writes nothing, and prev still holds frame 1
        // - which is exactly what a two-sync test asserts. **Two samples
        // cannot distinguish "prev lags by one frame" from "prev is frozen
        // at the first frame."** Both hypotheses predict the same two
        // numbers, so the old form of this test was permanently green with
        // the swap removed, despite naming that invariant in its title.
        //
        // The third sync is the first observation the two hypotheses
        // disagree about: lagging predicts 3.0, frozen predicts 0.0.
        //
        // What it would have cost: with prev frozen at the last frame
        // where the entity count changed, Task 12 would tween every entity
        // from its spawn position towards its current position on every
        // frame, forever, with the suite green throughout.
        let mut sim = Sim::new_with_lot(16, 16);
        let id = sim
            .world_mut()
            .spawn((Agent, Position { x: 0.0, y: 0.0 }, Hunger(50.0)))
            .id();
        sim.sync_render_buffer();

        sim.world_mut().get_mut::<Position>(id).unwrap().x = 3.0;
        sim.sync_render_buffer();

        assert_eq!(sim.render_buffer().prev_positions[0], 0.0);
        assert_eq!(sim.render_buffer().positions[0], 3.0);

        sim.world_mut().get_mut::<Position>(id).unwrap().x = 5.0;
        sim.sync_render_buffer();

        assert_eq!(
            sim.render_buffer().prev_positions[0],
            3.0,
            "prev must lag by exactly one sync, not freeze at the first"
        );
        assert_eq!(sim.render_buffer().positions[0], 5.0);
    }

    #[test]
    fn a_first_sync_seeds_prev_positions_rather_than_leaving_them_empty() {
        let mut sim = Sim::new_with_lot(16, 16);
        sim.world_mut()
            .spawn((Agent, Position { x: 7.0, y: 9.0 }, Hunger(50.0)));

        sim.sync_render_buffer();
        assert_eq!(sim.render_buffer().count, 1, "the spawn must be visible");
        assert_eq!(
            sim.render_buffer().prev_positions,
            sim.render_buffer().positions,
            "there is no previous frame on the first sync, so prev must be \
             seeded from the current frame; left empty, Task 12 either reads \
             out of bounds or interpolates from garbage"
        );

        // A spawn between syncs changes the row count, which invalidates
        // the whole slot mapping. The same reseeding has to happen, or
        // slot i in prev_positions belongs to a different entity than
        // slot i in positions.
        sim.world_mut()
            .spawn((Position { x: 2.0, y: 3.0 }, a_smart_object()));
        sim.sync_render_buffer();
        assert_eq!(sim.render_buffer().count, 2, "the second spawn is visible");
        assert_eq!(
            sim.render_buffer().prev_positions.len(),
            sim.render_buffer().positions.len(),
            "prev_positions and positions must always be the same length"
        );
    }

    #[test]
    fn entity_slots_survive_archetype_churn() {
        // The invariant this pins: a given entity keeps the same buffer
        // slot between frames. Task 12 interpolates slot i between
        // prev_positions and positions, so if slots move, entities
        // interpolate across each other's coordinates and the visible
        // result is smearing or teleporting - a rendering bug whose cause
        // lives four tasks upstream.
        //
        // The trap this test is shaped around, lessons-learned [L5]:
        // spawning N entities sequentially puts them all in one archetype,
        // where table order ALREADY equals index order. Such a test passes
        // with `rows.sort_by_key` deleted. Archetype churn is what makes
        // the two orders differ.
        let mut sim = Sim::new_with_lot(16, 16);
        let ids: Vec<Entity> = (0..4)
            .map(|i| {
                sim.world_mut()
                    .spawn((
                        Agent,
                        Position {
                            x: i as f32,
                            y: 0.0,
                        },
                        Hunger(50.0),
                    ))
                    .id()
            })
            .collect();

        sim.sync_render_buffer();
        assert_eq!(
            sim.render_buffer().count,
            4,
            "all four agents must be in the buffer, or the comparison below \
             is between two empty vectors and proves nothing"
        );
        let positions_before = sim.render_buffer().positions.clone();
        let kinds_before = sim.render_buffer().kinds.clone();

        // Adding then removing a component swap-removes the entity from
        // its table and re-appends it at the back. Two lines reproduce
        // what a few minutes of gameplay does on its own, since agents
        // change archetype every time Target, Path or Eating is added or
        // removed. Applied between syncs, where no system observes it, so
        // nothing about the simulation's own state changes.
        sim.world_mut().entity_mut(ids[0]).insert(Eating {
            remaining_ticks: 1,
            delta_per_tick: 0.0,
        });
        sim.world_mut().entity_mut(ids[0]).remove::<Eating>();

        // Precondition. Without it this test silently decays into one that
        // cannot fail: if raw iteration order still equalled index order,
        // the sort would be a no-op and deleting it would change nothing.
        let raw = raw_render_order(&mut sim);
        let mut ascending = raw.clone();
        ascending.sort_unstable();
        assert_ne!(
            raw, ascending,
            "archetype churn left iteration order equal to index order, so \
             this test cannot detect a missing sort; got {raw:?}"
        );

        sim.sync_render_buffer();

        assert_eq!(
            sim.render_buffer().positions,
            positions_before,
            "an entity changed buffer slot across a sync; render \
             interpolation reads slot i of prev_positions and slot i of \
             positions as the same entity"
        );
        assert_eq!(
            sim.render_buffer().kinds,
            kinds_before,
            "an entity changed buffer slot across a sync; the renderer \
             would draw the wrong sprite for that slot"
        );
    }
}
