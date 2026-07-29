//! Validation, and the compilation of validated content into a pack.
//!
//! Every failure mode in this module is a build failure by design. The
//! checks live here rather than in the schema because serde can express
//! shape but not meaning: "this need name is one rustc knows about" and
//! "every `NeedId` appears exactly once" are not shapes.

use crate::error::ContentError;
use crate::pack::{
    CompiledInteraction, CompiledLot, CompiledObject, CompiledPlacement, ContentPack, ObjectDefId,
};
use crate::schema::{AtlasFile, LotFile, NeedsFile, ObjectsFile};
use std::collections::BTreeSet;
use terri_core::{NeedId, NEED_COUNT};

/// The atlas sprite every sim is drawn with.
///
/// The one sprite name that lives in Rust rather than in `content/`,
/// because a sim is not an authored object: nothing declares one, and
/// `spawn_agent` takes a position and a hunger. Keeping it here rather
/// than in TypeScript means the render buffer can carry a sprite index
/// for **every** row, so the shell never has to ask what kind of thing a
/// row is in order to draw it.
pub const SIM_SPRITE: &str = "sim";

/// Rejects a number that is meaningless rather than merely wrong. `NaN`
/// is the dangerous one: it propagates silently through the scoring
/// arithmetic instead of failing anywhere near the content that produced
/// it. Infinity is rejected with it, because a single infinite advert
/// makes every score on the object infinite and two of them summing with
/// opposite signs produce a `NaN` after all.
fn check_finite(value: f32, context: &str) -> Result<(), ContentError> {
    if !value.is_finite() {
        return Err(ContentError::NonFiniteValue {
            context: context.to_string(),
        });
    }
    Ok(())
}

/// Finite, and non-negative as well.
///
/// Used where a negative number has no meaning at all rather than an
/// inconvenient one: a decay rate that refills a need is a sign error,
/// not a design. Advertised deltas deliberately do NOT go through this -
/// see the negative-delta note on `compile` below.
fn check_number(value: f32, context: &str) -> Result<(), ContentError> {
    check_finite(value, context)?;
    if value < 0.0 {
        return Err(ContentError::NegativeValue {
            context: context.to_string(),
        });
    }
    Ok(())
}

/// Validates content and compiles it to a pack. Every failure mode here
/// is a build failure by design: a broken pack must not be constructible,
/// so it can never reach runtime. See [D9].
///
/// **Advertised deltas may be negative.** M1a rejected them, which
/// foreclosed a shower that costs energy, and trade-off interactions are
/// a real part of how this genre reads: a sim weighing "I want to be
/// clean but I am already exhausted" is the emergent behaviour M1b
/// exists to evaluate. `score_advertisement` carries the sign through the
/// same cubed-urgency weighting it applies to a benefit, so a cost is
/// felt in proportion to how badly the need it drains is already felt.
/// A non-finite delta is still rejected; that check moved from
/// `check_number` to `check_finite` rather than being dropped.
pub fn compile(
    needs: NeedsFile,
    objects: ObjectsFile,
    lot: LotFile,
    atlas: AtlasFile,
) -> Result<ContentPack, ContentError> {
    let sprite_index = |name: &str| atlas.sprite.iter().position(|s| s.name == name);
    let sim_sprite = sprite_index(SIM_SPRITE).ok_or_else(|| ContentError::MissingSimSprite {
        sprite: SIM_SPRITE.to_string(),
    })? as u32;

    let mut decay = [f32::NAN; NEED_COUNT];
    // A fixed-size array rather than a set: `NeedId` is `Eq + Hash` but
    // not `Ord`, and the need space is closed and small, so indexing it
    // directly needs no allocation and no ordering it does not have.
    let mut seen_needs = [false; NEED_COUNT];

    for def in &needs.need {
        let Some(id) = NeedId::from_name(&def.id) else {
            return Err(ContentError::UnknownNeedDecay {
                need: def.id.clone(),
            });
        };
        if seen_needs[id.index()] {
            return Err(ContentError::DuplicateNeedDecay {
                need: def.id.clone(),
            });
        }
        seen_needs[id.index()] = true;
        check_number(
            def.decay_per_tick,
            &format!("decay_per_tick for '{}'", def.id),
        )?;
        decay[id.index()] = def.decay_per_tick;
    }

    // Without this loop a need omitted from the file keeps the `NaN`
    // seeded above, and a `NaN` decay rate poisons that need's level on
    // the first tick with nothing pointing back at the content.
    for id in NeedId::ALL {
        if !seen_needs[id.index()] {
            return Err(ContentError::MissingNeedDecay {
                need: id.as_str().to_string(),
            });
        }
    }

    let mut seen_objects = BTreeSet::new();
    let mut compiled = Vec::with_capacity(objects.object.len());

    for object in &objects.object {
        if !seen_objects.insert(object.id.clone()) {
            return Err(ContentError::DuplicateObjectId {
                id: object.id.clone(),
            });
        }

        // Resolved before the interactions, so a typo in the sprite name
        // is reported as a typo rather than as whatever the object's
        // other content happens to trip over first.
        let Some(sprite) = sprite_index(&object.sprite) else {
            return Err(ContentError::UnknownSprite {
                object: object.id.clone(),
                sprite: object.sprite.clone(),
            });
        };

        // Scoped to the object, so two objects may each declare a
        // `use` interaction without colliding.
        let mut seen_interactions = BTreeSet::new();
        let mut interactions = Vec::with_capacity(object.interaction.len());

        for act in &object.interaction {
            if !seen_interactions.insert(act.id.clone()) {
                return Err(ContentError::DuplicateInteractionId {
                    object: object.id.clone(),
                    id: act.id.clone(),
                });
            }
            if act.duration_ticks == 0 {
                return Err(ContentError::ZeroDuration {
                    object: object.id.clone(),
                    interaction: act.id.clone(),
                });
            }
            if act.slots == 0 {
                return Err(ContentError::ZeroSlots {
                    object: object.id.clone(),
                    interaction: act.id.clone(),
                });
            }

            let mut advertises = Vec::with_capacity(act.advertises.len());
            for (need_name, delta) in &act.advertises {
                let Some(id) = NeedId::from_name(need_name) else {
                    return Err(ContentError::UnknownNeed {
                        object: object.id.clone(),
                        interaction: act.id.clone(),
                        need: need_name.clone(),
                    });
                };
                // `check_finite`, not `check_number`: a negative delta is
                // legal content. See the note on this function.
                check_finite(*delta, &format!("advert '{}' on '{}'", need_name, act.id))?;
                advertises.push((id.index() as u8, *delta));
            }
            // BTreeMap iterates by name; the pack is keyed by index, so
            // sort explicitly rather than relying on the two agreeing.
            advertises.sort_unstable_by_key(|(i, _)| *i);

            interactions.push(CompiledInteraction {
                id: act.id.clone(),
                advertises,
                duration_ticks: act.duration_ticks,
                slots: act.slots,
            });
        }

        compiled.push(CompiledObject {
            id: object.id.clone(),
            name: object.name.clone(),
            sprite: sprite as u32,
            interactions,
        });
    }

    let lot = compile_lot(lot, &compiled)?;

    Ok(ContentPack {
        decay_per_tick: decay,
        objects: compiled,
        sim_sprite,
        lot,
    })
}

