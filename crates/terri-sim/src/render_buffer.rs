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
    ///
    /// Not what the renderer draws - `sprites` is - and kept because the
    /// two answer different questions. This one is a simulation fact
    /// (does the row carry `Agent`), and the renderer uses it to decide
    /// which within-tile depth layer the row belongs on, so that a sim
    /// standing on an object is drawn in front of it rather than losing
    /// the depth test to it.
    pub kinds: Vec<u32>,
    /// Index into the sprite atlas, one per row.
    ///
    /// It is here rather than derived in the shell because it comes from
    /// **content**: an object's `sprite` field is resolved against the
    /// atlas manifest when the pack is compiled. A lookup table in
    /// TypeScript keyed on object id would be a second copy of the object
    /// list, which is the coupling [D1] exists to prevent.
    pub sprites: Vec<u32>,
    /// The raw entity index occupying each row.
    ///
    /// **A ROW IS NOT AN ENTITY INDEX.** `sync_render_buffer` sorts rows by
    /// entity index for determinism, so a row number is that entity's
    /// *rank* among the live ones, not its index. The two coincide exactly
    /// while entities occupy 0..count with no gaps, which is every
    /// situation the game has been in so far and is why this column did
    /// not exist until something needed it.
    ///
    /// What needed it is **picking**. A click inverts the projection to a
    /// tile, finds the row standing there, and has to name that entity in a
    /// `Select` or `UseObject` command - and those carry raw indices,
    /// because JavaScript cannot construct an `Entity`. Sending the row
    /// number instead works until the first despawn leaves a hole, after
    /// which every click past the hole selects or directs the wrong entity,
    /// with nothing in the type system or the tests to say so. That is the
    /// [L3] family again: correct by coincidence, and the coincidence is
    /// scheduled to end at M1d when sims can die.
    ///
    /// So the shell reads the mapping rather than assuming it.
    /// `a_row_is_not_its_entity_index_once_an_index_is_freed` is the test
    /// that fails if this ever silently becomes the identity again.
    pub ids: Vec<u32>,
    pub count: usize,
}

#[cfg(test)]
mod tests {
    use crate::test_content::shipped_fridge as a_smart_object;
    use crate::Sim;
    use bevy_ecs::prelude::*;
    use terri_core::{Agent, Eating, NeedId, Needs, Position, SmartObject};

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

    /// The [A-11] anchor rule: an object's ROW is centred on its
    /// footprint rectangle while its Position component stays on the
    /// origin tile. Every other fixture in this module is 1x1, where
    /// centring is the identity - so without this test the whole
    /// mechanism deletes cleanly ([L53]'s shape: a rule correct for
    /// every case the fixtures can express is not a tested rule).
    #[test]
    fn a_multi_tile_object_row_is_centred_on_its_rectangle_not_its_origin_tile() {
        let mut sim = Sim::new_with_lot(16, 16);
        let bed = terri_data::pack()
            .find("double_bed")
            .expect("the shipped pack declares the 2x2 bed");
        let entity = sim
            .world_mut()
            .spawn((Position { x: 3.0, y: 6.0 }, SmartObject(bed)))
            .id();

        sim.sync_render_buffer();
        let buf = sim.render_buffer();
        assert_eq!(buf.count, 1);
        assert_eq!(
            (buf.positions[0], buf.positions[1]),
            (3.5, 6.5),
            "a 2x2 footprint's centre is origin plus half a tile on each \
             axis; the origin-anchored row is what drew the bed through \
             the bedroom wall"
        );

        // The component is simulation state and must not move: scoring
        // distance, pathing, and the world hash all read it.
        let pos = sim.world().get::<Position>(entity).expect("still placed");
        assert_eq!((pos.x, pos.y), (3.0, 6.0));
    }

