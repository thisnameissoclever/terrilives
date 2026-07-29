//! Serde mirrors of the authored TOML content files.
//!
//! These types describe the *shape* content must have; they say nothing
//! about whether it is valid. Serde cannot express "every `NeedId`
//! appears exactly once" or "this need name is one rustc knows about",
//! so those checks live in the compile step and report `ContentError`.

use serde::Deserialize;
use std::collections::BTreeMap;

/// Mirrors `content/tuning.toml`, the single home for every value that
/// governs the **system** rather than describing one piece of content.
///
/// The split is a standing project rule rather than this file's private
/// convention, and the TOML states it too: a fridge's hunger delta is
/// content and belongs in `objects.toml`; the temperature governing how
/// randomly any sim chooses is tuning and belongs here. **A new knob
/// goes in that file rather than into a Rust `const`**, because the
/// person tuning game feel is iterating and wants one file to open, and
/// a constant buried in a system is a knob they will never find.
///
/// **Nothing here defaults.** Every other rule in this module is a
/// compile-step check reporting a `ContentError`; presence is the one
/// serde can express on its own, and it expresses it by making the field
/// required. A defaulted knob is the silent-nothing case [D9] exists to
/// prevent: a `duration_variance` quietly defaulting to zero is a
/// simulation that is merely metronomic rather than one that fails.
#[derive(Debug, Deserialize)]
pub struct TuningFile {
    /// Below this score, an option is not worth doing at all.
    pub action_threshold: f32,
    /// Softmax temperature for choosing among candidates. Must be
    /// strictly positive: selection divides by it.
    pub choice_temperature: f32,
    /// Below this, nothing is urgent enough to act on and the sim
    /// wanders. Must not exceed `action_threshold`.
    pub idle_threshold: f32,
    /// Ticks a sim pauses between wanders.
    pub wander_pause_ticks: u32,
    /// How many random tiles a wandering sim tries before giving up for
    /// the tick. At least 1; it is what bounds the re-roll.
    pub wander_attempts: u32,
    /// Fraction either side of an interaction's content duration that
    /// the real duration is sampled within. In `[0, 1)`.
    pub duration_variance: f32,
    /// Hard floor on any interaction, in ticks. At least 1.
    pub min_interaction_ticks: u32,
    /// Seed for the simulation PRNG.
    pub rng_seed: u64,
    /// The most player-issued intents one sim may hold at once. At least
    /// 1; it is what bounds a click.
    pub max_queued_intents: u32,
    /// Need name to how much of that need drains per tick.
    ///
    /// A decay rate is a system-wide balance knob rather than part of a
    /// need's identity, so it lives here and not in `needs.toml`, which
    /// declares only which needs exist. The compile step checks that this
    /// table covers exactly the needs that file declares.
    ///
    /// `BTreeMap` rather than `HashMap` for the same reason
    /// [`InteractionDef::advertises`] is one: the compiled pack feeds a
    /// determinism hash, and nothing on the way there may depend on hash
    /// iteration order. A map rather than a list also makes a repeated
    /// need a TOML parse error rather than something the compile step has
    /// to catch.
    pub decay_per_tick: BTreeMap<String, f32>,
}

/// Mirrors `content/needs.toml`, which declares which needs exist and
/// nothing else. Every `NeedId` variant must appear exactly once; that is
/// checked in the compile step, not here, because serde cannot express
/// it.
#[derive(Debug, Deserialize)]
pub struct NeedsFile {
    pub need: Vec<NeedDef>,
}

#[derive(Debug, Deserialize)]
pub struct NeedDef {
    /// Matches `NeedId::as_str`. An unknown name is a content error, not
    /// a parse error, so this stays a `String` here.
    pub id: String,
}

/// Mirrors `content/objects.toml`.
#[derive(Debug, Deserialize)]
pub struct ObjectsFile {
    pub object: Vec<ObjectDef>,
}