/// Validates the lot against the objects that were just compiled, and
/// resolves every placement's object id to its index in them.
///
/// Taking the compiled objects rather than the authored ones is what
/// makes the last rule a real dangling-reference check: a placement can
/// only name something that survived object validation.
fn compile_lot(lot: LotFile, objects: &[CompiledObject]) -> Result<CompiledLot, ContentError> {
    // A zero dimension is not merely odd; `TileGrid::new(0, h)` has no
    // walkable tile at all, so every agent on it silently never moves.
    // That is the shape of failure [D9] exists to convert into a build
    // error.
    if lot.width == 0 || lot.height == 0 {
        return Err(ContentError::EmptyLot {
            width: lot.width,
            height: lot.height,
        });
    }

    let mut walls = Vec::with_capacity(lot.wall.len());
    // Membership is asked once per placement, so a set rather than a
    // scan over `walls`. Ordered, because nothing here may depend on
    // hash iteration order; see `CompiledInteraction::advertises`.
    let mut wall_tiles = BTreeSet::new();

    for wall in &lot.wall {
        // Both bounds, both axes, in one place. `u32::try_from` is what
        // rejects a negative coordinate; writing `wall.x as u32 <
        // lot.width` instead would wrap -1 to 4294967295 and reject it
        // for the wrong reason today, and accept it the day someone
        // authors a lot wider than 4 billion tiles.
        let (Ok(x), Ok(y)) = (u32::try_from(wall.x), u32::try_from(wall.y)) else {
            return Err(ContentError::WallOutOfBounds {
                x: wall.x,
                y: wall.y,
                width: lot.width,
                height: lot.height,
            });
        };
        if x >= lot.width || y >= lot.height {
            return Err(ContentError::WallOutOfBounds {
                x: wall.x,
                y: wall.y,
                width: lot.width,
                height: lot.height,
            });
        }
        walls.push((x, y));
        wall_tiles.insert((x, y));
    }

    let mut placements = Vec::with_capacity(lot.place.len());

    for place in &lot.place {
        // The object id is resolved FIRST, so a typo in the name is
        // reported as a typo rather than as whatever geometric
        // consequence it happens to have.
        let Some(index) = objects.iter().position(|o| o.id == place.object) else {
            return Err(ContentError::UnknownPlacedObject {
                object: place.object.clone(),
            });
        };

        // Finiteness before the bounds comparison, because every
        // comparison against NaN is false: `NaN < 0.0` and
        // `NaN >= width` are both false, so a NaN coordinate would sail
        // through an in-bounds check and land as a tile of 0 after the
        // cast.
        check_finite(place.x, &format!("placement x for '{}'", place.object))?;
        check_finite(place.y, &format!("placement y for '{}'", place.object))?;

        if place.x < 0.0
            || place.y < 0.0
            || place.x >= lot.width as f32
            || place.y >= lot.height as f32
        {
            return Err(ContentError::PlacementOutOfBounds {
                object: place.object.clone(),
                x: place.x,
                y: place.y,
                width: lot.width,
                height: lot.height,
            });
        }

        // Non-negative and below the width by the check above, so the
        // cast truncates towards zero, which for a non-negative value is
        // the floor: the tile the object stands in.
        let tile = (place.x as u32, place.y as u32);
        if wall_tiles.contains(&tile) {
            return Err(ContentError::PlacementOnWall {
                object: place.object.clone(),
                x: tile.0,
                y: tile.1,
            });
        }

        placements.push(CompiledPlacement {
            object: ObjectDefId(index as u32),
            x: place.x,
            y: place.y,
        });
    }

    Ok(CompiledLot {
        width: lot.width,
        height: lot.height,
        walls,
        placements,
    })
}

#[cfg(test)]
mod tests {
    // `super::*` already supplies ContentError, NeedsFile, ObjectsFile,
    // NeedId and NEED_COUNT. Only the types production code does not
    // name are imported here.
    use super::*;
    use crate::schema::{
        AtlasSpriteDef, InteractionDef, NeedDef, ObjectDef, PlacementDef, WallDef,
    };

    /// The atlas every test compiles against.
    ///
    /// Five sprites in an order chosen so that no object's sprite index
    /// equals its own position in the object list, and so that the sim's
    /// is neither 0 nor last. `three_objects` declares fridge, bed, sink
    /// at positions 0, 1, 2 and they resolve to 2, 3, 4 here. Without
    /// that offset a resolver that returned the object's own position, or
    /// zero, would satisfy every assertion below - [L29] in the atlas's
    /// costume.
    fn test_atlas() -> AtlasFile {
        AtlasFile {
            sprite: ["couch_art", SIM_SPRITE, "fridge_art", "bed_art", "sink_art"]
                .iter()
                .map(|name| AtlasSpriteDef {
                    name: (*name).to_string(),
                })
                .collect(),
        }
    }

