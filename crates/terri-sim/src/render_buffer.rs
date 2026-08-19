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
    /// Stable authored Sim identity for each row, or [`NO_SIM_ID`].
    ///
    /// This is aligned with `ids`, not a replacement for it. `ids` names the
    /// current ECS entity used by commands and picking; this column names the
    /// person across save/load world replacement. Objects, unnamed stress
    /// agents, and presentation-only bystanders carry the sentinel.
    pub sim_ids: Vec<u32>,
    /// Compiled footprint width in lot tiles, one per row.
    ///
    /// Smart objects carry the content definition's width. Agents and
    /// presentation-only bystanders carry 1 so every row has usable geometry
    /// without making the shell reconstruct simulation facts.
    pub footprint_widths: Vec<u32>,
    /// Compiled footprint depth in lot tiles, one per row.
    ///
    /// Kept as a sibling column rather than packed with width so JavaScript can
    /// view both directly as `Uint32Array`s. Like every render column, its row
    /// order is the sorted `ids` order.
    pub footprint_depths: Vec<u32>,
    /// Index into the sprite atlas, one per row.
    ///
    /// It is here rather than derived in the shell because it comes from
    /// **content**: an object's `sprite` field is resolved against the
    /// atlas manifest when the pack is compiled. A lookup table in
    /// TypeScript keyed on object id would be a second copy of the object
    /// list, which is the coupling [D1] exists to prevent.
    pub sprites: Vec<u32>,
    /// Optional atlas layer drawn after bodies occupying this object.
    /// [`NO_FOREGROUND_SPRITE`] means the row has no foreground layer.
    pub foreground_sprites: Vec<u32>,
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
    /// [L3] family again: correct by coincidence, and the coincidence ends
    /// with the first despawn that leaves a reusable entity-index hole.
    ///
    /// So the shell reads the mapping rather than assuming it.
    /// `a_row_is_not_its_entity_index_once_an_index_is_freed` is the test
    /// that fails if this ever silently becomes the identity again.
    pub ids: Vec<u32>,
    /// What each row is DOING right now, as the [A-11] activity codes:
    /// 0 none, 1 walking, 2 waiting (reserved for a conversation whose
    /// initiator is still inbound), 3 exact authored eating, 4 talking
    /// (either side of a conversation), 5 sleeping (a valid sleep-tagged
    /// object interaction), 6 at work, 7 ordinary object use without a
    /// narrower authored activity, 8 exact authored reading, 9 exercising,
    /// 10 watching fish, and 11 sitting. Some codes are text-only and draw no
    /// indicator.
    ///
    /// Exists because the owner's play report put it plainly: "if you
    /// can't see what they're doing, they may as well not be doing
    /// anything." The simulation had all of these as components; this
    /// column is how the shell learns them without a query per frame.
    /// Objects are always 0 - activity is a fact about agents.
    pub activities: Vec<u32>,
    /// Body-action presentation for each row. See [`visual_action`] for the
    /// stable codes handed to the shell.
    ///
    /// This is deliberately separate from [`RenderBuffer::activities`].
    /// Activity 3 names exact authored object or chain eating. Activity 7
    /// names generic object use. Object and social body art still comes from
    /// an authored interaction or chain-step visual contract rather than
    /// guessing whether generic use is bathing, reading, or something else.
    /// Walking is the deliberate exception: it is presentation-owned and
    /// derived from the live path's next step.
    pub visual_actions: Vec<u32>,
    /// Lot-axis direction each projected body action faces. See [`facing`].
    /// A row whose visual action is [`visual_action::NONE`] also carries
    /// [`facing::NONE`].
    pub facings: Vec<u32>,
    /// What each row is CARRYING, as an index into the pack's item
    /// kinds, or [`NOT_CARRYING`] - the [K3] hands, made visible. The
    /// shell resolves the index against `item_kinds()` and the
    /// `carried_<kind>` atlas convention.
    pub carrying: Vec<u32>,
    pub count: usize,
}

/// The `carrying` column's empty-hands sentinel. Out of band: a pack's
/// item-kind list is a handful of entries, not four billion.
pub const NOT_CARRYING: u32 = u32::MAX;
/// The `foreground_sprites` column's absent-layer sentinel.
pub const NO_FOREGROUND_SPRITE: u32 = u32::MAX;
/// The `sim_ids` column's absent authored-identity sentinel.
pub const NO_SIM_ID: u32 = u32::MAX;

/// The `activities` codes, named. `u32` like every other column so the
/// JavaScript view is one more `Uint32Array` over the same memory.
pub mod activity {
    pub const NONE: u32 = 0;
    pub const WALKING: u32 = 1;
    pub const WAITING: u32 = 2;
    pub const EATING: u32 = 3;
    pub const TALKING: u32 = 4;
    pub const SLEEPING: u32 = 5;
    /// Off the lot working - [E4]. Not an indicator: the shell skips
    /// the whole row's draw (sprite, indicator, pick box), so the sim
    /// is gone without its interpolation slot moving.
    pub const AT_WORK: u32 = 6;
    /// Ordinary object use without a narrower authored activity. This is
    /// text-only in the shell: one glyph cannot honestly mean reading,
    /// washing, television, bathing, and toilet use at once.
    pub const USING_OBJECT: u32 = 7;
    /// Exact authored reading, either at a validated object socket or toward
    /// a validated object anchor.
    pub const READING: u32 = 8;
    /// Exact authored exercise at a validated object socket.
    pub const EXERCISING: u32 = 9;
    /// Exact authored aquarium watching toward a validated object anchor.
    pub const WATCHING_FISH: u32 = 10;
    /// Exact authored ordinary sitting at a validated object socket.
    pub const SITTING: u32 = 11;
}

/// Presentation body-action codes. Kept as `u32` so JavaScript can view the
/// column directly in WASM linear memory. Object and social actions require
/// authored content contracts; walking is derived from the live path.
pub mod visual_action {
    pub const NONE: u32 = 0;
    pub const TALK: u32 = 1;
    pub const EAT: u32 = 2;
    /// Seated reading at an object-local action socket.
    pub const READ: u32 = 3;
    /// Standing reading toward an object's footprint centre.
    pub const STANDING_READ: u32 = 4;
    /// Articulated travel toward the live path's next step.
    pub const WALK: u32 = 5;
    /// Seated exercise at an object-local action socket.
    pub const EXERCISE: u32 = 6;
    /// Standing aquarium watching toward the object's footprint centre.
    pub const WATCH: u32 = 7;
    /// Ordinary sitting at an object-local action socket.
    pub const SIT: u32 = 8;
    /// Horizontal sleeping body art at an object-local action socket.
    pub const SLEEP: u32 = 9;
}

/// Lot-axis facing codes for projected body actions.
///
/// Positive and negative refer to the simulation's x and y axes, not screen
/// directions after the isometric projection.
pub mod facing {
    pub const NONE: u32 = 0;
    pub const POSITIVE_X: u32 = 1;
    pub const NEGATIVE_X: u32 = 2;
    pub const POSITIVE_Y: u32 = 3;
    pub const NEGATIVE_Y: u32 = 4;
}

#[cfg(test)]
mod tests {
    use crate::test_content::shipped_fridge as a_smart_object;
    use crate::Sim;
    use bevy_ecs::prelude::*;
    use terri_core::{Agent, Eating, NeedId, Needs, Position, SimId, SmartObject};

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

    /// Footprint presentation metadata comes from the same compiled content
    /// as placement and pathing. The fixture deliberately includes different
    /// rectangular shapes, a 1x1 object, an agent, and a bystander. That makes
    /// width and depth distinguishable and makes a constant-one, swapped-axis,
    /// or entity-kind implementation fail rather than pass by coincidence.
    #[test]
    fn every_render_row_carries_its_content_footprint_or_one_by_one() {
        let pack = terri_data::pack();
        let bed = pack.find("bed").expect("the shipped pack declares the bed");
        let double_bed = pack
            .find("double_bed")
            .expect("the shipped pack declares the double bed");
        let fridge = pack
            .find("fridge")
            .expect("the shipped pack declares the fridge");

        let mut sim = Sim::new_with_lot(16, 16);
        sim.world_mut()
            .spawn((Position { x: 1.0, y: 1.0 }, SmartObject(bed)));
        sim.world_mut()
            .spawn((Position { x: 4.0, y: 1.0 }, SmartObject(double_bed)));
        sim.world_mut()
            .spawn((Position { x: 8.0, y: 1.0 }, SmartObject(fridge)));
        sim.world_mut().spawn((
            Agent,
            Position { x: 11.0, y: 1.0 },
            Needs::with(NeedId::Hunger, 50.0),
        ));
        // A row with neither `Agent` nor `SmartObject` is the bystander case
        // used by world-hash tests. It still needs valid presentation geometry.
        sim.world_mut().spawn(Position { x: 13.0, y: 1.0 });

        sim.sync_render_buffer();
        let buf = sim.render_buffer();
        assert_eq!(buf.count, 5);
        assert_eq!(buf.footprint_widths, vec![2, 2, 1, 1, 1]);
        assert_eq!(buf.footprint_depths, vec![1, 2, 1, 1, 1]);
        assert_ne!(
            buf.footprint_widths, buf.footprint_depths,
            "a non-square shipped object must keep width and depth distinguishable"
        );
        assert_ne!(
            buf.footprint_widths, buf.kinds,
            "footprint width must not accidentally expose the sibling kind column"
        );
        assert_ne!(
            buf.footprint_depths, buf.kinds,
            "footprint depth must not accidentally expose the sibling kind column"
        );
    }