#[derive(Debug, Deserialize)]
pub struct ObjectDef {
    pub id: String,
    pub name: String,
    /// Which sprite in the atlas draws this object.
    ///
    /// Required rather than defaulted, and it is content rather than a
    /// renderer detail on purpose. The alternative - a switch in
    /// TypeScript mapping object id to sprite - is a second copy of the
    /// object list living in the shell, so every new object would be a
    /// two-file edit and a silently-wrong sprite would be a two-file
    /// bug. That is the coupling [D1] exists to prevent.
    ///
    /// A `String` here and an index in the compiled pack, for the same
    /// reason a need name is: after compilation a sprite that the atlas
    /// does not hold has no representation.
    pub sprite: String,
    /// Absent rather than empty is the common case for scenery, so this
    /// defaults instead of being required.
    #[serde(default)]
    pub interaction: Vec<InteractionDef>,
}

#[derive(Debug, Deserialize)]
pub struct InteractionDef {
    pub id: String,
    /// Need name to the delta this interaction advertises. Sparse: a
    /// need absent from the map is not advertised at all, which is not
    /// the same as advertising zero.
    ///
    /// `BTreeMap` rather than `HashMap`, and this is load-bearing rather
    /// than stylistic. The compiled pack is serialised in iteration
    /// order and feeds a determinism hash, so `HashMap`'s per-process
    /// ordering would surface as a spurious content diff rather than as
    /// an obvious bug. `advert_iteration_is_sorted_not_hash_ordered`
    /// pins it.
    pub advertises: BTreeMap<String, f32>,
    pub duration_ticks: u32,
    pub slots: u8,
}

/// Mirrors `content/lot.toml`: the size of the lot, its interior wall
/// tiles, and where each object stands.
///
/// Walls and placements both default, so an empty lot of a given size is
/// expressible without writing two empty arrays. A lot with no size is
/// not: `width` and `height` are required, because a defaulted zero is
/// exactly the silent-nothing case [D9] exists to prevent.
#[derive(Debug, Deserialize)]
pub struct LotFile {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub wall: Vec<WallDef>,
    #[serde(default)]
    pub place: Vec<PlacementDef>,
}

/// One impassable tile.
///
/// `i32` rather than `u32`, and that is a decision rather than a default.
/// `i32` is the tile coordinate type everywhere else - `TileGrid::
/// is_walkable` and `find_path` both take `(i32, i32)` - and it lets a
/// negative coordinate reach the validator, which reports it against the
/// lot it is outside of. A `u32` would make `x = -1` a serde type error
/// naming neither the lot nor the wall.
#[derive(Debug, Deserialize)]
pub struct WallDef {
    pub x: i32,
    pub y: i32,
}

/// Mirrors `assets/sprites/atlas.toml`, which is **generated** by
/// `assets/sprites/build-atlas.ps1` rather than authored.
///
/// It is read here rather than in the renderer because the check it
/// enables - "every object names a sprite the atlas actually holds" - is
/// a dangling-reference check, and [D9] puts those at build time where
/// they abort the build. The renderer reads the same manifest through
/// its generated `web/src/render/atlas.ts` twin.
///
/// Only the fields the validator needs are declared. `x`, `y`, `w` and
/// `h` are in the file and are deliberately absent here: pixel
/// coordinates are the renderer's business, and a `terri-data` that
/// parsed them would invite something in the simulation to use one.
#[derive(Debug, Deserialize)]
pub struct AtlasFile {
    /// Declaration order is the sprite index. Nothing sorts it.
    pub sprite: Vec<AtlasSpriteDef>,
}

#[derive(Debug, Deserialize)]
pub struct AtlasSpriteDef {
    pub name: String,
}

