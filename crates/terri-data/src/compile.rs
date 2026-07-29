//! Validation, and the compilation of validated content into a pack.
//!
//! Every failure mode in this module is a build failure by design. The
//! checks live here rather than in the schema because serde can express
//! shape but not meaning: "this need name is one rustc knows about" and
//! "every `NeedId` appears exactly once" are not shapes.

use crate::error::ContentError;
use crate::pack::{
    CompiledInteraction, CompiledLot, CompiledObject, CompiledPlacement, ContentPack, ObjectDefId,
    Tuning,
};
use crate::schema::{AtlasFile, LotFile, NeedsFile, ObjectsFile, TuningFile};
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
    tuning: TuningFile,
) -> Result<ContentPack, ContentError> {
    let sprite_index = |name: &str| atlas.sprite.iter().position(|s| s.name == name);
    let sim_sprite = sprite_index(SIM_SPRITE).ok_or_else(|| ContentError::MissingSimSprite {
        sprite: SIM_SPRITE.to_string(),
    })? as u32;

    // Two files, two rules, in that order. `needs.toml` says which needs
    // EXIST; `tuning.toml`'s `[decay_per_tick]` says how fast the
    // simulation drains them. Declaration is checked first so that a
    // typo'd need name is reported against the file that named it rather
    // than as a missing rate for something nobody declared.
    //
    // A fixed-size array rather than a set: `NeedId` is `Eq + Hash` but
    // not `Ord`, and the need space is closed and small, so indexing it
    // directly needs no allocation and no ordering it does not have.
    let mut declared = [false; NEED_COUNT];

    for def in &needs.need {
        let Some(id) = NeedId::from_name(&def.id) else {
            return Err(ContentError::UnknownDeclaredNeed {
                need: def.id.clone(),
            });
        };
        if declared[id.index()] {
            return Err(ContentError::DuplicateDeclaredNeed {
                need: def.id.clone(),
            });
        }
        declared[id.index()] = true;
    }

    for id in NeedId::ALL {
        if !declared[id.index()] {
            return Err(ContentError::MissingDeclaredNeed {
                need: id.as_str().to_string(),
            });
        }
    }

    let mut decay = [f32::NAN; NEED_COUNT];
    let mut rated = [false; NEED_COUNT];

    for (need_name, rate) in &tuning.decay_per_tick {
        let Some(id) = NeedId::from_name(need_name) else {
            return Err(ContentError::UnknownNeedDecay {
                need: need_name.clone(),
            });
        };
        // No duplicate check: the table is a `BTreeMap`, so a repeated
        // key is a TOML parse error long before this runs.
        rated[id.index()] = true;
        check_number(*rate, &format!("decay_per_tick for '{need_name}'"))?;
        decay[id.index()] = *rate;
    }

    // Without this loop a need omitted from the table keeps the `NaN`
    // seeded above, and a `NaN` decay rate poisons that need's level on
    // the first tick with nothing pointing back at the content.
    for id in NeedId::ALL {
        if !rated[id.index()] {
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
    let tuning = compile_tuning(tuning)?;

    Ok(ContentPack {
        decay_per_tick: decay,
        objects: compiled,
        sim_sprite,
        lot,
        tuning,
    })
}

/// Validates the system knobs from `content/tuning.toml`.
///
/// Presence is serde's job - `TuningFile` defaults nothing, so a missing
/// knob is a parse error naming the field before this is reached. What
/// is left is the meaning: a value can be present, well-typed, and still
/// describe a simulation that divides by zero or contradicts itself.
///
/// Every rule here exists because breaking it fails **quietly**, which
/// is what [D9] converts into a build failure. A zero temperature makes
/// every selection weight `NaN`, and `NaN` loses every comparison, so a
/// sim would simply stop choosing anything with no panic and no log.
fn compile_tuning(tuning: TuningFile) -> Result<Tuning, ContentError> {
    // Finiteness first, for the same reason placement coordinates are
    // checked before their bounds: every comparison against NaN is
    // false, so `NaN <= 0.0` would let a NaN temperature through the
    // range check below and into the arithmetic it exists to protect.
    // Checking it first is also what makes the range errors' `f32`
    // payloads safe to compare with a derived `PartialEq`.
    check_finite(tuning.action_threshold, "action_threshold in tuning.toml")?;
    check_finite(
        tuning.choice_temperature,
        "choice_temperature in tuning.toml",
    )?;
    check_finite(tuning.idle_threshold, "idle_threshold in tuning.toml")?;
    check_finite(tuning.duration_variance, "duration_variance in tuning.toml")?;

    if tuning.choice_temperature <= 0.0 {
        return Err(ContentError::NonPositiveTemperature {
            value: tuning.choice_temperature,
        });
    }
    if tuning.min_interaction_ticks == 0 {
        return Err(ContentError::ZeroInteractionFloor);
    }
    if tuning.wander_attempts == 0 {
        return Err(ContentError::ZeroWanderAttempts);
    }
    if tuning.max_queued_intents == 0 {
        return Err(ContentError::ZeroQueuedIntents);
    }
    if !(0.0..1.0).contains(&tuning.duration_variance) {
        return Err(ContentError::DurationVarianceOutOfRange {
            value: tuning.duration_variance,
        });
    }
    if tuning.idle_threshold > tuning.action_threshold {
        return Err(ContentError::IdleThresholdAboveAction {
            idle: tuning.idle_threshold,
            action: tuning.action_threshold,
        });
    }

    Ok(Tuning {
        action_threshold: tuning.action_threshold,
        choice_temperature: tuning.choice_temperature,
        idle_threshold: tuning.idle_threshold,
        wander_pause_ticks: tuning.wander_pause_ticks,
        wander_attempts: tuning.wander_attempts,
        duration_variance: tuning.duration_variance,
        min_interaction_ticks: tuning.min_interaction_ticks,
        rng_seed: tuning.rng_seed,
        max_queued_intents: tuning.max_queued_intents,
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
    ///
    /// The tuning block was APPENDED when `content/tuning.toml` arrived,
    /// deliberately: `ContentPack` grew a field at the end, so every
    /// earlier block above kept its offset and stayed reviewable against
    /// the annotations it already had.
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
        // tuning: four LE f32 and five varints, in `Tuning`'s field
        // order. Every value differs, so a field encoded into the wrong
        // slot moves these bytes.
        0x00, 0x00, 0x80, 0x3E, // action_threshold      0.25
        0x00, 0x00, 0x00, 0x3F, // choice_temperature    0.5
        0x00, 0x00, 0x00, 0x3E, // idle_threshold        0.125
        0x09,                   // wander_pause_ticks    9
        0x06,                   // wander_attempts       6
        0x00, 0x00, 0x40, 0x3F, // duration_variance     0.75
        0x03,                   // min_interaction_ticks 3
        0xAC, 0x02,             // rng_seed              300, a two-byte
                                // varint, so the u64 is not silently a
                                // single byte like the two u32s above
        0x07,                   // max_queued_intents    7, APPENDED at
                                // M1b Task 5 so every block above kept
                                // its offset and its annotation
    ];

    /// The object tests are about objects, so they compile against a lot
    /// with room for nothing in it. The lot tests below build their own.
    fn compile_objects(
        needs: NeedsFile,
        objects: ObjectsFile,
    ) -> Result<ContentPack, ContentError> {
        compile_all(needs, objects, full_tuning())
    }

    /// The three-way version, for the two tests that have to vary the
    /// needs file and the tuning file in the same compilation.
    fn compile_all(
        needs: NeedsFile,
        objects: ObjectsFile,
        tuning: TuningFile,
    ) -> Result<ContentPack, ContentError> {
        compile(needs, objects, bare_lot(), test_atlas(), tuning)
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

    /// Valid tuning, with every knob a different value.
    ///
    /// Shared values would let a field written into the wrong slot pass
    /// unnoticed, which is [L29] in the tuning file's costume, and the
    /// golden vector below reads these bytes directly. The floats are
    /// all exact in binary32 so the assertions can be equalities.
    ///
    /// `idle_threshold` is deliberately BELOW `action_threshold` rather
    /// than equal to it, so `rejects_an_idle_threshold_above_the_action_threshold`
    /// has somewhere to move it to on either side of the boundary.
    ///
    /// The decay table is the exception: it is UNIFORM here, so a compile
    /// step that wrote every rate into one slot would pass. That is what
    /// `distinct_tuning` below exists for, and keeping the two apart is
    /// what lets every other test in this module ignore decay entirely.
    fn full_tuning() -> TuningFile {
        TuningFile {
            action_threshold: 0.25,
            choice_temperature: 0.5,
            idle_threshold: 0.125,
            wander_pause_ticks: 9,
            wander_attempts: 6,
            duration_variance: 0.75,
            min_interaction_ticks: 3,
            rng_seed: 300,
            max_queued_intents: 7,
            decay_per_tick: NeedId::ALL
                .iter()
                .map(|id| (id.as_str().to_string(), 0.1))
                .collect(),
        }
    }

    /// `full_tuning` with every need on its own decay rate.
    fn distinct_tuning() -> TuningFile {
        tuning_where(|t| {
            t.decay_per_tick = NeedId::ALL
                .iter()
                .map(|id| (id.as_str().to_string(), distinct_decay(*id)))
                .collect();
        })
    }

    /// `full_tuning` with `mutate` applied, for the rejection tests.
    fn tuning_where(mutate: impl FnOnce(&mut TuningFile)) -> TuningFile {
        let mut tuning = full_tuning();
        mutate(&mut tuning);
        tuning
    }

    /// Compiles otherwise-valid content against the given tuning, so the
    /// tests below vary one knob and nothing else.
    fn compile_tuned(tuning: TuningFile) -> Result<ContentPack, ContentError> {
        compile(
            full_needs(),
            one_object(snack()),
            bare_lot(),
            test_atlas(),
            tuning,
        )
    }

    /// Every need declared, and nothing else: `needs.toml` says which
    /// needs exist, and `tuning.toml` says how fast they drain.
    ///
    /// Declared in REVERSE `NeedId` order, so a compile step that
    /// confused a need's position in this file with its index would be
    /// visible. The rates cannot be confused that way at all any more,
    /// because they arrive keyed by name.
    fn full_needs() -> NeedsFile {
        NeedsFile {
            need: NeedId::ALL
                .iter()
                .rev()
                .map(|id| NeedDef {
                    id: id.as_str().to_string(),
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
            compile(
                full_needs(),
                one_object(snack()),
                bare_lot(),
                atlas,
                full_tuning()
            )
            .unwrap_err(),
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

    /// Which needs exist and how fast they drain are now two rules over
    /// two files, and the four tests below are one per way each can be
    /// wrong. They are separate tests rather than one, because the whole
    /// point of splitting the files is that a rate missing from
    /// `tuning.toml` and a need missing from `needs.toml` are different
    /// mistakes with different fixes, and a shared assertion could not
    /// tell an author which one they made.
    ///
    /// There is deliberately no duplicate-rate case: the decay table is a
    /// map, so a repeated key is a TOML parse error before `compile` is
    /// reached.
    #[test]
    fn rejects_a_declared_need_with_no_decay_rate() {
        let tuning = tuning_where(|t| {
            t.decay_per_tick.remove("comfort");
        });
        let err = compile_tuned(tuning).unwrap_err();
        assert_eq!(
            err,
            ContentError::MissingNeedDecay {
                need: "comfort".into()
            }
        );
    }

    #[test]
    fn rejects_a_decay_rate_for_a_need_rustc_does_not_know() {
        let tuning = tuning_where(|t| {
            t.decay_per_tick.insert("vibes".into(), 0.1);
        });
        let err = compile_tuned(tuning).unwrap_err();
        assert_eq!(
            err,
            ContentError::UnknownNeedDecay {
                need: "vibes".into()
            }
        );
    }

    #[test]
    fn rejects_an_unknown_declared_need() {
        let mut needs = full_needs();
        needs.need.push(NeedDef { id: "vibes".into() });
        let err = compile_objects(needs, one_object(snack())).unwrap_err();
        assert_eq!(
            err,
            ContentError::UnknownDeclaredNeed {
                need: "vibes".into()
            }
        );
    }

    #[test]
    fn rejects_a_duplicate_declared_need() {
        let mut needs = full_needs();
        needs.need.push(NeedDef {
            id: "hunger".into(),
        });
        let err = compile_objects(needs, one_object(snack())).unwrap_err();
        assert_eq!(
            err,
            ContentError::DuplicateDeclaredNeed {
                need: "hunger".into()
            }
        );
    }

    /// A `NeedId` variant `needs.toml` does not declare at all.
    ///
    /// The tuning table still carries its rate, so this is genuinely the
    /// declaration rule firing rather than the rate rule: without the
    /// completeness check on `needs.toml` the compilation would succeed
    /// and the need would exist in Rust while being invisible in content.
    #[test]
    fn rejects_a_need_variant_that_content_does_not_declare() {
        let mut needs = full_needs();
        needs.need.retain(|n| n.id != "comfort");
        assert!(
            full_tuning().decay_per_tick.contains_key("comfort"),
            "the tuning table must still rate comfort, or this test cannot \
             tell the declaration rule from the rate rule"
        );
        let err = compile_objects(needs, one_object(snack())).unwrap_err();
        assert_eq!(
            err,
            ContentError::MissingDeclaredNeed {
                need: "comfort".into()
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

            let tuning = tuning_where(|t| {
                t.decay_per_tick.insert("hunger".into(), bad);
            });
            assert!(
                matches!(
                    compile_tuned(tuning).unwrap_err(),
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
                        compile(
                            full_needs(),
                            one_object(snack()),
                            lot,
                            test_atlas(),
                            full_tuning()
                        )
                        .unwrap_err(),
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
        let tuning = tuning_where(|t| {
            t.decay_per_tick.insert("hunger".into(), -1.0);
        });
        assert!(matches!(
            compile_tuned(tuning).unwrap_err(),
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
        let tuning = tuning_where(|t| {
            t.decay_per_tick.insert("hunger".into(), 0.0);
        });
        let mut act = snack();
        act.advertises.insert("energy".into(), 0.0);

        let pack = compile_all(full_needs(), one_object(act), tuning)
            .expect("zero is in range, not invalid");
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
    /// wrong slot, would leave them all green.
    ///
    /// The table's iteration order pins the slot mapping for free now
    /// that the rates are keyed by name: a `BTreeMap` hands them over
    /// alphabetically - bladder, comfort, energy, fun, hunger, hygiene,
    /// social, which is indices 3, 6, 1, 5, 0, 2, 4 - so writing them out
    /// in arrival order would produce a completely different array. The
    /// precondition below states that rather than leaving it to the
    /// reader, so renumbering `NeedId` fails loudly here instead of
    /// quietly decaying this into a tautology.
    #[test]
    fn decay_rates_land_at_their_own_need_index() {
        let tuning = distinct_tuning();
        let arrival: Vec<usize> = tuning
            .decay_per_tick
            .keys()
            .map(|name| NeedId::from_name(name).expect("known need").index())
            .collect();
        let mut sorted = arrival.clone();
        sorted.sort_unstable();
        assert_ne!(
            arrival, sorted,
            "the table's name order must differ from index order, or this \
             test cannot see a rate written into the slot it arrived in"
        );

        let pack = compile_tuned(tuning).expect("valid");

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
    /// decorative: seven distinct decay rates whose alphabetical arrival
    /// order is nothing like the index order they are stored in, three
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
            full_needs(),
            one_object(snack_advertising_three_needs()),
            distinct_lot(),
            test_atlas(),
            distinct_tuning(),
        )
        .expect("valid");
        let bytes = postcard::to_allocvec(&pack).expect("pack must serialise");
        assert!(
            !GOLDEN_PACK_BYTES.is_empty(),
            "an emptied vector would assert nothing"
        );
        assert_eq!(bytes, GOLDEN_PACK_BYTES);
    }

    // ---- Tuning --------------------------------------------------------
    //
    // Presence is serde's rule and lives in `schema.rs`; these are the
    // rules about MEANING, each of which a well-typed file can break.
    // Per [L26] the rejection tests are half the surface, so
    // `compiles_tuning_into_the_pack` states what the validator builds
    // and every rejection below is paired with the value on the other
    // side of its boundary.

    /// The accepting half. Every knob is read back, against a fixture
    /// where no two of them are interchangeable, so a field written into
    /// a neighbouring slot is visible.
    #[test]
    fn compiles_tuning_into_the_pack() {
        let tuning = compile_tuned(full_tuning()).expect("valid").tuning;

        assert_eq!(tuning.action_threshold, 0.25);
        assert_eq!(tuning.choice_temperature, 0.5);
        assert_eq!(tuning.idle_threshold, 0.125);
        assert_eq!(tuning.wander_pause_ticks, 9);
        assert_eq!(tuning.duration_variance, 0.75);
        assert_eq!(tuning.min_interaction_ticks, 3);
        assert_eq!(tuning.rng_seed, 300);
        assert_eq!(tuning.max_queued_intents, 7);
    }

    /// Weighted selection divides by the temperature, so zero is a
    /// division by zero whose result is `NaN`, and `NaN` loses every
    /// comparison: a sim would stop choosing anything at all, forever,
    /// with no panic and no log. A negative temperature is worse than
    /// meaningless - it inverts the softmax, so the least urgent option
    /// becomes the most likely.
    ///
    /// Zero is the case that pins `<=` rather than `<`, and the smallest
    /// positive float is the other side of that boundary.
    #[test]
    fn rejects_a_non_positive_choice_temperature() {
        for bad in [0.0, -0.5, -f32::MIN_POSITIVE] {
            assert_eq!(
                compile_tuned(tuning_where(|t| t.choice_temperature = bad)).unwrap_err(),
                ContentError::NonPositiveTemperature { value: bad },
                "a choice_temperature of {bad} divides selection by zero or inverts it"
            );
        }

        let pack = compile_tuned(tuning_where(|t| t.choice_temperature = f32::MIN_POSITIVE))
            .expect("any positive temperature is legal, however small");
        assert_eq!(pack.tuning.choice_temperature, f32::MIN_POSITIVE);
    }

    /// A floor of zero ticks is an interaction that can finish on the
    /// tick it starts. Nothing downstream divides by it, so it fails by
    /// looking wrong rather than by crashing, which is exactly the shape
    /// [D9] exists to catch at build time.
    ///
    /// One tick is asserted as legal on the other side of the boundary,
    /// so the rule cannot be "at least 2" and pass this test.
    #[test]
    fn rejects_a_zero_interaction_floor() {
        assert_eq!(
            compile_tuned(tuning_where(|t| t.min_interaction_ticks = 0)).unwrap_err(),
            ContentError::ZeroInteractionFloor
        );

        let pack = compile_tuned(tuning_where(|t| t.min_interaction_ticks = 1))
            .expect("one tick is a legal floor, if a short one");
        assert_eq!(pack.tuning.min_interaction_ticks, 1);
    }

    /// Zero wander attempts does not mean "wander less". A wander
    /// destination is drawn and then pathed to, and the attempt count is
    /// how many draws a sim gets, so zero means the loop never runs and
    /// the sim never wanders at all - the standing-still behaviour [D-5]
    /// exists to remove, back again and looking exactly like a feature
    /// that was never built.
    ///
    /// One attempt is asserted legal on the other side of the boundary,
    /// so the rule cannot be "at least 2" and pass this test.
    #[test]
    fn rejects_zero_wander_attempts() {
        assert_eq!(
            compile_tuned(tuning_where(|t| t.wander_attempts = 0)).unwrap_err(),
            ContentError::ZeroWanderAttempts
        );

        let pack = compile_tuned(tuning_where(|t| t.wander_attempts = 1))
            .expect("a single attempt is legal, if a stubborn sim it is not");
        assert_eq!(pack.tuning.wander_attempts, 1);
    }

    /// A queue cap of zero is not "no queueing"; `drain_commands` refuses
    /// any intent that would take the queue past this, so at zero every
    /// `UseObject` command is refused and directing a sim silently does
    /// nothing. The game would run and the sim would behave; only the
    /// player's clicks would stop mattering, which is the shape [D9]
    /// exists to convert into a build failure rather than a puzzled hour.
    ///
    /// One is asserted legal on the other side of the boundary, so the
    /// rule cannot be "at least 2" and pass this test.
    #[test]
    fn rejects_zero_max_queued_intents() {
        assert_eq!(
            compile_tuned(tuning_where(|t| t.max_queued_intents = 0)).unwrap_err(),
            ContentError::ZeroQueuedIntents
        );

        let pack = compile_tuned(tuning_where(|t| t.max_queued_intents = 1))
            .expect("a single queued intent is legal, if an impatient sim it is not");
        assert_eq!(pack.tuning.max_queued_intents, 1);
    }

    /// Variance is a FRACTION either side of an interaction's authored
    /// duration. At 1.0 the lower bound reaches zero, so the floor
    /// rather than the content would decide every duration; above 1.0
    /// the lower bound is negative. Zero is legal and means "use the
    /// authored duration exactly".
    ///
    /// Both ends are asserted from both sides. `0.0` is the case that
    /// makes the lower bound INCLUSIVE and `1.0` the case that makes the
    /// upper bound EXCLUSIVE; without them `(0.0..1.0)`, `(0.0..=1.0)`
    /// and an exclusive lower bound are interchangeable.
    #[test]
    fn rejects_a_duration_variance_outside_zero_to_one() {
        for bad in [-f32::MIN_POSITIVE, -0.5, 1.0, 1.5] {
            assert_eq!(
                compile_tuned(tuning_where(|t| t.duration_variance = bad)).unwrap_err(),
                ContentError::DurationVarianceOutOfRange { value: bad },
                "a duration_variance of {bad} is outside [0, 1)"
            );
        }

        for good in [0.0, 0.9999999] {
            let pack = compile_tuned(tuning_where(|t| t.duration_variance = good))
                .unwrap_or_else(|e| panic!("{good} is inside [0, 1); got {e}"));
            assert_eq!(pack.tuning.duration_variance, good);
        }
    }

    /// An idle threshold above the action threshold means a sim wanders
    /// off while something is worth doing. The two knobs answer "is
    /// anything worth doing" and "is nothing worth doing enough that I
    /// should mill about", and in that order the second contradicts the
    /// first - so it is incoherent rather than merely aggressive tuning,
    /// and the simulation that results looks like a pathfinding bug
    /// rather than like a tuning mistake.
    ///
    /// Equal is LEGAL, and that is the case that pins `>` rather than
    /// `>=`. The rejected case is the next representable float above it,
    /// so the rule cannot be a comparison with slack in it and still
    /// pass.
    #[test]
    fn rejects_an_idle_threshold_above_the_action_threshold() {
        const ACTION: f32 = 0.25;
        let just_above = f32::from_bits(ACTION.to_bits() + 1);
        assert!(
            just_above > ACTION,
            "the fixture must actually straddle the boundary; got {just_above}"
        );

        for bad in [just_above, 0.5] {
            assert_eq!(
                compile_tuned(tuning_where(|t| {
                    t.action_threshold = ACTION;
                    t.idle_threshold = bad;
                }))
                .unwrap_err(),
                ContentError::IdleThresholdAboveAction {
                    idle: bad,
                    action: ACTION
                },
                "an idle threshold of {bad} sits above an action threshold of {ACTION}"
            );
        }

        let pack = compile_tuned(tuning_where(|t| {
            t.action_threshold = ACTION;
            t.idle_threshold = ACTION;
        }))
        .expect("equal thresholds are coherent: nothing worth doing is also nothing to idle over");
        assert_eq!(pack.tuning.idle_threshold, ACTION);
    }

    /// Every authored float in the tuning file, against every non-finite
    /// value.
    ///
    /// All four are asserted rather than one, because the realistic
    /// mutation is to drop a single `check_finite` call, and a
    /// three-quarters-covered guard is indistinguishable from a whole
    /// one to a test that checks a single field.
    ///
    /// The variant matters as much as the rejection. `NaN` would be
    /// caught by the range rules too - every comparison against it is
    /// false, so `NaN <= 0.0` is false but `!(0.0..1.0).contains(&NaN)`
    /// is true - and being caught there would report the wrong error and
    /// would leave `action_threshold`, which has no range rule, with no
    /// guard at all. Asserting `NonFiniteValue` specifically is what
    /// pins the finiteness check running FIRST.
    #[test]
    fn rejects_a_non_finite_tuning_value() {
        type Setter = fn(&mut TuningFile, f32);
        const KNOBS: [(&str, Setter); 4] = [
            ("action_threshold", |t, v| t.action_threshold = v),
            ("choice_temperature", |t, v| t.choice_temperature = v),
            ("idle_threshold", |t, v| t.idle_threshold = v),
            ("duration_variance", |t, v| t.duration_variance = v),
        ];

        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            for (knob, set) in KNOBS {
                assert_eq!(
                    compile_tuned(tuning_where(|t| set(t, bad))).unwrap_err(),
                    ContentError::NonFiniteValue {
                        context: format!("{knob} in tuning.toml")
                    },
                    "a {knob} of {bad} must be rejected as non-finite"
                );
            }
        }
    }

    /// The tuning half of the message tests, for the same reason as the
    /// other two: these strings are read by whoever just broke the build
    /// from a TOML edit, and nothing else asserts them.
    ///
    /// Each names the knob AND the file, because "must be at least 1"
    /// without either is not actionable.
    #[test]
    fn tuning_error_messages_name_the_offending_knob() {
        let cases: Vec<(TuningFile, &str)> = vec![
            (
                tuning_where(|t| t.choice_temperature = 0.0),
                "tuning.toml has choice_temperature of 0; it must be greater than 0 because selection divides by it",
            ),
            (
                tuning_where(|t| t.min_interaction_ticks = 0),
                "tuning.toml has min_interaction_ticks of 0; must be at least 1",
            ),
            (
                tuning_where(|t| t.duration_variance = 1.5),
                "tuning.toml has duration_variance of 1.5; must be at least 0 and less than 1",
            ),
            (
                tuning_where(|t| t.idle_threshold = 0.5),
                "tuning.toml has idle_threshold 0.5 above action_threshold 0.25; a sim would wander off while something is worth doing",
            ),
            (
                tuning_where(|t| t.max_queued_intents = 0),
                "tuning.toml has max_queued_intents of 0, so directing a sim at an object could never do anything; must be at least 1",
            ),
            (
                tuning_where(|t| t.action_threshold = f32::NAN),
                "action_threshold in tuning.toml is not a finite number",
            ),
        ];

        for (tuning, expected) in cases {
            assert_eq!(compile_tuned(tuning).unwrap_err().to_string(), expected);
        }
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
            full_tuning(),
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

        let pack = compile(
            full_needs(),
            three_objects(),
            lot,
            test_atlas(),
            full_tuning(),
        )
        .expect("valid");
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
                compile(
                    full_needs(),
                    one_object(snack()),
                    lot,
                    test_atlas(),
                    full_tuning()
                )
                .unwrap_err(),
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
                compile(
                    full_needs(),
                    one_object(snack()),
                    lot,
                    test_atlas(),
                    full_tuning()
                )
                .unwrap_err(),
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
        let pack = compile(
            full_needs(),
            one_object(snack()),
            lot,
            test_atlas(),
            full_tuning(),
        )
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
                compile(
                    full_needs(),
                    one_object(snack()),
                    lot,
                    test_atlas(),
                    full_tuning()
                )
                .unwrap_err(),
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
        let pack = compile(
            full_needs(),
            one_object(snack()),
            lot,
            test_atlas(),
            full_tuning(),
        )
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
            compile(
                full_needs(),
                one_object(snack()),
                lot,
                test_atlas(),
                full_tuning()
            )
            .unwrap_err(),
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
        compile(
            full_needs(),
            one_object(snack()),
            lot,
            test_atlas(),
            full_tuning(),
        )
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
            compile(
                full_needs(),
                one_object(snack()),
                lot,
                test_atlas(),
                full_tuning()
            )
            .unwrap_err(),
            ContentError::UnknownPlacedObject {
                object: "hovercraft".into()
            }
        );

        // The same name against a pack that DOES declare it compiles, so
        // the rejection is about the reference rather than about the
        // rule firing unconditionally.
        let lot = lot_where(|lot| lot.place[0].object = "sink".into());
        let pack = compile(
            full_needs(),
            three_objects(),
            lot,
            test_atlas(),
            full_tuning(),
        )
        .expect("'sink' is declared");
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
            "needs.toml does not declare 'comfort'"
        );

        assert_eq!(
            compile_tuned(tuning_where(|t| {
                t.decay_per_tick.remove("comfort");
            }))
            .unwrap_err()
            .to_string(),
            "tuning.toml's [decay_per_tick] is missing a rate for 'comfort'"
        );

        assert_eq!(
            compile_tuned(tuning_where(|t| {
                t.decay_per_tick.insert("hunger".into(), -1.0);
            }))
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
                compile(
                    full_needs(),
                    one_object(snack()),
                    lot,
                    test_atlas(),
                    full_tuning()
                )
                .unwrap_err()
                .to_string(),
                expected
            );
        }
    }
}
