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
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{Footprint, NeedId, NEED_COUNT};

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

        // A zero dimension is the silent-nothing case one layer down from
        // `EmptyLot`: the rectangle covers no tiles, so nothing is
        // orthogonally adjacent to it, `find_path_adjacent` finds nowhere to
        // stand, and scoring quietly treats the object as unavailable for
        // ever. Checked here rather than in the lot, because it is wrong
        // about the OBJECT and stays wrong wherever it is placed - and
        // because every rectangle computation below assumes at least one
        // tile.
        if object.footprint.width == 0 || object.footprint.depth == 0 {
            return Err(ContentError::ZeroFootprint {
                object: object.id.clone(),
                width: object.footprint.width,
                depth: object.footprint.depth,
            });
        }

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

            // **Absent falls back to the id; blank is rejected.** The two
            // are different authoring states and only the `Option` in the
            // schema can tell them apart: saying nothing means "the id will
            // do", and `label = ""` means a menu row with no text in it.
            //
            // `trim` rather than `is_empty`, because a label of `" "` draws
            // exactly the same nothing as `""` and TOML preserves it
            // faithfully. The stored label keeps the author's own spacing;
            // only the emptiness TEST trims, since trimming what is stored
            // would silently rewrite content.
            let label = match &act.label {
                Some(label) if label.trim().is_empty() => {
                    return Err(ContentError::EmptyInteractionLabel {
                        object: object.id.clone(),
                        interaction: act.id.clone(),
                    })
                }
                Some(label) => label.clone(),
                None => act.id.clone(),
            };

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
                label,
            });
        }

        compiled.push(CompiledObject {
            id: object.id.clone(),
            name: object.name.clone(),
            sprite: sprite as u32,
            interactions,
            footprint: object.footprint,
        });
    }

    let lot = compile_lot(lot, &compiled)?;
    let tuning = compile_tuning(tuning)?;

    // **An interaction the floor is longer than does not do what it says.**
    //
    // Checked here rather than beside the other per-interaction rules above
    // because it is the only rule that needs two files at once: the duration
    // is content and both `min_interaction_ticks` and `duration_variance` are
    // tuning, so neither file is wrong on its own.
    //
    // The failure it prevents is quiet in three ways at once, which is what
    // earns it a build error under [D9]. An interaction below the line runs
    // for exactly the floor **every single time**, so `duration_variance` is
    // silently inert for it; and because `tick_interactions` refills at
    // `delta / duration_ticks` per tick, running for `floor` ticks instead of
    // `duration_ticks` delivers `floor / duration_ticks` times the advertised
    // amount. Nothing errors, nothing logs, and the object simply is not the
    // thing its content describes.
    //
    // All three were true of shipped content and none was noticed by a test.
    // The sink declared 8 ticks and 22 hygiene, ran for 12 ticks on 6 of 6
    // measured interactions, and delivered 33 - recorded as [C1] in
    // docs/alpha-feel-notes.md, found by a 12 000-tick trace rather than by
    // the suite. `cargo run -p terri-sim --example trace` is that trace, kept
    // in the repo this time.
    //
    // `div_ceil` because the boundary belongs to the safe side: the condition
    // is `duration * (1 - variance) >= floor`, and integer ticks mean the
    // smallest duration satisfying it is the ceiling of the quotient.
    let variance = tuning.duration_variance;
    let floor = tuning.min_interaction_ticks;
    for object in &compiled {
        for act in &object.interactions {
            if (act.duration_ticks as f32) * (1.0 - variance) < floor as f32 {
                // Safe: `duration_variance` is validated to [0, 1) above, so
                // the denominator is in (0, 1] and the scaled floor cannot
                // overflow a u32 for any floor a build accepts.
                let minimum = ((floor as f32) / (1.0 - variance)).ceil() as u32;
                return Err(ContentError::ClippedDuration {
                    object: object.id.clone(),
                    interaction: act.id.clone(),
                    duration_ticks: act.duration_ticks,
                    minimum,
                    floor,
                    variance,
                });
            }
        }
    }

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
    check_finite(
        tuning.habituation_per_use,
        "habituation_per_use in tuning.toml",
    )?;
    check_finite(
        tuning.habituation_decay_per_tick,
        "habituation_decay_per_tick in tuning.toml",
    )?;
    check_finite(tuning.habituation_floor, "habituation_floor in tuning.toml")?;

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
    if tuning.max_queued_commands == 0 {
        return Err(ContentError::ZeroQueuedCommands);
    }
    // Habituation. Each rule guards a value that fails QUIETLY rather than
    // loudly, which is the standard this function applies.
    //
    // A rise outside [0, 1] either does nothing (0 is a legal way to disable
    // the mechanic) or saturates every entry on first use, which reads as an
    // object a sim will never touch twice and looks like a scoring bug.
    if !(0.0..=1.0).contains(&tuning.habituation_per_use) {
        return Err(ContentError::HabituationPerUseOutOfRange {
            value: tuning.habituation_per_use,
        });
    }
    // **A zero decay is rejected rather than treated as "never recover".** It
    // would make habituation a one-way ratchet: every interaction a sim has
    // ever performed would sink to the floor and stay there, so after long
    // enough the whole house is equally unappealing and selection is choosing
    // between identical numbers. That is [C6] applied to everything at once,
    // and it arrives silently over tens of minutes.
    // A plain comparison rather than the negated form used in
    // `score_advertisement`, and safe here for a reason that is not true there:
    // `check_finite` has already rejected NaN a few lines above, so `<=` cannot
    // silently pass an incomparable value through.
    if tuning.habituation_decay_per_tick <= 0.0 {
        return Err(ContentError::NonPositiveHabituationDecay {
            value: tuning.habituation_decay_per_tick,
        });
    }
    // The floor is a MULTIPLIER, so 1 disables the effect and 0 would make a
    // fully habituated interaction worth exactly nothing - permanently
    // unselectable, which is a need becoming unsatisfiable by a route
    // `every_declared_need_can_be_satisfied_by_some_interaction` cannot see
    // because it is dynamic rather than static.
    if tuning.habituation_floor <= 0.0 || tuning.habituation_floor > 1.0 {
        return Err(ContentError::HabituationFloorOutOfRange {
            value: tuning.habituation_floor,
        });
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
        habituation_per_use: tuning.habituation_per_use,
        habituation_decay_per_tick: tuning.habituation_decay_per_tick,
        habituation_floor: tuning.habituation_floor,
        action_threshold: tuning.action_threshold,
        choice_temperature: tuning.choice_temperature,
        idle_threshold: tuning.idle_threshold,
        wander_pause_ticks: tuning.wander_pause_ticks,
        wander_attempts: tuning.wander_attempts,
        duration_variance: tuning.duration_variance,
        min_interaction_ticks: tuning.min_interaction_ticks,
        rng_seed: tuning.rng_seed,
        max_queued_intents: tuning.max_queued_intents,
        max_queued_commands: tuning.max_queued_commands,
        // Unchecked on purpose, unlike every cap above. Zero here means
        // "read every frame", which is wasteful and still correct; the
        // rules in this function exist for values that fail QUIETLY, and
        // a panel that refreshes too often is neither quiet nor a
        // failure.
        need_bar_refresh_ms: tuning.need_bar_refresh_ms,
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
    // What the footprint rules below need, collected as the placements are
    // resolved: the object's id for the messages, the tile it stands on, and
    // the rectangle that tile is the origin of. Declaration order is
    // preserved, which is what makes `FootprintsOverlap` name the earlier
    // object first rather than whichever one a map happened to yield.
    let mut rects: Vec<(String, (u32, u32), Footprint)> = Vec::with_capacity(lot.place.len());

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

        rects.push((place.object.clone(), tile, objects[index].footprint));
        placements.push(CompiledPlacement {
            object: ObjectDefId(index as u32),
            x: place.x,
            y: place.y,
        });
    }

    // ---- [F5]: the three footprint rules -------------------------------
    //
    // Run in this order so that an author with two problems at once is told
    // about the more fundamental one. A rectangle running off the lot is
    // wrong on its own; an overlap needs two objects to agree they are wrong
    // together; and reachability is a property of the whole lot rather than
    // of any one placement. Reporting them the other way round would send
    // somebody to move a sofa when the real problem is that a bed is three
    // tiles wide.
    //
    // The origin tile itself is checked twice - once above by
    // `PlacementOutOfBounds` and `PlacementOnWall`, once here as the first
    // tile of the rectangle - and that is deliberate. The checks above report
    // the authored `f32` pair, which is the number in the file; these report
    // a TILE, which for anything wider than 1x1 is a number the author has to
    // derive. Two messages for two different mistakes, and the origin check
    // runs first so a 1x1 object never reports the derived one.
    let far_corner = |tile: (u32, u32), footprint: Footprint| -> Option<(u32, u32)> {
        // `checked_*` because these are authored numbers: `width = 4294967295`
        // is expressible in TOML, and a wrapping far corner would put the
        // rectangle behind its own origin and make every check below pass
        // vacuously. The `- 1` is because the origin tile is the FIRST of
        // `width`. The `checked_sub` cannot fail - `compile` rejects a zero
        // dimension before this runs - and is written this way so that a
        // future reordering is a `None` rather than a panic.
        Some((
            tile.0.checked_add(footprint.width.checked_sub(1)?)?,
            tile.1.checked_add(footprint.depth.checked_sub(1)?)?,
        ))
    };

    // Rule 2, both halves. Bounds for the whole rectangle before walls for
    // the whole rectangle, for the same "most fundamental first" reason: a
    // tile off the lot is not a tile that could hold a wall.
    let mut corners = Vec::with_capacity(rects.len());
    for (object, tile, footprint) in &rects {
        let out_of_bounds = |x: u32, y: u32| ContentError::FootprintOutOfBounds {
            object: object.clone(),
            x,
            y,
            width: lot.width,
            height: lot.height,
        };
        let Some(far) = far_corner(*tile, *footprint) else {
            return Err(out_of_bounds(tile.0, tile.1));
        };
        for y in tile.1..=far.1 {
            for x in tile.0..=far.0 {
                if x >= lot.width || y >= lot.height {
                    return Err(out_of_bounds(x, y));
                }
            }
        }
        for y in tile.1..=far.1 {
            for x in tile.0..=far.0 {
                if wall_tiles.contains(&(x, y)) {
                    return Err(ContentError::FootprintOnWall {
                        object: object.clone(),
                        x,
                        y,
                    });
                }
            }
        }
        corners.push(far);
    }

    // Rule 1. `BTreeSet`/`BTreeMap` rather than the hash flavours for the
    // reason `CompiledInteraction::advertises` gives: nothing on the way to
    // the pack may depend on hash iteration order. Here it also decides which
    // tile a multi-tile overlap is reported at, so an unordered map would
    // make the error MESSAGE vary from build to build.
    let mut occupied: BTreeMap<(u32, u32), usize> = BTreeMap::new();
    for (index, ((object, tile, _), far)) in rects.iter().zip(&corners).enumerate() {
        for y in tile.1..=far.1 {
            for x in tile.0..=far.0 {
                if let Some(previous) = occupied.insert((x, y), index) {
                    return Err(ContentError::FootprintsOverlap {
                        // `previous < index`, because placements are walked in
                        // declaration order, so `first` is always the one
                        // declared earlier.
                        first: rects[previous].0.clone(),
                        second: object.clone(),
                        x,
                        y,
                    });
                }
            }
        }
    }

    // Rule 3, and the one that pays for [F3]. Everything the walls and the
    // footprints between them make impassable, which is exactly what
    // `Sim::new_from_lot` will block.
    let mut blocked = wall_tiles.clone();
    blocked.extend(occupied.keys().copied());

    // Every tile beside a rectangle that is inside the lot and walkable.
    // `i64` so a rectangle touching x = 0 can name the column before it
    // without wrapping.
    let approaches = |tile: (u32, u32), far: (u32, u32)| -> Vec<(u32, u32)> {
        let (x0, y0) = (tile.0 as i64, tile.1 as i64);
        let (x1, y1) = (far.0 as i64, far.1 as i64);
        let mut ring: Vec<(i64, i64)> = Vec::new();
        for x in x0..=x1 {
            ring.push((x, y0 - 1));
            ring.push((x, y1 + 1));
        }
        for y in y0..=y1 {
            ring.push((x0 - 1, y));
            ring.push((x1 + 1, y));
        }
        ring.into_iter()
            .filter(|&(x, y)| x >= 0 && y >= 0 && x < lot.width as i64 && y < lot.height as i64)
            .map(|(x, y)| (x as u32, y as u32))
            .filter(|tile| !blocked.contains(tile))
            .collect()
    };

    // Half one, for every object, before half two for any of them: "this
    // object is walled in" and "the lot is split in two" are different
    // mistakes with different fixes, and the first is the more local.
    let mut approach_sets = Vec::with_capacity(rects.len());
    for ((object, tile, _), far) in rects.iter().zip(&corners) {
        let beside = approaches(*tile, *far);
        if beside.is_empty() {
            return Err(ContentError::NoWalkableApproach {
                object: object.clone(),
                x: tile.0,
                y: tile.1,
            });
        }
        approach_sets.push(beside);
    }

    // Half two: every approach tile has to be in ONE region, so a sim can
    // get from any object to any other. The flood fill starts at the first
    // walkable tile in the lot, which is where an agent-carrying lot will
    // have its earliest legal spawn, and is what makes "unreachable" a
    // statement about a fixed origin rather than about an arbitrary pair.
    //
    // A lot with no walkable tile at all reaches this with `root` at `None`,
    // and there is nothing to check: any object in it has already failed half
    // one, and a lot with no objects and no floor is a different problem that
    // no [F5] rule claims.
    let root = (0..lot.height)
        .flat_map(|y| (0..lot.width).map(move |x| (x, y)))
        .find(|tile| !blocked.contains(tile));
    if let Some(root) = root {
        let reached = flood_fill(lot.width, lot.height, &blocked, root);
        let index_of = |x: u32, y: u32| (y as usize) * (lot.width as usize) + (x as usize);
        for ((object, _, _), beside) in rects.iter().zip(&approach_sets) {
            for &(x, y) in beside {
                if !reached[index_of(x, y)] {
                    return Err(ContentError::UnreachableApproach {
                        object: object.clone(),
                        x,
                        y,
                        root_x: root.0,
                        root_y: root.1,
                    });
                }
            }
        }
    }

    Ok(CompiledLot {
        width: lot.width,
        height: lot.height,
        walls,
        placements,
    })
}