    #[test]
    fn stable_sim_ids_are_aligned_and_absent_rows_use_the_sentinel() {
        let mut sim = Sim::new_with_lot(8, 8);
        let named = sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, SimId(41)))
            .id();
        let bare = sim
            .world_mut()
            .spawn((Agent, Position { x: 2.0, y: 1.0 }))
            .id();
        let object = sim
            .world_mut()
            .spawn((Position { x: 3.0, y: 1.0 }, a_smart_object()))
            .id();

        sim.sync_render_buffer();
        let buf = sim.render_buffer();
        let row_of = |entity: Entity| {
            buf.ids
                .iter()
                .position(|&id| id == entity.index_u32())
                .expect("the spawned entity has a render row")
        };

        assert_eq!(buf.sim_ids[row_of(named)], 41);
        assert_eq!(buf.sim_ids[row_of(bare)], super::NO_SIM_ID);
        assert_eq!(buf.sim_ids[row_of(object)], super::NO_SIM_ID);
        assert_eq!(buf.sim_ids.len(), buf.count);
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

    /// The [A-11] activity column, every code from one world: a talker,
    /// its partner, an eater, a reader, a generic object user, a sleeper, a
    /// walker, a waiter, an idler, and objects. Each code has exactly one
    /// producer here, so a classifier that collapses two states - the bug the
    /// precedence comments exist to prevent - collides somewhere visible.
    #[test]
    fn the_activity_column_names_what_each_row_is_doing() {
        use crate::render_buffer::activity;
        use terri_core::{Path, Relationships, Reserved, Socialising, Target};

        let pack = terri_data::pack();
        let fridge = pack.find("fridge").expect("shipped");
        let sink = pack.find("sink").expect("shipped");
        let bed = pack.find("bed").expect("shipped");
        let chair = pack.find("reading_chair").expect("shipped");
        let snack = shipped_interaction_index(fridge, "grab_snack");
        let wash_hands = shipped_interaction_index(sink, "wash_hands");
        let settle_in = shipped_interaction_index(chair, "settle_in");
        let _ = Relationships::default();

        let mut sim = Sim::new_with_lot(16, 16);
        let object = sim
            .world_mut()
            .spawn((Position { x: 9.0, y: 9.0 }, SmartObject(fridge)))
            .id();
        let generic_object = sim
            .world_mut()
            .spawn((Position { x: 10.0, y: 9.0 }, SmartObject(sink)))
            .id();
        let reading_object = sim.spawn_object(Position { x: 11.0, y: 9.0 }, chair);
        let spawn_agent = |sim: &mut Sim, x: f32| {
            sim.world_mut()
                .spawn((
                    Agent,
                    Position { x, y: 1.0 },
                    Needs::with(NeedId::Hunger, 50.0),
                ))
                .id()
        };
        let idler = spawn_agent(&mut sim, 1.0);
        let eater = spawn_agent(&mut sim, 2.0);
        let generic_user = spawn_agent(&mut sim, 3.0);
        let sleeper = spawn_agent(&mut sim, 4.0);
        let walker = spawn_agent(&mut sim, 5.0);
        let waiter = spawn_agent(&mut sim, 6.0);
        let talker = spawn_agent(&mut sim, 7.0);
        let partner = spawn_agent(&mut sim, 8.0);
        let reader = spawn_agent(&mut sim, 9.0);

        sim.world_mut().entity_mut(eater).insert((
            Eating {
                object: fridge,
                interaction: snack,
                remaining_ticks: 5,
            },
            Target {
                object,
                interaction: snack,
            },
        ));
        sim.world_mut().entity_mut(generic_user).insert((
            Eating {
                object: sink,
                interaction: wash_hands,
                remaining_ticks: 5,
            },
            Target {
                object: generic_object,
                interaction: wash_hands,
            },
        ));
        sim.world_mut().entity_mut(reader).insert((
            Eating {
                object: chair,
                interaction: settle_in,
                remaining_ticks: 5,
            },
            Target {
                object: reading_object,
                interaction: settle_in,
            },
        ));
        // The bunk's one interaction owns the shipped sleep tag. That exact
        // authored meaning is what the classifier reads, not the object name.
        sim.world_mut().entity_mut(sleeper).insert(Eating {
            object: bed,
            interaction: 0,
            remaining_ticks: 50,
        });
        sim.world_mut().entity_mut(walker).insert(Path {
            steps: vec![(4, 2)],
            cursor: 0,
        });
        sim.world_mut().entity_mut(waiter).insert(Reserved);
        sim.world_mut().entity_mut(talker).insert((
            Socialising {
                interaction: 0,
                partner,
                remaining_ticks: 10,
            },
            Target {
                object: partner,
                interaction: 0,
            },
        ));
        // The partner carries Reserved ONLY - discriminating it from the
        // waiter is exactly the partner-set pass's job.
        sim.world_mut().entity_mut(partner).insert(Reserved);

        sim.sync_render_buffer();
        let buf = sim.render_buffer();
        let of = |entity: bevy_ecs::entity::Entity| -> u32 {
            let row = buf
                .ids
                .iter()
                .position(|&id| id == entity.index_u32())
                .expect("every spawned entity has a row");
            buf.activities[row]
        };

        assert_eq!(of(object), activity::NONE, "objects do nothing");
        assert_eq!(of(generic_object), activity::NONE, "objects do nothing");
        assert_eq!(of(reading_object), activity::NONE, "objects do nothing");
        assert_eq!(of(idler), activity::NONE);
        assert_eq!(of(eater), activity::EATING);
        assert_eq!(of(generic_user), activity::USING_OBJECT);
        assert_eq!(of(reader), activity::READING);
        assert_eq!(of(sleeper), activity::SLEEPING);
        assert_eq!(of(walker), activity::WALKING);
        assert_eq!(of(waiter), activity::WAITING);
        assert_eq!(of(talker), activity::TALKING);
        assert_eq!(
            of(partner),
            activity::TALKING,
            "the receiving side is talking too, though it carries only \
             Reserved - the waiter above is what a wrong partner pass \
             turns it into"
        );
    }

    fn authored_talk_interaction(id: &str) -> terri_data::CompiledInteraction {
        let mut interaction = crate::test_content::interaction(id, &[(NeedId::Social, 20.0)], 20);
        interaction.visual = Some(terri_data::CompiledVisual {
            action: terri_data::CompiledVisualAction::Talk,
            anchor: terri_data::CompiledVisualAnchor::Partner,
            facing: terri_data::CompiledVisualFacing::TowardAnchor,
            socket: None,
        });
        interaction
    }

    fn projection_of(buffer: &super::RenderBuffer, entity: Entity) -> (u32, u32, u32) {
        let row = buffer
            .ids
            .iter()
            .position(|&id| id == entity.index_u32())
            .expect("the fixture entity has a render row");
        (
            buffer.visual_actions[row],
            buffer.facings[row],
            buffer.activities[row],
        )
    }

    fn shipped_interaction_index(object: terri_data::ObjectDefId, interaction_id: &str) -> u32 {
        terri_data::pack()
            .object(object)
            .interactions
            .iter()
            .position(|interaction| interaction.id == interaction_id)
            .unwrap_or_else(|| panic!("the shipped object declares '{interaction_id}'"))
            as u32
    }

    fn displayed_position_of(
        buffer: &super::RenderBuffer,
        entity: Entity,
    ) -> ((f32, f32), (f32, f32)) {
        let row = buffer
            .ids
            .iter()
            .position(|&id| id == entity.index_u32())
            .expect("the fixture entity has a render row");
        let offset = row * 2;
        (
            (buffer.positions[offset], buffer.positions[offset + 1]),
            (
                buffer.prev_positions[offset],
                buffer.prev_positions[offset + 1],
            ),
        )
    }

    #[test]
    fn authored_object_codes_append_after_every_existing_render_code() {
        use crate::render_buffer::{activity, visual_action};

        assert_eq!(visual_action::WALK, 5, "walking remains action 5");
        assert_eq!(visual_action::EXERCISE, 6, "exercise appends as action 6");
        assert_eq!(visual_action::WATCH, 7, "watching fish appends as action 7");
        assert_eq!(visual_action::SIT, 8, "sitting appends as action 8");
        assert_eq!(visual_action::SLEEP, 9, "sleeping appends as action 9");
        assert_eq!(activity::READING, 8, "reading remains activity 8");
        assert_eq!(activity::EXERCISING, 9, "exercise appends as activity 9");
        assert_eq!(
            activity::WATCHING_FISH,
            10,
            "watching fish appends as activity 10"
        );
        assert_eq!(activity::SITTING, 11, "sitting appends as activity 11");
    }

    #[test]
    fn walking_visual_uses_the_live_next_step_for_all_four_lot_axes_only() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::Path;

        assert_eq!(visual_action::WALK, 5, "walking is append-only action 5");

        let mut sim = Sim::new_with_lot(24, 24);
        let cases = [
            (Position { x: 8.25, y: 8.0 }, (9, 8), facing::POSITIVE_X),
            (Position { x: 8.75, y: 8.0 }, (8, 8), facing::NEGATIVE_X),
            (Position { x: 8.0, y: 8.25 }, (8, 9), facing::POSITIVE_Y),
            (Position { x: 8.0, y: 8.75 }, (8, 8), facing::NEGATIVE_Y),
        ];
        let mut agents = Vec::new();
        for (position, next_step, expected_facing) in cases {
            let agent = sim.world_mut().spawn((Agent, position)).id();
            agents.push((agent, position, next_step, expected_facing));
        }
        sim.sync_render_buffer();
        let row_count_without_paths = sim.render_buffer().count;

        for (agent, _, next_step, _) in &agents {
            sim.world_mut().entity_mut(*agent).insert(Path {
                steps: vec![*next_step],
                cursor: 0,
            });
        }
        let save_before_projection = sim.save_snapshot();
        let hash_before_projection = sim.world_hash();
        sim.sync_render_buffer();

        assert_eq!(sim.render_buffer().count, row_count_without_paths);
        for (agent, position, _, expected_facing) in agents {
            assert_eq!(
                projection_of(sim.render_buffer(), agent),
                (visual_action::WALK, expected_facing, activity::WALKING)
            );
            assert_eq!(
                displayed_position_of(sim.render_buffer(), agent),
                ((position.x, position.y), (position.x, position.y)),
                "walking action metadata must not create another row or move either sample"
            );
            assert_eq!(sim.world().get::<Position>(agent).copied(), Some(position));
        }
        assert_eq!(sim.save_snapshot(), save_before_projection);
        assert_eq!(sim.world_hash(), hash_before_projection);
    }

    #[test]
    fn walking_visual_falls_back_for_exhausted_coincident_and_absent_paths() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::{AtWork, Path};

        let mut sim = Sim::new_with_lot(16, 16);
        let no_path = sim
            .world_mut()
            .spawn((Agent, Position { x: 2.0, y: 2.0 }))
            .id();
        let exhausted = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 4.0 },
                Path {
                    steps: vec![(5, 4)],
                    cursor: 1,
                },
            ))
            .id();
        let coincident = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 6.0, y: 6.0 },
                Path {
                    steps: vec![(6, 6)],
                    cursor: 0,
                },
            ))
            .id();
        let off_lot = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 8.0, y: 8.0 },
                Path {
                    steps: vec![(9, 8)],
                    cursor: 0,
                },
                AtWork { remaining_ticks: 5 },
            ))
            .id();
        let object_with_path = sim
            .world_mut()
            .spawn((
                Position { x: 10.0, y: 10.0 },
                SmartObject(a_smart_object().0),
                Path {
                    steps: vec![(11, 10)],
                    cursor: 0,
                },
            ))
            .id();

        sim.sync_render_buffer();

        assert_eq!(
            projection_of(sim.render_buffer(), no_path),
            (visual_action::NONE, facing::NONE, activity::NONE)
        );
        for agent in [exhausted, coincident] {
            assert_eq!(
                projection_of(sim.render_buffer(), agent),
                (visual_action::NONE, facing::NONE, activity::WALKING),
                "a Path marker without a directional next step keeps the old activity but cannot select walk art"
            );
        }
        assert_eq!(
            projection_of(sim.render_buffer(), off_lot),
            (visual_action::NONE, facing::NONE, activity::AT_WORK),
            "a directional path must not emit walk art unless WALKING wins the final activity"
        );
        assert_eq!(
            projection_of(sim.render_buffer(), object_with_path),
            (visual_action::NONE, facing::NONE, activity::NONE),
            "a Path on a non-Agent row cannot make furniture select character art"
        );
    }

    #[test]
    fn authored_action_precedence_cannot_be_overwritten_by_a_walk_path() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::{Path, Reserved, Socialising, Target};

        let pack = terri_data::pack();
        let mut sim = Sim::new_with_lot(32, 32);
        let walking_path = || Path {
            steps: vec![(4, 3)],
            cursor: 0,
        };

        let partner = sim
            .world_mut()
            .spawn((Agent, Position { x: 5.0, y: 3.0 }, Reserved))
            .id();
        let talker = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 3.0, y: 3.0 },
                Socialising {
                    interaction: 0,
                    partner,
                    remaining_ticks: 10,
                },
                walking_path(),
            ))
            .id();

        let fridge = pack.find("fridge").expect("shipped fridge");
        let snack = shipped_interaction_index(fridge, "grab_snack");
        let fridge_target = sim.spawn_object(Position { x: 10.0, y: 3.0 }, fridge);
        let eater = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 8.0, y: 3.0 },
                Eating {
                    object: fridge,
                    interaction: snack,
                    remaining_ticks: 10,
                },
                Target {
                    object: fridge_target,
                    interaction: snack,
                },
                Path {
                    steps: vec![(9, 3)],
                    cursor: 0,
                },
            ))
            .id();

        let (seated_reader, _, _, _) = spawn_shipped_reader(
            &mut sim,
            Position { x: 15.0, y: 3.0 },
            Position { x: 13.0, y: 3.0 },
        );
        sim.world_mut().entity_mut(seated_reader).insert(Path {
            steps: vec![(14, 3)],
            cursor: 0,
        });
        let (standing_reader, _, _, _) = spawn_shipped_standing_reader(
            &mut sim,
            Position { x: 20.0, y: 3.0 },
            Position { x: 18.0, y: 3.0 },
        );
        sim.world_mut().entity_mut(standing_reader).insert(Path {
            steps: vec![(19, 3)],
            cursor: 0,
        });
        let (exerciser, _, _, _) = spawn_shipped_exerciser(
            &mut sim,
            Position { x: 25.0, y: 3.0 },
            Position { x: 23.0, y: 3.0 },
        );
        sim.world_mut().entity_mut(exerciser).insert(Path {
            steps: vec![(24, 3)],
            cursor: 0,
        });
        let (watcher, _, _, _) = spawn_shipped_fish_watcher(
            &mut sim,
            Position { x: 30.0, y: 3.0 },
            Position { x: 28.0, y: 3.0 },
        );
        sim.world_mut().entity_mut(watcher).insert(Path {
            steps: vec![(29, 3)],
            cursor: 0,
        });

        sim.sync_render_buffer();

        assert_eq!(
            projection_of(sim.render_buffer(), talker),
            (visual_action::TALK, facing::POSITIVE_X, activity::TALKING)
        );
        assert_eq!(
            projection_of(sim.render_buffer(), eater),
            (visual_action::EAT, facing::POSITIVE_X, activity::EATING)
        );
        assert_eq!(
            projection_of(sim.render_buffer(), seated_reader),
            (visual_action::READ, facing::POSITIVE_X, activity::READING)
        );
        assert_eq!(
            projection_of(sim.render_buffer(), standing_reader),
            (
                visual_action::STANDING_READ,
                facing::POSITIVE_X,
                activity::READING,
            )
        );
        assert_eq!(
            projection_of(sim.render_buffer(), exerciser),
            (
                visual_action::EXERCISE,
                facing::POSITIVE_X,
                activity::EXERCISING,
            )
        );
        assert_eq!(
            projection_of(sim.render_buffer(), watcher),
            (
                visual_action::WATCH,
                facing::POSITIVE_X,
                activity::WATCHING_FISH,
            )
        );
    }

    #[test]
    fn paused_sync_and_load_keep_walk_facing_when_position_samples_are_equal() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::Path;

        let mut sim = Sim::new_with_lot(16, 16);
        let position = Position { x: 7.25, y: 8.0 };
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                position,
                Path {
                    steps: vec![(8, 8)],
                    cursor: 0,
                },
            ))
            .id();
        sim.sync_render_buffer();
        let snapshot = sim.save_snapshot();
        let hash = sim.world_hash();

        sim.sync_render_buffer_after_commands();
        assert_eq!(
            projection_of(sim.render_buffer(), agent),
            (visual_action::WALK, facing::POSITIVE_X, activity::WALKING)
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            ((position.x, position.y), (position.x, position.y)),
            "a paused metadata refresh has no position delta from which Web could infer facing"
        );
        assert_eq!(sim.save_snapshot(), snapshot);
        assert_eq!(sim.world_hash(), hash);

        let mut restored = Sim::new_with_lot(1, 1);
        restored
            .load_snapshot(snapshot.clone())
            .expect("walking Save V1 state is valid");
        assert_eq!(
            projection_of(restored.render_buffer(), agent),
            (visual_action::WALK, facing::POSITIVE_X, activity::WALKING)
        );
        assert_eq!(
            displayed_position_of(restored.render_buffer(), agent),
            ((position.x, position.y), (position.x, position.y)),
            "Load reseeds both samples, so the path-derived facing is the only directional signal"
        );
        assert_eq!(restored.save_snapshot(), snapshot);
        assert_eq!(restored.world_hash(), hash);
    }

    fn spawn_shipped_reader(
        sim: &mut Sim,
        chair_at: Position,
        agent_at: Position,
    ) -> (Entity, Entity, terri_data::ObjectDefId, u32) {
        let chair = sim
            .world()
            .resource::<crate::Content>()
            .0
            .find("reading_chair")
            .expect("the active pack declares the reading chair");
        let interaction = sim
            .world()
            .resource::<crate::Content>()
            .0
            .object(chair)
            .interactions
            .iter()
            .position(|interaction| interaction.id == "settle_in")
            .expect("the active pack declares settle_in") as u32;
        let target = sim.spawn_object(chair_at, chair);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                agent_at,
                Eating {
                    object: chair,
                    interaction,
                    remaining_ticks: 10,
                },
                terri_core::Target {
                    object: target,
                    interaction,
                },
            ))
            .id();
        (agent, target, chair, interaction)
    }

    fn spawn_shipped_standing_reader(
        sim: &mut Sim,
        shelf_at: Position,
        agent_at: Position,
    ) -> (Entity, Entity, terri_data::ObjectDefId, u32) {
        let bookshelf = sim
            .world()
            .resource::<crate::Content>()
            .0
            .find("bookshelf")
            .expect("the active pack declares the bookshelf");
        let interaction = sim
            .world()
            .resource::<crate::Content>()
            .0
            .object(bookshelf)
            .interactions
            .iter()
            .position(|interaction| interaction.id == "read")
            .expect("the active pack declares bookshelf.read") as u32;
        let target = sim.spawn_object(shelf_at, bookshelf);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                agent_at,
                Eating {
                    object: bookshelf,
                    interaction,
                    remaining_ticks: 10,
                },
                terri_core::Target {
                    object: target,
                    interaction,
                },
            ))
            .id();
        (agent, target, bookshelf, interaction)
    }

    fn spawn_shipped_exerciser(
        sim: &mut Sim,
        bike_at: Position,
        agent_at: Position,
    ) -> (Entity, Entity, terri_data::ObjectDefId, u32) {
        let bike = sim
            .world()
            .resource::<crate::Content>()
            .0
            .find("moving_box")
            .expect("the active pack declares the exercise bike");
        let interaction = sim
            .world()
            .resource::<crate::Content>()
            .0
            .object(bike)
            .interactions
            .iter()
            .position(|interaction| interaction.id == "use_exercise_bike")
            .expect("the active pack declares use_exercise_bike") as u32;
        let target = sim.spawn_object(bike_at, bike);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                agent_at,
                Eating {
                    object: bike,
                    interaction,
                    remaining_ticks: 10,
                },
                terri_core::Target {
                    object: target,
                    interaction,
                },
            ))
            .id();
        (agent, target, bike, interaction)
    }

    fn spawn_shipped_sitter(
        sim: &mut Sim,
        chair_at: Position,
        agent_at: Position,
    ) -> (Entity, Entity, terri_data::ObjectDefId, u32) {
        let armchair = sim
            .world()
            .resource::<crate::Content>()
            .0
            .find("armchair")
            .expect("the active pack declares the armchair");
        let interaction = shipped_interaction_index(armchair, "take_the_chair");
        let target = sim.spawn_object(chair_at, armchair);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                agent_at,
                Eating {
                    object: armchair,
                    interaction,
                    remaining_ticks: 10,
                },
                terri_core::Target {
                    object: target,
                    interaction,
                },
            ))
            .id();
        (agent, target, armchair, interaction)
    }

    fn spawn_shipped_sleeper(
        sim: &mut Sim,
        bed_at: Position,
        agent_at: Position,
    ) -> (Entity, Entity, terri_data::ObjectDefId, u32) {
        let bed = sim
            .world()
            .resource::<crate::Content>()
            .0
            .find("bed")
            .expect("the active pack declares the bunk bed");
        let interaction = shipped_interaction_index(bed, "sleep");
        let target = sim.spawn_object(bed_at, bed);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                agent_at,
                Eating {
                    object: bed,
                    interaction,
                    remaining_ticks: 10,
                },
                terri_core::Target {
                    object: target,
                    interaction,
                },
            ))
            .id();
        (agent, target, bed, interaction)
    }

    fn spawn_shipped_fish_watcher(
        sim: &mut Sim,
        aquarium_at: Position,
        agent_at: Position,
    ) -> (Entity, Entity, terri_data::ObjectDefId, u32) {
        let aquarium = sim
            .world()
            .resource::<crate::Content>()
            .0
            .find("reference_shelf")
            .expect("the active pack declares the aquarium");
        let interaction = sim
            .world()
            .resource::<crate::Content>()
            .0
            .object(aquarium)
            .interactions
            .iter()
            .position(|interaction| interaction.id == "watch_fish")
            .expect("the active pack declares watch_fish") as u32;
        let target = sim.spawn_object(aquarium_at, aquarium);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                agent_at,
                Eating {
                    object: aquarium,
                    interaction,
                    remaining_ticks: 10,
                },
                terri_core::Target {
                    object: target,
                    interaction,
                },
            ))
            .id();
        (agent, target, aquarium, interaction)
    }

    #[test]
    fn paused_chain_state_preserves_interrupted_authored_action_projections() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::{ChainState, StepWork};

        let mut sim = Sim::new_with_lot(48, 48);
        assert!(
            !sim.world().resource::<crate::Content>().0.chains.is_empty(),
            "the interrupted-chain fixture needs a valid resumable chain"
        );
        let (seated_reader, _, _, _) = spawn_shipped_reader(
            &mut sim,
            Position { x: 8.0, y: 8.0 },
            Position { x: 6.0, y: 8.0 },
        );
        let (standing_reader, _, _, _) = spawn_shipped_standing_reader(
            &mut sim,
            Position { x: 16.0, y: 8.0 },
            Position { x: 14.0, y: 8.0 },
        );
        let (exerciser, _, _, _) = spawn_shipped_exerciser(
            &mut sim,
            Position { x: 24.0, y: 8.0 },
            Position { x: 22.0, y: 8.0 },
        );
        let (fish_watcher, _, _, _) = spawn_shipped_fish_watcher(
            &mut sim,
            Position { x: 32.0, y: 8.0 },
            Position { x: 30.0, y: 8.0 },
        );
        let expected = [
            (
                seated_reader,
                visual_action::READ,
                facing::POSITIVE_X,
                activity::READING,
            ),
            (
                standing_reader,
                visual_action::STANDING_READ,
                facing::POSITIVE_X,
                activity::READING,
            ),
            (
                exerciser,
                visual_action::EXERCISE,
                facing::POSITIVE_X,
                activity::EXERCISING,
            ),
            (
                fish_watcher,
                visual_action::WATCH,
                facing::POSITIVE_X,
                activity::WATCHING_FISH,
            ),
        ];

        // Player interactions pause chain work without deleting its resumable
        // counter. This is the component state produced by that interruption:
        // ordinary Eating plus Target, persistent ChainState, and no StepWork.
        for &(entity, _, _, _) in &expected {
            sim.world_mut()
                .entity_mut(entity)
                .insert(ChainState::begin(0));
            assert!(sim.world().get::<StepWork>(entity).is_none());
        }
        let snapshot = sim.save_snapshot();
        let hash = sim.world_hash();

        sim.sync_render_buffer();
        for &(entity, action, direction, projected_activity) in &expected {
            assert!(
                sim.world().get::<ChainState>(entity).is_some(),
                "render projection must not consume resumable chain progress"
            );
            assert_eq!(
                projection_of(sim.render_buffer(), entity),
                (action, direction, projected_activity),
                "a paused chain must preserve its ordinary authored interruption pose"
            );
        }
        assert_eq!(sim.save_snapshot(), snapshot);
        assert_eq!(sim.world_hash(), hash);

        let mut restored = Sim::new_with_lot(1, 1);
        restored
            .load_snapshot(snapshot)
            .expect("an interrupted ordinary action with resumable chain progress must load");
        for &(entity, action, direction, projected_activity) in &expected {
            assert!(restored.world().get::<ChainState>(entity).is_some());
            assert_eq!(
                projection_of(restored.render_buffer(), entity),
                (action, direction, projected_activity),
                "Load must reconstruct the interrupted authored pose"
            );
        }

        // StepWork is different: it means the chain step itself is actively
        // running, so malformed overlap must still fail closed.
        for &(entity, _, _, _) in &expected {
            restored.world_mut().entity_mut(entity).insert(StepWork {
                remaining_ticks: 10,
            });
        }
        restored.sync_render_buffer();
        for &(entity, _, _, _) in &expected {
            assert_eq!(
                projection_of(restored.render_buffer(), entity),
                (visual_action::NONE, facing::NONE, activity::USING_OBJECT),
                "active StepWork must suppress the ordinary authored pose"
            );
        }
    }

    #[test]
    fn shipped_socket_actions_and_aquarium_project_exact_pose_and_load_state() {
        use crate::render_buffer::{activity, facing, visual_action};

        let mut sim = Sim::new_with_lot(48, 48);
        let bike_position = Position { x: 35.5, y: 36.25 };
        let bike_agent_position = Position { x: 31.0, y: 36.25 };
        let (exerciser, bike_target, _, _) =
            spawn_shipped_exerciser(&mut sim, bike_position, bike_agent_position);
        let saddle = sim
            .world()
            .get::<crate::ResolvedActionSockets>(bike_target)
            .expect("the exercise bike resolves its saddle")
            .0[0]
            .clone();

        let chair_position = Position { x: 41.0, y: 40.0 };
        let chair_agent_position = Position { x: 39.0, y: 40.0 };
        let (sitter, chair_target, _, _) =
            spawn_shipped_sitter(&mut sim, chair_position, chair_agent_position);
        let seat = sim
            .world()
            .get::<crate::ResolvedActionSockets>(chair_target)
            .expect("the armchair resolves its seat")
            .0[0]
            .clone();

        let bed_position = Position { x: 25.0, y: 24.0 };
        let bed_agent_position = Position { x: 23.0, y: 24.0 };
        let (sleeper, bed_target, bed, _) =
            spawn_shipped_sleeper(&mut sim, bed_position, bed_agent_position);
        let lower_bunk = sim
            .world()
            .get::<crate::ResolvedActionSockets>(bed_target)
            .expect("the bunk bed resolves its lower bunk")
            .0[0]
            .clone();

        let aquarium_position = Position { x: 12.0, y: 12.0 };
        let watcher_cases = [
            (Position { x: 9.0, y: 12.0 }, facing::POSITIVE_X),
            (Position { x: 15.0, y: 12.0 }, facing::NEGATIVE_X),
            (Position { x: 12.0, y: 9.0 }, facing::POSITIVE_Y),
            (Position { x: 12.0, y: 15.0 }, facing::NEGATIVE_Y),
            // Equal non-zero deltas take the x axis deterministically.
            (Position { x: 10.0, y: 10.0 }, facing::POSITIVE_X),
        ];
        let mut watchers = Vec::new();
        for (position, expected_facing) in watcher_cases {
            let (watcher, _, _, _) =
                spawn_shipped_fish_watcher(&mut sim, aquarium_position, position);
            watchers.push((watcher, position, expected_facing));
        }
        let before_hash = sim.world_hash();
        let before_save = sim.save_snapshot();

        sim.sync_render_buffer();

        assert_eq!(
            projection_of(sim.render_buffer(), exerciser),
            (
                visual_action::EXERCISE,
                facing::POSITIVE_X,
                activity::EXERCISING,
            )
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), exerciser),
            ((saddle.x, saddle.y), (saddle.x, saddle.y)),
            "the body and both interpolation samples must plant on the exact saddle"
        );
        assert_eq!(
            projection_of(sim.render_buffer(), sitter),
            (visual_action::SIT, facing::POSITIVE_X, activity::SITTING,)
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), sitter),
            ((seat.x, seat.y), (seat.x, seat.y)),
            "the ordinary sitting body must plant on the exact chair seat"
        );
        assert_eq!(
            projection_of(sim.render_buffer(), sleeper),
            (visual_action::SLEEP, facing::POSITIVE_X, activity::SLEEPING,)
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), sleeper),
            ((lower_bunk.x, lower_bunk.y), (lower_bunk.x, lower_bunk.y)),
            "the horizontal sleeping body must plant on the exact lower bunk"
        );
        let bed_row = sim
            .render_buffer()
            .ids
            .iter()
            .position(|&id| id == bed_target.index_u32())
            .expect("the bunk bed has a render row");
        assert_eq!(
            sim.render_buffer().foreground_sprites[bed_row],
            sim.world()
                .resource::<crate::Content>()
                .0
                .object(bed)
                .foreground_sprite
                .expect("the shipped bunk bed declares foreground bedding")
        );
        for &(watcher, position, expected_facing) in &watchers {
            assert_eq!(
                projection_of(sim.render_buffer(), watcher),
                (
                    visual_action::WATCH,
                    expected_facing,
                    activity::WATCHING_FISH,
                )
            );
            assert_eq!(
                displayed_position_of(sim.render_buffer(), watcher),
                ((position.x, position.y), (position.x, position.y)),
                "watching fish must face the aquarium without entering it"
            );
        }
        assert_eq!(sim.save_snapshot(), before_save);
        assert_eq!(sim.world_hash(), before_hash);

        let mut restored = Sim::new_with_lot(1, 1);
        restored
            .load_snapshot(before_save.clone())
            .expect("the active aquarium and bike state must load");
        assert_eq!(restored.save_snapshot(), before_save);
        assert_eq!(restored.world_hash(), before_hash);
        assert_eq!(
            projection_of(restored.render_buffer(), exerciser),
            (
                visual_action::EXERCISE,
                facing::POSITIVE_X,
                activity::EXERCISING,
            )
        );
        assert_eq!(
            displayed_position_of(restored.render_buffer(), exerciser),
            ((saddle.x, saddle.y), (saddle.x, saddle.y)),
            "Load reconstructs the socket pose from tick state and current authored content"
        );
        assert_eq!(
            projection_of(restored.render_buffer(), sitter),
            (visual_action::SIT, facing::POSITIVE_X, activity::SITTING,)
        );
        assert_eq!(
            displayed_position_of(restored.render_buffer(), sitter),
            ((seat.x, seat.y), (seat.x, seat.y))
        );
        assert_eq!(
            projection_of(restored.render_buffer(), sleeper),
            (visual_action::SLEEP, facing::POSITIVE_X, activity::SLEEPING,)
        );
        assert_eq!(
            displayed_position_of(restored.render_buffer(), sleeper),
            ((lower_bunk.x, lower_bunk.y), (lower_bunk.x, lower_bunk.y))
        );
        let restored_bed_row = restored
            .render_buffer()
            .ids
            .iter()
            .position(|&id| id == bed_target.index_u32())
            .expect("the loaded bunk bed has a render row");
        assert_eq!(
            restored.render_buffer().foreground_sprites[restored_bed_row],
            restored
                .world()
                .resource::<crate::Content>()
                .0
                .object(bed)
                .foreground_sprite
                .expect("Load reconstructs foreground bedding from the current pack")
        );
        for &(watcher, position, expected_facing) in &watchers {
            assert_eq!(
                projection_of(restored.render_buffer(), watcher),
                (
                    visual_action::WATCH,
                    expected_facing,
                    activity::WATCHING_FISH,
                )
            );
            assert_eq!(
                displayed_position_of(restored.render_buffer(), watcher),
                ((position.x, position.y), (position.x, position.y))
            );
        }
    }

    #[test]
    fn exercise_socket_entry_continuation_and_cancel_reseed_both_samples() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::Target;

        let mut sim = Sim::new_with_lot(24, 24);
        let bike = terri_data::pack()
            .find("moving_box")
            .expect("shipped exercise bike");
        let exercise = shipped_interaction_index(bike, "use_exercise_bike");
        let bike_position = Position { x: 17.5, y: 18.25 };
        let agent_position = Position { x: 4.0, y: 5.5 };
        let target = sim.spawn_object(bike_position, bike);
        let saddle = sim
            .world()
            .get::<crate::ResolvedActionSockets>(target)
            .expect("bike socket carrier")
            .0[0]
            .clone();
        let agent = sim.world_mut().spawn((Agent, agent_position)).id();

        sim.sync_render_buffer();
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            (
                (agent_position.x, agent_position.y),
                (agent_position.x, agent_position.y),
            )
        );

        sim.world_mut().entity_mut(agent).insert((
            Eating {
                object: bike,
                interaction: exercise,
                remaining_ticks: 10,
            },
            Target {
                object: target,
                interaction: exercise,
            },
        ));
        sim.sync_render_buffer_after_commands();
        assert_eq!(
            projection_of(sim.render_buffer(), agent),
            (
                visual_action::EXERCISE,
                facing::POSITIVE_X,
                activity::EXERCISING,
            )
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            ((saddle.x, saddle.y), (saddle.x, saddle.y)),
            "paused entry must not glide from the path tile onto the saddle"
        );

        sim.sync_render_buffer();
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            ((saddle.x, saddle.y), (saddle.x, saddle.y)),
            "continued exercise remains planted across an advancing sample"
        );

        sim.world_mut()
            .entity_mut(agent)
            .remove::<(Eating, Target)>();
        sim.sync_render_buffer_after_commands();
        assert_eq!(
            projection_of(sim.render_buffer(), agent),
            (visual_action::NONE, facing::NONE, activity::NONE)
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            (
                (agent_position.x, agent_position.y),
                (agent_position.x, agent_position.y),
            ),
            "paused Cancel must not glide from the saddle back to the path tile"
        );
    }

    #[test]
    fn exercise_projects_both_position_samples_from_the_exact_resolved_socket() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::Target;

        let mut sim = Sim::new_with_lot(24, 24);
        let bike = terri_data::pack()
            .find("moving_box")
            .expect("shipped exercise bike");
        let exercise = shipped_interaction_index(bike, "use_exercise_bike");
        let bike_position = Position { x: 17.5, y: 18.25 };
        let target = sim.spawn_object(bike_position, bike);
        let socket_position = (19.75, 16.125);
        {
            let mut sockets = sim
                .world_mut()
                .get_mut::<crate::ResolvedActionSockets>(target)
                .expect("bike socket carrier");
            let saddle = sockets.0.get_mut(0).expect("exercise saddle");
            saddle.x = socket_position.0;
            saddle.y = socket_position.1;
        }
        assert_ne!(socket_position.0, bike_position.x);
        assert_ne!(socket_position.1, bike_position.y);

        let agent_position = Position { x: 4.0, y: 5.5 };
        let agent = sim.world_mut().spawn((Agent, agent_position)).id();
        sim.sync_render_buffer();
        sim.world_mut().entity_mut(agent).insert((
            Eating {
                object: bike,
                interaction: exercise,
                remaining_ticks: 10,
            },
            Target {
                object: target,
                interaction: exercise,
            },
        ));

        sim.sync_render_buffer_after_commands();

        assert_eq!(
            projection_of(sim.render_buffer(), agent),
            (
                visual_action::EXERCISE,
                facing::POSITIVE_X,
                activity::EXERCISING,
            )
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            (socket_position, socket_position),
            "paused exercise entry must reseed current and previous coordinates from the exact resolved socket, not the target origin"
        );
    }

    #[test]
    fn exercise_and_watch_require_their_exact_compiled_visual_contracts() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_data::{CompiledInteraction, CompiledVisualAction, CompiledVisualAnchor};

        type Mutation = fn(&mut CompiledInteraction);
        let generic = (visual_action::NONE, facing::NONE, activity::USING_OBJECT);
        let exercise_cases: [(&str, Mutation, (u32, u32, u32)); 7] = [
            (
                "missing visual",
                |interaction| interaction.visual = None,
                generic,
            ),
            (
                "reading sibling",
                |interaction| {
                    interaction.visual.as_mut().expect("visual").action =
                        CompiledVisualAction::Read;
                },
                (visual_action::READ, facing::POSITIVE_X, activity::READING),
            ),
            (
                "wrong action",
                |interaction| {
                    interaction.visual.as_mut().expect("visual").action =
                        CompiledVisualAction::Watch;
                },
                generic,
            ),
            (
                "wrong anchor",
                |interaction| {
                    interaction.visual.as_mut().expect("visual").anchor =
                        CompiledVisualAnchor::Object;
                },
                generic,
            ),
            (
                "wrong facing",
                |interaction| {
                    interaction.visual.as_mut().expect("visual").facing =
                        terri_data::CompiledVisualFacing::TowardAnchor;
                },
                generic,
            ),
            (
                "missing socket",
                |interaction| interaction.visual.as_mut().expect("visual").socket = None,
                generic,
            ),
            (
                "out-of-range socket",
                |interaction| interaction.visual.as_mut().expect("visual").socket = Some(1),
                generic,
            ),
        ];
        for (description, mutate, expected) in exercise_cases {
            let shipped = terri_data::pack();
            let bike = shipped.find("moving_box").expect("shipped bike");
            let mut definition = shipped.object(bike).clone();
            mutate(
                definition
                    .interactions
                    .iter_mut()
                    .find(|interaction| interaction.id == "use_exercise_bike")
                    .expect("exercise interaction"),
            );
            let pack = crate::test_content::pack(vec![definition]);
            let mut sim = crate::test_content::sim_with(20, 20, pack);
            let (agent, _, _, _) = spawn_shipped_exerciser(
                &mut sim,
                Position { x: 12.0, y: 12.0 },
                Position { x: 8.0, y: 12.0 },
            );
            sim.sync_render_buffer();
            assert_eq!(
                projection_of(sim.render_buffer(), agent),
                expected,
                "exercise {description} must retain only its exact sibling behavior"
            );
            assert_ne!(
                projection_of(sim.render_buffer(), agent).0,
                visual_action::EXERCISE,
                "exercise {description} must not acquire action 6"
            );
        }

        let watch_cases: [(&str, Mutation, (u32, u32, u32)); 6] = [
            (
                "missing visual",
                |interaction| interaction.visual = None,
                generic,
            ),
            (
                "standing-read sibling",
                |interaction| {
                    interaction.visual.as_mut().expect("visual").action =
                        CompiledVisualAction::Read;
                },
                (
                    visual_action::STANDING_READ,
                    facing::POSITIVE_X,
                    activity::READING,
                ),
            ),
            (
                "wrong action",
                |interaction| {
                    interaction.visual.as_mut().expect("visual").action =
                        CompiledVisualAction::Exercise;
                },
                generic,
            ),
            (
                "wrong anchor",
                |interaction| {
                    interaction.visual.as_mut().expect("visual").anchor =
                        CompiledVisualAnchor::ObjectSocket;
                },
                generic,
            ),
            (
                "wrong facing",
                |interaction| {
                    interaction.visual.as_mut().expect("visual").facing =
                        terri_data::CompiledVisualFacing::Socket;
                },
                generic,
            ),
            (
                "surplus socket",
                |interaction| interaction.visual.as_mut().expect("visual").socket = Some(0),
                generic,
            ),
        ];
        for (description, mutate, expected) in watch_cases {
            let shipped = terri_data::pack();
            let aquarium = shipped.find("reference_shelf").expect("shipped aquarium");
            let mut definition = shipped.object(aquarium).clone();
            mutate(
                definition
                    .interactions
                    .iter_mut()
                    .find(|interaction| interaction.id == "watch_fish")
                    .expect("watch interaction"),
            );
            let pack = crate::test_content::pack(vec![definition]);
            let mut sim = crate::test_content::sim_with(20, 20, pack);
            let (agent, _, _, _) = spawn_shipped_fish_watcher(
                &mut sim,
                Position { x: 12.0, y: 12.0 },
                Position { x: 8.0, y: 12.0 },
            );
            sim.sync_render_buffer();
            assert_eq!(
                projection_of(sim.render_buffer(), agent),
                expected,
                "watch {description} must retain only its exact sibling behavior"
            );
            assert_ne!(
                projection_of(sim.render_buffer(), agent).0,
                visual_action::WATCH,
                "watch {description} must not acquire action 7"
            );
        }
    }

    #[test]
    fn authored_exercise_and_watch_activity_outrank_an_independent_sleep_tag() {
        use crate::render_buffer::{activity, facing, visual_action};

        let shipped = terri_data::pack();
        let sleep_tag = shipped.sleep_tag.clone();
        let bike = shipped.find("moving_box").expect("shipped exercise bike");
        let aquarium = shipped.find("reference_shelf").expect("shipped aquarium");
        let mut bike_definition = shipped.object(bike).clone();
        bike_definition
            .interactions
            .iter_mut()
            .find(|interaction| interaction.id == "use_exercise_bike")
            .expect("exercise interaction")
            .tags
            .push(sleep_tag.clone());
        let mut aquarium_definition = shipped.object(aquarium).clone();
        aquarium_definition
            .interactions
            .iter_mut()
            .find(|interaction| interaction.id == "watch_fish")
            .expect("watch interaction")
            .tags
            .push(sleep_tag);

        // Tags and visual metadata are independent legal content fields. The
        // sleep classifier therefore sees both interactions as sleep-tagged,
        // while their exact visual contracts still own pose and activity.
        let pack = crate::test_content::pack(vec![bike_definition, aquarium_definition]);
        let mut sim = crate::test_content::sim_with(40, 24, pack);
        let (exerciser, _, _, _) = spawn_shipped_exerciser(
            &mut sim,
            Position { x: 12.0, y: 12.0 },
            Position { x: 8.0, y: 12.0 },
        );
        let (watcher, _, _, _) = spawn_shipped_fish_watcher(
            &mut sim,
            Position { x: 28.0, y: 12.0 },
            Position { x: 24.0, y: 12.0 },
        );
        for entity in [exerciser, watcher] {
            assert!(crate::systems::circadian::is_asleep(
                sim.world().resource::<crate::Content>().0,
                sim.world().get::<Eating>(entity),
            ));
        }

        sim.sync_render_buffer();

        assert_eq!(
            projection_of(sim.render_buffer(), exerciser),
            (
                visual_action::EXERCISE,
                facing::POSITIVE_X,
                activity::EXERCISING,
            ),
            "the exercise body and activity must remain one authored signal"
        );
        assert_eq!(
            projection_of(sim.render_buffer(), watcher),
            (
                visual_action::WATCH,
                facing::POSITIVE_X,
                activity::WATCHING_FISH,
            ),
            "the watch body and activity must remain one authored signal"
        );
    }

    #[test]
    fn at_work_suppresses_malformed_exercise_and_watch_overlaps() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::AtWork;

        let mut sim = Sim::new_with_lot(40, 24);
        let exerciser_position = Position { x: 8.0, y: 12.0 };
        let watcher_position = Position { x: 24.0, y: 12.0 };
        let (exerciser, _, _, _) =
            spawn_shipped_exerciser(&mut sim, Position { x: 12.0, y: 12.0 }, exerciser_position);
        let (watcher, _, _, _) =
            spawn_shipped_fish_watcher(&mut sim, Position { x: 28.0, y: 12.0 }, watcher_position);
        for entity in [exerciser, watcher] {
            sim.world_mut().entity_mut(entity).insert(AtWork {
                remaining_ticks: 10,
            });
        }

        sim.sync_render_buffer();

        for entity in [exerciser, watcher] {
            assert_eq!(
                projection_of(sim.render_buffer(), entity),
                (visual_action::NONE, facing::NONE, activity::AT_WORK),
                "an off-lot sim must not retain an ordinary object pose"
            );
        }
        assert_eq!(
            displayed_position_of(sim.render_buffer(), exerciser),
            (
                (exerciser_position.x, exerciser_position.y),
                (exerciser_position.x, exerciser_position.y),
            ),
            "suppressed exercise must not move an off-lot body onto the bike socket"
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), watcher),
            (
                (watcher_position.x, watcher_position.y),
                (watcher_position.x, watcher_position.y),
            )
        );
    }

    #[test]
    fn exact_shipped_bookshelf_reading_projects_standing_action_in_all_directions_without_moving() {
        use crate::render_buffer::{activity, facing, visual_action};

        let mut sim = Sim::new_with_lot(32, 32);
        let shelf_position = Position { x: 12.0, y: 12.0 };
        let cases = [
            (Position { x: 9.0, y: 12.0 }, facing::POSITIVE_X),
            (Position { x: 15.0, y: 12.0 }, facing::NEGATIVE_X),
            (Position { x: 12.0, y: 9.0 }, facing::POSITIVE_Y),
            (Position { x: 12.0, y: 15.0 }, facing::NEGATIVE_Y),
            // Equal non-zero deltas take the x axis deterministically.
            (Position { x: 10.0, y: 10.0 }, facing::POSITIVE_X),
        ];
        let mut agents = Vec::new();
        for (position, expected_facing) in cases {
            let (agent, _, _, _) =
                spawn_shipped_standing_reader(&mut sim, shelf_position, position);
            agents.push((agent, position, expected_facing));
        }
        let before_hash = sim.world_hash();
        let before_save = sim.save_snapshot();

        sim.sync_render_buffer();

        for (agent, position, expected_facing) in agents {
            assert_eq!(
                projection_of(sim.render_buffer(), agent),
                (
                    visual_action::STANDING_READ,
                    expected_facing,
                    activity::READING,
                )
            );
            assert_eq!(
                displayed_position_of(sim.render_buffer(), agent),
                ((position.x, position.y), (position.x, position.y)),
                "standing reading must keep both display samples on the ordinary path tile"
            );
            assert_eq!(
                sim.world().get::<Position>(agent).copied(),
                Some(position),
                "standing presentation must not move the ECS position"
            );
        }
        assert_eq!(sim.world_hash(), before_hash);
        assert_eq!(sim.save_snapshot(), before_save);
    }

    #[test]
    fn standing_read_facing_uses_the_exact_rectangular_footprint_centre_and_stable_ties() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::Footprint;

        let shipped = terri_data::pack();
        let shipped_bookshelf = shipped.find("bookshelf").expect("shipped bookshelf");
        let mut definition = shipped.object(shipped_bookshelf).clone();
        definition.footprint = Footprint { width: 3, depth: 2 };
        let pack = crate::test_content::pack(vec![definition]);
        let bookshelf = pack.find("bookshelf").expect("fixture bookshelf");
        let interaction = pack
            .object(bookshelf)
            .interactions
            .iter()
            .position(|interaction| interaction.id == "read")
            .expect("fixture bookshelf.read") as u32;
        let mut sim = crate::test_content::sim_with(24, 24, pack);
        let target = sim.spawn_object(Position { x: 8.0, y: 8.0 }, bookshelf);

        // The correct centre is (9.0, 8.5). The fifth case chooses a different
        // axis when faced toward the placement origin, so it pins use of the
        // full footprint rather than merely exercising four cardinal signs.
        let cases = [
            (Position { x: 6.0, y: 8.5 }, facing::POSITIVE_X),
            (Position { x: 12.0, y: 8.5 }, facing::NEGATIVE_X),
            (Position { x: 9.0, y: 6.0 }, facing::POSITIVE_Y),
            (Position { x: 9.0, y: 11.0 }, facing::NEGATIVE_Y),
            (Position { x: 8.8, y: 8.0 }, facing::POSITIVE_Y),
            // Coincident geometry falls back to stable entity order. The
            // target was spawned first, so the later agent faces negative x.
            (Position { x: 9.0, y: 8.5 }, facing::NEGATIVE_X),
        ];
        let mut agents = Vec::new();
        for (position, expected_facing) in cases {
            let agent = sim
                .world_mut()
                .spawn((
                    Agent,
                    position,
                    Eating {
                        object: bookshelf,
                        interaction,
                        remaining_ticks: 10,
                    },
                    terri_core::Target {
                        object: target,
                        interaction,
                    },
                ))
                .id();
            agents.push((agent, position, expected_facing));
        }

        sim.sync_render_buffer();
        for (agent, position, expected_facing) in agents {
            assert_eq!(
                projection_of(sim.render_buffer(), agent),
                (
                    visual_action::STANDING_READ,
                    expected_facing,
                    activity::READING,
                )
            );
            assert_eq!(
                displayed_position_of(sim.render_buffer(), agent).0,
                (position.x, position.y)
            );
        }
    }

    #[test]
    fn standing_read_requires_every_compiled_visual_field_and_no_socket() {
        use crate::render_buffer::{activity, facing, visual_action};

        for (description, mutate, expected) in [
            (
                "action",
                (|visual: &mut terri_data::CompiledVisual| {
                    visual.action = terri_data::CompiledVisualAction::Eat;
                }) as fn(&mut terri_data::CompiledVisual),
                (visual_action::EAT, facing::POSITIVE_X, activity::EATING),
            ),
            (
                "anchor",
                |visual: &mut terri_data::CompiledVisual| {
                    visual.anchor = terri_data::CompiledVisualAnchor::Station;
                },
                (visual_action::NONE, facing::NONE, activity::USING_OBJECT),
            ),
            (
                "facing",
                |visual: &mut terri_data::CompiledVisual| {
                    visual.facing = terri_data::CompiledVisualFacing::Socket;
                },
                (visual_action::NONE, facing::NONE, activity::USING_OBJECT),
            ),
            (
                "surplus socket",
                |visual: &mut terri_data::CompiledVisual| {
                    visual.socket = Some(0);
                },
                (visual_action::NONE, facing::NONE, activity::USING_OBJECT),
            ),
        ] {
            let shipped = terri_data::pack();
            let bookshelf = shipped.find("bookshelf").expect("shipped bookshelf");
            let mut definition = shipped.object(bookshelf).clone();
            mutate(
                definition
                    .interactions
                    .iter_mut()
                    .find(|interaction| interaction.id == "read")
                    .and_then(|interaction| interaction.visual.as_mut())
                    .expect("shipped bookshelf.read visual"),
            );
            let pack = crate::test_content::pack(vec![definition]);
            let mut sim = crate::test_content::sim_with(16, 16, pack);
            let (agent, _, _, _) = spawn_shipped_standing_reader(
                &mut sim,
                Position { x: 8.0, y: 8.0 },
                Position { x: 6.0, y: 8.0 },
            );

            sim.sync_render_buffer();
            assert_eq!(
                projection_of(sim.render_buffer(), agent),
                expected,
                "a compiled standing-read {description} near miss must retain its exact sibling behavior"
            );
            assert_ne!(
                projection_of(sim.render_buffer(), agent).0,
                visual_action::STANDING_READ,
                "a compiled standing-read {description} near miss must not acquire action 4"
            );
        }
    }

    #[test]
    fn standing_read_fails_closed_for_each_required_component_identity_and_owner_near_miss() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::{Socialising, StepWork, Target};

        let shipped = terri_data::pack();
        let shipped_bookshelf = shipped.find("bookshelf").expect("shipped bookshelf");
        let shipped_fridge = shipped.find("fridge").expect("shipped fridge");
        let mut bookshelf_definition = shipped.object(shipped_bookshelf).clone();
        let read = bookshelf_definition
            .interactions
            .iter()
            .position(|interaction| interaction.id == "read")
            .expect("shipped bookshelf.read") as u32;
        let mut alternate = bookshelf_definition.interactions[read as usize].clone();
        alternate.id = "alternate_read".to_string();
        let alternate_read = bookshelf_definition.interactions.len() as u32;
        bookshelf_definition.interactions.push(alternate);
        let mut tag_only = bookshelf_definition.interactions[read as usize].clone();
        tag_only.id = "tag_only".to_string();
        tag_only.visual = None;
        assert!(tag_only.tags.iter().any(|tag| tag == "reading"));
        let tag_only_read = bookshelf_definition.interactions.len() as u32;
        bookshelf_definition.interactions.push(tag_only);
        let pack = crate::test_content::pack(vec![
            bookshelf_definition,
            shipped.object(shipped_fridge).clone(),
        ]);
        let bookshelf = pack.find("bookshelf").expect("fixture bookshelf");
        let fridge = pack.find("fridge").expect("fixture fridge");
        let mut sim = crate::test_content::sim_with(32, 32, pack);
        let valid_target = sim.spawn_object(Position { x: 16.0, y: 16.0 }, bookshelf);
        let fridge_target = sim.spawn_object(Position { x: 18.0, y: 16.0 }, fridge);
        let missing_smart_object = sim.world_mut().spawn(Position { x: 16.0, y: 16.0 }).id();
        let missing_position = sim.world_mut().spawn(SmartObject(bookshelf)).id();
        let social_partner = sim
            .world_mut()
            .spawn((Agent, Position { x: 5.0, y: 6.0 }))
            .id();
        let spawn_agent = |sim: &mut Sim| {
            sim.world_mut()
                .spawn((Agent, Position { x: 5.0, y: 5.0 }))
                .id()
        };
        let eating = |object, interaction| Eating {
            object,
            interaction,
            remaining_ticks: 10,
        };
        let target = |object, interaction| Target {
            object,
            interaction,
        };

        let missing_eating = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(missing_eating)
            .insert(target(valid_target, read));
        let missing_target = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(missing_target)
            .insert(eating(bookshelf, read));
        let missing_agent = sim
            .world_mut()
            .spawn((
                Position { x: 5.0, y: 5.0 },
                eating(bookshelf, read),
                target(valid_target, read),
            ))
            .id();
        let target_without_smart_object = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(target_without_smart_object)
            .insert((eating(bookshelf, read), target(missing_smart_object, read)));
        let target_without_position = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(target_without_position)
            .insert((eating(bookshelf, read), target(missing_position, read)));
        let mismatched_definition = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(mismatched_definition)
            .insert((eating(fridge, read), target(valid_target, read)));
        let mismatched_interaction = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(mismatched_interaction).insert((
            eating(bookshelf, read),
            target(valid_target, alternate_read),
        ));
        let out_of_range_interaction = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(out_of_range_interaction)
            .insert((eating(bookshelf, 99), target(valid_target, 99)));
        let reading_tag_without_visual = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(reading_tag_without_visual)
            .insert((
                eating(bookshelf, tag_only_read),
                target(valid_target, tag_only_read),
            ));
        let wrong_target_definition = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(wrong_target_definition)
            .insert((eating(bookshelf, read), target(fridge_target, read)));
        let chain_sentinel = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(chain_sentinel).insert((
            eating(bookshelf, crate::systems::chain::CHAIN_STEP),
            target(valid_target, crate::systems::chain::CHAIN_STEP),
        ));
        let active_step_work = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(active_step_work).insert((
            eating(bookshelf, read),
            target(valid_target, read),
            StepWork {
                remaining_ticks: 10,
            },
        ));
        let active_social = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(active_social).insert((
            eating(bookshelf, read),
            target(valid_target, read),
            Socialising {
                interaction: 99,
                partner: social_partner,
                remaining_ticks: 10,
            },
        ));

        sim.sync_render_buffer();
        for (entity, description) in [
            (missing_eating, "missing Eating"),
            (missing_target, "missing Target"),
            (missing_agent, "missing Agent"),
            (target_without_smart_object, "target missing SmartObject"),
            (target_without_position, "target missing Position"),
            (mismatched_definition, "mismatched object definition"),
            (mismatched_interaction, "mismatched interaction"),
            (out_of_range_interaction, "out-of-range interaction"),
            (reading_tag_without_visual, "reading tag without visual"),
            (wrong_target_definition, "wrong exact target definition"),
            (chain_sentinel, "chain-step target sentinel"),
            (active_step_work, "active StepWork"),
            (active_social, "active Socialising"),
        ] {
            let (action, direction, projected_activity) =
                projection_of(sim.render_buffer(), entity);
            assert_eq!(
                (action, direction),
                (visual_action::NONE, facing::NONE),
                "{description} must not acquire standing-read art"
            );
            assert_ne!(
                projected_activity,
                activity::READING,
                "{description} must not acquire the exact Reading activity"
            );
        }
        assert_eq!(
            projection_of(sim.render_buffer(), missing_target).2,
            activity::USING_OBJECT,
            "ordinary malformed object use keeps its generic fallback"
        );
    }

    #[test]
    fn standing_read_uses_the_exact_target_entity_and_survives_save_load_without_projection_state()
    {
        use crate::render_buffer::{activity, facing, visual_action};

        let mut sim = Sim::new_with_lot(32, 32);
        let bookshelf = terri_data::pack()
            .find("bookshelf")
            .expect("shipped bookshelf");
        let read = shipped_interaction_index(bookshelf, "read");
        let _decoy = sim.spawn_object(Position { x: 4.0, y: 12.0 }, bookshelf);
        let exact = sim.spawn_object(Position { x: 20.0, y: 12.0 }, bookshelf);
        let agent_position = Position { x: 18.0, y: 12.0 };
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                agent_position,
                Eating {
                    object: bookshelf,
                    interaction: read,
                    remaining_ticks: 10,
                },
                terri_core::Target {
                    object: exact,
                    interaction: read,
                },
            ))
            .id();
        let snapshot = sim.save_snapshot();
        let hash = sim.world_hash();

        sim.sync_render_buffer();
        assert_eq!(
            projection_of(sim.render_buffer(), agent),
            (
                visual_action::STANDING_READ,
                facing::POSITIVE_X,
                activity::READING,
            ),
            "the decoy shelf to the west must not replace the exact target to the east"
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent).0,
            (18.0, 12.0)
        );
        assert_eq!(sim.save_snapshot(), snapshot);
        assert_eq!(sim.world_hash(), hash);

        let mut restored = Sim::new_with_lot(1, 1);
        restored
            .load_snapshot(snapshot.clone())
            .expect("the active bookshelf interaction is valid Save V1 state");
        restored.sync_render_buffer();
        assert_eq!(
            projection_of(restored.render_buffer(), agent),
            (
                visual_action::STANDING_READ,
                facing::POSITIVE_X,
                activity::READING,
            )
        );
        assert_eq!(
            displayed_position_of(restored.render_buffer(), agent),
            ((18.0, 12.0), (18.0, 12.0)),
            "Load reconstructs standing reading from saved simulation state at the ordinary tile"
        );
        assert_eq!(restored.save_snapshot(), snapshot);
        assert_eq!(restored.world_hash(), hash);
    }

    #[test]
    fn standing_read_keeps_seated_read_eating_and_generic_object_use_distinct() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::Target;

        let pack = terri_data::pack();
        let mut sim = Sim::new_with_lot(32, 32);
        let standing_position = Position { x: 5.0, y: 6.0 };
        let (standing_reader, _, _, _) =
            spawn_shipped_standing_reader(&mut sim, Position { x: 7.0, y: 6.0 }, standing_position);
        let chair_position = Position { x: 12.0, y: 6.0 };
        let (seated_reader, _, _, _) =
            spawn_shipped_reader(&mut sim, chair_position, Position { x: 10.0, y: 6.0 });

        let fridge = pack.find("fridge").expect("shipped fridge");
        let snack = shipped_interaction_index(fridge, "grab_snack");
        let fridge_target = sim.spawn_object(Position { x: 17.0, y: 6.0 }, fridge);
        let eater = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 15.0, y: 6.0 },
                Eating {
                    object: fridge,
                    interaction: snack,
                    remaining_ticks: 10,
                },
                Target {
                    object: fridge_target,
                    interaction: snack,
                },
            ))
            .id();

        let sink = pack.find("sink").expect("shipped sink");
        let wash = shipped_interaction_index(sink, "wash_hands");
        let sink_target = sim.spawn_object(Position { x: 22.0, y: 6.0 }, sink);
        let generic_user = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 20.0, y: 6.0 },
                Eating {
                    object: sink,
                    interaction: wash,
                    remaining_ticks: 10,
                },
                Target {
                    object: sink_target,
                    interaction: wash,
                },
            ))
            .id();

        sim.sync_render_buffer();
        assert_eq!(
            projection_of(sim.render_buffer(), standing_reader),
            (
                visual_action::STANDING_READ,
                facing::POSITIVE_X,
                activity::READING,
            )
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), standing_reader).0,
            (standing_position.x, standing_position.y)
        );
        assert_eq!(
            projection_of(sim.render_buffer(), seated_reader),
            (visual_action::READ, facing::POSITIVE_X, activity::READING)
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), seated_reader).0,
            (chair_position.x, chair_position.y)
        );
        assert_eq!(
            projection_of(sim.render_buffer(), eater),
            (visual_action::EAT, facing::POSITIVE_X, activity::EATING)
        );
        assert_eq!(
            projection_of(sim.render_buffer(), generic_user),
            (visual_action::NONE, facing::NONE, activity::USING_OBJECT)
        );
    }

    #[test]
    fn exact_shipped_reading_projects_action_activity_facing_and_both_socket_axes_only() {
        use crate::render_buffer::{activity, facing, visual_action};

        let mut sim = Sim::new_with_lot(20, 20);
        let agent_position = Position { x: 3.25, y: 4.5 };
        let chair_position = Position { x: 11.5, y: 13.25 };
        let (agent, _, _, _) = spawn_shipped_reader(&mut sim, chair_position, agent_position);
        let before_hash = sim.world_hash();
        let before_save = sim.save_snapshot();

        sim.sync_render_buffer();

        assert_eq!(
            projection_of(sim.render_buffer(), agent),
            (visual_action::READ, facing::POSITIVE_X, activity::READING)
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            (
                (chair_position.x, chair_position.y),
                (chair_position.x, chair_position.y),
            ),
            "a first projected sample seeds both interpolation endpoints at the exact socket"
        );
        assert_eq!(
            sim.world().get::<Position>(agent).copied(),
            Some(agent_position),
            "seated presentation must not move the pathing component"
        );
        assert_eq!(sim.world_hash(), before_hash);
        assert_eq!(sim.save_snapshot(), before_save);
    }

    #[test]
    fn every_compiled_socket_facing_maps_to_its_append_only_render_code() {
        use crate::render_buffer::facing;

        for (compiled, expected) in [
            (
                terri_data::CompiledSocketFacing::PositiveX,
                facing::POSITIVE_X,
            ),
            (
                terri_data::CompiledSocketFacing::NegativeX,
                facing::NEGATIVE_X,
            ),
            (
                terri_data::CompiledSocketFacing::PositiveY,
                facing::POSITIVE_Y,
            ),
            (
                terri_data::CompiledSocketFacing::NegativeY,
                facing::NEGATIVE_Y,
            ),
        ] {
            let mut sim = Sim::new_with_lot(16, 16);
            let (agent, target, _, _) = spawn_shipped_reader(
                &mut sim,
                Position { x: 8.0, y: 8.0 },
                Position { x: 2.0, y: 2.0 },
            );
            sim.world_mut()
                .get_mut::<crate::ResolvedActionSockets>(target)
                .expect("dynamic reading chair owns its default socket")
                .0[0]
                .facing = compiled;

            sim.sync_render_buffer();
            assert_eq!(projection_of(sim.render_buffer(), agent).1, expected);
        }
    }

    #[test]
    fn reading_projection_fails_closed_for_each_required_component_and_identity_near_miss() {
        use crate::render_buffer::{facing, visual_action};
        use crate::ResolvedActionSockets;
        use terri_core::{StepWork, Target};

        let shipped = terri_data::pack();
        let shipped_chair = shipped.find("reading_chair").expect("shipped chair");
        let mut chair_definition = shipped.object(shipped_chair).clone();
        let settle = chair_definition
            .interactions
            .iter()
            .position(|interaction| interaction.id == "settle_in")
            .expect("shipped settle_in") as u32;
        let mut alternate_read_interaction = chair_definition.interactions[settle as usize].clone();
        alternate_read_interaction.id = "alternate_read".to_string();
        let alternate_read = chair_definition.interactions.len() as u32;
        chair_definition
            .interactions
            .push(alternate_read_interaction);
        let mut tag_only_interaction = chair_definition.interactions[settle as usize].clone();
        tag_only_interaction.id = "tag_only".to_string();
        tag_only_interaction.visual = None;
        assert!(tag_only_interaction.tags.iter().any(|tag| tag == "reading"));
        let tag_only = chair_definition.interactions.len() as u32;
        chair_definition.interactions.push(tag_only_interaction);
        let fridge_definition = shipped
            .object(shipped.find("fridge").expect("shipped fridge"))
            .clone();
        let pack = crate::test_content::pack(vec![chair_definition, fridge_definition]);
        let chair = pack.find("reading_chair").expect("fixture chair");
        let fridge = pack.find("fridge").expect("fixture fridge");
        let mut sim = crate::test_content::sim_with(24, 24, pack);
        let valid_target = sim.spawn_object(Position { x: 12.0, y: 12.0 }, chair);
        let valid_sockets = sim
            .world()
            .get::<ResolvedActionSockets>(valid_target)
            .expect("valid target has sockets")
            .clone();
        let missing_smart_object = sim
            .world_mut()
            .spawn((Position { x: 12.0, y: 12.0 }, valid_sockets.clone()))
            .id();
        let missing_position = sim
            .world_mut()
            .spawn((SmartObject(chair), valid_sockets.clone()))
            .id();
        let missing_sockets = sim
            .world_mut()
            .spawn((Position { x: 12.0, y: 12.0 }, SmartObject(chair)))
            .id();

        let spawn_agent = |sim: &mut Sim| {
            sim.world_mut()
                .spawn((Agent, Position { x: 4.0, y: 5.0 }))
                .id()
        };
        let missing_eating = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(missing_eating).insert(Target {
            object: valid_target,
            interaction: settle,
        });
        let missing_target = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(missing_target).insert(Eating {
            object: chair,
            interaction: settle,
            remaining_ticks: 10,
        });
        let missing_agent = sim
            .world_mut()
            .spawn((
                Position { x: 4.0, y: 5.0 },
                Eating {
                    object: chair,
                    interaction: settle,
                    remaining_ticks: 10,
                },
                Target {
                    object: valid_target,
                    interaction: settle,
                },
            ))
            .id();
        let target_without_smart_object = spawn_agent(&mut sim);
        let target_without_position = spawn_agent(&mut sim);
        let target_without_sockets = spawn_agent(&mut sim);
        for (agent, object) in [
            (target_without_smart_object, missing_smart_object),
            (target_without_position, missing_position),
            (target_without_sockets, missing_sockets),
        ] {
            sim.world_mut().entity_mut(agent).insert((
                Eating {
                    object: chair,
                    interaction: settle,
                    remaining_ticks: 10,
                },
                Target {
                    object,
                    interaction: settle,
                },
            ));
        }
        let mismatched_object = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(mismatched_object).insert((
            Eating {
                object: fridge,
                interaction: settle,
                remaining_ticks: 10,
            },
            Target {
                object: valid_target,
                interaction: settle,
            },
        ));
        let mismatched_interaction = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(mismatched_interaction).insert((
            Eating {
                object: chair,
                interaction: settle,
                remaining_ticks: 10,
            },
            Target {
                object: valid_target,
                interaction: alternate_read,
            },
        ));
        let out_of_range_interaction = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(out_of_range_interaction)
            .insert((
                Eating {
                    object: chair,
                    interaction: 99,
                    remaining_ticks: 10,
                },
                Target {
                    object: valid_target,
                    interaction: 99,
                },
            ));
        let tag_without_visual = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(tag_without_visual).insert((
            Eating {
                object: chair,
                interaction: tag_only,
                remaining_ticks: 10,
            },
            Target {
                object: valid_target,
                interaction: tag_only,
            },
        ));
        let ambiguous_step_work = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(ambiguous_step_work).insert((
            Eating {
                object: chair,
                interaction: settle,
                remaining_ticks: 10,
            },
            Target {
                object: valid_target,
                interaction: settle,
            },
            StepWork {
                remaining_ticks: 10,
            },
        ));
        sim.sync_render_buffer();
        for (entity, description) in [
            (missing_eating, "missing Eating"),
            (missing_target, "missing Target"),
            (missing_agent, "missing Agent"),
            (target_without_smart_object, "target missing SmartObject"),
            (target_without_position, "target missing Position"),
            (target_without_sockets, "target missing socket carrier"),
            (mismatched_object, "mismatched object definition"),
            (mismatched_interaction, "mismatched interaction"),
            (out_of_range_interaction, "out-of-range interaction"),
            (tag_without_visual, "reading tag without authored visual"),
            (ambiguous_step_work, "Eating combined with StepWork"),
        ] {
            let (action, direction, _) = projection_of(sim.render_buffer(), entity);
            assert_eq!(
                (action, direction),
                (visual_action::NONE, facing::NONE),
                "{description} must fail closed"
            );
        }
    }

    #[test]
    fn reading_entry_continuation_and_exit_reseed_both_interpolation_axes_and_samples() {
        use terri_core::Target;

        let mut sim = Sim::new_with_lot(20, 20);
        let chair = terri_data::pack()
            .find("reading_chair")
            .expect("shipped chair");
        let settle = shipped_interaction_index(chair, "settle_in");
        let chair_position = Position { x: 12.5, y: 14.25 };
        let agent_position = Position { x: 3.0, y: 5.5 };
        let target = sim.spawn_object(chair_position, chair);
        let agent = sim.world_mut().spawn((Agent, agent_position)).id();

        sim.sync_render_buffer();
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            (
                (agent_position.x, agent_position.y),
                (agent_position.x, agent_position.y),
            )
        );

        sim.world_mut().entity_mut(agent).insert((
            Eating {
                object: chair,
                interaction: settle,
                remaining_ticks: 10,
            },
            Target {
                object: target,
                interaction: settle,
            },
        ));
        sim.sync_render_buffer();
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            (
                (chair_position.x, chair_position.y),
                (chair_position.x, chair_position.y),
            ),
            "entry must not interpolate from the pathing tile through the chair"
        );

        sim.sync_render_buffer();
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            (
                (chair_position.x, chair_position.y),
                (chair_position.x, chair_position.y),
            ),
            "continued reading remains planted at the same socket"
        );

        sim.world_mut()
            .entity_mut(agent)
            .remove::<(Eating, Target)>();
        sim.sync_render_buffer();
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            (
                (agent_position.x, agent_position.y),
                (agent_position.x, agent_position.y),
            ),
            "exit must not interpolate backward through the chair"
        );
    }

    #[test]
    fn paused_reading_entry_and_cancel_still_reseed_both_position_samples() {
        use terri_core::{CommandQueue, Intent, IntentQueue, SimCommand, Target};

        let mut sim = Sim::new_with_lot(20, 20);
        let chair = terri_data::pack()
            .find("reading_chair")
            .expect("shipped chair");
        let settle = shipped_interaction_index(chair, "settle_in");
        let chair_position = Position { x: 13.25, y: 12.75 };
        let agent_position = Position { x: 2.5, y: 4.25 };
        let target = sim.spawn_object(chair_position, chair);
        let agent = sim.world_mut().spawn((Agent, agent_position)).id();
        sim.sync_render_buffer();

        sim.world_mut().entity_mut(agent).insert((
            Eating {
                object: chair,
                interaction: settle,
                remaining_ticks: 10,
            },
            Target {
                object: target,
                interaction: settle,
            },
            IntentQueue::from_intents(vec![Intent {
                object: target,
                interaction: settle,
            }]),
        ));
        sim.sync_render_buffer_after_commands();
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            (
                (chair_position.x, chair_position.y),
                (chair_position.x, chair_position.y),
            ),
            "a paused command may enter projection without advancing an ordinary sample"
        );

        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::CancelIntents {
                agent: agent.index_u32(),
            });
        assert_eq!(
            sim.world().resource::<CommandQueue>().len(),
            1,
            "the cancellation must be staged before the paused drain"
        );
        let tick_before_cancel = sim.world().resource::<terri_core::SimClock>().tick;
        sim.flush_commands();
        sim.sync_render_buffer_after_commands();
        assert!(sim.world().resource::<CommandQueue>().is_empty());
        assert_eq!(
            sim.world().resource::<terri_core::SimClock>().tick,
            tick_before_cancel,
            "the paused cancellation route must not advance simulation time"
        );
        assert!(sim.world().get::<Eating>(agent).is_none());
        assert!(sim.world().get::<Target>(agent).is_none());
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent),
            (
                (agent_position.x, agent_position.y),
                (agent_position.x, agent_position.y),
            ),
            "paused cancellation must snap both samples back to the ECS position"
        );
    }

    #[test]
    fn reading_requires_each_compiled_visual_field_and_an_in_range_socket_index() {
        use crate::render_buffer::{facing, visual_action};

        for (description, mutate) in [
            (
                "action",
                (|visual: &mut terri_data::CompiledVisual| {
                    visual.action = terri_data::CompiledVisualAction::Eat;
                }) as fn(&mut terri_data::CompiledVisual),
            ),
            ("anchor", |visual: &mut terri_data::CompiledVisual| {
                visual.anchor = terri_data::CompiledVisualAnchor::Object;
            }),
            ("facing", |visual: &mut terri_data::CompiledVisual| {
                visual.facing = terri_data::CompiledVisualFacing::TowardAnchor;
            }),
            (
                "missing socket",
                |visual: &mut terri_data::CompiledVisual| {
                    visual.socket = None;
                },
            ),
            (
                "out-of-range socket",
                |visual: &mut terri_data::CompiledVisual| {
                    visual.socket = Some(99);
                },
            ),
        ] {
            let shipped = terri_data::pack();
            let chair = shipped.find("reading_chair").expect("shipped chair");
            let mut definition = shipped.object(chair).clone();
            let settle = definition
                .interactions
                .iter_mut()
                .find(|interaction| interaction.id == "settle_in")
                .expect("shipped settle_in");
            mutate(settle.visual.as_mut().expect("shipped read visual"));
            let pack = crate::test_content::pack(vec![definition]);
            let mut sim = crate::test_content::sim_with(16, 16, pack);
            let (agent, _, _, _) = spawn_shipped_reader(
                &mut sim,
                Position { x: 9.0, y: 10.0 },
                Position { x: 2.0, y: 3.0 },
            );

            sim.sync_render_buffer();
            let (action, direction, _) = projection_of(sim.render_buffer(), agent);
            assert_eq!(
                (action, direction),
                (visual_action::NONE, facing::NONE),
                "a malformed compiled {description} must fail closed"
            );
        }
    }

    #[test]
    fn reading_uses_the_exact_target_entity_when_two_identical_chairs_exist() {
        let mut sim = Sim::new_with_lot(24, 24);
        let chair = terri_data::pack()
            .find("reading_chair")
            .expect("shipped chair");
        let settle = shipped_interaction_index(chair, "settle_in");
        let _decoy = sim.spawn_object(Position { x: 3.0, y: 4.0 }, chair);
        let exact = sim.spawn_object(Position { x: 17.25, y: 18.5 }, chair);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 8.0, y: 8.0 },
                Eating {
                    object: chair,
                    interaction: settle,
                    remaining_ticks: 10,
                },
                terri_core::Target {
                    object: exact,
                    interaction: settle,
                },
            ))
            .id();

        sim.sync_render_buffer();
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent).0,
            (17.25, 18.5),
            "definition equality must not substitute a different chair's socket"
        );
    }

    #[test]
    fn conversation_visual_and_position_retain_precedence_over_valid_reading() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::{Reserved, Socialising};

        let shipped = terri_data::pack();
        let chair = shipped.find("reading_chair").expect("shipped chair");
        let pack = crate::test_content::pack_with_social(
            vec![shipped.object(chair).clone()],
            vec![authored_talk_interaction("chat")],
            crate::test_content::tuning(),
        );
        let mut sim = crate::test_content::sim_with(20, 20, pack);
        let agent_position = Position { x: 3.0, y: 4.0 };
        let (agent, _, _, _) =
            spawn_shipped_reader(&mut sim, Position { x: 14.0, y: 15.0 }, agent_position);
        let partner = sim
            .world_mut()
            .spawn((Agent, Position { x: 5.0, y: 4.0 }, Reserved))
            .id();
        sim.world_mut().entity_mut(agent).insert(Socialising {
            interaction: 0,
            partner,
            remaining_ticks: 10,
        });

        sim.sync_render_buffer();
        assert_eq!(
            projection_of(sim.render_buffer(), agent),
            (visual_action::TALK, facing::POSITIVE_X, activity::TALKING)
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent).0,
            (agent_position.x, agent_position.y),
            "talk precedence must keep the body at its ordinary conversation position"
        );
    }

    #[test]
    fn conversation_visual_retains_precedence_over_valid_standing_reading() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::{Reserved, Socialising};

        let shipped = terri_data::pack();
        let bookshelf = shipped.find("bookshelf").expect("shipped bookshelf");
        let pack = crate::test_content::pack_with_social(
            vec![shipped.object(bookshelf).clone()],
            vec![authored_talk_interaction("chat")],
            crate::test_content::tuning(),
        );
        let mut sim = crate::test_content::sim_with(20, 20, pack);
        let agent_position = Position { x: 3.0, y: 4.0 };
        let (agent, _, _, _) =
            spawn_shipped_standing_reader(&mut sim, Position { x: 14.0, y: 15.0 }, agent_position);
        let partner = sim
            .world_mut()
            .spawn((Agent, Position { x: 5.0, y: 4.0 }, Reserved))
            .id();
        sim.world_mut().entity_mut(agent).insert(Socialising {
            interaction: 0,
            partner,
            remaining_ticks: 10,
        });

        sim.sync_render_buffer();
        assert_eq!(
            projection_of(sim.render_buffer(), agent),
            (visual_action::TALK, facing::POSITIVE_X, activity::TALKING)
        );
        assert_eq!(
            displayed_position_of(sim.render_buffer(), agent).0,
            (agent_position.x, agent_position.y),
            "talk precedence must keep a would-be standing reader on the ordinary tile"
        );
    }

    #[test]
    fn shipped_snack_projects_eat_toward_the_exact_object_in_all_four_directions() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::Target;

        let pack = terri_data::pack();
        let fridge = pack.find("fridge").expect("shipped fridge");
        let snack = shipped_interaction_index(fridge, "grab_snack");
        let mut sim = Sim::new_with_lot(16, 16);
        let target = sim
            .world_mut()
            .spawn((Position { x: 8.0, y: 8.0 }, SmartObject(fridge)))
            .id();

        let cases = [
            ((6.0, 8.0), facing::POSITIVE_X),
            ((10.0, 8.0), facing::NEGATIVE_X),
            ((8.0, 6.0), facing::POSITIVE_Y),
            ((8.0, 10.0), facing::NEGATIVE_Y),
        ];
        let mut agents = Vec::new();
        for ((x, y), expected_facing) in cases {
            let agent = sim
                .world_mut()
                .spawn((
                    Agent,
                    Position { x, y },
                    Eating {
                        object: fridge,
                        interaction: snack,
                        remaining_ticks: 10,
                    },
                    Target {
                        object: target,
                        interaction: snack,
                    },
                ))
                .id();
            agents.push((agent, expected_facing));
        }

        let before_hash = sim.world_hash();
        let before_save = sim.save_snapshot();
        sim.sync_render_buffer();
        let buffer = sim.render_buffer();
        for (agent, expected_facing) in agents {
            assert_eq!(
                projection_of(buffer, agent),
                (visual_action::EAT, expected_facing, activity::EATING)
            );
        }
        assert_eq!(
            sim.world_hash(),
            before_hash,
            "presentation sync must not enter the deterministic world digest"
        );
        assert_eq!(
            sim.save_snapshot(),
            before_save,
            "presentation sync must not add or rewrite Save V1 state"
        );
    }

    #[test]
    fn shipped_ordinary_object_uses_report_generic_activity_without_eating_art() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::Target;

        let pack = terri_data::pack();
        let cases = [
            ("shower", "take_shower"),
            ("toilet", "relieve_self"),
            ("television", "watch_tv"),
            ("sink", "wash_hands"),
            ("kitchen_sink", "wash_up"),
            ("reading_chair", "settle_in"),
        ];
        let mut sim = Sim::new_with_lot(24, 24);
        let mut agents = Vec::new();

        for (offset, (object_id, interaction_id)) in cases.into_iter().enumerate() {
            let definition = pack
                .find(object_id)
                .unwrap_or_else(|| panic!("the shipped pack declares '{object_id}'"));
            let interaction = shipped_interaction_index(definition, interaction_id);
            let x = 2.0 + offset as f32 * 3.0;
            let target = sim
                .world_mut()
                .spawn((Position { x: x + 1.0, y: 8.0 }, SmartObject(definition)))
                .id();
            let agent = sim
                .world_mut()
                .spawn((
                    Agent,
                    Position { x, y: 8.0 },
                    Eating {
                        object: definition,
                        interaction,
                        remaining_ticks: 10,
                    },
                    Target {
                        object: target,
                        interaction,
                    },
                ))
                .id();
            agents.push((agent, object_id, interaction_id));
        }

        sim.sync_render_buffer();
        for (agent, object_id, interaction_id) in agents {
            assert_eq!(
                projection_of(sim.render_buffer(), agent),
                (visual_action::NONE, facing::NONE, activity::USING_OBJECT,),
                "{object_id}/{interaction_id} is ordinary object use, not authored eating"
            );
        }
    }

    #[test]
    fn rectangular_object_eat_facing_pins_every_footprint_centre_operator() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::{Footprint, Target};

        let shipped = terri_data::pack();
        let shipped_fridge = shipped.find("fridge").expect("shipped fridge");
        let mut fridge_definition = shipped.object(shipped_fridge).clone();
        fridge_definition.footprint = Footprint { width: 3, depth: 2 };
        let pack = crate::test_content::pack(vec![fridge_definition]);
        let fridge = pack.find("fridge").expect("fixture fridge");
        let snack = pack
            .object(fridge)
            .interactions
            .iter()
            .position(|interaction| interaction.id == "grab_snack")
            .expect("fixture snack interaction") as u32;

        let mut sim = crate::test_content::sim_with(20, 20, pack);
        let target = sim
            .world_mut()
            .spawn((Position { x: 8.0, y: 8.0 }, SmartObject(fridge)))
            .id();

        // The correct centre is (9.0, 8.5). Each position sits between that
        // point and one family of arithmetic mutants, so checking only a
        // convenient cardinal approach cannot let a wrong formula survive.
        let cases = [
            ((9.2, 8.4), facing::NEGATIVE_X),
            ((8.9, 8.0), facing::POSITIVE_Y),
            ((8.9, 9.0), facing::NEGATIVE_Y),
        ];
        let mut agents = Vec::new();
        for ((x, y), expected_facing) in cases {
            let agent = sim
                .world_mut()
                .spawn((
                    Agent,
                    Position { x, y },
                    Eating {
                        object: fridge,
                        interaction: snack,
                        remaining_ticks: 10,
                    },
                    Target {
                        object: target,
                        interaction: snack,
                    },
                ))
                .id();
            agents.push((agent, expected_facing));
        }

        sim.sync_render_buffer();
        for (agent, expected_facing) in agents {
            assert_eq!(
                projection_of(sim.render_buffer(), agent),
                (visual_action::EAT, expected_facing, activity::EATING)
            );
        }
    }

    #[test]
    fn terminal_dinner_projects_eat_and_fork_activity_from_the_exact_station() {
        use crate::render_buffer::{activity, facing, visual_action};
        use crate::systems::chain::CHAIN_STEP;
        use terri_core::{ChainState, StepWork, Target};

        let pack = terri_data::pack();
        let chain_index = pack
            .chains
            .iter()
            .position(|chain| chain.id == "cook_dinner")
            .expect("shipped dinner chain") as u32;
        let terminal_step = pack.chains[chain_index as usize].steps.len() as u32 - 1;
        let role = pack.chains[chain_index as usize].steps[terminal_step as usize].role;
        let station = pack
            .objects
            .iter()
            .position(|object| object.id == "dining_table")
            .map(|index| terri_data::ObjectDefId(index as u32))
            .expect("shipped dining table");
        assert_eq!(pack.object(station).footprint.width, 2);
        assert!(pack.object(station).roles.contains(&role));

        let mut sim = Sim::new_with_lot(24, 24);
        let decoy_definition = pack
            .objects
            .iter()
            .position(|object| object.id == "desk")
            .map(|index| terri_data::ObjectDefId(index as u32))
            .expect("shipped desk");
        assert!(pack.object(decoy_definition).roles.contains(&role));
        let _decoy = sim
            .world_mut()
            .spawn((Position { x: 1.0, y: 8.0 }, SmartObject(decoy_definition)))
            .id();
        let exact_station = sim
            .world_mut()
            .spawn((Position { x: 8.0, y: 8.0 }, SmartObject(station)))
            .id();

        let cases = [
            ((6.0, 8.0), facing::POSITIVE_X),
            ((11.0, 8.0), facing::NEGATIVE_X),
            ((8.5, 6.0), facing::POSITIVE_Y),
            ((8.5, 10.0), facing::NEGATIVE_Y),
            // From this point the placement origin is y-dominant, while the
            // 2 by 1 footprint centre is x-dominant. This row therefore pins
            // the centre calculation rather than merely a direction.
            ((7.8, 7.6), facing::POSITIVE_X),
        ];
        let mut agents = Vec::new();
        for ((x, y), expected_facing) in cases {
            let agent = sim
                .world_mut()
                .spawn((
                    Agent,
                    Position { x, y },
                    ChainState {
                        chain: chain_index,
                        step: terminal_step,
                        fumble_scale: 1.0,
                    },
                    StepWork {
                        remaining_ticks: 10,
                    },
                    Target {
                        object: exact_station,
                        interaction: CHAIN_STEP,
                    },
                ))
                .id();
            agents.push((agent, expected_facing));
        }

        let before_hash = sim.world_hash();
        let before_save = sim.save_snapshot();
        sim.sync_render_buffer();
        let buffer = sim.render_buffer();
        for (agent, expected_facing) in agents {
            assert_eq!(
                projection_of(buffer, agent),
                (visual_action::EAT, expected_facing, activity::EATING),
                "terminal dinner needs both the authored body pose and the fork bubble"
            );
        }
        assert_eq!(sim.world_hash(), before_hash);
        assert_eq!(sim.save_snapshot(), before_save);
    }

    #[test]
    fn object_eat_projection_fails_closed_for_each_component_and_identity_near_miss() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::{ChainState, StepWork, Target};

        let shipped = terri_data::pack();
        let shipped_fridge = shipped.find("fridge").expect("shipped fridge");
        let shipped_snack = shipped_interaction_index(shipped_fridge, "grab_snack");
        let mut fridge_definition = shipped.object(shipped_fridge).clone();
        let mut second_authored_snack =
            fridge_definition.interactions[shipped_snack as usize].clone();
        second_authored_snack.id = "second_authored_snack".to_string();
        second_authored_snack.label = "Second authored snack".to_string();
        fridge_definition.interactions.push(second_authored_snack);
        let shipped_bed = shipped.find("bed").expect("shipped bed");
        let mut unauthored_bed = shipped.object(shipped_bed).clone();
        unauthored_bed.interactions[0].visual = None;
        let pack = crate::test_content::pack(vec![fridge_definition, unauthored_bed]);
        let fridge = pack.find("fridge").expect("fixture fridge");
        let snack = shipped_snack;
        let second_snack = snack + 1;
        let bed = pack.find("bed").expect("fixture bed");
        let bed_interaction = 0;
        assert!(pack.object(bed).interactions[bed_interaction]
            .visual
            .is_none());

        let mut sim = crate::test_content::sim_with(16, 16, pack);
        let valid_target = sim
            .world_mut()
            .spawn((Position { x: 8.0, y: 8.0 }, SmartObject(fridge)))
            .id();
        let missing_object = sim.world_mut().spawn(Position { x: 8.0, y: 8.0 }).id();
        let missing_position = sim.world_mut().spawn(SmartObject(fridge)).id();
        let unauthored_target = sim
            .world_mut()
            .spawn((Position { x: 8.0, y: 8.0 }, SmartObject(bed)))
            .id();

        let spawn_agent = |sim: &mut Sim| {
            sim.world_mut()
                .spawn((Agent, Position { x: 6.0, y: 8.0 }))
                .id()
        };
        let missing_eating = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(missing_eating).insert(Target {
            object: valid_target,
            interaction: snack,
        });

        let missing_agent = sim
            .world_mut()
            .spawn((
                Position { x: 6.0, y: 8.0 },
                Eating {
                    object: fridge,
                    interaction: snack,
                    remaining_ticks: 10,
                },
                Target {
                    object: valid_target,
                    interaction: snack,
                },
            ))
            .id();

        let missing_target = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(missing_target).insert(Eating {
            object: fridge,
            interaction: snack,
            remaining_ticks: 10,
        });

        let mismatched_interaction = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(mismatched_interaction).insert((
            Eating {
                object: fridge,
                interaction: snack,
                remaining_ticks: 10,
            },
            Target {
                object: valid_target,
                interaction: second_snack,
            },
        ));

        let out_of_range_interaction = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(out_of_range_interaction)
            .insert((
                Eating {
                    object: fridge,
                    interaction: 99,
                    remaining_ticks: 10,
                },
                Target {
                    object: valid_target,
                    interaction: 99,
                },
            ));

        let mismatched_definition = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(mismatched_definition).insert((
            Eating {
                object: bed,
                interaction: snack,
                remaining_ticks: 10,
            },
            Target {
                object: valid_target,
                interaction: snack,
            },
        ));

        let no_smart_object = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(no_smart_object).insert((
            Eating {
                object: fridge,
                interaction: snack,
                remaining_ticks: 10,
            },
            Target {
                object: missing_object,
                interaction: snack,
            },
        ));

        let no_position = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(no_position).insert((
            Eating {
                object: fridge,
                interaction: snack,
                remaining_ticks: 10,
            },
            Target {
                object: missing_position,
                interaction: snack,
            },
        ));

        let unauthored = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(unauthored).insert((
            Eating {
                object: bed,
                interaction: bed_interaction as u32,
                remaining_ticks: 10,
            },
            Target {
                object: unauthored_target,
                interaction: bed_interaction as u32,
            },
        ));

        let ambiguous_action_state = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(ambiguous_action_state).insert((
            Eating {
                object: fridge,
                interaction: snack,
                remaining_ticks: 10,
            },
            Target {
                object: valid_target,
                interaction: snack,
            },
            ChainState {
                chain: 0,
                step: 0,
                fumble_scale: 1.0,
            },
            StepWork {
                remaining_ticks: 10,
            },
        ));

        sim.sync_render_buffer();
        for (entity, description) in [
            (missing_eating, "missing Eating"),
            (missing_agent, "missing Agent"),
            (missing_target, "missing Target"),
            (mismatched_interaction, "mismatched interaction"),
            (out_of_range_interaction, "out-of-range interaction"),
            (mismatched_definition, "mismatched object definition"),
            (no_smart_object, "target missing SmartObject"),
            (no_position, "target missing Position"),
            (unauthored, "unauthored object interaction"),
            (ambiguous_action_state, "both Eating and StepWork"),
        ] {
            let (action, direction, _) = projection_of(sim.render_buffer(), entity);
            assert_eq!(
                (action, direction),
                (visual_action::NONE, facing::NONE),
                "{description} must fail closed"
            );
        }
        let (_, _, broad_activity) = projection_of(sim.render_buffer(), missing_target);
        assert_eq!(
            broad_activity,
            activity::USING_OBJECT,
            "malformed authored eating falls back to generic object use without selecting body art"
        );
    }

    #[test]
    fn chain_eat_projection_fails_closed_for_each_component_and_identity_near_miss() {
        use crate::render_buffer::{activity, facing, visual_action};
        use crate::systems::chain::CHAIN_STEP;
        use terri_core::{ChainState, StepWork, Target};

        let pack = terri_data::pack();
        let chain_index = pack
            .chains
            .iter()
            .position(|chain| chain.id == "cook_dinner")
            .expect("shipped dinner chain") as u32;
        let chain = &pack.chains[chain_index as usize];
        let terminal_step = chain.steps.len() as u32 - 1;
        let terminal_role = chain.steps[terminal_step as usize].role;
        let unauthored_step = chain
            .steps
            .iter()
            .position(|step| step.visual.is_none())
            .expect("shipped dinner has an unauthored preparation step")
            as u32;
        let unauthored_role = chain.steps[unauthored_step as usize].role;
        let station_for = |role: u32| {
            pack.objects
                .iter()
                .position(|object| object.roles.contains(&role))
                .map(|index| terri_data::ObjectDefId(index as u32))
                .expect("shipped chain role has a station")
        };

        let mut sim = Sim::new_with_lot(16, 16);
        let valid_target = sim
            .world_mut()
            .spawn((
                Position { x: 8.0, y: 8.0 },
                SmartObject(station_for(terminal_role)),
            ))
            .id();
        let wrong_role_target = sim
            .world_mut()
            .spawn((
                Position { x: 8.0, y: 8.0 },
                SmartObject(chain.advertised_by),
            ))
            .id();
        assert!(!pack
            .object(chain.advertised_by)
            .roles
            .contains(&terminal_role));
        let missing_object = sim.world_mut().spawn(Position { x: 8.0, y: 8.0 }).id();
        let missing_position = sim
            .world_mut()
            .spawn(SmartObject(station_for(terminal_role)))
            .id();
        let unauthored_target = sim
            .world_mut()
            .spawn((
                Position { x: 8.0, y: 8.0 },
                SmartObject(station_for(unauthored_role)),
            ))
            .id();

        let spawn_agent = |sim: &mut Sim| {
            sim.world_mut()
                .spawn((Agent, Position { x: 6.0, y: 8.0 }))
                .id()
        };
        let state = || ChainState {
            chain: chain_index,
            step: terminal_step,
            fumble_scale: 1.0,
        };
        let work = || StepWork {
            remaining_ticks: 10,
        };
        let target = |object| Target {
            object,
            interaction: CHAIN_STEP,
        };

        let missing_chain_state = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(missing_chain_state)
            .insert((work(), target(valid_target)));

        let missing_agent = sim
            .world_mut()
            .spawn((
                Position { x: 6.0, y: 8.0 },
                state(),
                work(),
                target(valid_target),
            ))
            .id();

        let missing_step_work = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(missing_step_work)
            .insert((state(), target(valid_target)));

        let missing_target = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(missing_target)
            .insert((state(), work()));

        let wrong_sentinel = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(wrong_sentinel).insert((
            state(),
            work(),
            Target {
                object: valid_target,
                interaction: 0,
            },
        ));

        let invalid_chain = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(invalid_chain).insert((
            ChainState {
                chain: 99,
                step: terminal_step,
                fumble_scale: 1.0,
            },
            work(),
            target(valid_target),
        ));

        let invalid_step = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(invalid_step).insert((
            ChainState {
                chain: chain_index,
                step: 99,
                fumble_scale: 1.0,
            },
            work(),
            target(valid_target),
        ));

        let wrong_role = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(wrong_role)
            .insert((state(), work(), target(wrong_role_target)));

        let no_smart_object = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(no_smart_object).insert((
            state(),
            work(),
            target(missing_object),
        ));

        let no_position = spawn_agent(&mut sim);
        sim.world_mut()
            .entity_mut(no_position)
            .insert((state(), work(), target(missing_position)));

        let unauthored = spawn_agent(&mut sim);
        sim.world_mut().entity_mut(unauthored).insert((
            ChainState {
                chain: chain_index,
                step: unauthored_step,
                fumble_scale: 1.0,
            },
            work(),
            target(unauthored_target),
        ));

        sim.sync_render_buffer();
        for (entity, description) in [
            (missing_chain_state, "missing ChainState"),
            (missing_agent, "missing Agent"),
            (missing_step_work, "missing StepWork"),
            (missing_target, "missing Target"),
            (wrong_sentinel, "wrong Target sentinel"),
            (invalid_chain, "out-of-range chain"),
            (invalid_step, "out-of-range step"),
            (wrong_role, "target with wrong station role"),
            (no_smart_object, "target missing SmartObject"),
            (no_position, "target missing Position"),
            (unauthored, "unauthored chain step"),
        ] {
            let (action, direction, activity) = projection_of(sim.render_buffer(), entity);
            assert_eq!(
                (action, direction),
                (visual_action::NONE, facing::NONE),
                "{description} must fail closed"
            );
            assert_ne!(
                activity,
                activity::EATING,
                "{description} must not acquire the terminal dinner fork bubble"
            );
        }
    }

    #[test]
    fn conversation_visual_retains_precedence_over_a_valid_object_eat_projection() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::{Reserved, Socialising, Target};

        let fridge = terri_data::pack().find("fridge").expect("shipped fridge");
        let snack = shipped_interaction_index(fridge, "grab_snack");
        let object = terri_data::pack().object(fridge).clone();
        let pack = crate::test_content::pack_with_social(
            vec![object],
            vec![authored_talk_interaction("chat")],
            crate::test_content::tuning(),
        );
        let fixture_fridge = pack.find("fridge").expect("fixture fridge");
        let mut sim = crate::test_content::sim_with(12, 12, pack);
        let target = sim
            .world_mut()
            .spawn((Position { x: 8.0, y: 8.0 }, SmartObject(fixture_fridge)))
            .id();
        let partner = sim
            .world_mut()
            .spawn((Agent, Position { x: 6.0, y: 4.0 }, Reserved))
            .id();
        let initiator = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 4.0 },
                Eating {
                    object: fixture_fridge,
                    interaction: snack,
                    remaining_ticks: 10,
                },
                Target {
                    object: target,
                    interaction: snack,
                },
                Socialising {
                    interaction: 0,
                    partner,
                    remaining_ticks: 10,
                },
            ))
            .id();

        sim.sync_render_buffer();
        assert_eq!(
            projection_of(sim.render_buffer(), initiator),
            (visual_action::TALK, facing::POSITIVE_X, activity::TALKING),
            "malformed overlap must retain the established conversation precedence"
        );
        assert_eq!(
            projection_of(sim.render_buffer(), partner),
            (visual_action::TALK, facing::NEGATIVE_X, activity::TALKING)
        );
    }

    #[test]
    fn passive_malformed_social_partners_fail_closed_for_every_object_action_pose() {
        use crate::render_buffer::{activity, facing, visual_action};
        use terri_core::{Socialising, Target};

        let mut sim = Sim::new_with_lot(48, 48);
        let (seated, _, _, _) = spawn_shipped_reader(
            &mut sim,
            Position { x: 6.0, y: 6.0 },
            Position { x: 5.0, y: 6.0 },
        );
        let (standing, _, _, _) = spawn_shipped_standing_reader(
            &mut sim,
            Position { x: 14.0, y: 6.0 },
            Position { x: 12.0, y: 6.0 },
        );
        let (exercise, _, _, _) = spawn_shipped_exerciser(
            &mut sim,
            Position { x: 22.0, y: 6.0 },
            Position { x: 20.0, y: 6.0 },
        );
        let (watch, _, _, _) = spawn_shipped_fish_watcher(
            &mut sim,
            Position { x: 30.0, y: 6.0 },
            Position { x: 28.0, y: 6.0 },
        );

        let fridge = terri_data::pack().find("fridge").expect("shipped fridge");
        let snack = shipped_interaction_index(fridge, "grab_snack");
        let fridge_target = sim.spawn_object(Position { x: 38.0, y: 6.0 }, fridge);
        let eating = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 36.0, y: 6.0 },
                Eating {
                    object: fridge,
                    interaction: snack,
                    remaining_ticks: 10,
                },
                Target {
                    object: fridge_target,
                    interaction: snack,
                },
            ))
            .id();

        for (index, partner) in [seated, standing, exercise, watch, eating]
            .into_iter()
            .enumerate()
        {
            sim.world_mut().spawn((
                Agent,
                Position {
                    x: 2.0,
                    y: 2.0 + index as f32,
                },
                Socialising {
                    interaction: u32::MAX,
                    partner,
                    remaining_ticks: 10,
                },
            ));
        }

        sim.sync_render_buffer();
        for (entity, description) in [
            (seated, "seated reading"),
            (standing, "standing reading"),
            (exercise, "exercise"),
            (watch, "watching fish"),
            (eating, "object eating"),
        ] {
            assert_eq!(
                projection_of(sim.render_buffer(), entity),
                (visual_action::NONE, facing::NONE, activity::TALKING),
                "a passive malformed social partner must suppress {description} art"
            );
        }
    }

    /// The authored action is projected from each real `Socialising` pair,
    /// not from proximity, activity code, or `Reserved` alone. The two pairs
    /// sit close enough that nearest-neighbour pairing would cross them, and
    /// their axes differ so the wrong anchor is visible in the facing codes.
    #[test]
    fn authored_talk_projects_both_real_pairs_without_animating_waiters_or_object_use() {
        use crate::render_buffer::{facing, visual_action};
        use crate::test_content;
        use terri_core::{Relationships, Reserved, Socialising, Target};

        let ordinary_social =
            test_content::interaction("quiet_chat", &[(NeedId::Social, 20.0)], 20);
        let object_interaction =
            test_content::interaction("use_object", &[(NeedId::Hunger, 20.0)], 20);
        let pack = test_content::pack_with_social(
            vec![test_content::object_offering(
                "fixture_object",
                vec![object_interaction],
            )],
            vec![authored_talk_interaction("chat"), ordinary_social],
            test_content::tuning(),
        );
        let object_def = pack.find("fixture_object").expect("fixture object");
        let mut sim = test_content::sim_with(10, 10, pack);

        let spawn_agent = |sim: &mut Sim, x: f32, y: f32| {
            sim.world_mut()
                .spawn((
                    Agent,
                    Position { x, y },
                    Needs::with(NeedId::Social, 50.0),
                    Relationships::default(),
                ))
                .id()
        };

        // Pair one faces along x. Pair two is interleaved spatially and
        // faces along y, so choosing the nearest free agent would cross the
        // conversations and produce different codes.
        let x_initiator = spawn_agent(&mut sim, 1.0, 1.0);
        let x_partner = spawn_agent(&mut sim, 3.0, 1.0);
        let y_initiator = spawn_agent(&mut sim, 2.0, 0.5);
        let y_partner = spawn_agent(&mut sim, 2.0, 2.5);
        let negative_y_initiator = spawn_agent(&mut sim, 3.0, 3.5);
        let negative_y_partner = spawn_agent(&mut sim, 3.0, 1.5);
        let waiter = spawn_agent(&mut sim, 4.0, 4.0);
        let plain_initiator = spawn_agent(&mut sim, 6.0, 1.0);
        let plain_partner = spawn_agent(&mut sim, 7.0, 1.0);
        let object_user = spawn_agent(&mut sim, 8.0, 8.0);
        let object = sim
            .world_mut()
            .spawn((Position { x: 8.0, y: 7.0 }, SmartObject(object_def)))
            .id();

        let start_talk = |sim: &mut Sim, initiator: Entity, partner: Entity, interaction| {
            sim.world_mut().entity_mut(initiator).insert((
                Socialising {
                    interaction,
                    partner,
                    remaining_ticks: 10,
                },
                Target {
                    object: partner,
                    interaction,
                },
            ));
            sim.world_mut().entity_mut(partner).insert(Reserved);
        };
        start_talk(&mut sim, x_initiator, x_partner, 0);
        start_talk(&mut sim, y_initiator, y_partner, 0);
        start_talk(&mut sim, negative_y_initiator, negative_y_partner, 0);
        start_talk(&mut sim, plain_initiator, plain_partner, 1);
        sim.world_mut().entity_mut(waiter).insert(Reserved);
        sim.world_mut().entity_mut(object_user).insert(Eating {
            object: object_def,
            interaction: 0,
            remaining_ticks: 10,
        });

        sim.sync_render_buffer();
        let buf = sim.render_buffer();
        let projection_of = |entity: Entity| {
            let row = buf
                .ids
                .iter()
                .position(|&id| id == entity.index_u32())
                .expect("every fixture entity has a render row");
            (buf.visual_actions[row], buf.facings[row])
        };

        assert_eq!(
            projection_of(x_initiator),
            (visual_action::TALK, facing::POSITIVE_X)
        );
        assert_eq!(
            projection_of(x_partner),
            (visual_action::TALK, facing::NEGATIVE_X)
        );
        assert_eq!(
            projection_of(y_initiator),
            (visual_action::TALK, facing::POSITIVE_Y)
        );
        assert_eq!(
            projection_of(y_partner),
            (visual_action::TALK, facing::NEGATIVE_Y)
        );
        assert_eq!(
            projection_of(negative_y_initiator),
            (visual_action::TALK, facing::NEGATIVE_Y)
        );
        assert_eq!(
            projection_of(negative_y_partner),
            (visual_action::TALK, facing::POSITIVE_Y),
            "negative y must have a real opposite, not the fallback facing"
        );

        for (entity, description) in [
            (waiter, "an unrelated Reserved waiter"),
            (plain_initiator, "an unauthored social initiator"),
            (plain_partner, "an unauthored social receiver"),
            (object_user, "an agent using an object"),
            (object, "the object itself"),
        ] {
            assert_eq!(
                projection_of(entity),
                (visual_action::NONE, facing::NONE),
                "{description} must not acquire talk art from broad activity state"
            );
        }
    }

    #[test]
    fn coincident_talkers_face_by_stable_entity_order_in_both_directions() {
        use crate::render_buffer::{facing, visual_action};
        use crate::test_content;
        use terri_core::{Reserved, Socialising};

        let pack = test_content::pack_with_social(
            Vec::new(),
            vec![authored_talk_interaction("chat")],
            test_content::tuning(),
        );
        let mut sim = test_content::sim_with(8, 8, pack);
        let lower_initiator = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 2.0 },
                Needs::with(NeedId::Social, 50.0),
            ))
            .id();
        let higher_receiver = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 2.0 },
                Needs::with(NeedId::Social, 50.0),
                Reserved,
            ))
            .id();
        sim.world_mut()
            .entity_mut(lower_initiator)
            .insert(Socialising {
                interaction: 0,
                partner: higher_receiver,
                remaining_ticks: 10,
            });

        let lower_receiver = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 4.0 },
                Needs::with(NeedId::Social, 50.0),
                Reserved,
            ))
            .id();
        let higher_initiator = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 4.0 },
                Needs::with(NeedId::Social, 50.0),
                Socialising {
                    interaction: 0,
                    partner: lower_receiver,
                    remaining_ticks: 10,
                },
            ))
            .id();
        assert!(
            lower_receiver.index_u32() < higher_initiator.index_u32(),
            "spawn order must establish the coincident tie fixture"
        );

        sim.sync_render_buffer();
        let buf = sim.render_buffer();
        let projection_of = |entity: Entity| {
            let row = buf
                .ids
                .iter()
                .position(|&id| id == entity.index_u32())
                .expect("both talkers have rows");
            (buf.visual_actions[row], buf.facings[row])
        };
        assert_eq!(
            projection_of(lower_initiator),
            (visual_action::TALK, facing::POSITIVE_X),
            "the lower initiator owns positive x when geometry ties"
        );
        assert_eq!(
            projection_of(higher_receiver),
            (visual_action::TALK, facing::NEGATIVE_X),
            "the higher receiver must be opposite the lower initiator"
        );
        assert_eq!(
            projection_of(lower_receiver),
            (visual_action::TALK, facing::POSITIVE_X),
            "the lower entity index owns positive x when geometry ties"
        );
        assert_eq!(
            projection_of(higher_initiator),
            (visual_action::TALK, facing::NEGATIVE_X),
            "the higher entity index owns negative x when geometry ties"
        );
    }

    #[test]
    fn authored_talk_visual_requires_both_participants_to_be_agents() {
        use crate::render_buffer::{facing, visual_action};
        use crate::test_content;
        use terri_core::Socialising;

        let pack = test_content::pack_with_social(
            Vec::new(),
            vec![authored_talk_interaction("chat")],
            test_content::tuning(),
        );
        let mut sim = test_content::sim_with(8, 8, pack);
        let non_agent = sim.world_mut().spawn(Position { x: 3.0, y: 2.0 }).id();
        let initiator = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 2.0 },
                Needs::with(NeedId::Social, 50.0),
                Socialising {
                    interaction: 0,
                    partner: non_agent,
                    remaining_ticks: 10,
                },
            ))
            .id();

        sim.sync_render_buffer();
        let buf = sim.render_buffer();
        let projection_of = |entity: Entity| {
            let row = buf
                .ids
                .iter()
                .position(|&id| id == entity.index_u32())
                .expect("both positioned entities have render rows");
            (buf.visual_actions[row], buf.facings[row])
        };
        assert_eq!(
            projection_of(initiator),
            (visual_action::NONE, facing::NONE),
            "a malformed conversation must not give an agent a pose toward a non-agent"
        );
        assert_eq!(
            projection_of(non_agent),
            (visual_action::NONE, facing::NONE),
            "a non-agent must never acquire an agent talk pose"
        );
    }

    #[test]
    fn the_authored_sleep_tag_alone_changes_object_use_to_sleeping() {
        use crate::render_buffer::activity;
        use crate::test_content;

        let ordinary = test_content::interaction("ordinary", &[(NeedId::Energy, 40.0)], 18);
        let mut sleeping = ordinary.clone();
        sleeping.id = "sleeping".to_string();
        sleeping.label = "Sleeping".to_string();
        sleeping.tags = vec![terri_data::pack().sleep_tag.clone()];
        let pack = test_content::pack(vec![test_content::object_offering(
            "energy_pair",
            vec![ordinary, sleeping],
        )]);
        let def = pack.find("energy_pair").expect("the fixture declares it");
        let mut sim = test_content::sim_with(8, 8, pack);
        let awake_agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                Needs::with(NeedId::Hunger, 50.0),
            ))
            .id();
        let sleeping_agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 1.0 },
                Needs::with(NeedId::Hunger, 50.0),
            ))
            .id();
        sim.world_mut().entity_mut(awake_agent).insert(Eating {
            object: def,
            interaction: 0,
            remaining_ticks: 5,
        });
        sim.world_mut().entity_mut(sleeping_agent).insert(Eating {
            object: def,
            interaction: 1,
            remaining_ticks: 5,
        });

        sim.sync_render_buffer();
        let buf = sim.render_buffer();
        let activity_of = |entity: Entity| {
            let row = buf
                .ids
                .iter()
                .position(|&id| id == entity.index_u32())
                .expect("the agent has a row");
            buf.activities[row]
        };
        assert_eq!(
            activity_of(awake_agent),
            activity::USING_OBJECT,
            "an energy advert without the authored tag is ordinary object use"
        );
        assert_eq!(
            activity_of(sleeping_agent),
            activity::SLEEPING,
            "the otherwise identical tagged interaction is sleep"
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
        assert_eq!(buf.footprint_widths.len(), 2);
        assert_eq!(buf.footprint_depths.len(), 2);
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
    /// `sync_render_buffer` clears every vector and fills every row column, and
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
            assert_eq!(buf.footprint_widths.len(), expected_count);
            assert_eq!(buf.footprint_depths.len(), expected_count);
            assert_eq!(buf.sprites.len(), expected_count);
            assert_eq!(buf.foreground_sprites.len(), expected_count);
            assert_eq!(buf.activities.len(), expected_count);
            assert_eq!(buf.visual_actions.len(), expected_count);
            assert_eq!(buf.facings.len(), expected_count);
            assert_eq!(buf.carrying.len(), expected_count);
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