    /// A `SpriteVariant` - the compiled form of a placement's `facing` -
    /// outranks the object definition's sprite in the buffer, and its
    /// absence changes nothing. Without this, dropping the variant read
    /// deletes the whole facing feature silently: every placement falls
    /// back to the definition sprite, which is exactly the wrong-facing
    /// kitchen [A-11] reported.
    #[test]
    fn a_sprite_variant_outranks_the_definition_sprite() {
        let mut sim = Sim::new_with_lot(8, 8);
        sim.world_mut().spawn((
            Position { x: 2.0, y: 2.0 },
            a_smart_object(),
            terri_core::SpriteVariant(7),
        ));
        sim.world_mut()
            .spawn((Position { x: 4.0, y: 4.0 }, a_smart_object()));

        sim.sync_render_buffer();
        let buf = sim.render_buffer();
        assert_eq!(buf.count, 2);
        assert_eq!(
            buf.sprites[0], 7,
            "the faced placement draws its resolved variant"
        );
        assert_ne!(
            buf.sprites[1], 7,
            "the plain placement still draws the definition's sprite"
        );
    }

    #[test]
    fn render_buffer_matches_world_state() {
        let mut sim = Sim::new_with_lot(16, 16);
        sim.world_mut()
            .spawn((Position { x: 4.0, y: 5.0 }, a_smart_object()));
        sim.world_mut().spawn((
            Agent,
            Position { x: 1.0, y: 2.0 },
            Needs::with(NeedId::Hunger, 50.0),
        ));

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

    /// The sprite column, against SHIPPED content.
    ///
    /// Two objects with different `sprite` fields plus one agent, so the
    /// three mutations that matter are all visible: writing the sim's
    /// sprite everywhere, writing sprite 0 everywhere, and writing the
    /// object's own `ObjectDefId` instead of its sprite. The last is the
    /// realistic one, because both are `u32` and both are indices, so it
    /// compiles and type-checks and draws the wrong furniture.
    ///
    /// It reads the expectations out of the pack rather than restating
    /// them, so a re-skin of `objects.toml` does not break it - but it
    /// asserts up front that the three indices differ, because on
    /// content where they happened to agree this test could not see any
    /// of those mutations ([L34]).
    #[test]
    fn each_row_carries_its_own_content_sprite_not_its_object_id() {
        let pack = terri_data::pack();
        let fridge = pack.find("fridge").expect("shipped content has a fridge");
        let sofa = pack.find("sofa").expect("shipped content has a sofa");

        let fridge_sprite = pack.object(fridge).sprite;
        let sofa_sprite = pack.object(sofa).sprite;
        assert!(
            fridge_sprite != sofa_sprite
                && fridge_sprite != pack.sim_sprite
                && sofa_sprite != pack.sim_sprite,
            "the two objects and the sim must draw as three different \
             sprites, or this test cannot tell them apart"
        );
        assert!(
            fridge_sprite != fridge.0 || sofa_sprite != sofa.0,
            "at least one object's sprite index must differ from its own \
             ObjectDefId, or writing the id in place of the sprite is \
             invisible here"
        );

        let mut sim = Sim::new_with_lot(16, 16);
        sim.world_mut()
            .spawn((Position { x: 1.0, y: 1.0 }, SmartObject(fridge)));
        sim.world_mut()
            .spawn((Position { x: 2.0, y: 2.0 }, SmartObject(sofa)));
        sim.world_mut().spawn((
            Agent,
            Position { x: 3.0, y: 3.0 },
            Needs::with(NeedId::Hunger, 50.0),
        ));

        sim.sync_render_buffer();

        assert_eq!(
            sim.render_buffer().sprites,
            vec![fridge_sprite, sofa_sprite, pack.sim_sprite],
            "sorted by entity index, so the fridge spawned first comes first"
        );
        assert_eq!(
            sim.render_buffer().sprites.len(),
            sim.render_buffer().count,
            "every row must have a sprite; a short array leaves the last \
             entities reading whatever is past the end of the view"
        );
    }

    /// The `ids` column against the case that motivates it: a freed entity
    /// index.
    ///
    /// Nothing in the shipped game despawns yet, so on every world the
    /// player can currently produce, row `n` holds entity index `n` and a
    /// shell that used the row number as the index would be perfectly
    /// correct. **That is what this test exists to stop being load-bearing.**
    ///
    /// The despawn is the whole fixture. Without it the expected `ids` are
    /// `[0, 1, 2]`, which is also what a `push(row_number)` mutation
    /// produces and what `ids.iter().enumerate()` produces - so a test on a
    /// dense world cannot see any of the ways this column can be wrong
    /// ([L34]: a degenerate fixture whose input domain cannot express the
    /// bug). With a hole in the middle, the identity mapping and the true
    /// mapping disagree on two of the three rows.
    ///
    /// The assertion that the two disagree is stated first and separately,
    /// because if `bevy_ecs` ever reused the freed index eagerly enough to
    /// close the hole, this test would go on passing while testing nothing.
    #[test]
    fn a_row_is_not_its_entity_index_once_an_index_is_freed() {
        let mut sim = Sim::new_with_lot(16, 16);
        let spawned: Vec<Entity> = (0..4)
            .map(|i| {
                sim.world_mut()
                    .spawn((
                        Position {
                            x: i as f32,
                            y: 0.0,
                        },
                        a_smart_object(),
                    ))
                    .id()
            })
            .collect();

        // The second of four, so the hole is in the middle and every later
        // row's index is one above its row number. Despawning the last
        // would leave rows 0..2 still equal to indices 0..2.
        sim.world_mut().despawn(spawned[1]);
        sim.sync_render_buffer();

        let ids = sim.render_buffer().ids.clone();
        let identity: Vec<u32> = (0..ids.len() as u32).collect();
        assert_ne!(
            ids, identity,
            "the fixture must produce a world where the row number and the \
             entity index disagree, or nothing below is being tested"
        );

        let expected: Vec<u32> = spawned
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != 1)
            .map(|(_, entity)| entity.index_u32())
            .collect();
        assert_eq!(
            ids, expected,
            "each row must carry the entity actually standing in it, in the \
             same sorted order as positions and kinds"
        );
        assert_eq!(
            ids.len(),
            sim.render_buffer().count,
            "a short ids array leaves the last rows reading past the end of \
             the view, which resolves clicks to whatever integer is there"
        );
    }

