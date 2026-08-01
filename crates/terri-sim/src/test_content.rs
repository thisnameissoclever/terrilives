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
use terri_core::{Footprint, NeedId, SimRng, SmartObject};
use terri_data::{CompiledInteraction, CompiledObject, ContentPack, Tuning};

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
        // What `compile` produces for an interaction that declares no
        // label: the id itself, never an empty string. A fixture with a
        // blank label would be a pack the pipeline refuses to build, for
        // the same reason the sort and the duplicate check above are
        // asserted rather than assumed.
        label: id.to_string(),
        // Untagged and unrewarding, which is what `compile` produces for
        // an interaction that declares neither ([E2]) - most fixtures
        // are chores. Satisfaction tests build their own tagged
        // interactions.
        tags: Vec::new(),
        satisfaction: 0.0,
    }
}

/// An object offering exactly one interaction.
pub fn object(id: &str, advertises: &[(NeedId, f32)], duration_ticks: u32) -> CompiledObject {
    object_offering(id, vec![interaction("use_it", advertises, duration_ticks)])
}

/// An object offering exactly TWO interactions, each given as
/// `(need, delta, duration_ticks)`.
///
/// **All three components differ between the two on purpose, and the
/// helper exists so that they cannot accidentally stop differing.** An
/// interaction index is only observable through what running it DOES, so a
/// fixture whose two interactions advertise the same need for the same
/// amount over the same number of ticks makes "interaction 1 ran" and
/// "interaction 0 ran" agree on every measurement - which is [L34] applied
/// to the one field the whole index exists to carry. With the two
/// separated, three independent things say which one ran: the need that
/// moved, how far it moved, and how long the sim was busy.
///
/// The ids are positional rather than taken from the caller because they
/// are what `compile` uses as the default LABEL, and a menu row's position
/// is its interaction index - so a fixture whose rows read "first" and
/// "second" states the mapping the flyout depends on. `compile` rejects a
/// repeated interaction id within one object, so they must differ anyway.
pub fn object_with_two_interactions(
    id: &str,
    first: (NeedId, f32, u32),
    second: (NeedId, f32, u32),
) -> CompiledObject {
    assert!(
        first.0 != second.0 && first.1 != second.1 && first.2 != second.2,
        "the two interactions must differ in need, delta AND duration, or \
         a test cannot tell which of them ran"
    );
    object_offering(
        id,
        vec![
            interaction("first", &[(first.0, first.1)], first.2),
            interaction("second", &[(second.0, second.1)], second.2),
        ],
    )
}

/// An object offering several interactions, in the given order.
///
/// The sprite is the sim's, because nothing in `terri-sim` renders and
/// every fixture here would otherwise have to invent an atlas index that
/// no atlas backs. `render_buffer.rs` is where the sprite column is
/// actually pinned, and it uses shipped content so the index means
/// something.
pub fn object_offering(id: &str, interactions: Vec<CompiledInteraction>) -> CompiledObject {
    object_sized(id, interactions, Footprint::SINGLE)
}

/// An object of a given size, for the tests that are about footprints.
///
/// One tile is the default everywhere else on purpose. Every distance,
/// arrival tile and score in this crate's fixtures was written against a
/// one-tile object, so widening the shared helper would silently move all
/// of them at once - and the first symptom would be an unrelated scoring
/// assertion off by one step.
pub fn object_sized(
    id: &str,
    interactions: Vec<CompiledInteraction>,
    footprint: Footprint,
) -> CompiledObject {
    CompiledObject {
        id: id.to_string(),
        name: id.to_string(),
        sprite: terri_data::pack().sim_sprite,
        interactions,
        footprint,
        // Roleless, like most furniture; chain tests wear their own.
        roles: Vec::new(),
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
    pack_tuned(objects, tuning())
}

/// A pack holding these objects with the given knobs, for the tests that
/// have to vary one.
///
/// Three knobs are varied today. Two are because selection became a
/// WEIGHTED draw: `choice_temperature` is turned down where a test names a
/// golden winner, so the assertion is about scoring rather than about the
/// outcome of a coin toss, and `rng_seed` is varied where the draw itself
/// is what is under test. The third is `duration_variance`, turned to zero
/// where a test names an interaction by how LONG it ran - [D-4] samples a
/// duration around the content number, and two interactions' sampled bands
/// can overlap even when their content durations differ, so a measured
/// length cannot otherwise name the interaction it came from. Every caller
/// builds its override by spreading
/// [`tuning`] rather than writing literals, so nothing else moves with
/// it - `action_threshold` in particular stays the number every scoring
/// assertion in the suite is written against.
/// A pack with a SOCIAL vocabulary as well as objects - the explicit
/// opt-in `pack_tuned`'s empty default requires of every test about sims
/// talking. The entries come from [`interaction`], because a social
/// interaction IS a `CompiledInteraction`; the vocabulary is what a sim
/// advertises instead of what an object does.
pub fn pack_with_social(
    objects: Vec<CompiledObject>,
    social: Vec<CompiledInteraction>,
    tuning: Tuning,
) -> &'static ContentPack {
    let pack = pack_tuned(objects, tuning);
    // Leaked like everything here; one clone per call in a test process.
    Box::leak(Box::new(ContentPack {
        traits: Vec::new(),
        social,
        ..pack.clone()
    }))
}

