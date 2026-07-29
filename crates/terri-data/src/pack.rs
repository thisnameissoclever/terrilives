//! The compiled content pack: what validation produces and what the
//! simulation reads.
//!
//! Everything here is post-validation. The types deliberately cannot
//! express the states `compile` rejects - a need name is an index rather
//! than a string, so an unknown need has no representation once a pack
//! exists. That is the point of [D9]: a broken pack must not be
//! constructible, so it can never reach runtime.

use serde::{Deserialize, Serialize};
use terri_core::NEED_COUNT;

/// Defined in `terri-core`, re-exported here so content consumers have
/// one import path. It lives there because `SmartObject` holds one and
/// `terri-core` must not depend on the content crate.
pub use terri_core::ObjectDefId;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledInteraction {
    pub id: String,
    /// (`NeedId` index, delta), sorted by index. Sparse: only advertised
    /// needs appear, and an absent need is not advertised at all, which
    /// is not the same as advertising zero.
    pub advertises: Vec<(u8, f32)>,
    pub duration_ticks: u32,
    pub slots: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledObject {
    pub id: String,
    pub name: String,
    /// Index into `assets/sprites/atlas.toml`'s `[[sprite]]` list, and
    /// therefore into the renderer's `SPRITES` array, which is generated
    /// from the same manifest in the same pass.
    ///
    /// An index rather than the authored name for the same reason a need
    /// is an index: once a pack exists, a sprite the atlas does not hold
    /// has no representation.
    pub sprite: u32,
    pub interactions: Vec<CompiledInteraction>,
}

/// One object, placed on the lot.
///
/// The object is an `ObjectDefId` rather than the authored string, for
/// the same reason a need is an index: once a pack exists, a placement
/// referring to an object that is not in it has no representation. That
/// is [D9] applied to the lot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledPlacement {
    pub object: ObjectDefId,
    pub x: f32,
    pub y: f32,
}

/// The lot: its size, its interior wall tiles, and what stands on it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledLot {
    pub width: u32,
    pub height: u32,
    /// Impassable tiles, in the order `lot.toml` declares them.
    ///
    /// Declaration order is preserved rather than sorted, deliberately.
    /// `CompiledInteraction::advertises` is sorted because its source is
    /// keyed by need NAME while the pack is keyed by need INDEX, so two
    /// orders exist and the pack has to pick one. A wall list has only
    /// ever had one order, the authored one, so sorting would be a
    /// mechanism with nothing to disambiguate - and every mechanism needs
    /// a test that can see it.
    ///
    /// Every entry is in bounds by construction; `compile` rejects a lot
    /// where one is not.
    pub walls: Vec<(u32, u32)>,
    pub placements: Vec<CompiledPlacement>,
}

