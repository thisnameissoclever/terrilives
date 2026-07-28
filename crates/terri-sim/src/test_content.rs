//! Content packs built in memory, for tests only.
//!
//! `content/objects.toml` declares one object, and several tests in this
//! crate need two or three with deltas chosen to make a specific
//! comparison observable. Those fixtures live here rather than in shipped
//! content: anything in `content/` is an object every agent in the game
//! can walk up to and use, and an object tuned to produce a bitwise tie
//! is not something to ship.
//!
//! It lives in `terri-sim` rather than behind `#[cfg(test)]` in
//! `terri-data` because a `#[cfg(test)]` item is compiled only into its
//! own crate's test binary. `terri-sim`'s tests are a separate
//! compilation unit and would not see one.

use crate::{Content, Sim};
use terri_core::{NeedId, SmartObject};
use terri_data::{CompiledInteraction, CompiledObject, ContentPack};

/// One interaction advertising the given (need, delta) pairs.
///
/// The adverts are sorted by need index, because that is what `compile`
/// produces and what `CompiledInteraction::advertises` documents. A
/// fixture that skipped the sort would be testing a pack the pipeline
/// cannot actually build.
pub fn interaction(
    id: &str,
    advertises: &[(NeedId, f32)],
    duration_ticks: u32,
) -> CompiledInteraction {
    assert!(
        duration_ticks >= 1,
        "`compile` rejects a zero duration, so no fixture may have one; \
         the systems divide by this"
    );
    let mut advertises: Vec<(u8, f32)> = advertises
        .iter()
        .map(|(need, delta)| (need.index() as u8, *delta))
        .collect();
    advertises.sort_unstable_by_key(|(index, _)| *index);
    // Authored adverts are a `BTreeMap<String, f32>` keyed by need name,
    // and `compile` pushes one entry per key, so a compiled pack cannot
    // name the same need twice. Same reasoning as the sort above: a
    // fixture able to express that would be testing a pack the pipeline
    // cannot build. Checked after sorting, where duplicates are adjacent.
    assert!(
        advertises.windows(2).all(|w| w[0].0 != w[1].0),
        "`compile` emits at most one advert per need, so no fixture may \
         name one twice"
    );
    CompiledInteraction {
        id: id.to_string(),
        advertises,
        duration_ticks,
        slots: 1,
    }
}

/// An object offering exactly one interaction.
pub fn object(id: &str, advertises: &[(NeedId, f32)], duration_ticks: u32) -> CompiledObject {
    object_offering(id, vec![interaction("use_it", advertises, duration_ticks)])
}

/// An object offering several interactions, in the given order.
pub fn object_offering(id: &str, interactions: Vec<CompiledInteraction>) -> CompiledObject {
    CompiledObject {
        id: id.to_string(),
        name: id.to_string(),
        interactions,
    }
}

/// A pack holding exactly these objects, with the **shipped** decay
/// rates.
///
/// Copying the real rates rather than inventing them is deliberate:
/// `decay_needs` reads them, so a fixture with its own rates would
/// silently change how fast needs move in every test that installs one,
/// and every timing and threshold assertion in the suite depends on that.
///
/// Leaked because [`Content`] holds a `&'static`. One small allocation
/// per call, in a test process, bounded by the number of tests.
pub fn pack(objects: Vec<CompiledObject>) -> &'static ContentPack {
    Box::leak(Box::new(ContentPack {
        decay_per_tick: terri_data::pack().decay_per_tick,
        objects,
    }))
}

/// A sim reading `content` instead of the shipped pack.
pub fn sim_with(width: usize, height: usize, content: &'static ContentPack) -> Sim {
    let mut sim = Sim::new_with_lot(width, height);
    sim.world_mut().insert_resource(Content(content));
    sim
}

/// The rate `decay_needs` actually drains `need` at, read from the same
/// content the simulation reads rather than restated as a literal.
///
/// Spawning one tick's worth above a level is how several tests arrange
/// for scoring to see an exact number: decay runs immediately before
/// selection. Every need decays from Task 7 onward, so a test that pins
/// two needs to the same post-tick level has to offset both, each by its
/// own rate - the rates are deliberately all different.
pub fn decay_per_tick(need: NeedId) -> f32 {
    terri_data::pack().decay_per_tick[need.index()]
}

/// The shipped fridge as a component.
///
/// Tests that are about the simulation rather than about scoring use
/// real content on purpose, so they pin behaviour the game actually has.
pub fn shipped_fridge() -> SmartObject {
    SmartObject(
        terri_data::pack()
            .find("fridge")
            .expect("content/objects.toml declares a fridge"),
    )
}