/// One object, placed. `object` is the string id of an entry in
/// `objects.toml`; the compile step resolves it to an `ObjectDefId`, so
/// a dangling reference has no representation once a pack exists.
///
/// Coordinates are `f32` rather than tile indices because `Position` is
/// an f32 pair: an object may stand anywhere, and the tile it occupies
/// is the tile its coordinates fall in.
#[derive(Debug, Deserialize)]
pub struct PlacementDef {
    pub object: String,
    pub x: f32,
    pub y: f32,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The eight scalar knobs, with pairwise distinct values so that a
    /// field read off the wrong key is visible. Two knobs sharing a value
    /// would make a transposed pair of fields parse identically, which
    /// is [L34] in the tuning file's costume.
    ///
    /// The four `u32`s and the `u64` are deliberately different numbers
    /// for the same reason, and every float is exact in binary32 so the
    /// assertions can be equalities rather than tolerances.
    const TUNING_LINES: [(&str, &str); 9] = [
        ("action_threshold", "0.25"),
        ("choice_temperature", "0.5"),
        ("idle_threshold", "0.125"),
        ("wander_pause_ticks", "9"),
        ("wander_attempts", "6"),
        ("duration_variance", "0.75"),
        ("min_interaction_ticks", "3"),
        ("rng_seed", "300"),
        ("max_queued_intents", "7"),
    ];

    /// The decay table, which is the ninth knob and the only one that is
    /// not a scalar. Its key is named separately because a TOML table has
    /// to be emitted after every top-level key rather than in line with
    /// them.
    const DECAY_KEY: &str = "decay_per_tick";

    /// Three needs rather than seven: this module tests SHAPE, and
    /// "exactly the seven `NeedId` variants" is a compile-step rule.
    /// Distinct rates, again so a value read off the wrong key is visible,
    /// and declared out of alphabetical order so a map that preserved
    /// insertion order would be distinguishable from a sorted one.
    const DECAY_LINES: [(&str, &str); 3] = [
        ("social", "0.0625"),
        ("hunger", "0.03125"),
        ("energy", "0.015625"),
    ];

    /// The fixture above as TOML, minus the named knob. Passing a name
    /// no knob has yields the complete file.
    fn tuning_toml_without(omitted: &str) -> String {
        let mut out: String = TUNING_LINES
            .iter()
            .filter(|(key, _)| *key != omitted)
            .map(|(key, value)| format!("{key} = {value}\n"))
            .collect();
        // The table goes last, because everything after a `[table]`
        // header in TOML belongs to that table.
        if omitted != DECAY_KEY {
            out.push_str(&format!("\n[{DECAY_KEY}]\n"));
            for (need, rate) in DECAY_LINES {
                out.push_str(&format!("{need} = {rate}\n"));
            }
        }
        out
    }

    #[test]
    fn parses_a_tuning_file() {
        let parsed: TuningFile =
            toml::from_str(&tuning_toml_without("")).expect("valid tuning toml");

        assert_eq!(parsed.action_threshold, 0.25);
        assert_eq!(parsed.choice_temperature, 0.5);
        assert_eq!(parsed.idle_threshold, 0.125);
        assert_eq!(parsed.wander_pause_ticks, 9);
        assert_eq!(parsed.wander_attempts, 6);
        assert_eq!(parsed.duration_variance, 0.75);
        assert_eq!(parsed.min_interaction_ticks, 3);
        assert_eq!(parsed.rng_seed, 300);
        assert_eq!(parsed.max_queued_intents, 7);

        assert_eq!(parsed.decay_per_tick.len(), DECAY_LINES.len());
        for (need, rate) in DECAY_LINES {
            assert_eq!(
                parsed.decay_per_tick.get(need),
                Some(&rate.parse::<f32>().expect("the fixture rates are numbers")),
                "'{need}' did not reach the decay table with its own rate"
            );
        }
    }

    /// The decay table is keyed by need NAME while the compiled pack is
    /// keyed by need INDEX, so two orders exist and something has to pick
    /// one. `BTreeMap` iterates sorted; a `HashMap` would iterate in an
    /// order that varies from process to process, and the compiled pack
    /// feeds a determinism hash. Same mechanism, and the same reasoning,
    /// as `advert_iteration_is_sorted_not_hash_ordered` below.
    #[test]
    fn decay_iteration_is_sorted_not_hash_ordered() {
        let declared: Vec<&str> = DECAY_LINES.iter().map(|(need, _)| *need).collect();
        let mut sorted = declared.clone();
        sorted.sort_unstable();
        assert_ne!(
            declared, sorted,
            "the declared order must differ from sorted order, or this \
             test cannot tell an insertion-ordered map from a sorted one"
        );

        let parsed: TuningFile =
            toml::from_str(&tuning_toml_without("")).expect("valid tuning toml");
        let keys: Vec<&str> = parsed
            .decay_per_tick
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        assert_eq!(keys, sorted, "decay iteration order is not sorted");
    }

