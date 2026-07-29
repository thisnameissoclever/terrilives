//! Content schema, validation, and the compiled pack.
//!
//! Deliberately free of `bevy_ecs` and of anything web. This crate is
//! read by `build.rs` at build time and by the simulation at run time,
//! so it has to compile for the host and for `wasm32-unknown-unknown`.

pub mod compile;
pub mod error;
pub mod pack;
pub mod schema;

pub use compile::{compile, SIM_SPRITE};
pub use error::ContentError;
pub use pack::{
    CompiledInteraction, CompiledLot, CompiledObject, CompiledPlacement, ContentPack, ObjectDefId,
    Tuning,
};
pub use schema::{
    AtlasFile, AtlasSpriteDef, InteractionDef, LotFile, NeedDef, NeedsFile, ObjectDef, ObjectsFile,
    PlacementDef, TuningFile, WallDef,
};

use std::sync::OnceLock;

/// Written by `build.rs` from `content/*.toml` into `OUT_DIR`, so these
/// bytes and the source content cannot disagree: they are produced by
/// the same build that compiles this file.
static PACK_BYTES: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/content_pack.postcard"));

/// The compiled content pack, deserialised once on first use.
///
/// Cannot fail at runtime: build.rs aborts the build on invalid content,
/// and the bytes are embedded from that same build.
pub fn pack() -> &'static ContentPack {
    static PACK: OnceLock<ContentPack> = OnceLock::new();
    PACK.get_or_init(|| {
        postcard::from_bytes(PACK_BYTES).expect("embedded pack was written by build.rs")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_embedded_pack_deserialises_and_holds_the_fridge() {
        let p = pack();
        let id = p
            .find("fridge")
            .expect("content/objects.toml declares a fridge");
        let fridge = p.object(id);
        assert_eq!(fridge.interactions.len(), 1);
        let act = &fridge.interactions[0];
        assert_eq!(act.id, "grab_snack");
        assert_eq!(act.duration_ticks, 15);
        assert_eq!(
            act.advertises,
            vec![(terri_core::NeedId::Hunger.index() as u8, 40.0)]
        );
    }

    #[test]
    fn every_need_has_a_finite_decay_rate() {
        // compile() fills this array from content and leaves NaN where a
        // rate is missing, so a NaN here means validation was bypassed.
        for id in terri_core::NeedId::ALL {
            let rate = pack().decay_per_tick[id.index()];
            assert!(rate.is_finite(), "{} has no decay rate", id.as_str());
        }
    }

    #[test]
    fn the_pack_is_the_same_instance_every_call() {
        assert!(
            std::ptr::eq(pack(), pack()),
            "pack must be deserialised once"
        );
    }

    /// [D6] calls for roughly eight objects so that a sim has something
    /// to decide between; with one, selection is a threshold rather than
    /// a decision. Asserting the count is what keeps a content edit that
    /// deletes half the house from being invisible to the suite.
    ///
    /// Every id is named rather than just counted, because eight objects
    /// with the wrong names is the same number.
    #[test]
    fn the_shipped_pack_declares_every_object_the_design_calls_for() {
        let p = pack();
        let mut ids: Vec<&str> = p.objects.iter().map(|o| o.id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(
            ids,
            [
                "bed",
                "bookshelf",
                "fridge",
                "shower",
                "sink",
                "sofa",
                "television",
                "toilet"
            ]
        );
    }

    /// The sofa is where [D6]'s scoring SUMS across advertised deltas is
    /// TUNED to be observable: neither 18 fun nor 34 comfort beats the
    /// television's 30 fun alone, and together they can. Until it existed
    /// that summing was exercised only by in-memory fixtures.
    ///
    /// "Two needs" alone would not be the claim, because the shower has
    /// advertised two since M1b and is declared earlier in the file. Its
    /// pair is a benefit and a COST, which exercises the sign carried
    /// through `score_advertisement` rather than the summing - which is
    /// why this test asserts the two separately. The television's
    /// `social` + `fun` is a third case again, two positive deltas that
    /// were not chosen to make the summing decide anything.
    ///
    /// The shower is the one that advertises a NEGATIVE delta, which M1a
    /// rejected outright. Both are asserted here because both are claims
    /// about shipped content that a rebalance could quietly drop.
    #[test]
    fn the_shipped_pack_carries_a_multi_need_advert_and_a_negative_one() {
        let p = pack();

        let sofa = p.object(p.find("sofa").expect("objects.toml declares a sofa"));
        let lounge = &sofa.interactions[0];
        assert_eq!(
            lounge.advertises,
            vec![
                (terri_core::NeedId::Fun.index() as u8, 18.0),
                (terri_core::NeedId::Comfort.index() as u8, 34.0),
            ],
            "the sofa must advertise two needs, index-ordered"
        );

        let shower = p.object(p.find("shower").expect("objects.toml declares a shower"));
        let take = &shower.interactions[0];
        let energy = take
            .advertises
            .iter()
            .find(|(index, _)| *index == terri_core::NeedId::Energy.index() as u8)
            .expect("the shower must advertise energy");
        assert!(
            energy.1 < 0.0,
            "the shower's energy delta is a COST and must stay negative; got {}",
            energy.1
        );
    }

    /// The lot the game actually loads. `compile` rejects a wall or a
    /// placement outside the lot, so these assertions cannot fail on
    /// shipped content without the build having failed first - which is
    /// the point: this test is what fails if the lot is ever loaded from
    /// somewhere the build gate does not cover.
    #[test]
    fn the_shipped_lot_places_every_object_inside_the_lot_and_off_the_walls() {
        let p = pack();
        let lot = &p.lot;

        assert!(lot.width > 0 && lot.height > 0);
        assert!(!lot.walls.is_empty(), "the lot must have interior walls");
        assert!(
            !lot.placements.is_empty(),
            "an empty lot would satisfy every assertion below vacuously"
        );

        for (x, y) in &lot.walls {
            assert!(
                *x < lot.width && *y < lot.height,
                "wall ({x}, {y}) is outside the {}x{} lot",
                lot.width,
                lot.height
            );
        }

        for placement in &lot.placements {
            let object = p.object(placement.object);
            assert!(
                placement.x >= 0.0
                    && placement.y >= 0.0
                    && placement.x < lot.width as f32
                    && placement.y < lot.height as f32,
                "'{}' at ({}, {}) is outside the lot",
                object.id,
                placement.x,
                placement.y
            );
            assert!(
                !lot.is_wall(placement.x as u32, placement.y as u32),
                "'{}' stands on a wall and would be unreachable",
                object.id
            );
        }
    }

    /// Every shipped object draws as something, and as something of its
    /// own.
    ///
    /// The build already refuses a sprite the atlas does not hold, so
    /// this is not re-checking that. What it checks is the thing
    /// validation deliberately permits and a copy-paste in
    /// `objects.toml` would produce: two objects sharing one sprite, so
    /// the sofa and the television are the same picture and the play
    /// session judges a room it cannot read. Nothing else in the
    /// pipeline treats that as an error.
    #[test]
    fn every_shipped_object_draws_as_a_different_sprite() {
        let p = pack();
        let mut sprites: Vec<u32> = p.objects.iter().map(|o| o.sprite).collect();
        assert_eq!(sprites.len(), 8, "the design calls for eight objects");
        sprites.push(p.sim_sprite);
        let before = sprites.len();
        sprites.sort_unstable();
        sprites.dedup();
        assert_eq!(
            sprites.len(),
            before,
            "two shipped objects share a sprite, or one of them is drawn \
             as the sim; every id in objects.toml must name its own"
        );
    }

    /// The knobs `content/tuning.toml` authors, read back off the pack
    /// the game actually loads.
    ///
    /// `compile` rejects an incoherent set, so these cannot be wrong on
    /// shipped content without the build having failed first. What this
    /// adds is the wiring: that the file is read at all, that each value
    /// lands on its own field, and that a knob is not quietly reading
    /// its neighbour. Every asserted value differs from every other, so
    /// a transposed pair moves it.
    ///
    /// The numbers are restated here rather than read from the file
    /// because that is the point - a tuning pass that changes one of
    /// them should have to say so here, which is where somebody
    /// reviewing a balance change will look.
    #[test]
    fn the_shipped_pack_carries_the_authored_tuning() {
        let t = pack().tuning;

        assert_eq!(t.action_threshold, 0.05);
        assert_eq!(t.choice_temperature, 0.06);
        assert_eq!(t.idle_threshold, 0.04);
        assert_eq!(t.wander_pause_ticks, 20);
        assert_eq!(t.duration_variance, 0.4);
        assert_eq!(t.min_interaction_ticks, 12);
        assert_eq!(t.rng_seed, 20260728);
        assert_eq!(t.max_queued_intents, 4);
        assert_eq!(t.max_queued_commands, 64);
        assert_eq!(t.need_bar_refresh_ms, 100);
    }

    /// Every object the design declares is actually placed. An object in
    /// `objects.toml` that nothing puts on the lot cannot be chosen, so
    /// it contributes nothing to the decision the milestone exists to
    /// evaluate - and nothing else in the pipeline notices.
    #[test]
    fn every_declared_object_is_placed_on_the_lot() {
        let p = pack();
        let mut placed: Vec<&str> = p
            .lot
            .placements
            .iter()
            .map(|placement| p.object(placement.object).id.as_str())
            .collect();
        placed.sort_unstable();
        placed.dedup();

        let mut declared: Vec<&str> = p.objects.iter().map(|o| o.id.as_str()).collect();
        declared.sort_unstable();

        assert_eq!(placed, declared, "every declared object must be placed");
    }

    /// Every declared need has some way to be satisfied.
    ///
    /// The same shape of check as
    /// `every_declared_object_is_placed_on_the_lot` above, one layer in: an
    /// object nothing places cannot be chosen, and a need nothing
    /// advertises cannot be filled. Both are content that exists and does
    /// nothing, and neither has any behavioural effect - which is precisely
    /// why nothing else in the pipeline notices. `social` was in exactly
    /// this state until M1c's close-out: declared, decaying at 0.035 a
    /// tick, pinned at zero from about tick 2 857 onward, and invisible to
    /// the entire suite because **nothing scored it and nothing tested it,
    /// which are the same condition.** Recorded as [C2] in
    /// `docs/alpha-feel-notes.md`.
    ///
    /// The rule is a POSITIVE delta rather than mere presence, and that is
    /// load-bearing rather than pedantic. A delta may legally be negative -
    /// the shower's `energy = -12.0` is a cost, and scoring weighs it - so
    /// "appears somewhere in an advert list" is satisfied by a need that
    /// can only ever be *drained*, which is exactly as unfillable as
    /// `social` was. Energy is separately advertised `+100` by the bed, so
    /// the weaker rule would pass today either way and would go on passing
    /// through the content edit that broke it.
    ///
    /// This composes with its neighbour rather than repeating it: every
    /// declared object is placed, so an advert found here is one a sim can
    /// actually walk to.
    #[test]
    fn every_declared_need_can_be_satisfied_by_some_interaction() {
        let p = pack();

        // Per testing-protocol rule 5. A pack with no objects, or objects
        // with no interactions, would fail every assertion below for a
        // reason that is not the one this test names.
        assert!(!p.objects.is_empty(), "an empty pack advertises nothing");
        assert!(
            p.objects.iter().any(|o| !o.interactions.is_empty()),
            "objects with no interactions advertise nothing"
        );

        for id in terri_core::NeedId::ALL {
            let index = id.index() as u8;
            let satisfied_by = p.objects.iter().find(|object| {
                object.interactions.iter().any(|act| {
                    act.advertises
                        .iter()
                        .any(|(need, delta)| *need == index && *delta > 0.0)
                })
            });
            assert!(
                satisfied_by.is_some(),
                "'{}' is declared in content/needs.toml, drains every tick, \
                 and no interaction advertises a positive delta for it - so \
                 its bar can only ever empty. Either give an object an \
                 advert that fills it, or stop declaring the need until \
                 something can. See [C2] in docs/alpha-feel-notes.md.",
                id.as_str()
            );
        }
    }
}