impl CompiledLot {
    /// Whether `(x, y)` is one of this lot's wall tiles.
    ///
    /// Linear, because a hand-authored lot has tens of walls rather than
    /// thousands, and because the caller that matters - lot spawning -
    /// walks the list once at startup rather than querying it per tick.
    pub fn is_wall(&self, x: u32, y: u32) -> bool {
        self.walls.contains(&(x, y))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContentPack {
    pub decay_per_tick: [f32; NEED_COUNT],
    pub objects: Vec<CompiledObject>,
    /// The atlas index of the sprite every sim is drawn with.
    ///
    /// A sim is not authored content - nothing in `content/` declares
    /// one - so unlike an object's sprite this resolves a name fixed in
    /// `compile.rs` rather than one a designer typed. It lives in the
    /// pack anyway so that the render buffer can fill a sprite index for
    /// every row without the simulation or the shell knowing what a sim
    /// looks like.
    pub sim_sprite: u32,
    /// Last, so that the pack's byte encoding grows by appending. The
    /// golden vector in `compile.rs` annotates the earlier blocks, and
    /// keeping them at fixed offsets is what makes it reviewable.
    pub lot: CompiledLot,
}

impl ContentPack {
    /// Panics on an id from a different pack. `ObjectDefId` is an index
    /// into *this* pack's `objects`, which is why nothing persists one;
    /// save files store the string id and call [`ContentPack::find`].
    pub fn object(&self, id: ObjectDefId) -> &CompiledObject {
        &self.objects[id.0 as usize]
    }

    pub fn find(&self, id: &str) -> Option<ObjectDefId> {
        self.objects
            .iter()
            .position(|o| o.id == id)
            .map(|i| ObjectDefId(i as u32))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interaction(id: &str) -> CompiledInteraction {
        CompiledInteraction {
            id: id.to_string(),
            advertises: vec![(0, 35.0), (6, 5.0)],
            duration_ticks: 15,
            slots: 1,
        }
    }

    /// Non-square, with two walls declared out of sorted order and two
    /// placements whose object indices differ from their own positions
    /// in the list. Every one of those asymmetries exists so that a
    /// transposition, a reordering, or an index collapsed to zero is
    /// visible rather than hidden by a tidy fixture.
    fn a_lot() -> CompiledLot {
        CompiledLot {
            width: 6,
            height: 4,
            walls: vec![(3, 2), (1, 0)],
            placements: vec![
                CompiledPlacement {
                    object: ObjectDefId(2),
                    x: 2.5,
                    y: 1.25,
                },
                CompiledPlacement {
                    object: ObjectDefId(0),
                    x: 4.0,
                    y: 3.5,
                },
            ],
        }
    }

    fn three_objects() -> ContentPack {
        ContentPack {
            decay_per_tick: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
            objects: ["fridge", "bed", "sink"]
                .iter()
                .enumerate()
                // Sprite indices that are not the object's own position,
                // so a field dropped from the encoding or read off the
                // wrong slot moves the round-trip assertion below.
                .map(|(i, id)| CompiledObject {
                    id: (*id).to_string(),
                    name: id.to_uppercase(),
                    sprite: (i as u32) + 4,
                    interactions: vec![interaction("use_it")],
                })
                .collect(),
            sim_sprite: 1,
            lot: a_lot(),
        }
    }

    /// Both halves of the lookup are index arithmetic, and a single
    /// object cannot tell a correct index from a hardcoded zero. Three
    /// objects make `find` returning `Some(ObjectDefId(0))` and `object`
    /// returning `&self.objects[0]` both observable.
    #[test]
    fn find_and_object_round_trip_for_every_declared_object() {
        let pack = three_objects();
        assert_eq!(pack.objects.len(), 3, "the lookup needs something to find");

        for (i, declared) in ["fridge", "bed", "sink"].iter().enumerate() {
            let found = pack.find(declared).expect("declared object must be found");
            assert_eq!(
                found,
                ObjectDefId(i as u32),
                "'{declared}' is at declaration index {i}"
            );
            assert_eq!(
                pack.object(found).id,
                *declared,
                "object() returned a different object than find() named"
            );
        }

        assert_eq!(pack.find("nope"), None);
    }

    /// `is_wall` is a membership test over a list of PAIRS, and the two
    /// ways to get it wrong are to compare only one coordinate and to
    /// compare them transposed. The fixture's walls are `(3, 2)` and
    /// `(1, 0)`, so `(2, 3)` and `(0, 1)` are the transposes and neither
    /// is a wall; `(3, 0)` and `(1, 2)` are the cross products, which
    /// catch a single-coordinate comparison.
    #[test]
    fn is_wall_matches_both_coordinates_of_a_declared_wall() {
        let lot = a_lot();
        assert!(!lot.walls.is_empty(), "an empty lot would match nothing");

        assert!(lot.is_wall(3, 2));
        assert!(lot.is_wall(1, 0));

        assert!(!lot.is_wall(2, 3), "(2, 3) is (3, 2) transposed");
        assert!(!lot.is_wall(0, 1), "(0, 1) is (1, 0) transposed");
        assert!(!lot.is_wall(3, 0), "x alone must not decide a wall");
        assert!(!lot.is_wall(1, 2), "y alone must not decide a wall");
    }

    /// Task 5's `build.rs` writes the pack with `postcard::to_allocvec`
    /// and the runtime reads it with `postcard::from_bytes`. `postcard`
    /// is declared `default-features = false, features = ["alloc"]`, and
    /// `to_allocvec` is gated on exactly that feature, so this test is
    /// what makes the manifest choice a checked claim rather than an
    /// assumption.
    #[test]
    fn a_pack_round_trips_through_postcard() {
        let pack = three_objects();
        let bytes = postcard::to_allocvec(&pack).expect("pack must serialise");
        assert!(
            !bytes.is_empty(),
            "an empty encoding would round-trip trivially"
        );

        let restored: ContentPack = postcard::from_bytes(&bytes).expect("pack must deserialise");
        assert_eq!(restored, pack);
    }
}
