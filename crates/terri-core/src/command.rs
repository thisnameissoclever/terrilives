//! Player input as data. See ARCHITECTURE.md [D-2].

use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};

/// One player action, as data.
///
/// This type is the whole anti-corner requirement of M1b. JavaScript
/// never mutates simulation state; it enqueues one of these, and the
/// simulation drains them at a fixed point in the tick. That is what
/// keeps determinism ([A5]), gives [D8]'s save model something to log,
/// and leaves Layer 2 multiplayer possible - the thing you would send
/// over a wire is exactly this.
///
/// Entities cross as raw u32 indices because JavaScript cannot build an
/// Entity. Resolution back to a live Entity must tolerate a stale index.
///
/// **The variant order and the field widths are wire format.** Inserting
/// a variant anywhere but the end, or widening `SetSpeed`, renumbers or
/// resizes what postcard writes, so an old command log would replay as
/// something else. `command_encoding_is_pinned_by_a_golden_byte_vector`
/// is what makes that change loud.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SimCommand {
    /// Select an agent, or clear the selection with None.
    Select(Option<u32>),
    /// Direct an agent to use an object, overriding autonomy.
    UseObject { agent: u32, object: u32 },
    /// Clear an agent's queued intents, returning it to autonomy.
    CancelIntents { agent: u32 },
    /// Ticks per frame. 0 is paused. Never changes dt; see [D2].
    SetSpeed(u8),
}

/// Commands awaiting the next drain point. Ordered, because two commands
/// issued in one tick must apply in the order the player issued them.
#[derive(Resource, Debug, Default)]
pub struct CommandQueue(Vec<SimCommand>);

impl CommandQueue {
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
            SimCommand::UseObject {
                agent: 3,
                object: 9,
            },
            SimCommand::CancelIntents { agent: 3 },
            SimCommand::SetSpeed(2),
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
        // variants, insert one in the middle, or change `SetSpeed(u8)` to
        // `SetSpeed(u32)`. Every one of those keeps a round trip green
        // while silently renumbering or resizing a format that [D8]'s
        // command log and Layer 2 multiplayer both read back later.
        //
        // Postcard writes the variant index as a varint, then the payload:
        // `Option` as 0 or 1 then the value, `u32` as a varint, `u8` as one
        // raw byte. If a postcard upgrade ever changes that, this test is
        // the thing that says so, and the fix is a save-format decision
        // rather than a version bump.
        let cases: Vec<(SimCommand, &[u8])> = vec![
            (SimCommand::Select(Some(7)), &[0x00, 0x01, 0x07]),
            (SimCommand::Select(None), &[0x00, 0x00]),
            // 300 needs two varint bytes, so this fails if the index ever
            // stops being a varint or the field stops being a u32.
            (SimCommand::Select(Some(300)), &[0x00, 0x01, 0xAC, 0x02]),
            (
                SimCommand::UseObject {
                    agent: 3,
                    object: 9,
                },
                &[0x01, 0x03, 0x09],
            ),
            (SimCommand::CancelIntents { agent: 3 }, &[0x02, 0x03]),
            (SimCommand::SetSpeed(2), &[0x03, 0x02]),
            // Above 127, so a widened `SetSpeed` would emit two bytes here
            // and one for every value below it. Not a speed anyone sets;
            // this row is about the width, not the semantics.
            (SimCommand::SetSpeed(200), &[0x03, 0xC8]),
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