    /// The index `test_atlas` gives a sprite, so the expectations below
    /// read off the fixture rather than restating it.
    fn atlas_index(name: &str) -> u32 {
        test_atlas()
            .sprite
            .iter()
            .position(|s| s.name == name)
            .expect("the fixture atlas must hold this sprite") as u32
    }

    /// A decay rate that differs per need. `0.1` everywhere would let a
    /// compile step that wrote every rate into slot 0 pass unnoticed.
    fn distinct_decay(id: NeedId) -> f32 {
        (id.index() as f32 + 1.0) / 10.0
    }

    /// Regenerated only when the pack format changes on purpose. See
    /// `a_compiled_pack_serialises_to_a_stable_golden_vector`.
    ///
    /// Annotated because an opaque byte blob is a vector nobody can
    /// review. Three annotations matter: the decay block, which is in
    /// index order while the fixture declares it in reverse; the advert
    /// block, which is in index order while the fixture's map iterates it
    /// by name; and the wall block, which is in DECLARATION order while
    /// the fixture declares it out of sorted order.
    #[rustfmt::skip]
    const GOLDEN_PACK_BYTES: &[u8] = &[
        // decay_per_tick: seven LE f32 in NeedId index order.
        0xCD, 0xCC, 0xCC, 0x3D, // [0] hunger  0.1
        0xCD, 0xCC, 0x4C, 0x3E, // [1] energy  0.2
        0x9A, 0x99, 0x99, 0x3E, // [2] hygiene 0.3
        0xCD, 0xCC, 0xCC, 0x3E, // [3] bladder 0.4
        0x00, 0x00, 0x00, 0x3F, // [4] social  0.5
        0x9A, 0x99, 0x19, 0x3F, // [5] fun     0.6
        0x33, 0x33, 0x33, 0x3F, // [6] comfort 0.7
        0x01, // objects: 1
        0x06, b'f', b'r', b'i', b'd', b'g', b'e',
        0x06, b'F', b'r', b'i', b'd', b'g', b'e',
        0x02, // sprite: 'fridge_art' is at index 2 of the fixture atlas,
              // NOT 0, which is where a resolver reading the object's own
              // position would put it
        0x01, // interactions: 1
        0x0A, b'g', b'r', b'a', b'b', b'_', b's', b'n', b'a', b'c', b'k',
        0x03, // advertises: 3, index-ordered
        0x00, 0x00, 0x00, 0x0C, 0x42, // hunger  35.0
        0x01, 0x00, 0x00, 0x40, 0x40, // energy   3.0
        0x06, 0x00, 0x00, 0xA0, 0x40, // comfort  5.0
        0x0F, // duration_ticks: 15
        0x01, // slots: 1
        0x01, // sim_sprite: 'sim' is at index 1 of the fixture atlas
        // lot: width, height, walls, placements.
        0x05, // width:  5
        0x03, // height: 3, so the two are not interchangeable
        0x02, // walls: 2, in DECLARATION order, not sorted
        0x03, 0x02, // (3, 2)
        0x01, 0x00, // (1, 0)
        0x01, // placements: 1
        0x00, // 'fridge' resolved to ObjectDefId(0)
        0x00, 0x00, 0x20, 0x40, // x 2.5, fractional on purpose
        0x00, 0x00, 0xA0, 0x3F, // y 1.25
    ];

    /// The object tests are about objects, so they compile against a lot
    /// with room for nothing in it. The lot tests below build their own.
    fn compile_objects(
        needs: NeedsFile,
        objects: ObjectsFile,
    ) -> Result<ContentPack, ContentError> {
        compile(needs, objects, bare_lot(), test_atlas())
    }

    fn bare_lot() -> LotFile {
        LotFile {
            width: 1,
            height: 1,
            wall: Vec::new(),
            place: Vec::new(),
        }
    }

    /// A lot whose every number is distinguishable from every other:
    /// non-square, walls declared out of sorted order, and a placement
    /// on fractional coordinates whose tile is neither `(0, 0)` nor
    /// either wall.
    fn distinct_lot() -> LotFile {
        LotFile {
            width: 5,
            height: 3,
            wall: vec![WallDef { x: 3, y: 2 }, WallDef { x: 1, y: 0 }],
            place: vec![PlacementDef {
                object: "fridge".into(),
                x: 2.5,
                y: 1.25,
            }],
        }
    }

    /// `distinct_lot` with `mutate` applied, for the rejection tests.
    fn lot_where(mutate: impl FnOnce(&mut LotFile)) -> LotFile {
        let mut lot = distinct_lot();
        mutate(&mut lot);
        lot
    }

    /// Three objects, so a placement resolving to index 0 is
    /// distinguishable from a placement resolving correctly. `fridge`
    /// stays first because `one_object` and the golden vector both
    /// assume it.
    fn three_objects() -> ObjectsFile {
        ObjectsFile {
            object: ["fridge", "bed", "sink"]
                .iter()
                .map(|id| ObjectDef {
                    id: (*id).to_string(),
                    name: id.to_uppercase(),
                    sprite: format!("{id}_art"),
                    interaction: vec![snack()],
                })
                .collect(),
        }
    }

    fn full_needs() -> NeedsFile {
        NeedsFile {
            need: NeedId::ALL
                .iter()
                .map(|id| NeedDef {
                    id: id.as_str().to_string(),
                    decay_per_tick: 0.1,
                })
                .collect(),
        }
    }

    fn one_object(interaction: InteractionDef) -> ObjectsFile {
        ObjectsFile {
            object: vec![ObjectDef {
                id: "fridge".into(),
                name: "Fridge".into(),
                sprite: "fridge_art".into(),
                interaction: vec![interaction],
            }],
        }
    }

