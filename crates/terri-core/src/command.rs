//! Player input as data. See ARCHITECTURE.md [D-2].

use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};

/// One player action, as data.
///
/// This type is the whole anti-corner requirement of M1b. JavaScript
/// never mutates simulation state; it enqueues one of these, and the
/// simulation drains them through one serialized system: first in a full
/// tick or alone while paused. Split and batched drains are equivalent for
/// one ordered stream. That keeps determinism ([A5]), gives [D8]'s save model
/// something to log, and leaves Layer 2 multiplayer possible - the thing you
/// would send over a wire is exactly this.
///
/// Entities cross as raw u32 indices because JavaScript cannot build an
/// Entity. Resolution back to a live Entity must tolerate a stale index.
///
/// **The variant order and the field widths are wire format.** Inserting
/// a variant anywhere but the end, or widening `SetSpeed`, renumbers or
/// resizes what postcard writes, so an old command log would replay as
/// something else. `command_encoding_is_pinned_by_a_golden_byte_vector`
/// is what makes that change loud.
///
/// **A struct variant's fields are written in declaration order**, which
/// makes APPENDING a field the one cheap change available here: the new
/// field's bytes land after every existing field, so the variant grows and
/// nothing before it moves. Inserting one anywhere else shifts every field
/// after it, which is the same class of break as renumbering a variant.
/// `UseObject::interaction` was added that way - see [I4] in
/// `docs/specs/2026-07-30-selection-and-input-design.md` for why it was
/// worth spending a byte on before the first save file exists rather than
/// a migration after.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SimCommand {
    /// Select an agent, or clear the selection with None.
    Select(Option<u32>),
    /// Direct an agent to use one of an object's interactions,
    /// overriding autonomy.
    ///
    /// `interaction` indexes that object's own `interactions` list in the
    /// order `content/objects.toml` declares them - the same order
    /// `SimHandle::interaction_labels` reports and the right-click flyout
    /// draws its rows in, so menu row `n` is interaction `n`. A plain
    /// left click sends 0, which is the only interaction any shipped
    /// object currently has.
    ///
    /// **An index past the end of that list is not rejected here.** It is
    /// exactly what a command log recorded against an older content pack
    /// replays as, and `serve_intents` drops such an intent on the tick it
    /// reaches the front rather than indexing with it. This type is data;
    /// the range check belongs where the data is used.
    ///
    /// `interaction` is LAST because postcard writes these three fields in
    /// declaration order. See the type comment.
    UseObject {
        agent: u32,
        object: u32,
        interaction: u32,
    },
    /// Clear an agent's queued intents, returning it to autonomy.
    CancelIntents { agent: u32 },
    /// Ticks per frame. 0 is paused. Never changes dt; see [D2].
    SetSpeed(u8),
    /// Direct an agent to start a social interaction with another sim,
    /// overriding autonomy - [A-11]'s "interact with other Sims".
    ///
    /// Not a reuse of [`SimCommand::UseObject`], for two reasons that
    /// are each sufficient: its drain resolves the target against
    /// `With<SmartObject>` and a test pins that sims are rejected there,
    /// so reinterpreting the field would change the meaning of every
    /// already-logged UseObject byte; and `interaction` here indexes the
    /// pack's SOCIAL vocabulary rather than an object's own list - one
    /// variant carrying both spaces would need a discriminant anyway.
    ///
    /// Appended after `SetSpeed`, which is the one cheap change: postcard
    /// writes the variant index, so every earlier command's bytes are
    /// untouched and the golden vector gains rows without moving any.
    /// The same range-check division as UseObject: an out-of-range
    /// social index is data here and `serve_intents`'s problem there.
    TalkTo {
        agent: u32,
        target: u32,
        interaction: u32,
    },
    /// [`SimCommand::UseObject`] placed at the FRONT of the agent's queue
    /// rather than the back - what a plain click or a plain menu row
    /// sends, per [I-plain-order-goes-first] in
    /// `docs/specs/2026-07-30-selection-and-input-design.md`.
    ///
    /// The sim drops what it is doing for this order as soon as the order
    /// can be served (while its object or partner is taken, the order
    /// waits at the front and the current action carries on) and, once
    /// it is done, carries on with everything that was already waiting. That
    /// is the difference from the `CancelIntents` + `UseObject` pair the
    /// shell used to send for a plain click: the pair emptied the queue,
    /// so an order given without Queue mode threw away every order given
    /// with it. Only `CancelIntents` empties a queue now.
    ///
    /// A separate variant rather than a `front` field appended to
    /// `UseObject`, because a field appended to a struct variant lengthens
    /// the bytes of every already-saved command of that variant, and
    /// saves exist now; a new variant leaves every earlier byte alone.
    /// The drain shares one placement routine between the two, so the
    /// cap, the fresh-queue staging and the serving guard are still one
    /// code path each.
    ///
    /// At a full queue the BACK intent is dropped to make room, and the
    /// drop is reported as a DISPLACEMENT, a counter of its own beside
    /// the capacity rejections, so the player hears that an older order
    /// fell off rather than that this one was refused. Refusing the
    /// front order instead would refuse the correction a plain click
    /// exists to make. If the dropped intent is the one the sim is
    /// carrying out, the drain releases that commitment on the spot.
    UseObjectFirst {
        agent: u32,
        object: u32,
        interaction: u32,
    },
    /// [`SimCommand::TalkTo`] placed at the FRONT of the agent's queue.
    /// The social twin of `UseObjectFirst`, with the same placement rules.
    TalkToFirst {
        agent: u32,
        target: u32,
        interaction: u32,
    },
    /// Atomic move and rotation. Appended to preserve earlier wire codes.
    PlaceObject {
        object: u32,
        x: u32,
        y: u32,
        facing: crate::Facing,
    },
    /// Make one boundary between two tiles open, a wall, or a doorway -
    /// [WT-command]. A lot edit, applied by itself in stream order like
    /// `PlaceObject`. Appended to preserve earlier wire codes.
    SetWallEdge {
        axis: crate::layout::EdgeAxis,
        x: u32,
        y: u32,
        state: crate::layout::WallState,
    },
    /// Buy one of the object named by `definition`, a pack object index,
    /// and stand it at `x`, `y` facing `facing` - [BM-buy]. A lot edit,
    /// applied by itself in stream order like `PlaceObject`. Appended to
    /// preserve earlier wire codes.
    BuyObject {
        definition: u32,
        x: u32,
        y: u32,
        facing: crate::Facing,
    },
    /// Wall the outline of the rectangle of tiles between two opposite
    /// corners, in either order, with `doorway` as the one line left
    /// passable ([RT-command]). A lot edit, applied by itself in stream order
    /// and wholly or not at all. Appended to preserve earlier wire codes.
    BuildRoom {
        x0: u32,
        y0: u32,
        x1: u32,
        y1: u32,
        doorway: Option<crate::layout::WallLine>,
    },
    /// Sell the placed object carrying entity index `object` - [SL-command]
    /// in `docs/specs/2026-09-22-selling-furniture.md`. A lot edit, applied
    /// by itself in stream order like `PlaceObject`. Appended to preserve
    /// earlier wire codes.
    SellObject { object: u32 },
    /// Draw the placed object carrying entity index `object` in content
    /// colourway `colourway` - [RC-command] in
    /// `docs/specs/2026-09-22-colourways.md`. A lot edit, applied by itself
    /// in stream order like `SellObject`. Appended to preserve earlier wire
    /// codes.
    SetColourway { object: u32, colourway: u32 },
    /// Buy object definition `definition` at tile (x, y) facing `facing`, in
    /// content colourway `colourway` - [RC-slice-buy] in
    /// `docs/specs/2026-09-22-colourways.md`. One lot edit: every purchase
    /// check, then the colourway, then the object is bought and drawn in it.
    /// Appended to preserve earlier wire codes.
    BuyObjectInColourway {
        definition: u32,
        x: u32,
        y: u32,
        facing: crate::Facing,
        colourway: u32,
    },
    /// A new housemate named `name` moves in, with pack personality
    /// `personality` and pack traits `traits` - [CS-command] in
    /// `docs/specs/2026-09-22-create-a-sim.md`. One edit, checked whole
    /// before anything is written. Appended to preserve earlier wire codes.
    AddHousemate {
        name: String,
        personality: u32,
        traits: Vec<u32>,
    },
    /// Lay floor covering `covering` on the tile at (x, y), or take the
    /// tile's covering away with 0 - [FL-command] in
    /// `docs/specs/2026-09-22-floors.md`. A covering is 1 upward for the
    /// content's coverings in order; 0 leaves the tile drawn by where it is
    /// ([OS-yard]). A lot edit, applied by itself in stream order like
    /// `SetWallEdge`. Appended to preserve earlier wire codes.
    SetFloor { x: u32, y: u32, covering: u8 },
    /// Record that the sim with entity index `who` is `relation` to the sim
    /// with entity index `to`, or take their tie away with `None`. The index
    /// is a debt the tie carries, see `FamilyTies` - [FM-tie] in
    /// `docs/specs/2026-09-22-family.md`. One fact about two people, applied
    /// by itself in stream order like `SetFloor`. Appended to preserve
    /// earlier wire codes.
    SetFamilyTie {
        who: u32,
        to: u32,
        relation: Option<crate::layout::Relation>,
    },
}