    /// The rejecting half, and the reason `TuningFile` has no
    /// `#[serde(default)]` anywhere.
    ///
    /// A knob is not merely nicer to require than to default: an
    /// omitted `choice_temperature` defaulting to zero divides by zero
    /// in selection, and an omitted `duration_variance` defaulting to
    /// zero produces a simulation that runs and is simply metronomic.
    /// Both are the silent-nothing case [D9] exists to convert into a
    /// build failure.
    ///
    /// Every field is tried rather than one, because a `#[serde(default)]`
    /// added to a single knob is exactly the edit a one-field test
    /// cannot see.
    #[test]
    fn every_tuning_knob_is_required_rather_than_defaulted() {
        assert!(
            toml::from_str::<TuningFile>(&tuning_toml_without("")).is_ok(),
            "the complete fixture must parse, or the omissions below \
             prove nothing"
        );

        let omissions = TUNING_LINES
            .iter()
            .map(|(key, _)| *key)
            .chain(std::iter::once(DECAY_KEY));
        for omitted in omissions {
            let err = match toml::from_str::<TuningFile>(&tuning_toml_without(omitted)) {
                Ok(parsed) => {
                    panic!("a tuning file missing '{omitted}' must not parse; got {parsed:?}")
                }
                Err(err) => err,
            };
            assert!(
                err.to_string().contains(omitted),
                "the error must name the missing knob '{omitted}'; got {err}"
            );
        }
    }

    #[test]
    fn parses_a_needs_file() {
        let parsed: NeedsFile = toml::from_str(
            r#"
            [[need]]
            id = "hunger"

            [[need]]
            id = "energy"
            "#,
        )
        .expect("valid needs toml");
        assert_eq!(
            parsed
                .need
                .iter()
                .map(|n| n.id.as_str())
                .collect::<Vec<_>>(),
            vec!["hunger", "energy"],
            "needs.toml declares which needs exist, in declaration order"
        );
    }

    #[test]
    fn parses_an_object_with_a_sparse_advert() {
        let parsed: ObjectsFile = toml::from_str(
            r#"
            [[object]]
            id = "fridge"
            name = "Chill-o-Matic 3000"
            sprite = "kitchenFridgeBuiltIn"

              [[object.interaction]]
              id = "grab_snack"
              advertises = { hunger = 35.0 }
              duration_ticks = 15
              slots = 1
            "#,
        )
        .expect("valid objects toml");
        let obj = &parsed.object[0];
        assert_eq!(obj.id, "fridge");
        assert_eq!(obj.sprite, "kitchenFridgeBuiltIn");
        let act = &obj.interaction[0];
        assert_eq!(act.advertises.get("hunger"), Some(&35.0));
        assert_eq!(act.advertises.len(), 1, "advert must stay sparse");
        assert_eq!(act.duration_ticks, 15);
    }