    fn snack() -> InteractionDef {
        InteractionDef {
            id: "grab_snack".into(),
            advertises: [("hunger".to_string(), 35.0)].into_iter().collect(),
            duration_ticks: 15,
            slots: 1,
        }
    }

    /// Every need present with its own rate, declared in reverse order
    /// so that position in the file and slot in the pack disagree.
    fn distinct_needs() -> NeedsFile {
        NeedsFile {
            need: NeedId::ALL
                .iter()
                .rev()
                .map(|id| NeedDef {
                    id: id.as_str().to_string(),
                    decay_per_tick: distinct_decay(*id),
                })
                .collect(),
        }
    }

    /// comfort (6), energy (1), hunger (0): the `BTreeMap`'s name order
    /// is the exact reverse of the index order the pack wants, so the
    /// two can never coincide by accident.
    fn snack_advertising_three_needs() -> InteractionDef {
        let mut act = snack();
        act.advertises.insert("comfort".into(), 5.0);
        act.advertises.insert("energy".into(), 3.0);
        act
    }

    #[test]
    fn compiles_valid_content() {
        let pack = compile_objects(full_needs(), one_object(snack())).expect("valid");
        assert_eq!(pack.objects.len(), 1);
        assert_eq!(pack.decay_per_tick.len(), NEED_COUNT);
        let act = &pack.objects[0].interactions[0];
        assert_eq!(act.advertises, vec![(NeedId::Hunger.index() as u8, 35.0)]);
        assert_eq!(act.duration_ticks, 15);
        assert_eq!(act.slots, 1);
        assert_eq!(pack.objects[0].name, "Fridge");
        assert_eq!(pack.find("fridge"), Some(ObjectDefId(0)));
        assert_eq!(pack.find("nope"), None);
    }

    /// The accepting half of the sprite rule: a name that IS in the atlas
    /// resolves to that sprite's position in it.
    ///
    /// Three objects rather than one, and an atlas whose order is not the
    /// object list's, because one object cannot tell a resolved index
    /// from a hardcoded zero and three objects in declaration order
    /// cannot tell it from the object's own position. Here they are at
    /// positions 0, 1, 2 and resolve to 2, 3, 4.
    #[test]
    fn an_objects_sprite_resolves_to_its_position_in_the_atlas() {
        let pack = compile_objects(full_needs(), three_objects()).expect("valid");
        assert_eq!(
            pack.objects.len(),
            3,
            "the resolver needs something to find"
        );

        let resolved: Vec<u32> = pack.objects.iter().map(|o| o.sprite).collect();
        assert_eq!(
            resolved,
            vec![
                atlas_index("fridge_art"),
                atlas_index("bed_art"),
                atlas_index("sink_art"),
            ],
            "each object must carry its own sprite's atlas index"
        );
        assert_eq!(
            resolved,
            vec![2, 3, 4],
            "and those indices must differ from the objects' own positions, \
             or this test cannot see a resolver that returns the position"
        );
    }

    /// The dangling-reference check for sprites, the same shape as
    /// `rejects_a_placement_naming_an_object_that_does_not_exist`. An
    /// object naming a sprite the atlas does not hold must not compile,
    /// because after compilation a sprite is an index into the atlas and
    /// a bad index has no representation - WGSL clamps an out-of-range
    /// uniform-array index rather than trapping, so at run time the
    /// object would silently draw as some other object.
    #[test]
    fn rejects_an_object_naming_a_sprite_the_atlas_does_not_hold() {
        let mut objects = one_object(snack());
        objects.object[0].sprite = "hovercraft_art".into();
        assert_eq!(
            compile_objects(full_needs(), objects).unwrap_err(),
            ContentError::UnknownSprite {
                object: "fridge".into(),
                sprite: "hovercraft_art".into()
            }
        );

        // The same object against a sprite the atlas DOES hold compiles,
        // so the rejection is about the reference rather than about the
        // rule firing unconditionally.
        let mut objects = one_object(snack());
        objects.object[0].sprite = "couch_art".into();
        let pack = compile_objects(full_needs(), objects).expect("'couch_art' is in the atlas");
        assert_eq!(pack.objects[0].sprite, atlas_index("couch_art"));
    }

    /// The sim's sprite is not authored, so nothing in `content/` can
    /// break it - but an atlas regenerated without it would leave every
    /// sim drawing whatever sprite index 0 happens to be, which on the
    /// shipped atlas is the floor. Rejected at build time instead.
    #[test]
    fn rejects_an_atlas_with_no_sprite_for_a_sim() {
        let atlas = AtlasFile {
            sprite: test_atlas()
                .sprite
                .into_iter()
                .filter(|s| s.name != SIM_SPRITE)
                .collect(),
        };
        assert!(
            !atlas.sprite.is_empty(),
            "an empty atlas would fail for the other reason and prove nothing"
        );
        assert_eq!(
            compile(full_needs(), one_object(snack()), bare_lot(), atlas).unwrap_err(),
            ContentError::MissingSimSprite {
                sprite: SIM_SPRITE.into()
            }
        );
    }

    /// And the accepting half: the sim resolves to its own position,
    /// which in the fixture is neither 0 nor last.
    #[test]
    fn the_sim_sprite_resolves_to_its_own_position_in_the_atlas() {
        let pack = compile_objects(full_needs(), one_object(snack())).expect("valid");
        assert_eq!(pack.sim_sprite, atlas_index(SIM_SPRITE));
        assert_eq!(
            pack.sim_sprite, 1,
            "the fixture puts the sim at index 1 precisely so that 0 and \
             `len - 1` are both wrong answers"
        );
    }

    #[test]
    fn rejects_an_advert_naming_an_unknown_need() {
        let mut act = snack();
        act.advertises.insert("vibes".into(), 1.0);
        let err = compile_objects(full_needs(), one_object(act)).unwrap_err();
        assert_eq!(
            err,
            ContentError::UnknownNeed {
                object: "fridge".into(),
                interaction: "grab_snack".into(),
                need: "vibes".into()
            }
        );
    }

