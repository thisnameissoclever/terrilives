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
    CompiledCareer, CompiledChain, CompiledChainStep, CompiledHouseholdMember, CompiledInteraction,
    CompiledLot, CompiledObject, CompiledPersonality, CompiledPlacement, CompiledTrait,
    CompiledTraitKind, ContentPack, Footprint, ObjectDefId, Tuning,
};
pub use schema::{
    ArchetypeDef, AtlasFile, AtlasSpriteDef, DispositionDef, HouseholdFile, HouseholdSimDef,
    InteractionDef, LotFile, NeedDef, NeedsFile, ObjectDef, ObjectsFile, PersonalitiesFile,
    PlacementDef, TraitDef, TraitsFile, TuningFile, WallDef, MAX_HOUSEHOLD_SIZE, TRAIT_KINDS,
};

use std::sync::OnceLock;

/// Written by `build.rs` from `content/*.toml` into `OUT_DIR`, so these
/// bytes and the source content cannot disagree: they are produced by
/// the same build that compiles this file.
static PACK_BYTES: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/content_pack.postcard"));

/// The part of a content pack a SAVE can point at, hashed.
///
/// A save records this value and refuses to load against content whose
/// answer differs, because a `SavedEating` naming interaction 2 of the
/// bookcase is nonsense against a bookcase that now offers one.
///
/// **This used to hash the whole serialised pack, and that was wrong in
/// a way the owner had to report.** Every deploy invalidated every save,
/// because every deploy changed something: a balance number, a new
/// sprite, a renamed sim. The message "Saved game is invalid. Starting a
/// new game." was accurate and useless - the save was fine, and nothing
/// it referred to had moved.
///
/// What is hashed here is exactly what a `SaveSnapshotV1` can address,
/// and the shape of that list is dictated by `terri-core`'s save structs
/// rather than chosen:
///
/// * Object ids, and each object's interaction ids IN ORDER. Saves name
///   objects by string, so their order is free; interactions are named by
///   INDEX, so theirs is not.
/// * The social vocabulary's ids in order - `SavedSocialising` holds an
///   index into it.
/// * Each chain's id and how many steps it has - `SavedChainState` holds
///   a step index.
/// * The item kinds, careers, traits and hobbies a save names by string.
///   Order is free; existence is not.
///
/// What is deliberately NOT hashed: every number in `tuning.toml`, every
/// advert delta and duration, every sprite index, every sim's NAME, the
/// lot, and the circadian curve. A save that loads into retuned content
/// simply plays under the new numbers, which is what a player wants and
/// what a designer iterating on balance needs.
///
/// The cost of the narrower rule, stated plainly: change a delta and a
/// mid-flight interaction finishes under the new one. That is a save
/// continuing into a patched game, which is the normal thing for a game
/// to do, and not the "restored simulation continues under different
/// rules" hazard the wide hash was written for - that hazard is about
/// indices pointing somewhere else, and indices are what is still hashed.
pub fn content_fingerprint(pack: &ContentPack) -> u64 {
    let mut hasher = terri_core::FnvHasher::default();
    // A separator between every list, so that moving a name from one
    // vocabulary to another changes the hash. Without it the careers
    // ["a"] and the traits ["b"] hash the same as careers ["a", "b"] and
    // no traits.
    let field = |hasher: &mut terri_core::FnvHasher, tag: u8| {
        hasher.write_bytes(&[0xff, tag]);
    };

    field(&mut hasher, 0);
    for object in &pack.objects {
        hasher.write_bytes(object.id.as_bytes());
        hasher.write_bytes(&[0]);
        for interaction in &object.interactions {
            hasher.write_bytes(interaction.id.as_bytes());
            hasher.write_bytes(&[1]);
        }
        hasher.write_bytes(&[2]);
    }

    field(&mut hasher, 1);
    for interaction in &pack.social {
        hasher.write_bytes(interaction.id.as_bytes());
        hasher.write_bytes(&[0]);
    }

    field(&mut hasher, 2);
    for chain in &pack.chains {
        hasher.write_bytes(chain.id.as_bytes());
        hasher.write_bytes(&(chain.steps.len() as u32).to_le_bytes());
    }

    field(&mut hasher, 3);
    for kind in &pack.item_kinds {
        hasher.write_bytes(kind.as_bytes());
        hasher.write_bytes(&[0]);
    }

    field(&mut hasher, 4);
    for career in &pack.careers {
        hasher.write_bytes(career.id.as_bytes());
        hasher.write_bytes(&[0]);
    }

    field(&mut hasher, 5);
    for trait_def in &pack.traits {
        hasher.write_bytes(trait_def.id.as_bytes());
        hasher.write_bytes(&[0]);
    }

    hasher.finish()
}

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
        // 30 since the alpha balance pass; it was 15, which sat below the
        // clipping line and made the fridge deliver more hunger than it
        // advertised. `no_shipped_interaction_is_clipped_by_the_interaction_floor`
        // in compile.rs is the rule; this is just deserialisation.
        assert_eq!(act.duration_ticks, 30);
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

    /// The shipped dinner chain, end to end through the embedded pack:
    /// four steps at four stations, hands that add up (yield, carry,
    /// transform, consume), the cooking tag on the hob step where
    /// Doug's hobby and Nadia's capability will find it, and the
    /// terminal-only payoff. A content edit that dropped a step or a
    /// station would land here before it landed in play.
    #[test]
    fn the_shipped_pack_carries_the_dinner_chain() {
        let p = pack();
        let chain = p
            .chains
            .iter()
            .find(|c| c.id == "cook_dinner")
            .expect("content/chains.toml declares cook_dinner");
        assert_eq!(p.object(chain.advertised_by).id, "fridge");
        assert_eq!(chain.steps.len(), 4);

        let role = |i: usize| p.roles[chain.steps[i].role as usize].as_str();
        assert_eq!(
            [role(0), role(1), role(2), role(3)],
            ["cold_storage", "prep_surface", "hob", "eating_surface"]
        );
        assert_eq!(chain.steps[2].tags, vec!["cooking".to_string()]);

        let kind = |i: u32| p.item_kinds[i as usize].as_str();
        assert_eq!(chain.steps[0].yields.map(kind), Some("ingredients"));
        assert_eq!(
            chain.steps[2].transforms.map(|(f, t)| (kind(f), kind(t))),
            Some(("ingredients", "dinner"))
        );
        assert_eq!(chain.steps[3].consumes.map(kind), Some("dinner"));

        assert!(
            chain.advertises.iter().any(|(_, delta)| *delta > 0.0),
            "a dinner that feeds nobody is not a dinner"
        );
        assert!(chain.satisfaction > 0.0);
    }

    #[test]
    fn the_pack_is_the_same_instance_every_call() {
        assert!(
            std::ptr::eq(pack(), pack()),
            "pack must be deserialised once"
        );
    }

    /// **The fingerprint moves when an INDEX a save holds would move, and
    /// stays put otherwise.** Both halves matter and the second half is
    /// the one that was wrong: the fingerprint used to hash the whole
    /// serialised pack, so every deploy invalidated every save and the
    /// owner saw "Saved game is invalid" after each one.
    #[test]
    fn the_fingerprint_moves_only_when_a_saved_reference_would() {
        let original = pack().clone();
        let base = content_fingerprint(&original);

        // Renaming an interaction moves it: `SavedEating` holds an INDEX
        // into the object's list, so the id is what pins that index to a
        // meaning.
        let mut renamed = original.clone();
        renamed.objects[0].interactions[0].id = "something_else".to_string();
        assert_ne!(base, content_fingerprint(&renamed), "an interaction id");

        // Adding an interaction changes how many indices are valid, and
        // dropping one invalidates the last. No shipped object offers two
        // today, so this grows one rather than clipping one.
        let mut longer = original.clone();
        let extra = longer.objects[0].interactions[0].clone();
        longer.objects[0].interactions.push(CompiledInteraction {
            id: "an_extra_row".to_string(),
            ..extra
        });
        assert_ne!(base, content_fingerprint(&longer), "an interaction count");

        // Deleting an object entirely: saves name objects by string, so a
        // save pointing at this one has nothing to resolve to.
        let mut fewer = original.clone();
        fewer.objects.pop();
        assert_ne!(base, content_fingerprint(&fewer), "an object");

        // Reordering the social vocabulary: `SavedSocialising` holds an
        // index into it.
        if original.social.len() > 1 {
            let mut swapped = original.clone();
            swapped.social.swap(0, 1);
            assert_ne!(base, content_fingerprint(&swapped), "social order");
        }

        // A chain losing a step: `SavedChainState` holds a step index.
        let mut clipped = original.clone();
        assert!(!clipped.chains.is_empty(), "the fixture needs a chain");
        clipped.chains[0].steps.pop();
        assert_ne!(base, content_fingerprint(&clipped), "a chain's length");

        // And the other half. None of these can move an index, so none of
        // them may cost a player their game.
        let mut retuned = original.clone();
        retuned.tuning.rng_seed ^= 1;
        retuned.tuning.action_threshold += 0.01;
        retuned.tuning.asleep_decay_scale = 1.0;
        assert_eq!(base, content_fingerprint(&retuned), "a balance pass");

        let mut renamed_sim = original.clone();
        assert!(!renamed_sim.household.is_empty(), "the fixture needs a sim");
        renamed_sim.household[0].name = "Somebody Else".to_string();
        assert_eq!(base, content_fingerprint(&renamed_sim), "a sim's name");

        let mut redrawn = original.clone();
        redrawn.sim_sprite += 1;
        redrawn.objects[0].sprite += 1;
        assert_eq!(base, content_fingerprint(&redrawn), "an art pass");

        let mut regraded = original.clone();
        regraded.objects[0].interactions[0].duration_ticks += 5;
        regraded.objects[0].interactions[0].advertises[0].1 += 1.0;
        assert_eq!(base, content_fingerprint(&regraded), "an advert edit");
    }

    /// One vocabulary's name must not be able to masquerade as another's.
    ///
    /// Without a separator between the lists, careers `["a"]` beside
    /// traits `["b"]` hashes the same as careers `["a", "b"]` beside no
    /// traits - and a save naming career "b" would load against content
    /// where "b" is a trait.
    #[test]
    fn the_fingerprints_lists_cannot_bleed_into_one_another() {
        let mut moved = pack().clone();
        assert!(!moved.careers.is_empty() && !moved.traits.is_empty());
        let borrowed = moved.careers[0].id.clone();
        moved.traits[0].id = borrowed;
        assert_ne!(
            content_fingerprint(pack()),
            content_fingerprint(&moved),
            "a name moving between vocabularies must change the hash"
        );
    }

    /// [D6] calls for enough objects that a sim has something to decide
    /// between; with one, selection is a threshold rather than a decision.
    /// Asserting the roster is what keeps a content edit that deletes half
    /// the house from being invisible to the suite.
    ///
    /// Every id is named rather than just counted, because thirty objects
    /// with the wrong names is the same number.
    ///
    /// The list grew from eight to thirty with the five-room house; see
    /// `docs/specs/2026-07-30-the-house-design.md`. About half of the new
    /// entries advertise nothing at all, which is a category rather than an
    /// omission - see `at_least_a_third_of_the_house_is_furniture_nobody_uses`
    /// below.
    #[test]
    fn the_shipped_pack_declares_every_object_the_design_calls_for() {
        let p = pack();
        let mut ids: Vec<&str> = p.objects.iter().map(|o| o.id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(
            ids,
            [
                "armchair",
                "bathtub",
                "bed",
                "bookshelf",
                "chair",
                "coat_rack",
                "counter",
                "desk",
                "desk_chair",
                "dining_table",
                "double_bed",
                "dresser",
                "floor_lamp",
                "fridge",
                "kitchen_sink",
                "laundry",
                "long_sofa",
                "moving_box",
                "nightstand",
                "potted_plant",
                "radio",
                "reading_chair",
                "reference_shelf",
                "shower",
                "sink",
                "sofa",
                "stove",
                "television",
                "toilet",
                "trashcan",
            ]
        );
    }

    /// **The house has at least 25 things standing in it.** That is goal
    /// item 8 stated as a number, and it is about PLACEMENTS rather than
    /// definitions: two counters and two chairs share one definition each,
    /// so counting `objects` would undercount what a player sees.
    ///
    /// A floor rather than an equality, because adding another chair should
    /// not be a test edit. The roster test above is what pins the exact set
    /// of definitions; this pins that the lot is furnished.
    #[test]
    fn the_shipped_lot_stands_at_least_twenty_five_objects_in_the_house() {
        let placed = pack().lot.placements.len();
        assert!(
            placed >= 25,
            "goal item 8 asks for a home worth living in, which was written \
             down as 25 or more placed objects; the lot places {placed}"
        );
    }

    /// **Some of the house is furniture nobody uses, on purpose.**
    ///
    /// A counter, a coat rack, a box that was going to be unpacked: they
    /// advertise nothing, so `select_action` never scores them, and they
    /// exist because a room reads as a room when it holds things that are
    /// not all affordances. `an_object_may_declare_no_interactions` in
    /// `schema.rs` is what keeps that legal at the parse layer; this is what
    /// says the shipped content actually uses it.
    ///
    /// Both directions are asserted and the second is the one with a bug
    /// behind it. A pipeline that silently dropped interactions - a bad
    /// merge, a `#[serde(default)]` on the wrong field - would leave every
    /// object advertising nothing, and the house would look identical while
    /// every sim stood still for ever ([L17]). "At least one has none" alone
    /// is green in that world.
    #[test]
    fn at_least_a_third_of_the_house_is_furniture_nobody_uses() {
        let p = pack();
        let silent = p
            .objects
            .iter()
            .filter(|o| o.interactions.is_empty())
            .count();
        assert!(
            silent * 3 >= p.objects.len(),
            "only {silent} of {} objects are scenery; the house is meant to \
             hold things that are not all affordances",
            p.objects.len()
        );
        assert!(
            silent < p.objects.len(),
            "every object advertises nothing, so no sim can ever choose to \
             do anything; the interactions have been dropped somewhere in \
             the pipeline"
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
        // A floor rather than the exact count, which used to be `== 8`: the
        // roster is pinned by
        // `the_shipped_pack_declares_every_object_the_design_calls_for`, and
        // restating a number here only meant two tests to edit whenever the
        // house gained a chair. What this needs is that the house is big
        // enough for a shared sprite to be a plausible copy-paste at all.
        assert!(
            sprites.len() > 8,
            "the house is meant to hold more than the original eight objects; \
             got {}",
            sprites.len()
        );
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

    /// **The shipped household: three sims, three archetypes, and the
    /// numbers that make them tellable apart.** Goal item 1 stated as
    /// content: at least three, every member on a DIFFERENT archetype -
    /// three sims sharing one personality would satisfy "three sims" while
    /// failing "visibly different behaviour traceable to personality
    /// data", which is the actual criterion.
    #[test]
    fn the_shipped_household_is_three_sims_on_three_different_archetypes() {
        let p = pack();
        assert!(
            p.household.len() >= 3,
            "goal item 1 asks for a household of at least three; got {}",
            p.household.len()
        );

        let mut worn: Vec<u32> = p.household.iter().map(|m| m.personality).collect();
        worn.sort_unstable();
        worn.dedup();
        assert_eq!(
            worn.len(),
            p.household.len(),
            "two household members share an archetype; the household would be N copies of fewer people"
        );

        for member in &p.household {
            assert!(
                (member.personality as usize) < p.personalities.len(),
                "'{}' points past the personality list",
                member.name
            );
            assert!(!member.name.trim().is_empty());
        }
    }

    /// Every shipped archetype differs from neutral somewhere, and every
    /// multiplier in the file is pairwise distinct - the [L26]/[L29]
    /// discipline the file's header promises, checked mechanically
    /// because at 20-odd values nobody keeps it by eye.
    #[test]
    fn every_shipped_archetype_is_distinct_and_none_is_secretly_neutral() {
        let p = pack();
        assert!(
            p.personalities.len() >= 3,
            "three sims on three archetypes need three archetypes"
        );

        let mut values: Vec<f32> = Vec::new();
        for personality in &p.personalities {
            let mut differs = false;
            for i in 0..terri_core::NEED_COUNT {
                if personality.drain[i] != 1.0 {
                    differs = true;
                    values.push(personality.drain[i]);
                }
                if personality.satisfaction[i] != 1.0 {
                    differs = true;
                    values.push(personality.satisfaction[i]);
                }
            }
            for (_, _, weight) in &personality.dispositions {
                differs = true;
                values.push(*weight);
            }
            assert!(
                differs,
                "archetype '{}' is neutral everywhere; a sim wearing it is indistinguishable from a sim with no personality at all",
                personality.id
            );
        }

        // Pairwise distinct across the whole file. Two equal multipliers
        // in different slots make a transposition invisible; sorting and
        // comparing neighbours finds any collision in one pass. Bitwise
        // comparison via to_bits, because every authored value is exact.
        let mut bits: Vec<u32> = values.iter().map(|v| v.to_bits()).collect();
        let before = bits.len();
        bits.sort_unstable();
        bits.dedup();
        assert_eq!(
            bits.len(),
            before,
            "two personality multipliers share a value; [L26] is why that makes them untestable apart"
        );
    }

    /// The starting needs across the household are pairwise distinct too,
    /// and each sim starts short of something: a household spawning fully
    /// content has no first move to watch, and the opening minute is the
    /// only minute a new player is guaranteed to give it.
    #[test]
    fn every_shipped_sim_arrives_wanting_something_different() {
        let p = pack();
        let mut lowered: Vec<u32> = Vec::new();
        for member in &p.household {
            let below: Vec<f32> = member
                .needs
                .iter()
                .copied()
                .filter(|level| *level < terri_core::NEED_MAX)
                .collect();
            assert!(
                !below.is_empty(),
                "'{}' arrives perfectly content and will stand still for the whole opening minute",
                member.name
            );
            lowered.extend(below.iter().map(|v| v.to_bits()));
        }
        let before = lowered.len();
        lowered.sort_unstable();
        lowered.dedup();
        assert_eq!(lowered.len(), before, "two starting needs share a value");
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
    /// **The shipped `sleep_tag` names an interaction that exists.**
    ///
    /// This is a test rather than a compile-step rule, and the departure
    /// from [D9] is deliberate rather than an oversight. The rule needs
    /// two files at once - the tag is in `tuning.toml` and the
    /// interactions are in `objects.toml` - and enforcing it at the
    /// boundary would make every minimal fixture in `compile.rs` invalid
    /// until it grew a bed it does not want. Those fixtures are one
    /// object each on purpose.
    ///
    /// What it catches is the same failure either way, and it is a quiet
    /// one: rename the tag in one file and not the other, and no sim is
    /// ever asleep. The drive never fires, the decay never slows, no Zzz
    /// is ever drawn, and nothing anywhere says a word.
    #[test]
    fn the_shipped_sleep_tag_is_a_tag_the_shipped_objects_declare() {
        let pack = pack();
        assert!(!pack.sleep_tag.is_empty(), "the compile step rejects blank");
        let wearers: Vec<&str> = pack
            .objects
            .iter()
            .flat_map(|object| {
                object
                    .interactions
                    .iter()
                    .filter(|interaction| interaction.tags.contains(&pack.sleep_tag))
                    .map(|_| object.id.as_str())
            })
            .collect();
        assert!(
            !wearers.is_empty(),
            "no interaction in objects.toml declares {:?}, so nothing in \
             the shipped game can ever be asleep",
            pack.sleep_tag
        );
        // Both beds, not just one. A tag that reached only the bunk would
        // mean the double bed silently stopped counting as sleep - a
        // half-working feature is harder to notice than a dead one.
        assert!(
            wearers.len() >= 2,
            "only {wearers:?} declares the sleep tag; every bed in the \
             house has to count as sleeping"
        );
    }

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
        assert_eq!(t.contested_score_multiplier, 0.75);
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

    /// Property 1 of `content/objects.toml`: no two durations and no two
    /// deltas are equal.
    ///
    /// The file has stated it as a rule for whoever rebalances next since
    /// the object list was written, and nothing has enforced it. It is
    /// load-bearing rather than flavour: `select_action` looks a delta up
    /// by need index and an interaction up by position, so two slots
    /// holding the same value make a whole class of index bug
    /// unobservable. [L26] and [L29] are the two recorded instances of
    /// exactly that, and both were found by hand rather than by the suite.
    ///
    /// **It is worth a test now because the content it governs has
    /// outgrown the eye.** Shipped content carries 18 interactions and 32
    /// deltas, against 8 and 10 when the rule was written, and every one
    /// of those values is chosen by a person.
    ///
    /// The `social` pass shows what that already costs. The comment on
    /// `watch_tv` reasons in prose about which numbers were unavailable -
    /// "Not 22 or 26 ... those are the sink's and the bookshelf's" - which
    /// is a human doing this test's job from memory. That reasoning was
    /// right when written and **its own record has since gone stale**: the
    /// sink's hygiene delta moved 22 to 32 in the same pass that raised
    /// the short durations, so nothing advertises 22 any more. The
    /// property held through both edits; what did not hold is the prose
    /// tracking which values are taken. That is the gap this closes - not
    /// a bug today, but the only reason today's content is still correct
    /// is that somebody checked by hand each time.
    ///
    /// Deltas are compared by BIT PATTERN, because `f32` is not `Ord` and
    /// cannot key a sort. That is exact rather than approximate here:
    /// these values are TOML literals and never arithmetic results, so
    /// there is no `-0.0` versus `0.0` case and no NaN to reconcile. A
    /// pack cannot hold a non-finite delta - `compile` rejects one.
    ///
    /// Both halves sort and compare neighbours rather than counting a
    /// set, so a failure can name the two entries that collide. Labelling
    /// takes two steps to be unambiguous, and each answers a case that
    /// actually occurs: `object/interaction` rather than the interaction
    /// id alone, because `compile` deliberately allows two objects to use
    /// the same interaction id; and the need name appended on the delta
    /// side, because two needs on ONE interaction may collide with each
    /// other - `{ fun = 18.0, comfort = 18.0 }` - and the object and
    /// interaction are identical on both sides of that pair.
    #[test]
    fn no_two_shipped_interactions_share_a_duration_or_a_delta() {
        let p = pack();

        let mut durations: Vec<(u32, String)> = Vec::new();
        let mut deltas: Vec<(u32, String)> = Vec::new();
        for object in &p.objects {
            for act in &object.interactions {
                let where_ = format!("{}/{}", object.id, act.id);
                durations.push((act.duration_ticks, where_.clone()));
                for (need, delta) in &act.advertises {
                    // The need is part of the label rather than dropped,
                    // because two needs on the SAME interaction may
                    // collide - `{ fun = 18.0, comfort = 18.0 }` is the
                    // shape - and `object/interaction` alone names both
                    // sides of that identically. In range by
                    // construction: `compile` rejects an advert naming a
                    // need rustc does not know.
                    let need = terri_core::NeedId::ALL[*need as usize].as_str();
                    deltas.push((delta.to_bits(), format!("{where_} ({need})")));
                }
            }
        }

        // Per testing-protocol rule 5. Each list is guarded on its OWN
        // length, because a `windows(2)` over fewer than two entries runs
        // zero times and would leave that half green over content it never
        // looked at.
        //
        // Deliberately NOT "every interaction advertises at least one
        // need". That is a different rule, it is not one the pipeline
        // holds - `advertises = {}` compiles, since `compile` validates
        // the entries that are present and does not require any - and
        // asserting it here would fail this test for content that is
        // legal while saying nothing about uniqueness. If that rule is
        // wanted it belongs in its own test, next to
        // `at_least_a_third_of_the_house_is_furniture_nobody_uses`, which
        // is the deliberate case of content that advertises nothing.
        let interactions: usize = p.objects.iter().map(|o| o.interactions.len()).sum();
        assert_eq!(
            durations.len(),
            interactions,
            "every interaction must contribute exactly one duration, or \
             the collection above is skipping content this test claims to \
             cover"
        );
        assert!(
            durations.len() >= 2,
            "fewer than two shipped durations, so there is no pair to \
             compare and this half proves nothing; found {}",
            durations.len()
        );
        assert!(
            deltas.len() >= 2,
            "fewer than two shipped deltas, so there is no pair to compare \
             and this half proves nothing; found {}",
            deltas.len()
        );

        durations.sort_unstable();
        for pair in durations.windows(2) {
            assert_ne!(
                pair[0].0, pair[1].0,
                "'{}' and '{}' both last {} ticks. Property 1 in \
                 content/objects.toml requires every duration to differ, \
                 because an interaction resolved by the wrong index is \
                 unobservable when two of them are the same length - see \
                 [L26] and [L29]",
                pair[0].1, pair[1].1, pair[0].0
            );
        }

        deltas.sort_unstable();
        for pair in deltas.windows(2) {
            assert_ne!(
                pair[0].0,
                pair[1].0,
                "'{}' and '{}' both advertise {}. Property 1 in \
                 content/objects.toml requires every delta to differ, \
                 because a delta looked up by the wrong need index is \
                 unobservable when two of them are equal - see [L26] and \
                 [L29]",
                pair[0].1,
                pair[1].1,
                f32::from_bits(pair[0].0)
            );
        }
    }

    /// The shipped half of [H6]'s split: an empty social vocabulary is
    /// legal in a test pack, and a shipped game where sims cannot talk to
    /// each other is M2d silently absent - the same silent nothing
    /// `every_declared_object_is_placed_on_the_lot` guards for furniture.
    ///
    /// "A way to talk" means an entry with a POSITIVE social delta, not
    /// merely an entry: a vocabulary of nothing but insults would satisfy
    /// `!is_empty()` while leaving the social need exactly as
    /// unsatisfiable-by-people as it was before M2d.
    #[test]
    fn the_shipped_pack_gives_sims_a_way_to_talk() {
        let p = pack();
        assert!(
            !p.social.is_empty(),
            "content/social.toml compiled to an empty vocabulary; sims \
             have no way to satisfy each other's social need"
        );

        let social = terri_core::NeedId::Social.index() as u8;
        assert!(
            p.social.iter().any(|act| {
                act.advertises
                    .iter()
                    .any(|(need, delta)| *need == social && *delta > 0.0)
            }),
            "no social interaction advertises a positive social delta, so \
             company satisfies everything except the need it exists for"
        );
    }
}