    /// Every column is the same length as `count`, sync after sync.
    ///
    /// `sync_render_buffer` clears four vectors and fills four vectors, and
    /// the failure mode of forgetting one is not a crash: `ids` would keep
    /// growing while the other three restarted, so the view handed to
    /// JavaScript would be the right length but hold the FIRST sync's ids
    /// for ever. Every click would then resolve against a stale mapping.
    ///
    /// Three syncs with a spawn between them, because a single sync cannot
    /// tell a cleared vector from one that has never been written.
    #[test]
    fn every_column_is_recleared_on_each_sync() {
        let mut sim = Sim::new_with_lot(16, 16);
        sim.world_mut()
            .spawn((Position { x: 1.0, y: 1.0 }, a_smart_object()));

        for expected_count in 1..=3 {
            sim.sync_render_buffer();
            let buf = sim.render_buffer();
            assert_eq!(buf.count, expected_count);
            assert_eq!(buf.ids.len(), expected_count, "ids grew or was not cleared");
            assert_eq!(buf.kinds.len(), expected_count);
            assert_eq!(buf.sprites.len(), expected_count);
            assert_eq!(buf.positions.len(), expected_count * 2);

            sim.world_mut().spawn((
                Agent,
                Position { x: 2.0, y: 2.0 },
                Needs::with(NeedId::Hunger, 50.0),
            ));
        }
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
            .spawn((
                Agent,
                Position { x: 0.0, y: 0.0 },
                Needs::with(NeedId::Hunger, 50.0),
            ))
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
        sim.world_mut().spawn((
            Agent,
            Position { x: 7.0, y: 9.0 },
            Needs::with(NeedId::Hunger, 50.0),
        ));

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
                        Needs::with(NeedId::Hunger, 50.0),
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
            object: a_smart_object().0,
            interaction: 0,
            remaining_ticks: 1,
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