    #[test]
    fn rejects_a_missing_need_decay() {
        let mut needs = full_needs();
        needs.need.retain(|n| n.id != "comfort");
        let err = compile_objects(needs, one_object(snack())).unwrap_err();
        assert_eq!(
            err,
            ContentError::MissingNeedDecay {
                need: "comfort".into()
            }
        );
    }

    #[test]
    fn rejects_an_unknown_need_decay() {
        let mut needs = full_needs();
        needs.need.push(NeedDef {
            id: "vibes".into(),
            decay_per_tick: 0.1,
        });
        let err = compile_objects(needs, one_object(snack())).unwrap_err();
        assert_eq!(
            err,
            ContentError::UnknownNeedDecay {
                need: "vibes".into()
            }
        );
    }

    #[test]
    fn rejects_a_duplicate_need_decay() {
        let mut needs = full_needs();
        needs.need.push(NeedDef {
            id: "hunger".into(),
            decay_per_tick: 0.2,
        });
        let err = compile_objects(needs, one_object(snack())).unwrap_err();
        assert_eq!(
            err,
            ContentError::DuplicateNeedDecay {
                need: "hunger".into()
            }
        );
    }

    #[test]
    fn rejects_duplicate_object_ids() {
        let mut objects = one_object(snack());
        objects.object.push(ObjectDef {
            id: "fridge".into(),
            name: "Another".into(),
            sprite: "fridge_art".into(),
            interaction: vec![],
        });
        let err = compile_objects(full_needs(), objects).unwrap_err();
        assert_eq!(
            err,
            ContentError::DuplicateObjectId {
                id: "fridge".into()
            }
        );
    }

    #[test]
    fn rejects_duplicate_interaction_ids_within_one_object() {
        let mut objects = one_object(snack());
        objects.object[0].interaction.push(snack());
        let err = compile_objects(full_needs(), objects).unwrap_err();
        assert_eq!(
            err,
            ContentError::DuplicateInteractionId {
                object: "fridge".into(),
                id: "grab_snack".into()
            }
        );
    }

    #[test]
    fn allows_the_same_interaction_id_on_different_objects() {
        let mut objects = one_object(snack());
        objects.object.push(ObjectDef {
            id: "vending".into(),
            name: "Vending".into(),
            sprite: "fridge_art".into(),
            interaction: vec![snack()],
        });
        compile_objects(full_needs(), objects).expect("ids are scoped to their object");
    }

    #[test]
    fn rejects_zero_duration() {
        let mut act = snack();
        act.duration_ticks = 0;
        let err = compile_objects(full_needs(), one_object(act)).unwrap_err();
        assert_eq!(
            err,
            ContentError::ZeroDuration {
                object: "fridge".into(),
                interaction: "grab_snack".into()
            }
        );
    }

    #[test]
    fn rejects_zero_slots() {
        let mut act = snack();
        act.slots = 0;
        let err = compile_objects(full_needs(), one_object(act)).unwrap_err();
        assert_eq!(
            err,
            ContentError::ZeroSlots {
                object: "fridge".into(),
                interaction: "grab_snack".into()
            }
        );
    }