/// Commands awaiting the next drain point. Ordered, because two commands
/// issued in one tick must apply in the order the player issued them.
#[derive(Resource, Debug, Default)]
pub struct CommandQueue(Vec<SimCommand>);

impl CommandQueue {
    /// A queue already holding these commands in drain order. Used by
    /// save restoration so input staged just before an autosave is not lost.
    pub fn from_commands(commands: Vec<SimCommand>) -> Self {
        Self(commands)
    }

    pub fn push(&mut self, cmd: SimCommand) {
        self.0.push(cmd);
    }

    pub fn drain(&mut self) -> std::vec::Drain<'_, SimCommand> {
        self.0.drain(..)
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Commands in the order the next full or paused drain will apply them.
    pub fn as_slice(&self) -> &[SimCommand] {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_round_trip_through_postcard() {
        // Commands are the wire format for the save-file command log and,
        // later, for multiplayer. A silent encoding change would break a
        // replay long after the commit that caused it.
        //
        // Note what this test does NOT do: a round trip is self-consistent
        // under ANY encoding, so renumbering the variants or widening a
        // field passes it unchanged. That is precisely the "asserts a
        // relation between two computed values" shape that testing-protocol
        // rule 3 warns about. The golden vector below is what actually
        // pins the bytes; this test pins that the derives exist and agree.
        let cases = vec![
            SimCommand::Select(Some(7)),
            SimCommand::Select(None),
            // Three DISTINCT field values, and the interaction is
            // non-zero deliberately. A `0` there is the value that cannot
            // distinguish "the field round-trips" from "the field is
            // dropped and reconstructed as its default", which is [L34]
            // in the exact place the field was just added.
            SimCommand::UseObject {
                agent: 3,
                object: 9,
                interaction: 2,
            },
            SimCommand::CancelIntents { agent: 3 },
            SimCommand::SetSpeed(2),
            SimCommand::TalkTo {
                agent: 3,
                target: 5,
                interaction: 1,
            },
        ];
        for cmd in cases {
            let bytes = postcard::to_allocvec(&cmd).expect("serialises");
            let back: SimCommand = postcard::from_bytes(&bytes).expect("deserialises");
            assert_eq!(back, cmd, "round trip changed {cmd:?}");
        }
    }

    #[test]
    fn command_encoding_is_pinned_by_a_golden_byte_vector() {
        // The mutation this catches and the round trip cannot: reorder the
        // variants, insert one in the middle, change `SetSpeed(u8)` to
        // `SetSpeed(u32)`, or move `UseObject`'s `interaction` ahead of
        // `object`. Every one of those keeps a round trip green while
        // silently renumbering, resizing or transposing a format that
        // [D8]'s command log and Layer 2 multiplayer both read back later.
        // The last of them is why `interaction` was appended rather than
        // slotted in where it reads best: fields go out in declaration
        // order, so last is the only position that leaves the bytes before
        // it alone.
        //
        // Postcard writes the variant index as a varint, then the payload:
        // `Option` as 0 or 1 then the value, `u32` as a varint, `u8` as one
        // raw byte. If a postcard upgrade ever changes that, this test is
        // the thing that says so, and the fix is a save-format decision
        // rather than a version bump.
        let cases: Vec<(SimCommand, &[u8])> = vec![
            (
                SimCommand::PlaceObject {
                    object: 300,
                    x: 2,
                    y: 5,
                    facing: crate::Facing::NorthWest,
                },
                &[7, 172, 2, 2, 5, 2],
            ),
            (
                SimCommand::SetWallEdge {
                    axis: crate::layout::EdgeAxis::Horizontal,
                    x: 300,
                    y: 4,
                    state: crate::layout::WallState::Doorway,
                },
                // Read from this assertion's failure: variant 8, axis 1,
                // x 300 as a two-byte varint, y 4, state 2.
                &[8, 1, 172, 2, 4, 2],
            ),
            (
                SimCommand::BuyObject {
                    definition: 300,
                    x: 2,
                    y: 5,
                    facing: crate::Facing::NorthWest,
                },
                // Read from this assertion's failure: variant 9, definition
                // 300 as a two-byte varint, x 2, y 5, facing 2.
                &[9, 172, 2, 2, 5, 2],
            ),
            (
                SimCommand::BuildRoom {
                    x0: 300,
                    y0: 2,
                    x1: 5,
                    y1: 6,
                    doorway: Some(crate::layout::WallLine {
                        axis: crate::layout::EdgeAxis::Horizontal,
                        x: 3,
                        y: 7,
                    }),
                },
                // Read from this assertion's failure: variant 10, x0 300 as a
                // two-byte varint, y0 2, x1 5, y1 6, then Some, axis 1, x 3, y 7.
                &[10, 172, 2, 2, 5, 6, 1, 1, 3, 7],
            ),
            (
                SimCommand::BuildRoom {
                    x0: 1,
                    y0: 2,
                    x1: 3,
                    y1: 4,
                    doorway: None,
                },
                // Read from this assertion's failure: no doorway is one 0.
                &[10, 1, 2, 3, 4, 0],
            ),
            (
                SimCommand::SellObject { object: 300 },
                // Read from this assertion's failure: variant 11, then the
                // object 300 as a two-byte varint.
                &[11, 172, 2],
            ),
            (
                SimCommand::SetColourway {
                    object: 300,
                    colourway: 2,
                },
                // Variant 12, the object 300 as a two-byte varint, then the
                // colourway 2.
                &[12, 172, 2, 2],
            ),
            (
                SimCommand::BuyObjectInColourway {
                    definition: 300,
                    x: 2,
                    y: 5,
                    facing: crate::Facing::NorthWest,
                    colourway: 3,
                },
                // Variant 13, then the purchase as `BuyObject` writes it,
                // then the colourway 3.
                &[13, 172, 2, 2, 5, 2, 3],
            ),
            (
                SimCommand::AddHousemate {
                    name: "Ann".to_string(),
                    personality: 2,
                    traits: vec![1, 300],
                },
                // Variant 14, the name's length then its bytes, the
                // personality, then the traits' count and each as a varint.
                &[14, 3, b'A', b'n', b'n', 2, 2, 1, 172, 2],
            ),
            (SimCommand::Select(Some(7)), &[0x00, 0x01, 0x07]),
            (SimCommand::Select(None), &[0x00, 0x00]),
            // 300 needs two varint bytes, so this fails if the index ever
            // stops being a varint or the field stops being a u32.
            (SimCommand::Select(Some(300)), &[0x00, 0x01, 0xAC, 0x02]),
            // **Both `UseObject` rows below were derived from this
            // assertion's own failure output rather than hand-computed.**
            // The expectation was first written as `[0xDE, 0xAD]`, the
            // test run, and the `left:` side of the panic copied in. A
            // golden vector reasoned out from the encoder's documentation
            // and then confirmed by the encoder is a round trip wearing a
            // literal's clothes ([L33]); reading the bytes off a failure
            // is the one way to be sure the number written here is the
            // number that goes on the wire.
            (
                SimCommand::UseObject {
                    agent: 3,
                    object: 9,
                    interaction: 0,
                },
                &[0x01, 0x03, 0x09, 0x00],
            ),
            // Interaction above 127, so this row needs two varint bytes.
            // The same reasoning the `SetSpeed(200)` row below carries,
            // pointed the other way: that row proves the speed is still
            // ONE raw byte, and this one proves the interaction is a
            // varint `u32` rather than a byte. Narrow `interaction` to a
            // `u8` and this is the row that fails while the one above it
            // stays green, because 0 encodes identically under both.
            (
                SimCommand::UseObject {
                    agent: 3,
                    object: 9,
                    interaction: 200,
                },
                &[0x01, 0x03, 0x09, 0xC8, 0x01],
            ),
            // The saturated index, which is what an interaction index
            // arriving from JavaScript can be. Five bytes, because a
            // 32-bit value needs five groups of seven bits and the last
            // one carries only four. It is here rather than only in
            // `terri-wasm` because that crate's boundary tests write their
            // bytes out by hand on purpose ([L33]) and say they match this
            // vector; a literal over there with no row over here would be
            // the second, unpinned statement of the format that this test
            // exists to prevent.
            (
                SimCommand::UseObject {
                    agent: 3,
                    object: 9,
                    interaction: u32::MAX,
                },
                &[0x01, 0x03, 0x09, 0xFF, 0xFF, 0xFF, 0xFF, 0x0F],
            ),
            (SimCommand::CancelIntents { agent: 3 }, &[0x02, 0x03]),
            (SimCommand::SetSpeed(2), &[0x03, 0x02]),
            // Above 127, so a widened `SetSpeed` would emit two bytes here
            // and one for every value below it. Not a speed anyone sets;
            // this row is about the width, not the semantics.
            (SimCommand::SetSpeed(200), &[0x03, 0xC8]),
            // TalkTo, variant 4 - appended, so every row above is
            // byte-identical to what it was before the variant existed,
            // which is the whole appending contract. Field values
            // pairwise distinct and non-zero per [L34]; the two-byte
            // interaction row and the saturated row carry the same
            // width arguments as UseObject's. Derived from the failing
            // assertion, per this test's own convention.
            (
                SimCommand::TalkTo {
                    agent: 3,
                    target: 5,
                    interaction: 1,
                },
                &[0x04, 0x03, 0x05, 0x01],
            ),
            (
                SimCommand::TalkTo {
                    agent: 3,
                    target: 5,
                    interaction: 200,
                },
                &[0x04, 0x03, 0x05, 0xC8, 0x01],
            ),
            (
                SimCommand::TalkTo {
                    agent: 3,
                    target: 5,
                    interaction: u32::MAX,
                },
                &[0x04, 0x03, 0x05, 0xFF, 0xFF, 0xFF, 0xFF, 0x0F],
            ),
            // The two FRONT placements, variants 5 and 6 - appended, so
            // every row above keeps its bytes. Each carries the same
            // three varints as the append variant it shadows, and the
            // two-byte interaction row pins the width the same way.
            // Derived from the failing assertion, per this test's
            // convention.
            (
                SimCommand::UseObjectFirst {
                    agent: 3,
                    object: 9,
                    interaction: 1,
                },
                &[0x05, 0x03, 0x09, 0x01],
            ),
            (
                SimCommand::UseObjectFirst {
                    agent: 3,
                    object: 9,
                    interaction: 200,
                },
                &[0x05, 0x03, 0x09, 0xC8, 0x01],
            ),
            (
                SimCommand::TalkToFirst {
                    agent: 3,
                    target: 5,
                    interaction: 1,
                },
                &[0x06, 0x03, 0x05, 0x01],
            ),
            (
                SimCommand::TalkToFirst {
                    agent: 3,
                    target: 5,
                    interaction: 200,
                },
                &[0x06, 0x03, 0x05, 0xC8, 0x01],
            ),
        ];
        for (cmd, expected) in cases {
            let bytes = postcard::to_allocvec(&cmd).expect("serialises");
            assert_eq!(
                bytes, expected,
                "the wire encoding of {cmd:?} changed; an existing command \
                 log would replay as something else"
            );
        }
    }

    #[test]
    fn the_queue_drains_in_order_and_empties() {
        // Order is load-bearing: two commands in one tick must apply in
        // the order the player issued them, or replay diverges.
        let mut q = CommandQueue::default();

        // `is_empty` is asserted in BOTH directions, and the false case is
        // the one that was missing. A queue holding two commands is the
        // only input on which `is_empty -> true` is observable; with only
        // the post-drain assertion below, that mutant survives the whole
        // workspace. Task 1's report predicted it as an open concern and
        // M1b Task 3's sweep confirmed it. Nothing outside this file
        // consumes the queue yet, so no other test can stand in.
        assert!(q.is_empty(), "a fresh queue holds nothing");
        q.push(SimCommand::Select(Some(1)));
        q.push(SimCommand::SetSpeed(3));
        assert_eq!(q.len(), 2);
        assert!(
            !q.is_empty(),
            "a queue holding two commands must not report empty"
        );

        let drained: Vec<_> = q.drain().collect();
        assert_eq!(
            drained,
            vec![SimCommand::Select(Some(1)), SimCommand::SetSpeed(3)]
        );
        assert!(q.is_empty(), "drain must leave the queue empty");
    }
}