pub fn pack_tuned(objects: Vec<CompiledObject>, tuning: Tuning) -> &'static ContentPack {
    Box::leak(Box::new(ContentPack {
        traits: Vec::new(),
        decay_per_tick: terri_data::pack().decay_per_tick,
        objects,
        sim_sprite: terri_data::pack().sim_sprite,
        // Same reasoning as the decay rates: copy the shipped lot rather
        // than invent one. Nothing in `terri-sim` reads `pack.lot` yet -
        // `sim_with` builds its own `TileGrid` and spawns objects
        // explicitly - so a fixture lot would be an invented constant
        // with no reader, which is worse than a real one with no reader.
        lot: terri_data::pack().lot.clone(),
        // And again: `select_action` compares against
        // `tuning.action_threshold`, so a fixture with its own knobs
        // would silently change the threshold every scoring assertion in
        // the suite is written against. `pack` passes `tuning()` here,
        // so a test stating the threshold and the pack the sim reads it
        // from have ONE source rather than two that agree today.
        tuning,
        // Empty rather than the shipped people, deliberately, and the
        // opposite call from the lot above. `sim_with` spawns its own
        // agents explicitly, so a fixture pack that also carried Terri,
        // Doug and Nadia would let `spawn_household` in some future test
        // add three extra sims nobody's assertions account for - the
        // shipped household is content for the shipped GAME, and a
        // fixture household is whatever the test spawns.
        personalities: Vec::new(),
        household: Vec::new(),
        // Empty, the same call as the household above and for the same
        // reason: the social vocabulary makes every OTHER sim a
        // candidate, so a fixture pack that silently carried the shipped
        // "chat" would let two-agent contention fixtures start choosing
        // each other - candidates nobody's assertions account for. A
        // test about sims talking installs a vocabulary explicitly, the
        // way a test about an object spawns the object.
        social: Vec::new(),
        // Empty for the same reason as the household: a career preempts
        // its holder on the day clock, and a fixture pack that silently
        // carried the shipped job would march test sims off the lot at
        // times nobody's assertions account for. A test about careers
        // installs one explicitly.
        careers: Vec::new(),
        // Empty, the same call once more: a fixture pack that silently
        // carried the shipped dinner chain would give every hungry
        // test sim a four-station errand nobody's assertions account
        // for. A test about chains installs one explicitly.
        roles: Vec::new(),
        item_kinds: Vec::new(),
        chains: Vec::new(),
    }))
}

/// The knobs the simulation actually runs on, read from the same content
/// the shipped pack carries rather than restated as a literal.
///
/// This is what a test asserting "the losing candidate still clears the
/// action threshold" must compare against. Hardcoding `0.05` there would
/// leave the test green while silently no longer testing the real
/// threshold, from the first time anybody tunes it.
pub fn tuning() -> terri_data::Tuning {
    terri_data::pack().tuning
}

/// A sim reading `content` instead of the shipped pack.
///
/// The PRNG is reseeded from `content` as well, because `Sim::new` seeds
/// it from the SHIPPED pack and selection draws from it. Without this a
/// fixture that set its own `rng_seed` would be silently ignored, and a
/// test written around a specific draw would be testing the shipped seed
/// while claiming to test its own.
pub fn sim_with(width: usize, height: usize, content: &'static ContentPack) -> Sim {
    let mut sim = Sim::new_with_lot(width, height);
    sim.world_mut().insert_resource(Content(content));
    sim.world_mut()
        .insert_resource(SimRng::from_seed(content.tuning.rng_seed));
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

/// A shipped object as a component, by its `content/objects.toml` id.
///
/// Tests that are about the simulation rather than about scoring use
/// real content on purpose, so they pin behaviour the game actually has.
pub fn shipped_object(id: &str) -> SmartObject {
    SmartObject(
        terri_data::pack()
            .find(id)
            .unwrap_or_else(|| panic!("content/objects.toml declares no '{id}'")),
    )
}

/// The shipped fridge as a component.
pub fn shipped_fridge() -> SmartObject {
    shipped_object("fridge")
}