    /// `check_finite` guards three call sites - adverts, placement x and
    /// placement y - and `check_number` adds the sign check on top of it
    /// for decay rates. Every one of those is asserted here, because the
    /// realistic mutation is to replace one call with a bespoke test and
    /// silently drop half of what it checked.
    ///
    /// Infinity is asserted alongside `NaN` rather than assumed to follow
    /// from it: `!value.is_finite()` mutated to `value.is_nan()` accepts
    /// infinity, and an infinite advert makes every score on the object
    /// infinite while an infinite coordinate lands outside every lot.
    #[test]
    fn rejects_non_finite_numbers_everywhere_a_number_is_authored() {
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut act = snack();
            act.advertises.insert("hunger".into(), bad);
            assert!(
                matches!(
                    compile_objects(full_needs(), one_object(act)).unwrap_err(),
                    ContentError::NonFiniteValue { .. }
                ),
                "an advert of {bad} must be rejected"
            );

            let mut needs = full_needs();
            needs.need[0].decay_per_tick = bad;
            assert!(
                matches!(
                    compile_objects(needs, one_object(snack())).unwrap_err(),
                    ContentError::NonFiniteValue { .. }
                ),
                "a decay rate of {bad} must be rejected"
            );

            for axis in 0..2 {
                let lot = lot_where(|lot| {
                    if axis == 0 {
                        lot.place[0].x = bad;
                    } else {
                        lot.place[0].y = bad;
                    }
                });
                assert!(
                    matches!(
                        compile(full_needs(), one_object(snack()), lot, test_atlas()).unwrap_err(),
                        ContentError::NonFiniteValue { .. }
                    ),
                    "a placement coordinate of {bad} on axis {axis} must be rejected"
                );
            }
        }
    }

    /// The sign check applies to decay rates and NOT to adverts, and that
    /// asymmetry is the deliberate M1b decision rather than an oversight.
    /// A negative decay rate refills a need on its own, which is a sign
    /// error with no design behind it. A negative advert is a cost - a
    /// shower that drains energy - and scoring weighs it.
    ///
    /// Both halves are asserted, because a mutation that pointed adverts
    /// back at `check_number`, or decay rates at `check_finite`, would
    /// leave one half of this file's coverage green either way.
    #[test]
    fn a_negative_decay_rate_is_rejected_but_a_negative_advert_is_content() {
        let mut needs = full_needs();
        needs.need[0].decay_per_tick = -1.0;
        assert!(matches!(
            compile_objects(needs, one_object(snack())).unwrap_err(),
            ContentError::NegativeValue { .. }
        ));

        let mut act = snack();
        act.advertises.insert("energy".into(), -12.0);
        let pack = compile_objects(full_needs(), one_object(act))
            .expect("a negative advert is a cost, not invalid content");
        assert_eq!(
            pack.objects[0].interactions[0].advertises,
            vec![
                (NeedId::Hunger.index() as u8, 35.0),
                (NeedId::Energy.index() as u8, -12.0),
            ],
            "the negative delta must reach the pack with its sign intact, \
             and on its own need"
        );
    }

    /// Zero sits exactly on `check_number`'s boundary, and the boundary
    /// is a content decision rather than an implementation detail, so it
    /// is pinned rather than left to whichever comparison operator got
    /// typed. Both meanings are legitimate content: a decay rate of zero
    /// is a need that does not decay, and an advert of zero is a need
    /// this interaction names but does nothing for, which the sparse
    /// advert map treats as distinct from not naming it at all.
    ///
    /// Without this, `<` and `<=` are interchangeable in `check_number`
    /// and nothing in the suite moves. `cargo mutants` found exactly
    /// that survivor.
    #[test]
    fn zero_is_a_legal_decay_rate_and_a_legal_advert() {
        let mut needs = full_needs();
        needs.need[0].decay_per_tick = 0.0;
        let mut act = snack();
        act.advertises.insert("energy".into(), 0.0);

        let pack = compile_objects(needs, one_object(act)).expect("zero is in range, not invalid");
        assert_eq!(pack.decay_per_tick[NeedId::Hunger.index()], 0.0);
        assert_eq!(
            pack.objects[0].interactions[0].advertises,
            vec![
                (NeedId::Hunger.index() as u8, 35.0),
                (NeedId::Energy.index() as u8, 0.0),
            ],
            "a zero advert must survive compilation rather than being dropped"
        );
    }

    /// The pack is serialised and hashed downstream, so a
    /// nondeterministic order would surface as a spurious content diff
    /// rather than as an obvious bug.
    ///
    /// The three needs are chosen so that `BTreeMap`'s name ordering is
    /// the exact reverse of the index ordering the pack wants: comfort
    /// (6), energy (1), hunger (0). Deleting the sort therefore produces
    /// `[6, 1, 0]`, and the test cannot pass on an accidental agreement
    /// between the two orders. The precondition is asserted below rather
    /// than assumed, so renumbering `NeedId` fails loudly here instead of
    /// quietly decaying this into a tautology.
    #[test]
    fn advertises_are_sorted_by_need_index() {
        let act = snack_advertising_three_needs();

        // Read the precondition off the fixture itself rather than off a
        // second copy of it, so the two cannot drift apart. These are
        // the indices in the order the source `BTreeMap` hands them
        // over, which is what the pack must NOT keep.
        let name_order: Vec<u8> = act
            .advertises
            .keys()
            .map(|n| NeedId::from_name(n).expect("known need").index() as u8)
            .collect();
        let mut index_order = name_order.clone();
        index_order.sort_unstable();
        assert_ne!(
            name_order, index_order,
            "name order must differ from index order, or this test proves nothing"
        );

        let pack = compile_objects(full_needs(), one_object(act)).expect("valid");
        let advertises = &pack.objects[0].interactions[0].advertises;

        assert_eq!(
            *advertises,
            vec![
                (NeedId::Hunger.index() as u8, 35.0),
                (NeedId::Energy.index() as u8, 3.0),
                (NeedId::Comfort.index() as u8, 5.0),
            ],
            "adverts must be index-ordered, with each delta still on its own need"
        );

        let indices: Vec<u8> = advertises.iter().map(|(i, _)| *i).collect();
        assert_eq!(indices, index_order);
        assert_eq!(indices.len(), 3);
    }

    /// Every other test in this module gives all seven needs the same
    /// decay rate, so writing every rate into one slot, or into the
    /// wrong slot, would leave them all green. Declaring the needs in
    /// reverse order additionally pins that the slot comes from the
    /// need's name and not from its position in the file.
    #[test]
    fn decay_rates_land_at_their_own_need_index() {
        let pack = compile_objects(distinct_needs(), one_object(snack())).expect("valid");

        for id in NeedId::ALL {
            assert_eq!(
                pack.decay_per_tick[id.index()],
                distinct_decay(id),
                "{}'s decay landed in the wrong slot",
                id.as_str()
            );
        }
    }

    /// The byte-level determinism anchor for the whole pipeline.
    ///
    /// Task 3 could only pin that one `BTreeMap` iterates sorted, and
    /// only probabilistically, because nothing serialised anything yet.
    /// This pins the artefact Task 5's `build.rs` actually writes and
    /// the runtime actually reads, deterministically: advert order,
    /// decay slot order, field order and the postcard encoding all show
    /// up in these bytes, so an ordering regression anywhere in the
    /// pipeline moves them.
    ///
    /// The fixture is chosen so the bytes are sensitive rather than
    /// decorative: seven distinct decay rates declared in reverse, three
    /// adverts whose name order reverses their index order, and a
    /// non-square lot whose two walls are declared out of sorted order.
    ///
    /// If this fails, ask which of two things happened. A deliberate
    /// change to the pack format needs the vector regenerated and every
    /// previously written pack rebuilt. Anything else is a determinism
    /// regression, and the vector is doing its job.
    #[test]
    fn a_compiled_pack_serialises_to_a_stable_golden_vector() {
        let pack = compile(
            distinct_needs(),
            one_object(snack_advertising_three_needs()),
            distinct_lot(),
            test_atlas(),
        )
        .expect("valid");
        let bytes = postcard::to_allocvec(&pack).expect("pack must serialise");
        assert!(
            !GOLDEN_PACK_BYTES.is_empty(),
            "an emptied vector would assert nothing"
        );
        assert_eq!(bytes, GOLDEN_PACK_BYTES);
    }

    // ---- The lot -------------------------------------------------------
    //
    // Per [L26], enumerating the error variants is coverage of half the
    // surface. `compiles_a_lot_into_the_pack` and
    // `placements_resolve_to_the_declared_object_index` are the other
    // half: what the validator BUILDS out of content it accepts.

    /// The accepting half. Every field of the compiled lot is read back,
    /// against a fixture where no two of them are interchangeable: the
    /// lot is non-square, the walls are declared out of sorted order, and
    /// the placement's coordinates are fractional and unequal.
    #[test]
    fn compiles_a_lot_into_the_pack() {
        let pack = compile(
            full_needs(),
            one_object(snack()),
            distinct_lot(),
            test_atlas(),
        )
        .expect("valid");
        let lot = &pack.lot;

        assert_eq!((lot.width, lot.height), (5, 3));
        assert_eq!(
            lot.walls,
            vec![(3, 2), (1, 0)],
            "walls must keep declaration order; sorting them would be a \
             mechanism with nothing to disambiguate"
        );
        assert_eq!(lot.placements.len(), 1);
        assert_eq!(lot.placements[0].object, ObjectDefId(0));
        assert_eq!((lot.placements[0].x, lot.placements[0].y), (2.5, 1.25));
    }

    /// A placement's object id is an index into the pack, and one object
    /// cannot tell a resolved index from a hardcoded zero. Three objects
    /// placed in an order that is not their declaration order make both
    /// `position(...)` collapsing to 0 and the list being reordered
    /// visible. This is [L29] in the lot's costume.
    #[test]
    fn placements_resolve_to_the_declared_object_index() {
        let lot = LotFile {
            width: 4,
            height: 4,
            wall: Vec::new(),
            place: ["sink", "fridge", "bed"]
                .iter()
                .enumerate()
                .map(|(i, id)| PlacementDef {
                    object: (*id).to_string(),
                    x: i as f32,
                    y: 3.0,
                })
                .collect(),
        };

        let pack = compile(full_needs(), three_objects(), lot, test_atlas()).expect("valid");
        assert_eq!(
            pack.objects.len(),
            3,
            "the resolver needs something to find"
        );

        // sink is declared third, fridge first, bed second; the placement
        // order deliberately matches none of that.
        let resolved: Vec<u32> = pack.lot.placements.iter().map(|p| p.object.0).collect();
        assert_eq!(resolved, vec![2, 0, 1]);
        for placement in &pack.lot.placements {
            // Stated through the pack's own lookup as well, so the
            // numbers above cannot both be wrong in the same direction.
            assert_eq!(
                pack.object(placement.object).id,
                match placement.object.0 {
                    0 => "fridge",
                    1 => "bed",
                    _ => "sink",
                }
            );
        }
    }

    /// Zero in either dimension. Both are asserted because
    /// `lot.width == 0 || lot.height == 0` mutated to `&&` still rejects
    /// a 0x0 lot, so testing only that would leave the mutant alive.
    #[test]
    fn rejects_a_lot_with_a_zero_dimension() {
        for (width, height) in [(0, 3), (5, 0), (0, 0)] {
            let lot = lot_where(|lot| {
                lot.width = width;
                lot.height = height;
                // A zero-sized lot can hold neither, and this test is
                // about the size rather than about what is on it.
                lot.wall.clear();
                lot.place.clear();
            });
            assert_eq!(
                compile(full_needs(), one_object(snack()), lot, test_atlas()).unwrap_err(),
                ContentError::EmptyLot { width, height },
                "a {width}x{height} lot has no walkable tile"
            );
        }
    }

    /// Walls, on all four sides of the lot.
    ///
    /// The negative cases are the ones that matter most: the coordinate
    /// type is `i32`, so `wall.x as u32` would wrap -1 to 4294967295 and
    /// happen to reject it, and would accept it again the day the bound
    /// moved. `u32::try_from` is what makes the lower bound real, and a
    /// negative on ONE axis with a valid value on the other is what
    /// stops the two checks from being collapsed into one.
    #[test]
    fn rejects_a_wall_outside_the_lot() {
        // distinct_lot is 5 wide and 3 tall, so 5 and 3 are the first
        // out-of-range values on their own axes - the off-by-one a `<=`
        // would let through.
        for (x, y) in [(5, 1), (1, 3), (-1, 1), (1, -1), (-1, -1)] {
            let lot = lot_where(|lot| lot.wall = vec![WallDef { x, y }]);
            assert_eq!(
                compile(full_needs(), one_object(snack()), lot, test_atlas()).unwrap_err(),
                ContentError::WallOutOfBounds {
                    x,
                    y,
                    width: 5,
                    height: 3
                },
                "a wall at ({x}, {y}) is outside a 5x3 lot"
            );
        }

        // The boundary from the other side, so the test cannot pass by
        // rejecting everything. (4, 2) is the far corner of a 5x3 lot.
        let lot = lot_where(|lot| lot.wall = vec![WallDef { x: 4, y: 2 }]);
        let pack = compile(full_needs(), one_object(snack()), lot, test_atlas())
            .expect("(4, 2) is the far corner of a 5x3 lot, not outside it");
        assert_eq!(pack.lot.walls, vec![(4, 2)]);
    }

    /// Placements, on all four sides.
    ///
    /// Coordinates are `f32`, so the boundary is `x < width` rather than
    /// `x <= width - 1`: `4.999` is inside a 5-wide lot and `5.0` is
    /// not. Both are asserted, because a bound written with `>` instead
    /// of `>=` differs on exactly `5.0` and on nothing else.
    #[test]
    fn rejects_a_placement_outside_the_lot() {
        for (x, y) in [(5.0, 1.0), (2.0, 3.0), (-0.5, 1.0), (2.0, -0.5)] {
            let lot = lot_where(|lot| {
                lot.place[0].x = x;
                lot.place[0].y = y;
            });
            assert_eq!(
                compile(full_needs(), one_object(snack()), lot, test_atlas()).unwrap_err(),
                ContentError::PlacementOutOfBounds {
                    object: "fridge".into(),
                    x,
                    y,
                    width: 5,
                    height: 3
                },
                "({x}, {y}) is outside a 5x3 lot"
            );
        }

        let lot = lot_where(|lot| {
            lot.place[0].x = 4.999;
            lot.place[0].y = 0.0;
            // (4, 0) must not be a wall, or this would fail for the
            // other reason and prove nothing about the bound.
            lot.wall.clear();
        });
        let pack = compile(full_needs(), one_object(snack()), lot, test_atlas())
            .expect("4.999 is inside a 5-wide lot; only 5.0 is not");
        assert_eq!(pack.lot.placements[0].x, 4.999);
    }

    /// An object standing inside a wall would be unreachable: scoring
    /// would keep advertising it and `find_path` would return `None`
    /// every tick, so the sim looks alive and simply never goes there.
    /// Exactly the silent failure [D9] exists to turn into a build error.
    #[test]
    fn rejects_a_placement_on_a_wall_tile() {
        // distinct_lot walls (3, 2) and (1, 0). The placement is on
        // FRACTIONAL coordinates inside the second of those, so the test
        // also pins that the tile is the floor of the coordinates rather
        // than the coordinates themselves.
        let lot = lot_where(|lot| {
            lot.place[0].x = 3.75;
            lot.place[0].y = 2.5;
        });
        assert_eq!(
            compile(full_needs(), one_object(snack()), lot, test_atlas()).unwrap_err(),
            ContentError::PlacementOnWall {
                object: "fridge".into(),
                x: 3,
                y: 2
            }
        );

        // The transpose is not a wall, so the check cannot be comparing
        // one coordinate or comparing them the wrong way round.
        let lot = lot_where(|lot| {
            lot.place[0].x = 2.5;
            lot.place[0].y = 0.5;
        });
        compile(full_needs(), one_object(snack()), lot, test_atlas())
            .expect("(2, 0) is not a wall; (3, 2) and (1, 0) are");
    }

    /// The dangling-reference check, and the reason this pipeline exists
    /// ([D9]). A lot naming an object that `objects.toml` does not
    /// declare must not compile, because after compilation a placement is
    /// an index and a bad index has no representation at all.
    #[test]
    fn rejects_a_placement_naming_an_object_that_does_not_exist() {
        let lot = lot_where(|lot| lot.place[0].object = "hovercraft".into());
        assert_eq!(
            compile(full_needs(), one_object(snack()), lot, test_atlas()).unwrap_err(),
            ContentError::UnknownPlacedObject {
                object: "hovercraft".into()
            }
        );

        // The same name against a pack that DOES declare it compiles, so
        // the rejection is about the reference rather than about the
        // rule firing unconditionally.
        let lot = lot_where(|lot| lot.place[0].object = "sink".into());
        let pack =
            compile(full_needs(), three_objects(), lot, test_atlas()).expect("'sink' is declared");
        assert_eq!(pack.lot.placements[0].object, ObjectDefId(2));
    }

    /// These strings are read by whoever just broke the build, usually
    /// from a TOML edit rather than a Rust one, and nothing else asserts
    /// them. A message that lost its context - or that names the wrong
    /// interaction because a `format!` argument was swapped - is
    /// invisible until the worst possible moment.
    #[test]
    fn error_messages_name_the_offending_content() {
        let mut act = snack();
        act.advertises.insert("vibes".into(), 1.0);
        assert_eq!(
            compile_objects(full_needs(), one_object(act))
                .unwrap_err()
                .to_string(),
            "object 'fridge' interaction 'grab_snack' advertises unknown need 'vibes'"
        );

        let mut act = snack();
        act.advertises.insert("hunger".into(), f32::NAN);
        assert_eq!(
            compile_objects(full_needs(), one_object(act))
                .unwrap_err()
                .to_string(),
            "advert 'hunger' on 'grab_snack' is not a finite number"
        );

        let mut needs = full_needs();
        needs.need.retain(|n| n.id != "comfort");
        assert_eq!(
            compile_objects(needs, one_object(snack()))
                .unwrap_err()
                .to_string(),
            "needs.toml is missing a decay rate for 'comfort'"
        );

        let mut needs = full_needs();
        needs.need[0].decay_per_tick = -1.0;
        assert_eq!(
            compile_objects(needs, one_object(snack()))
                .unwrap_err()
                .to_string(),
            "decay_per_tick for 'hunger' is negative"
        );

        let mut objects = one_object(snack());
        objects.object[0].sprite = "hovercraft_art".into();
        assert_eq!(
            compile_objects(full_needs(), objects)
                .unwrap_err()
                .to_string(),
            "object 'fridge' names sprite 'hovercraft_art', which atlas.toml does not hold"
        );
    }

    /// The lot half of the message test above, kept separate only
    /// because it is a different file the author has to go and edit.
    ///
    /// Each message has to be readable by somebody who has just broken
    /// the build from a TOML edit, so each names the offending object or
    /// coordinate AND the lot it is being judged against - "outside the
    /// lot" without the size is not actionable.
    #[test]
    fn lot_error_messages_name_the_offending_placement() {
        let cases: Vec<(LotFile, &str)> = vec![
            (
                lot_where(|lot| {
                    lot.width = 0;
                    lot.wall.clear();
                    lot.place.clear();
                }),
                "lot.toml declares a 0x3 lot; both dimensions must be at least 1",
            ),
            (
                lot_where(|lot| lot.wall = vec![WallDef { x: -1, y: 7 }]),
                "lot.toml has a wall at (-1, 7), outside the 5x3 lot",
            ),
            (
                lot_where(|lot| lot.place[0].x = 9.5),
                "lot.toml places 'fridge' at (9.5, 1.25), outside the 5x3 lot",
            ),
            (
                lot_where(|lot| {
                    lot.place[0].x = 1.5;
                    lot.place[0].y = 0.5;
                }),
                "lot.toml places 'fridge' on the wall tile (1, 0)",
            ),
            (
                lot_where(|lot| lot.place[0].object = "hovercraft".into()),
                "lot.toml places 'hovercraft', which objects.toml does not declare",
            ),
        ];

        for (lot, expected) in cases {
            assert_eq!(
                compile(full_needs(), one_object(snack()), lot, test_atlas())
                    .unwrap_err()
                    .to_string(),
                expected
            );
        }
    }
}