/// Which tiles are reachable from `root` by four-way movement over the
/// unblocked tiles, as a `width * height` row-major bitmap.
///
/// Four-way rather than eight, matching `TileGrid::NEIGHBOURS`: a diagonal
/// flood fill would call two rooms connected through a corner that no sim
/// can actually walk through, which is the reachability check passing for a
/// reason the simulation does not share.
///
/// Iterative rather than recursive. A 14x10 lot would recurse fine, but the
/// depth is bounded by the tile count and a lot is authored content that
/// nothing caps, so a deep lot would blow the build script's stack.
fn flood_fill(
    width: u32,
    height: u32,
    blocked: &BTreeSet<(u32, u32)>,
    root: (u32, u32),
) -> Vec<bool> {
    let (w, h) = (width as usize, height as usize);
    let mut reached = vec![false; w * h];
    let index_of = |x: u32, y: u32| (y as usize) * w + (x as usize);
    let mut stack = vec![root];
    reached[index_of(root.0, root.1)] = true;

    while let Some((x, y)) = stack.pop() {
        for (dx, dy) in [(1i64, 0i64), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x as i64 + dx, y as i64 + dy);
            if nx < 0 || ny < 0 || nx >= width as i64 || ny >= height as i64 {
                continue;
            }
            let next = (nx as u32, ny as u32);
            let index = index_of(next.0, next.1);
            if reached[index] || blocked.contains(&next) {
                continue;
            }
            reached[index] = true;
            stack.push(next);
        }
    }

    reached
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
    ///
    /// **Habituation broke that discipline and this vector was regenerated
    /// rather than patched.** Its three knobs were inserted in the MIDDLE of
    /// `Tuning`, next to the other behaviour knobs where a designer will look
    /// for them, which shifts every tuning byte after them. Grouping won over
    /// append-only here because the annotations above only cover the object,
    /// lot and atlas blocks, and those are unaffected - the whole cost was 12
    /// bytes of tuning moving, which is exactly what this test exists to
    /// report. Regenerated from the failing assertion, not hand-edited.
    ///
    /// **Footprints moved it twice over, for two independent and both
    /// deliberate reasons.** `CompiledObject` gained a `footprint`, appended
    /// after `interactions` so nothing before it shifts - that is the
    /// `1, 1` immediately after the `15, 1` duration and slots on row 7, the
    /// fixture object's default 1x1. And `distinct_lot`'s second wall moved
    /// from `(3, 2)` to `(4, 2)`, which is the `4, 2` two bytes later; see
    /// that fixture for why, because the reason is a rule doing its job
    /// rather than a fixture being tidied.
    ///
    /// **Interaction labels moved it once more, by exactly one appended
    /// block, and this was regenerated from the failing assertion rather
    /// than hand-edited.** `CompiledInteraction` gained a `label` after
    /// `slots`, so every byte up to and including the `15, 1` duration and
    /// slots pair on row 7 kept its offset, and what follows it is new:
    /// `15` for the string's length and then `Eat standing up` in ASCII,
    /// ending `117, 112` on row 8. The `1, 1` immediately after that is the
    /// object's default 1x1 footprint, unmoved and still the next block,
    /// which is what the append discipline buys. 134 bytes to 146.
    ///
    /// The label is a DECLARED one rather than the id fallback - see
    /// `snack_advertising_three_needs` - so these bytes also pin that the
    /// author's wording, and not `grab_snack`, is what reaches the pack.
    #[rustfmt::skip]
    const GOLDEN_PACK_BYTES: &[u8] = &[
        205, 204, 204, 61, 205, 204, 76, 62, 154, 153, 153, 62,
        205, 204, 204, 62, 0, 0, 0, 63, 154, 153, 25, 63,
        51, 51, 51, 63, 1, 6, 102, 114, 105, 100, 103, 101,
        6, 70, 114, 105, 100, 103, 101, 2, 1, 10, 103, 114,
        97, 98, 95, 115, 110, 97, 99, 107, 3, 0, 0, 0,
        12, 66, 1, 0, 0, 64, 64, 6, 0, 0, 160, 64,
        15, 1, 15, 69, 97, 116, 32, 115, 116, 97, 110, 100,
        105, 110, 103, 32, 117, 112, 1, 1, 1, 5, 3, 2,
        4, 2, 1, 0, 1, 0, 0, 0, 32, 64, 0, 0,
        160, 63, 0, 0, 128, 62, 0, 0, 0, 63, 0, 0,
        0, 62, 9, 6, 0, 0, 160, 62, 10, 215, 35, 59,
        0, 0, 32, 63, 0, 0, 64, 63, 3, 172, 2, 7,
        11, 13,
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
    ///
    /// **The second wall moved from `(3, 2)` to `(4, 2)` when footprints
    /// arrived, and it moved because [F5] rule 3 rejected the old one.** With
    /// `(1, 0)` walled, `(3, 2)` walled and the fridge's own tile `(2, 1)`
    /// now impassable, a 5x3 lot splits into two regions of six tiles each -
    /// and the fridge's approach tiles land in both, `(1, 1)` and `(2, 2)` on
    /// one side and `(2, 0)` and `(3, 1)` on the other. That is precisely the
    /// doorway-seal failure the rule exists to catch, arriving unprompted in
    /// a fixture nobody wrote to demonstrate it, which is the strongest
    /// evidence available that the rule has teeth. `(4, 2)` leaves the same
    /// asymmetries in place - still out of sorted order relative to
    /// `(1, 0)`, still the far corner - and leaves the lot connected through
    /// row 2.
    fn distinct_lot() -> LotFile {
        LotFile {
            width: 5,
            height: 3,
            wall: vec![WallDef { x: 4, y: 2 }, WallDef { x: 1, y: 0 }],
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
                    // Every fixture in this module is 1x1 unless it is about
                    // footprints, and the footprint tests below build their own
                    // objects. Widening one here would silently change what
                    // `placements_resolve_to_the_declared_object_index` and the
                    // golden vector are looking at, and the first symptom would
                    // be an overlap error in a test about index resolution.
                    footprint: Footprint::SINGLE,
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
            habituation_per_use: 0.3125,
            habituation_decay_per_tick: 0.0025,
            habituation_floor: 0.625,
            min_interaction_ticks: 3,
            rng_seed: 300,
            max_queued_intents: 7,
            max_queued_commands: 11,
            need_bar_refresh_ms: 13,
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
        one_object_sized(interaction, Footprint::SINGLE)
    }

    /// `one_object` with a footprint, for the rules that need a rectangle.
    fn one_object_sized(interaction: InteractionDef, footprint: Footprint) -> ObjectsFile {
        ObjectsFile {
            object: vec![ObjectDef {
                id: "fridge".into(),
                name: "Fridge".into(),
                sprite: "fridge_art".into(),
                footprint,
                interaction: vec![interaction],
            }],
        }
    }

    fn snack() -> InteractionDef {
        InteractionDef {
            id: "grab_snack".into(),
            // Unlabelled, which is the DEFAULTING path and therefore the
            // one most tests should exercise: an object authored before
            // the flyout existed says nothing about a label, and every
            // rule in this module has to keep working for it. The
            // labelled path gets its own fixtures below.
            label: None,
            advertises: [("hunger".to_string(), 35.0)].into_iter().collect(),
            duration_ticks: 15,
            slots: 1,
        }
    }

    /// comfort (6), energy (1), hunger (0): the `BTreeMap`'s name order
    /// is the exact reverse of the index order the pack wants, so the
    /// two can never coincide by accident.
    ///
    /// The golden vector compiles this one, so it also carries a DECLARED
    /// label - and one that shares no characters with `grab_snack`, so a
    /// label encoded off the `id` slot moves the bytes rather than
    /// reproducing them.
    fn snack_advertising_three_needs() -> InteractionDef {
        let mut act = snack();
        act.label = Some("Eat standing up".into());
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
            footprint: Footprint::SINGLE,
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
            footprint: Footprint::SINGLE,
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

    /// **The label rule, all three of its states in one run**, because two
    /// of them are only meaningful against each other.
    ///
    /// A declared label must survive compilation verbatim; an omitted one
    /// must become the interaction's own `id`; and a blank one must be
    /// rejected. Split into three tests, the middle one would pass on an
    /// implementation that ignored `label` entirely and always used the id,
    /// and the first would pass on one that never defaulted - so the pair
    /// has to be asserted together, and the fixture's declared label shares
    /// no characters with its id so the two answers cannot be confused.
    ///
    /// The blank case covers `" "` as well as `""`. They draw the same
    /// nothing in the menu, and a rule written as `is_empty` accepts the
    /// first while rejecting the second, which is a build that passes and a
    /// menu row that is still blank.
    #[test]
    fn an_interaction_label_defaults_to_its_id_is_kept_verbatim_and_is_never_blank() {
        let compiled = |act: InteractionDef| -> Result<String, ContentError> {
            compile_objects(full_needs(), one_object(act))
                .map(|pack| pack.objects[0].interactions[0].label.clone())
        };

        assert_eq!(
            compiled(snack()).expect("valid"),
            "grab_snack",
            "an interaction that declares no label must fall back to its \
             own id; an empty string here is a blank menu row"
        );

        let mut labelled = snack();
        labelled.label = Some("Eat standing up".into());
        assert_eq!(
            compiled(labelled).expect("valid"),
            "Eat standing up",
            "a declared label must reach the pack verbatim, or the flyout \
             shows the id and content/objects.toml has stopped being where \
             the wording lives"
        );

        for blank in ["", " ", "\t"] {
            let mut act = snack();
            act.label = Some(blank.into());
            assert_eq!(
                compiled(act).unwrap_err(),
                ContentError::EmptyInteractionLabel {
                    object: "fridge".into(),
                    interaction: "grab_snack".into()
                },
                "a label of {blank:?} must be rejected rather than compiled \
                 into a clickable row of empty space"
            );
        }
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
        // 11 rather than 7, so a compile step that filled either cap
        // from the other is visible here as well as in the golden bytes.
        assert_eq!(tuning.max_queued_commands, 11);
        // 13, sharing a value with nothing above it. This knob is read
        // by nobody in the workspace - the shell reads it across the
        // WASM boundary - so [L29] applies with full force: without this
        // line, a compile step that dropped it or filled it from
        // `max_queued_commands` would be caught by the golden vector
        // alone, and a golden vector is regenerated by whoever breaks it.
        assert_eq!(tuning.need_bar_refresh_ms, 13);
    }

    /// Weighted selection divides by the temperature, so zero is a
    /// division by zero whose result is `NaN`, and `NaN` loses every
    /// comparison: a sim would stop choosing anything at all, forever,
    /// with no panic and no log. A negative temperature is worse than
    /// meaningless - it inverts the softmax, so the least urgent option
    /// becomes the most likely.
    ///
    /// **The habituation floor's two bounds, and there was no test for
    /// either.** Three mutants survived the whole workspace here, found by
    /// the M2b sweep: `||` to `&&`, and `> 1.0` to `== 1.0` and to `>= 1.0`.
    ///
    /// The floor is a MULTIPLIER applied to a fully habituated
    /// interaction's benefit, so each bound fails in its own quiet way and
    /// neither fails loudly:
    ///
    /// - **Zero** makes a saturated interaction worth exactly nothing, so
    ///   the last object satisfying some need can become permanently
    ///   unselectable. That is a need going unsatisfiable dynamically,
    ///   which `every_declared_need_can_be_satisfied_by_some_interaction`
    ///   is static and cannot see.
    /// - **Above one** turns habituation into a REWARD for repetition: the
    ///   more a sim does something the better it scores, which is the
    ///   mechanic inverted rather than disabled.
    ///
    /// Four cases, and each one is the only input that kills one of the
    /// three mutants:
    ///
    /// - `0.0` is `<= 0.0` and NOT `> 1.0`, so it separates `||` from `&&`;
    /// - `1.5` is `> 1.0` and NOT `<= 0.0`, so it separates them the other
    ///   way, and it also kills `> 1.0` becoming `== 1.0`;
    /// - `1.0` must be ACCEPTED, which is what kills `>` becoming `>=`.
    ///   A floor of 1 disables the effect and that is legal;
    /// - a negative, because the range is a range and not a sign check.
    #[test]
    fn rejects_a_habituation_floor_outside_zero_exclusive_to_one_inclusive() {
        for bad in [0.0, -0.25, 1.5, f32::MAX] {
            assert_eq!(
                compile_tuned(tuning_where(|t| t.habituation_floor = bad)).unwrap_err(),
                ContentError::HabituationFloorOutOfRange { value: bad },
                "a habituation_floor of {bad} either makes an interaction                  permanently worthless or rewards repetition"
            );
        }

        // Both ends of what IS legal. 1.0 is the one that pins `>` rather
        // than `>=`; the smallest positive float is the other side of the
        // `<=` boundary, and is legal however useless.
        for good in [1.0, f32::MIN_POSITIVE] {
            let pack = compile_tuned(tuning_where(|t| t.habituation_floor = good))
                .unwrap_or_else(|e| panic!("a floor of {good} is legal; got {e}"));
            assert_eq!(pack.tuning.habituation_floor, good);
        }
    }

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

    /// The staging queue's cap, which bounds a different failure from
    /// the intent cap above. `SimHandle::enqueue_command` refuses a
    /// command that would take the queue past this, so at zero the
    /// boundary refuses the FIRST command and nothing the player does
    /// reaches the simulation at all - not a click, not a selection, not
    /// a pause. The page would look entirely normal doing it.
    ///
    /// One is asserted legal on the other side of the boundary for the
    /// same reason as above: the rule must not be able to be "at least
    /// 2" and still pass.
    #[test]
    fn rejects_zero_max_queued_commands() {
        assert_eq!(
            compile_tuned(tuning_where(|t| t.max_queued_commands = 0)).unwrap_err(),
            ContentError::ZeroQueuedCommands
        );

        let pack = compile_tuned(tuning_where(|t| t.max_queued_commands = 1))
            .expect("a single queued command is legal, if a twitchy player it is not");
        assert_eq!(pack.tuning.max_queued_commands, 1);
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

        // In-range values, and they have to be in range **for the fixture's
        // interaction as well**, which is a coupling worth stating rather
        // than working around.
        //
        // `snack()` runs 15 ticks against a floor of 12, so its band clears
        // the floor only while `15 * (1 - variance) >= 12`, which is
        // `variance <= 0.2`. That is not this rule's business - it is
        // `ClippedDuration`'s - but it means this loop cannot use a variance
        // near 1 to demonstrate the upper bound, because such content is
        // genuinely invalid for a different and correct reason.
        //
        // The upper bound's EXCLUSIVITY is proven by `1.0` in the `bad` loop
        // above, so nothing is lost; and the case below pins the coupling
        // directly, which the old `0.9999999` silently depended on.
        for good in [0.0, 0.2] {
            let pack = compile_tuned(tuning_where(|t| t.duration_variance = good))
                .unwrap_or_else(|e| panic!("{good} is inside [0, 1); got {e}"));
            assert_eq!(pack.tuning.duration_variance, good);
        }
    }

    /// **A variance near 1 makes every finite duration clipped**, and the
    /// error must say so rather than blaming the range.
    ///
    /// `minimum` is `floor / (1 - variance)`, so as the variance approaches 1
    /// it grows without bound: at 0.9999999 and a floor of 12 no duration a
    /// designer would ever write survives. The range check accepts the value
    /// - it is inside `[0, 1)` - and the cross-file rule is what rejects the
    ///   combination, which is the division of labour this pins.
    ///
    /// Without this test the two rules could be reordered or merged and
    /// nothing would notice; with it, a build that refuses a near-1 variance
    /// has to name the interaction it cannot satisfy.
    #[test]
    fn a_variance_near_one_is_in_range_but_leaves_no_duration_unclipped() {
        let err = compile_tuned(tuning_where(|t| t.duration_variance = 0.9999999)).unwrap_err();

        match err {
            ContentError::ClippedDuration {
                interaction,
                minimum,
                ..
            } => {
                assert_eq!(interaction, "grab_snack");
                assert!(
                    minimum > 1_000_000,
                    "at a variance this close to 1 the required duration must \
                     be absurd, which is the point; got {minimum}"
                );
            }
            other => panic!(
                "a variance of 0.9999999 is inside [0, 1), so it must be \
                 rejected by the clipping rule naming the interaction it \
                 cannot satisfy, not by the range rule; got {other:?}"
            ),
        }
    }

    /// The rule that would have caught [C1] before it shipped.
    ///
    /// The sink is the real case: 8 declared ticks against a floor of 12 and a
    /// variance of 0.4, so its whole band was 4.8 to 11.2 and every use ran
    /// for exactly 12, delivering 1.5x its advertised hygiene. The numbers
    /// below are that situation.
    #[test]
    fn rejects_an_interaction_the_floor_would_set_the_length_of() {
        let mut act = snack();
        act.duration_ticks = 8;
        let err = compile(
            full_needs(),
            one_object(act),
            bare_lot(),
            test_atlas(),
            tuning_where(|t| {
                t.min_interaction_ticks = 12;
                t.duration_variance = 0.4;
            }),
        )
        .unwrap_err();

        assert_eq!(
            err,
            ContentError::ClippedDuration {
                object: "fridge".into(),
                interaction: "grab_snack".into(),
                duration_ticks: 8,
                // 12 / 0.6 = 20 exactly, so the ceiling is 20 and not 21.
                minimum: 20,
                floor: 12,
                variance: 0.4,
            }
        );
    }

    /// The boundary, from both sides, because `<` and `<=` are one character
    /// apart and the difference is a duration that is exactly inert.
    ///
    /// At a floor of 12 and a variance of 0.4 the line is exactly 20: a
    /// 20-tick interaction bottoms out at 12.0, which the floor does not
    /// raise, so it is fine; 19 bottoms out at 11.4 and is not.
    #[test]
    fn the_clipping_line_is_inclusive_at_exactly_the_floor() {
        let at_the_line = |ticks: u32| {
            let mut act = snack();
            act.duration_ticks = ticks;
            compile(
                full_needs(),
                one_object(act),
                bare_lot(),
                test_atlas(),
                tuning_where(|t| {
                    t.min_interaction_ticks = 12;
                    t.duration_variance = 0.4;
                }),
            )
        };

        assert!(
            at_the_line(20).is_ok(),
            "a 20-tick interaction bottoms out at exactly the 12-tick floor, \
             so the floor never raises it and the content is honest"
        );
        assert!(
            at_the_line(19).is_err(),
            "19 bottoms out at 11.4, below the floor, so part of its band is \
             clipped; accepting it means the rule is off by one"
        );
    }

    /// **Shipped content, not a fixture.** The rule above is only worth
    /// having if it is actually true of the game, and the three interactions
    /// that violated it did so for months.
    #[test]
    fn no_shipped_interaction_is_clipped_by_the_interaction_floor() {
        let pack = crate::pack();
        let floor = pack.tuning.min_interaction_ticks;
        let variance = pack.tuning.duration_variance;
        assert!(
            floor > 0 && variance > 0.0,
            "with a zero floor or zero variance this test cannot fail and \
             therefore proves nothing; floor {floor}, variance {variance}"
        );

        for object in &pack.objects {
            for act in &object.interactions {
                let band_bottom = act.duration_ticks as f32 * (1.0 - variance);
                assert!(
                    band_bottom >= floor as f32,
                    "'{}' interaction '{}' declares {} ticks, whose band \
                     bottoms out at {band_bottom:.1} against a floor of \
                     {floor}: it would run at the floor every time and \
                     deliver {:.2}x its advertised deltas",
                    object.id,
                    act.id,
                    act.duration_ticks,
                    floor as f32 / act.duration_ticks as f32,
                );
            }
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
                tuning_where(|t| t.max_queued_commands = 0),
                "tuning.toml has max_queued_commands of 0, so the boundary would refuse every player command and nothing the player did would reach the simulation; must be at least 1",
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
            vec![(4, 2), (1, 0)],
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
        // distinct_lot walls (4, 2) and (1, 0). The placement is on
        // FRACTIONAL coordinates inside the first of those, so the test
        // also pins that the tile is the floor of the coordinates rather
        // than the coordinates themselves.
        let lot = lot_where(|lot| {
            lot.place[0].x = 4.75;
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
                x: 4,
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
        .expect("(2, 0) is not a wall; (4, 2) and (1, 0) are");
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

    // ---- Footprints ----------------------------------------------------
    //
    // [F5]'s three rules, one test each, and each paired with the case on
    // the other side of its boundary per [L26]. The boundaries are where
    // these rules are easy to get wrong by one tile: a rectangle whose far
    // edge is exactly the lot's last column is legal, two rectangles that
    // TOUCH are legal, and an object with exactly one walkable tile beside
    // it is legal. All three of those look like the rejected case from a
    // distance.
    //
    // These build their own lots rather than reusing `distinct_lot`, which
    // is 5x3 and has no room for a rectangle plus the walls needed to
    // constrain it. Keeping them apart also keeps `distinct_lot`'s tests
    // about the authored COORDINATE and these about the RECTANGLE, which are
    // separately checked and separately reported.

    /// Objects with footprints. Ids are limited to the three `test_atlas`
    /// holds art for, which is enough: no rule below needs a fourth object.
    fn sized_objects(sized: &[(&str, u32, u32)]) -> ObjectsFile {
        ObjectsFile {
            object: sized
                .iter()
                .map(|(id, width, depth)| ObjectDef {
                    id: (*id).to_string(),
                    name: id.to_uppercase(),
                    sprite: format!("{id}_art"),
                    footprint: Footprint {
                        width: *width,
                        depth: *depth,
                    },
                    interaction: vec![snack()],
                })
                .collect(),
        }
    }

    fn lot_of(
        width: u32,
        height: u32,
        walls: &[(i32, i32)],
        places: &[(&str, f32, f32)],
    ) -> LotFile {
        LotFile {
            width,
            height,
            wall: walls.iter().map(|&(x, y)| WallDef { x, y }).collect(),
            place: places
                .iter()
                .map(|&(object, x, y)| PlacementDef {
                    object: object.to_string(),
                    x,
                    y,
                })
                .collect(),
        }
    }

    /// Compiles a geometry fixture against valid needs, tuning and atlas, so
    /// each test below varies only the objects and the lot.
    fn compile_geometry(objects: ObjectsFile, lot: LotFile) -> Result<ContentPack, ContentError> {
        compile(full_needs(), objects, lot, test_atlas(), full_tuning())
    }

    /// The accepting half of the whole feature: a declared footprint reaches
    /// the pack, on the right object, with width and depth the right way
    /// round.
    ///
    /// 3x2 rather than square, so a transposed field moves an assertion; and
    /// a second object left at its default, so "every object gets the first
    /// one's rectangle" is visible. Without the second object a compile step
    /// that wrote one footprint over all of them would pass.
    #[test]
    fn an_objects_footprint_reaches_the_pack_with_its_width_and_depth_unswapped() {
        let pack = compile_geometry(
            sized_objects(&[("fridge", 3, 2), ("bed", 1, 1)]),
            lot_of(8, 6, &[], &[("fridge", 1.0, 1.0), ("bed", 6.0, 4.0)]),
        )
        .expect("a 3x2 rectangle at (1, 1) fits an 8x6 lot with room to walk");

        assert_eq!(
            pack.objects.len(),
            2,
            "one object cannot see a shared write"
        );
        assert_eq!(
            pack.objects[0].footprint,
            Footprint { width: 3, depth: 2 },
            "the fridge's own rectangle, 3 wide and 2 deep and not the transpose"
        );
        assert_eq!(
            pack.objects[1].footprint,
            Footprint::SINGLE,
            "the bed declared 1x1 and must still be 1x1"
        );
    }

    /// A zero dimension covers no tiles, so nothing is beside the object,
    /// `find_path_adjacent` finds nowhere to stand, and scoring drops it
    /// silently for ever - the object is furniture with an interaction
    /// nobody can reach.
    ///
    /// All three zero shapes, because `width == 0 || depth == 0` mutated to
    /// `&&` still rejects 0x0: a test of that case alone leaves the mutant
    /// alive. Same reasoning as `rejects_a_lot_with_a_zero_dimension`.
    ///
    /// 1x1 is asserted legal on the other side of the boundary, so the rule
    /// cannot be "at least 2" and pass this test.
    #[test]
    fn rejects_a_zero_footprint_dimension() {
        for (width, depth) in [(0, 1), (2, 0), (0, 0)] {
            assert_eq!(
                compile_geometry(
                    sized_objects(&[("fridge", width, depth)]),
                    lot_of(6, 4, &[], &[("fridge", 1.0, 1.0)]),
                )
                .unwrap_err(),
                ContentError::ZeroFootprint {
                    object: "fridge".into(),
                    width,
                    depth
                },
                "a {width}x{depth} footprint occupies no tiles"
            );
        }

        let pack = compile_geometry(
            sized_objects(&[("fridge", 1, 1)]),
            lot_of(6, 4, &[], &[("fridge", 1.0, 1.0)]),
        )
        .expect("one tile is the smallest legal object, and the default");
        assert_eq!(pack.objects[0].footprint, Footprint::SINGLE);
    }

    /// [F5] rule 2, first half. **The placement coordinate is inside the lot
    /// in every case here**, which is the whole reason this is not
    /// `PlacementOutOfBounds`: only the rectangle leaves, and an author told
    /// to look at the placement would find nothing wrong with it.
    ///
    /// Both axes, because a check written on one of them is invisible to a
    /// test of the other; and the far edge is asserted legal on both, so the
    /// rule cannot be off by one and still pass.
    #[test]
    fn rejects_a_footprint_that_runs_off_the_lot_though_its_placement_does_not() {
        // 3 wide from x = 4 covers 4, 5 and 6, and 6 is off a 6-wide lot.
        // 3 deep from y = 1 covers 1, 2 and 3, and 3 is off a 4-tall lot.
        for (footprint, at, offending) in
            [((3, 1), (4.0, 1.0), (6, 1)), ((1, 3), (1.0, 2.0), (1, 4))]
        {
            let lot = lot_of(6, 4, &[], &[("fridge", at.0, at.1)]);
            assert!(
                at.0 < 6.0 && at.1 < 4.0,
                "the placement itself must be inside the lot, or this test is \
                 `rejects_a_placement_outside_the_lot` wearing a hat"
            );
            assert_eq!(
                compile_geometry(sized_objects(&[("fridge", footprint.0, footprint.1)]), lot)
                    .unwrap_err(),
                ContentError::FootprintOutOfBounds {
                    object: "fridge".into(),
                    x: offending.0,
                    y: offending.1,
                    width: 6,
                    height: 4,
                },
                "a {}x{} rectangle at {at:?} runs off a 6x4 lot at {offending:?}",
                footprint.0,
                footprint.1
            );
        }

        // The other side of both boundaries: a rectangle ending ON the last
        // column, and one ending on the last row, are both inside.
        for (footprint, at) in [((3, 1), (3.0, 1.0)), ((1, 3), (1.0, 1.0))] {
            compile_geometry(
                sized_objects(&[("fridge", footprint.0, footprint.1)]),
                lot_of(6, 4, &[], &[("fridge", at.0, at.1)]),
            )
            .unwrap_or_else(|e| {
                panic!(
                    "a {}x{} rectangle at {at:?} ends on the last tile of a 6x4 \
                     lot, which is inside it; got {e}",
                    footprint.0, footprint.1
                )
            });
        }
    }

    /// [F5] rule 2, second half. The placement tile is clear of every wall in
    /// both halves, so this is the rectangle reaching one rather than
    /// `PlacementOnWall` under another name - the wall is two tiles east of
    /// where the author put the object.
    #[test]
    fn rejects_a_footprint_that_covers_a_wall_though_its_placement_does_not() {
        let wall = (5, 2);
        let at = (3.0, 2.0);

        assert_eq!(
            compile_geometry(
                sized_objects(&[("fridge", 3, 1)]),
                lot_of(8, 5, &[wall], &[("fridge", at.0, at.1)]),
            )
            .unwrap_err(),
            ContentError::FootprintOnWall {
                object: "fridge".into(),
                x: 5,
                y: 2,
            },
            "3 wide from x = 3 reaches the wall at (5, 2)"
        );

        // Two wide stops at x = 4, one tile short of the wall.
        compile_geometry(
            sized_objects(&[("fridge", 2, 1)]),
            lot_of(8, 5, &[wall], &[("fridge", at.0, at.1)]),
        )
        .expect("2 wide from x = 3 covers 3 and 4 and never touches (5, 2)");
    }

    /// [F5] rule 1, **the rule the whole feature was asked for**, and its
    /// boundary is the one the brief calls out: rectangles that TOUCH are
    /// fine, and only a shared tile is not.
    ///
    /// The two objects are the same shape and differ only in x, so the
    /// rejected and accepted cases are one tile apart. A fixture where they
    /// differed in size as well could not tell "overlaps" from "is too big".
    #[test]
    fn rejects_two_footprints_that_cover_the_same_tile_but_accepts_two_that_touch() {
        let objects = || sized_objects(&[("fridge", 2, 1), ("bed", 2, 1)]);

        // fridge covers (2, 1) and (3, 1); bed covers (3, 1) and (4, 1).
        assert_eq!(
            compile_geometry(
                objects(),
                lot_of(8, 4, &[], &[("fridge", 2.0, 1.0), ("bed", 3.0, 1.0)]),
            )
            .unwrap_err(),
            ContentError::FootprintsOverlap {
                // Declaration order, so the message does not depend on which
                // object a map happened to yield first.
                first: "fridge".into(),
                second: "bed".into(),
                x: 3,
                y: 1,
            },
            "both rectangles claim (3, 1)"
        );

        // One tile further east: fridge covers (2, 1) and (3, 1), bed covers
        // (4, 1) and (5, 1). They share an EDGE and no tile, which is a sofa
        // pushed up against a bookshelf and is exactly what a real lot does.
        let pack = compile_geometry(
            objects(),
            lot_of(8, 4, &[], &[("fridge", 2.0, 1.0), ("bed", 4.0, 1.0)]),
        )
        .expect("touching is not overlapping");
        assert_eq!(
            pack.lot.placements.len(),
            2,
            "both placements must survive, or 'accepted' means one was dropped"
        );
    }

    /// [F5] rule 3, first half. An object with nothing walkable beside it is
    /// unusable: `find_path_adjacent` returns `None`, scoring treats it as
    /// unavailable, and the sim looks perfectly alive while never touching
    /// it - for as long as the lot exists, which is why this is a build
    /// failure rather than a runtime one.
    ///
    /// The boundary is ONE walkable tile, because "at least one" and "all
    /// four" are the same thing on an open lot and differ only here.
    #[test]
    fn rejects_an_object_with_no_walkable_tile_beside_it_but_accepts_one_with_exactly_one() {
        // A 5x5 lot with the four tiles around (2, 2) walled.
        let boxed_in = [(1, 2), (3, 2), (2, 1), (2, 3)];
        assert_eq!(
            compile_geometry(
                sized_objects(&[("fridge", 1, 1)]),
                lot_of(5, 5, &boxed_in, &[("fridge", 2.0, 2.0)]),
            )
            .unwrap_err(),
            ContentError::NoWalkableApproach {
                object: "fridge".into(),
                x: 2,
                y: 2,
            }
        );

        // Open the north side only. One approach tile is enough, and it is
        // reachable from (0, 0), so the object is usable.
        let one_way: Vec<(i32, i32)> = boxed_in
            .into_iter()
            .filter(|&tile| tile != (2, 1))
            .collect();
        compile_geometry(
            sized_objects(&[("fridge", 1, 1)]),
            lot_of(5, 5, &one_way, &[("fridge", 2.0, 2.0)]),
        )
        .expect("one walkable tile beside an object is enough to use it");
    }

    /// [F5] rule 3, second half, **and the rule that pays for [F3]**: an
    /// object placed in a doorway seals a room, because footprint tiles are
    /// impassable.
    ///
    /// The fixture is two rooms divided by a wall at x = 4 with a single
    /// doorway at (4, 2). A 2x1 object at (3, 2) covers (3, 2) and (4, 2), so
    /// the doorway is gone and its own approach tile (5, 2) is left stranded
    /// in the east room. Nothing else about the lot is wrong: every rectangle
    /// is inside the lot, off the walls, non-overlapping, and has four
    /// walkable tiles beside it. Only the connectivity fails, which is
    /// precisely why the first two rules cannot cover this.
    ///
    /// The accepted case is the SAME object with the same rectangle two tiles
    /// west, so what changed is where it stands rather than what it is.
    #[test]
    fn rejects_a_footprint_that_seals_a_doorway_but_accepts_one_clear_of_it() {
        let divided = [(4, 0), (4, 1), (4, 3), (4, 4)];

        let err = compile_geometry(
            sized_objects(&[("bed", 2, 1)]),
            lot_of(7, 5, &divided, &[("bed", 3.0, 2.0)]),
        )
        .unwrap_err();
        assert_eq!(
            err,
            ContentError::UnreachableApproach {
                object: "bed".into(),
                x: 5,
                y: 2,
                root_x: 0,
                root_y: 0,
            },
            "a 2x1 at (3, 2) covers the doorway at (4, 2), so (5, 2) is cut off"
        );

        let pack = compile_geometry(
            sized_objects(&[("bed", 2, 1)]),
            lot_of(7, 5, &divided, &[("bed", 1.0, 2.0)]),
        )
        .expect("two tiles west of the doorway, the corridor through (3, 2) to (4, 2) is open");
        assert_eq!(
            pack.lot.placements.len(),
            1,
            "the placement must survive, or 'accepted' means it was dropped"
        );

        // The precondition the accepted case rests on, stated rather than
        // assumed: the doorway is a SINGLE tile, so sealing it really does
        // divide the lot. A second gap would make the rejected case pass and
        // this test would quietly stop being about connectivity.
        let gaps = (0..5)
            .filter(|y| !divided.contains(&(4, *y)))
            .collect::<Vec<i32>>();
        assert_eq!(gaps, vec![2], "the dividing wall must have one gap");
    }

    /// **The reachability flood fill moves four ways, like the simulation.**
    ///
    /// `TileGrid::NEIGHBOURS` is orthogonal-only, so two rooms touching at a
    /// corner are NOT connected for a sim. A diagonal flood fill would call
    /// them connected and accept a lot no sim can cross, which is the
    /// reachability rule passing for a reason the simulation does not share -
    /// and the failure would be invisible: the build goes green and half the
    /// house is quietly never used.
    ///
    /// **This test exists because the diagonal mutation SURVIVED the rest of
    /// this module.** Every other fixture here is connected or divided by a
    /// straight wall, and a straight wall blocks both movement rules equally,
    /// so none of them can tell the two apart. This one is the corner pinch:
    ///
    /// ```text
    ///        x=0 1 2 3
    ///   y=0    . . # #
    ///   y=1    . A # #        A = (1, 1), the region holding the root
    ///   y=2    # # B .        B = (2, 2), which only touches A diagonally
    ///   y=3    # # . O        O = the object at (3, 3)
    /// ```
    ///
    /// The accepted case opens `(2, 1)`, giving A and B a shared EDGE, so what
    /// changed between the two runs is one tile of wall rather than anything
    /// about the object.
    #[test]
    fn the_reachability_check_uses_four_way_movement_like_the_simulation_does() {
        // Two 2x2 rooms on the diagonal, mutually reachable only through the
        // (1, 1)/(2, 2) corner.
        let pinched = [
            (2, 0),
            (3, 0),
            (2, 1),
            (3, 1),
            (0, 2),
            (1, 2),
            (0, 3),
            (1, 3),
        ];
        let objects = || sized_objects(&[("fridge", 1, 1)]);
        let place = [("fridge", 3.0, 3.0)];

        assert_eq!(
            compile_geometry(objects(), lot_of(4, 4, &pinched, &place)).unwrap_err(),
            ContentError::UnreachableApproach {
                object: "fridge".into(),
                x: 3,
                y: 2,
                root_x: 0,
                root_y: 0,
            },
            "the object's room touches the root's room only at a corner, which \
             four-way movement cannot cross"
        );

        // Open the pinch into a doorway. One tile of wall is the whole
        // difference between the two runs.
        let opened: Vec<(i32, i32)> = pinched.into_iter().filter(|&tile| tile != (2, 1)).collect();
        compile_geometry(objects(), lot_of(4, 4, &opened, &place))
            .expect("with (2, 1) open the two rooms share an edge and a sim can walk between them");
    }

    /// **Shipped content, not a fixture**, and the same shape of check as
    /// `no_shipped_interaction_is_clipped_by_the_interaction_floor`: the
    /// rules are only worth having if the game actually satisfies them.
    ///
    /// This cannot fail without the build having failed first, since
    /// `build.rs` runs the same `compile` over the same files. What it adds is
    /// that the properties are stated where somebody re-authoring the lot will
    /// read them, that the SHIPPED bed is asserted to be the multi-tile object
    /// the design calls for, and that the flood fill is exercised against a
    /// real house rather than only against a seven-tile fixture. Rule 5 of the
    /// testing protocol applies with force here, so the preconditions are
    /// asserted first: with every object 1x1 this test cannot see a footprint
    /// rule at all.
    #[test]
    fn the_shipped_lot_satisfies_every_footprint_rule() {
        let pack = crate::pack();
        let lot = &pack.lot;

        assert!(
            !lot.placements.is_empty(),
            "an empty lot satisfies all three rules vacuously"
        );
        let wide: Vec<&str> = pack
            .objects
            .iter()
            .filter(|object| object.footprint != Footprint::SINGLE)
            .map(|object| object.id.as_str())
            .collect();
        assert_eq!(
            wide,
            vec![
                "bed",
                "dining_table",
                "long_sofa",
                "double_bed",
                "desk",
                "bathtub",
            ],
            "these are the shipped multi-tile objects, in declaration order; \
             with every object 1x1 this test cannot distinguish a footprint \
             rule from no rule"
        );
        // And one of them is wider in BOTH directions, which the list above
        // cannot say on its own. Every entry there could be 2x1, and a rule
        // that walked `width` twice instead of `width` then `depth` would be
        // invisible against a house of nothing but 2x1 furniture - the
        // transposition trap in [L34], in a footprint's costume.
        assert!(
            pack.objects
                .iter()
                .any(|object| object.footprint.width > 1 && object.footprint.depth > 1),
            "no shipped object covers more than one row AND more than one \
             column, so the depth axis of every rule below is untested"
        );

        // Rule 2 and rule 1 in one pass, because both are statements about
        // one tile at a time. Rebuilt from the pack rather than read out of
        // `compile`, so the two are separate statements of the same claim.
        let walls: BTreeSet<(u32, u32)> = lot.walls.iter().copied().collect();
        let mut occupied: BTreeMap<(u32, u32), &str> = BTreeMap::new();
        for placement in &lot.placements {
            let object = pack.object(placement.object);
            let tile = (placement.x as u32, placement.y as u32);
            for y in tile.1..tile.1 + object.footprint.depth {
                for x in tile.0..tile.0 + object.footprint.width {
                    assert!(
                        x < lot.width && y < lot.height,
                        "'{}' covers ({x}, {y}), outside the {}x{} lot",
                        object.id,
                        lot.width,
                        lot.height
                    );
                    assert!(
                        !walls.contains(&(x, y)),
                        "'{}' covers the wall tile ({x}, {y})",
                        object.id
                    );
                    if let Some(previous) = occupied.insert((x, y), object.id.as_str()) {
                        panic!("'{previous}' and '{}' both cover ({x}, {y})", object.id);
                    }
                }
            }
        }

        // Rule 3, over the tiles the simulation will actually treat as solid.
        let mut blocked = walls;
        blocked.extend(occupied.keys().copied());
        let root = (0..lot.height)
            .flat_map(|y| (0..lot.width).map(move |x| (x, y)))
            .find(|tile| !blocked.contains(tile))
            .expect("the shipped lot has somewhere to stand");
        let reached = flood_fill(lot.width, lot.height, &blocked, root);

        let mut checked = 0;
        for placement in &lot.placements {
            let object = pack.object(placement.object);
            let tile = (placement.x as i64, placement.y as i64);
            let far = (
                tile.0 + object.footprint.width as i64 - 1,
                tile.1 + object.footprint.depth as i64 - 1,
            );
            let mut beside = 0;
            for (x, y) in (tile.0..=far.0)
                .flat_map(|x| [(x, tile.1 - 1), (x, far.1 + 1)])
                .chain((tile.1..=far.1).flat_map(|y| [(tile.0 - 1, y), (far.0 + 1, y)]))
            {
                if x < 0 || y < 0 || x >= lot.width as i64 || y >= lot.height as i64 {
                    continue;
                }
                let approach = (x as u32, y as u32);
                if blocked.contains(&approach) {
                    continue;
                }
                beside += 1;
                assert!(
                    reached[(approach.1 as usize) * (lot.width as usize) + approach.0 as usize],
                    "the tile {approach:?} beside '{}' is cut off from {root:?}; \
                     the shipped lot is split into regions a sim cannot walk \
                     between",
                    object.id
                );
            }
            assert!(
                beside > 0,
                "'{}' has no walkable tile beside it and could never be used",
                object.id
            );
            checked += 1;
        }
        assert_eq!(
            checked,
            lot.placements.len(),
            "every placement must have been checked"
        );
    }
}
