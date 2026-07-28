//! Serde mirrors of the two TOML content files.
//!
//! These types describe the *shape* content must have; they say nothing
//! about whether it is valid. Serde cannot express "every `NeedId`
//! appears exactly once" or "this need name is one rustc knows about",
//! so those checks live in the compile step and report `ContentError`.

use serde::Deserialize;
use std::collections::BTreeMap;

/// Mirrors `content/needs.toml`. Every `NeedId` variant must appear
/// exactly once; that is checked in the compile step, not here, because
/// serde cannot express it.
#[derive(Debug, Deserialize)]
pub struct NeedsFile {
    pub need: Vec<NeedDef>,
}

#[derive(Debug, Deserialize)]
pub struct NeedDef {
    /// Matches `NeedId::as_str`. An unknown name is a content error, not
    /// a parse error, so this stays a `String` here.
    pub id: String,
    pub decay_per_tick: f32,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_needs_file() {
        let parsed: NeedsFile = toml::from_str(
            r#"
            [[need]]
            id = "hunger"
            decay_per_tick = 0.104
            "#,
        )
        .expect("valid needs toml");
        assert_eq!(parsed.need.len(), 1);
        assert_eq!(parsed.need[0].id, "hunger");
        assert_eq!(parsed.need[0].decay_per_tick, 0.104);
    }

    #[test]
    fn parses_an_object_with_a_sparse_advert() {
        let parsed: ObjectsFile = toml::from_str(
            r#"
            [[object]]
            id = "fridge"
            name = "Chill-o-Matic 3000"

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
            "#,
        )
        .expect("objects with no interaction should parse");
        assert!(parsed.object[0].interaction.is_empty());
    }
}