    /// The advert map is written into the compiled pack in iteration
    /// order, and that pack feeds a determinism hash, so the ordering is
    /// a mechanism rather than a detail. `BTreeMap` iterates sorted; a
    /// `HashMap` iterates in an order that varies from process to
    /// process, which would surface downstream as a spurious content
    /// diff rather than as an obvious bug.
    ///
    /// Measured: with `advertises` switched to a `HashMap`, the other
    /// three tests in this module all stay green. This is the only one
    /// that moves.
    #[test]
    fn advert_iteration_is_sorted_not_hash_ordered() {
        // Deliberately not alphabetical. If the source order were sorted
        // then an insertion-ordered map would satisfy the assertion at
        // the bottom too, and the test would stop discriminating between
        // the three map behaviours instead of just two.
        const DECLARED: [&str; 7] = [
            "social", "hunger", "comfort", "fun", "bladder", "energy", "hygiene",
        ];
        let mut sorted = DECLARED;
        sorted.sort_unstable();
        assert_ne!(
            DECLARED, sorted,
            "the declared order must differ from sorted order, or this test proves nothing"
        );

        let adverts = DECLARED
            .iter()
            .enumerate()
            .map(|(i, need)| format!("{need} = {}.0", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let parsed: ObjectsFile = toml::from_str(&format!(
            r#"
            [[object]]
            id = "bed"
            name = "Sleepeazy"
            sprite = "bedBunk"

              [[object.interaction]]
              id = "sleep"
              advertises = {{ {adverts} }}
              duration_ticks = 40
              slots = 1
            "#
        ))
        .expect("valid objects toml");

        let keys: Vec<&str> = parsed.object[0].interaction[0]
            .advertises
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, sorted, "advert iteration order is not sorted");
    }

    #[test]
    fn an_object_may_declare_no_interactions() {
        let parsed: ObjectsFile = toml::from_str(
            r#"
            [[object]]
            id = "rug"
            name = "Rug"
            sprite = "rugRound"
            "#,
        )
        .expect("objects with no interaction should parse");
        assert!(parsed.object[0].interaction.is_empty());
    }

    /// The shipped `lot.toml` uses inline tables inside an array, which
    /// is the only form in which fifteen wall tiles are readable. Serde
    /// accepts both that and `[[wall]]` sections, so this pins the one
    /// the authored file actually uses.
    ///
    /// The fixture is deliberately non-square and its walls are declared
    /// out of sorted order, so a transposed `width`/`height` and a
    /// silently reordered wall list are both visible here.
    #[test]
    fn parses_a_lot_with_walls_and_placements() {
        let parsed: LotFile = toml::from_str(
            r#"
            width = 6
            height = 4

            wall = [
              { x = 3, y = 2 },
              { x = 1, y = 0 },
            ]

            place = [
              { object = "fridge", x = 2.5, y = 1.25 },
            ]
            "#,
        )
        .expect("valid lot toml");

        assert_eq!((parsed.width, parsed.height), (6, 4));
        assert_eq!(
            parsed.wall.iter().map(|w| (w.x, w.y)).collect::<Vec<_>>(),
            vec![(3, 2), (1, 0)],
            "walls must keep the order they were declared in"
        );
        assert_eq!(parsed.place.len(), 1);
        assert_eq!(parsed.place[0].object, "fridge");
        // Fractional on purpose. Every coordinate being an integer would
        // make a truncating parse indistinguishable from a correct one;
        // see [L34].
        assert_eq!((parsed.place[0].x, parsed.place[0].y), (2.5, 1.25));
    }

    /// A lot with nothing in it yet is a legitimate authoring state, and
    /// the `#[serde(default)]` on both lists is what allows it. Without
    /// them, deleting the last object from a lot would turn a size-only
    /// file into a parse error.
    #[test]
    fn a_lot_may_declare_no_walls_and_no_placements() {
        let parsed: LotFile =
            toml::from_str("width = 2\nheight = 3\n").expect("a bare lot size should parse");
        assert!(parsed.wall.is_empty());
        assert!(parsed.place.is_empty());
        assert_eq!((parsed.width, parsed.height), (2, 3));
    }

    /// The size is the one thing that has no sensible default: a lot
    /// silently defaulting to 0x0 has no walkable tile at all, and every
    /// agent in it would simply never move. Serde must reject the file
    /// rather than compile a lot nobody can stand in.
    #[test]
    fn a_lot_without_a_size_is_a_parse_error_rather_than_a_zero_lot() {
        let err = toml::from_str::<LotFile>("wall = []\n").unwrap_err();
        assert!(
            err.to_string().contains("width"),
            "the error must name the missing field; got {err}"
        );
    }
}
