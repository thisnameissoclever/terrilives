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
    CompiledActionSocket, CompiledCareer, CompiledChain, CompiledChainStep,
    CompiledHouseholdMember, CompiledInteraction, CompiledLot, CompiledObject, CompiledPersonality,
    CompiledPlacement, CompiledPlacementSocket, CompiledSocketFacing, CompiledTrait,
    CompiledTraitKind, CompiledVisual, CompiledVisualAction, CompiledVisualAnchor,
    CompiledVisualFacing, ContentPack, Footprint, ObjectDefId, Tuning,
};
pub use schema::{
    ActionSocketDef, ArchetypeDef, AtlasFile, AtlasSpriteDef, DispositionDef, HouseholdFile,
    HouseholdSimDef, InteractionDef, LotFile, NeedDef, NeedsFile, ObjectDef, ObjectsFile,
    PersonalitiesFile, PlacementDef, TraitDef, TraitsFile, TuningFile, VisualDef, WallDef,
    MAX_HOUSEHOLD_SIZE, TRAIT_KINDS,
};

use std::sync::OnceLock;

/// Written by `build.rs` from `content/*.toml` into `OUT_DIR`, so these
/// bytes and the source content cannot disagree: they are produced by
/// the same build that compiles this file.
static PACK_BYTES: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/content_pack.postcard"));

/// The compatibility shape of the content a Save V1 can point at, hashed.
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
/// What is hashed here is the part of a `SaveSnapshotV1` address that the
/// snapshot itself cannot validate by name:
///
/// * Each object's footprint, resolved station-role names, interaction ids IN
///   ORDER, and advertised chain ids IN FLYOUT ORDER. Saves name objects by
///   string, so object declaration order is free; interaction and flyout rows
///   are numeric, so their order is not. Station roles decide where a restored
///   running chain will continue.
/// * The social vocabulary's ids in order - `SavedSocialising` holds an
///   index into it.
/// * Each chain's id and ordered structural steps - `SavedChainState` holds a
///   step index, so a same-length reorder must not silently resume a different
///   station or hand-off.
/// * Trait ids and their kind. Trait state is saved by id, but a capability
///   level must never be reinterpreted as a condition severity.
/// * The optional front-door coordinate. Save V1 persists the old collision
///   grid but career shifts still path to the current pack's door.
///
/// What is deliberately NOT hashed: every number in `tuning.toml`, every
/// advert delta, label, duration, tag, object-interaction visual contract,
/// chain-step visual contract, action socket, every sprite index, every sim's
/// NAME, the rest of the lot, careers, carried-item declaration order, and the
/// circadian curve. Object, career, trait, chain, and carried-item string
/// references are validated against the current pack while loading. Hobbies
/// remain raw tags; removing their last matching activity makes the hobby
/// inactive rather than making the save corrupt. A save that loads into
/// retuned content simply plays under the new numbers, which is what a player
/// wants and what a designer iterating on balance needs.
///
/// The cost of the narrower rule, stated plainly: change a delta and a
/// mid-flight interaction finishes under the new one. That is a save
/// continuing into a patched game, which is the normal thing for a game
/// to do. This remains one global digest, so adding an otherwise unrelated
/// object or trait still changes it. Save V2 can remove that false rejection
/// only by persisting stable ids beside every numeric row; pretending one hash
/// can infer which definitions a particular save used would be theatre.
pub fn content_fingerprint(pack: &ContentPack) -> u64 {
    let mut hasher = terri_core::FnvHasher::default();
    hasher.write_bytes(b"terrilives-save-compatibility-v1");

    let mut objects: Vec<_> = pack.objects.iter().collect();
    objects.sort_unstable_by(|left, right| left.id.cmp(&right.id));
    hash_count(&mut hasher, objects.len());
    for object in objects {
        hash_text(&mut hasher, &object.id);
        hasher.write_u64(object.footprint.width as u64);
        hasher.write_u64(object.footprint.depth as u64);

        let mut roles: Vec<_> = object
            .roles
            .iter()
            .map(|role| pack.roles[*role as usize].as_str())
            .collect();
        roles.sort_unstable();
        hash_count(&mut hasher, roles.len());
        for role in roles {
            hash_text(&mut hasher, role);
        }

        hash_count(&mut hasher, object.interactions.len());
        for interaction in &object.interactions {
            hash_text(&mut hasher, &interaction.id);
        }

        let object_id = pack
            .find(&object.id)
            .expect("object came from this validated pack");
        let advertised_chains: Vec<_> = pack
            .chains
            .iter()
            .filter(|chain| chain.advertised_by == object_id)
            .collect();
        hash_count(&mut hasher, advertised_chains.len());
        for chain in advertised_chains {
            hash_text(&mut hasher, &chain.id);
        }
    }

    hash_count(&mut hasher, pack.social.len());
    for interaction in &pack.social {
        hash_text(&mut hasher, &interaction.id);
    }

    match pack.lot.front_door {
        Some((x, y)) => {
            hasher.write_bytes(&[1]);
            hasher.write_u64(x as u64);
            hasher.write_u64(y as u64);
        }
        None => hasher.write_bytes(&[0]),
    }

    let mut chains: Vec<_> = pack.chains.iter().collect();
    chains.sort_unstable_by(|left, right| left.id.cmp(&right.id));
    hash_count(&mut hasher, chains.len());
    for chain in chains {
        hash_text(&mut hasher, &chain.id);
        hash_count(&mut hasher, chain.steps.len());
        for step in &chain.steps {
            hash_text(&mut hasher, &pack.roles[step.role as usize]);
            hash_optional_text(
                &mut hasher,
                step.yields
                    .map(|kind| pack.item_kinds[kind as usize].as_str()),
            );
            match step.transforms {
                Some((from, to)) => {
                    hasher.write_bytes(&[1]);
                    hash_text(&mut hasher, &pack.item_kinds[from as usize]);
                    hash_text(&mut hasher, &pack.item_kinds[to as usize]);
                }
                None => hasher.write_bytes(&[0]),
            }
            hash_optional_text(
                &mut hasher,
                step.consumes
                    .map(|kind| pack.item_kinds[kind as usize].as_str()),
            );
        }
    }

    let mut traits: Vec<_> = pack.traits.iter().collect();
    traits.sort_unstable_by(|left, right| left.id.cmp(&right.id));
    hash_count(&mut hasher, traits.len());
    for trait_def in traits {
        hash_text(&mut hasher, &trait_def.id);
        let kind = match trait_def.kind {
            CompiledTraitKind::Disposition { .. } => 0,
            CompiledTraitKind::Capability { .. } => 1,
            CompiledTraitKind::Condition { .. } => 2,
        };
        hasher.write_bytes(&[kind]);
    }

    hasher.finish()
}

/// The full-pack fingerprints emitted by every distinct public Save V1
/// content shape before the compatibility digest replaced that algorithm.
///
/// Each legacy key maps to the one reviewed compatibility shape it may enter.
/// Pairing both sides is important: an incompatible future content edit moves
/// the current digest and automatically closes these bridges instead of
/// treating an old opaque hash as a permanent skeleton key.
const LEGACY_FULL_PACK_FINGERPRINT_MIGRATIONS: &[(u64, u64)] = &[
    // 115ad03, where Save V1 first shipped.
    (0x9d22_8822_6933_d3c7, 0xb8d0_2015_e030_64d9),
    // b772ab9 through ebfa686. Those public revisions compiled identically.
    (0x263e_ed3b_bdcb_a7d0, 0xb8d0_2015_e030_64d9),
    // 3a5e936, the Muted Line and circadian release.
    (0x08ec_6011_bc11_7ad8, 0xb8d0_2015_e030_64d9),
    // 72d67c5, the last public full-pack fingerprint before this migration.
    (0x2eb2_02fa_e70e_4939, 0xb8d0_2015_e030_64d9),
];

/// Reviewed structural-digest migrations that do not carry any legacy data
/// rewrite. The first bridge adds interaction row zero to two formerly inert
/// objects while retaining their string ids, positions, footprints, entities,
/// and blocked tiles. Object declaration order is deliberately free. A valid
/// save from the source shape cannot refer to either new row because neither
/// row existed there.
///
/// Keep this separate from [`LEGACY_FULL_PACK_FINGERPRINT_MIGRATIONS`]: that
/// table also authorises the historical household-name rewrite, while an
/// ordinary current-format save carrying the source digest must retain every
/// saved name verbatim.
const PRIOR_STRUCTURAL_FINGERPRINT_MIGRATIONS: &[(u64, u64)] =
    &[(0x26d5_982c_9af8_3de8, 0xb8d0_2015_e030_64d9)];

/// Whether a Save V1 fingerprint may load against this content pack.
///
/// New saves carry [`content_fingerprint`]. The small migration table accepts
/// every distinct fingerprint the public game emitted under the retired
/// whole-pack algorithm, but only while the current structural digest remains
/// the specifically reviewed target.
pub fn content_fingerprint_matches(pack: &ContentPack, saved: u64) -> bool {
    let current = content_fingerprint(pack);
    saved == current
        || LEGACY_FULL_PACK_FINGERPRINT_MIGRATIONS
            .iter()
            .any(|&(legacy, target)| saved == legacy && current == target)
        || PRIOR_STRUCTURAL_FINGERPRINT_MIGRATIONS
            .iter()
            .any(|&(prior, target)| saved == prior && current == target)
}

/// Whether `saved` is one of the retired whole-pack fingerprints accepted by
/// the migration table for this exact current content shape.
pub fn content_fingerprint_is_legacy(pack: &ContentPack, saved: u64) -> bool {
    let current = content_fingerprint(pack);
    LEGACY_FULL_PACK_FINGERPRINT_MIGRATIONS
        .iter()
        .any(|&(legacy, target)| saved == legacy && current == target)
}

/// Whether `saved` is the exact pre-aquarium structural digest accepted by the
/// narrow interaction-row bridge for this content pack.
///
/// Save validation uses this classification to reject impossible references
/// to the two rows that did not exist in that source shape. Keep it separate
/// from [`content_fingerprint_is_legacy`]: this bridge never authorises the
/// historical household-name rewrite.
pub fn content_fingerprint_is_prior_structural(pack: &ContentPack, saved: u64) -> bool {
    let current = content_fingerprint(pack);
    PRIOR_STRUCTURAL_FINGERPRINT_MIGRATIONS
        .iter()
        .any(|&(prior, target)| saved == prior && current == target)
}

/// Whether `saved` comes from any accepted public shape before the aquarium
/// and exercise-bike interaction rows existed.
///
/// Those snapshots may load against this reviewed destination, but they may
/// not reinterpret row zero on either formerly inert persistence key as a
/// historical action. The current digest is deliberately excluded.
pub fn content_fingerprint_is_pre_aquarium_bike(pack: &ContentPack, saved: u64) -> bool {
    content_fingerprint_is_legacy(pack, saved)
        || content_fingerprint_is_prior_structural(pack, saved)
}

fn hash_count(hasher: &mut terri_core::FnvHasher, count: usize) {
    hasher.write_u64(count as u64);
}

fn hash_text(hasher: &mut terri_core::FnvHasher, value: &str) {
    hash_count(hasher, value.len());
    hasher.write_bytes(value.as_bytes());
}

fn hash_optional_text(hasher: &mut terri_core::FnvHasher, value: Option<&str>) {
    match value {
        Some(value) => {
            hasher.write_bytes(&[1]);
            hash_text(hasher, value);
        }
        None => hasher.write_bytes(&[0]),
    }
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
    /// Bill's hobby and Casey's capability will find it, and the
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

    #[test]
    fn the_fingerprint_observes_numeric_interaction_and_social_rows() {
        let original = pack().clone();
        let base = content_fingerprint(&original);

        let mut renamed_object = original.clone();
        renamed_object.objects[0].id = "something_else".to_string();
        assert_ne!(base, content_fingerprint(&renamed_object), "an object id");

        let mut fewer_objects = original.clone();
        fewer_objects.objects.pop();
        assert_ne!(base, content_fingerprint(&fewer_objects), "an object count");

        let mut renamed = original.clone();
        renamed.objects[0].interactions[0].id = "something_else".to_string();
        assert_ne!(base, content_fingerprint(&renamed), "an interaction id");

        let mut longer = original.clone();
        let extra = longer.objects[0].interactions[0].clone();
        longer.objects[0].interactions.push(CompiledInteraction {
            id: "an_extra_row".to_string(),
            ..extra
        });
        assert_ne!(base, content_fingerprint(&longer), "an interaction count");

        assert!(!original.social.is_empty(), "the fixture needs a social");
        let mut social_fixture = original.clone();
        let mut extra_social = social_fixture.social[0].clone();
        extra_social.id = "another_social".to_string();
        social_fixture.social.push(extra_social);
        let social_base = content_fingerprint(&social_fixture);
        let mut swapped = social_fixture;
        swapped.social.swap(0, 1);
        assert_ne!(social_base, content_fingerprint(&swapped), "social order");
    }

    #[test]
    fn the_fingerprint_observes_chain_flyout_and_step_meaning() {
        let original = pack().clone();
        let base = content_fingerprint(&original);
        assert!(!original.chains.is_empty(), "the fixture needs a chain");
        assert!(
            original.chains[0].steps.len() > 1,
            "the fixture needs two chain steps"
        );

        let mut clipped = original.clone();
        clipped.chains[0].steps.pop();
        assert_ne!(base, content_fingerprint(&clipped), "a chain's length");

        let mut reordered = original.clone();
        reordered.chains[0].steps.swap(0, 1);
        assert_ne!(
            base,
            content_fingerprint(&reordered),
            "the same step count with different meanings"
        );

        let current_advertiser = original.chains[0].advertised_by;
        let replacement = original
            .objects
            .iter()
            .enumerate()
            .find(|(index, _)| *index as u32 != current_advertiser.0)
            .map(|(index, _)| ObjectDefId(index as u32))
            .expect("the shipped pack has another object");
        let mut moved = original.clone();
        moved.chains[0].advertised_by = replacement;
        assert_ne!(
            base,
            content_fingerprint(&moved),
            "moving a chain moves an object's numeric flyout row"
        );

        let mut retuned = original.clone();
        retuned.chains[0].steps[0].label.push_str(" again");
        retuned.chains[0].steps[0].duration_ticks += 1;
        retuned.chains[0].steps[0].tags.push("patched".to_string());
        assert_eq!(
            base,
            content_fingerprint(&retuned),
            "labels, duration and tags are patchable semantics"
        );
    }

    #[test]
    fn the_fingerprint_observes_footprints_and_trait_state_kind() {
        let original = pack().clone();
        let base = content_fingerprint(&original);

        let mut resized = original.clone();
        resized.objects[0].footprint.width += 1;
        assert_ne!(
            base,
            content_fingerprint(&resized),
            "the restored collision grid must agree with object width"
        );
        let mut deepened = original.clone();
        deepened.objects[0].footprint.depth += 1;
        assert_ne!(
            base,
            content_fingerprint(&deepened),
            "the restored collision grid must agree with object depth"
        );

        let (source, role) = original
            .objects
            .iter()
            .enumerate()
            .find_map(|(index, object)| object.roles.first().map(|role| (index, *role)))
            .expect("the shipped pack needs a station role");
        let destination = original
            .objects
            .iter()
            .enumerate()
            .find(|(index, object)| *index != source && !object.roles.contains(&role))
            .map(|(index, _)| index)
            .expect("the shipped pack needs another object for the role");
        let mut remapped_station = original.clone();
        remapped_station.objects[source]
            .roles
            .retain(|candidate| *candidate != role);
        remapped_station.objects[destination].roles.push(role);
        remapped_station.objects[destination].roles.sort_unstable();
        assert_ne!(
            base,
            content_fingerprint(&remapped_station),
            "a restored chain must not silently continue at another station"
        );

        let (door_x, door_y) = original
            .lot
            .front_door
            .expect("the shipped career pack needs a front door");
        let mut moved_door = original.clone();
        moved_door.lot.front_door = Some((door_x + 1, door_y));
        assert_ne!(
            base,
            content_fingerprint(&moved_door),
            "a restored worker must not path on the old grid toward a new door"
        );
        let mut removed_door = original.clone();
        removed_door.lot.front_door = None;
        assert_ne!(
            base,
            content_fingerprint(&removed_door),
            "door presence changes the restored career route"
        );

        assert!(!original.traits.is_empty(), "the fixture needs a trait");
        let mut reinterpreted = original.clone();
        reinterpreted.traits[0].kind = match original.traits[0].kind {
            CompiledTraitKind::Disposition { .. } => CompiledTraitKind::Capability {
                start_level: 0.0,
                fail_delta_scale: 1.0,
                learn_per_attempt: 0.1,
            },
            CompiledTraitKind::Capability { .. } | CompiledTraitKind::Condition { .. } => {
                CompiledTraitKind::Disposition {
                    score_multiplier: 1.0,
                }
            }
        };
        assert_ne!(
            base,
            content_fingerprint(&reinterpreted),
            "saved trait state cannot change category"
        );

        let mut retuned = original.clone();
        match &mut retuned.traits[0].kind {
            CompiledTraitKind::Disposition { score_multiplier } => *score_multiplier += 0.01,
            CompiledTraitKind::Capability {
                learn_per_attempt, ..
            } => *learn_per_attempt += 0.01,
            CompiledTraitKind::Condition {
                manage_per_completion,
                ..
            } => *manage_per_completion += 0.01,
        }
        assert_eq!(
            base,
            content_fingerprint(&retuned),
            "numbers inside one trait kind are balance"
        );
    }

    #[test]
    fn the_fingerprint_allows_names_art_balance_and_string_table_reordering() {
        let original = pack().clone();
        let base = content_fingerprint(&original);

        let mut retuned = original.clone();
        retuned.tuning.rng_seed ^= 1;
        retuned.tuning.action_threshold += 0.01;
        retuned.tuning.asleep_decay_scale = 1.0;
        assert_eq!(base, content_fingerprint(&retuned), "a balance pass");

        let mut reranged = original.clone();
        reranged.tuning.wander_radius_tiles += 1;
        assert_eq!(
            base,
            content_fingerprint(&reranged),
            "idle wander radius is patchable balance"
        );

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

        assert!(original.objects.len() > 1, "the fixture needs two objects");
        let mut objects = original.clone();
        objects.objects.swap(0, 1);
        for placement in &mut objects.lot.placements {
            placement.object = ObjectDefId(swap_zero_and_one(placement.object.0));
        }
        for personality in &mut objects.personalities {
            for (object, _, _) in &mut personality.dispositions {
                *object = ObjectDefId(swap_zero_and_one(object.0));
            }
        }
        for chain in &mut objects.chains {
            chain.advertised_by = ObjectDefId(swap_zero_and_one(chain.advertised_by.0));
        }
        assert_eq!(
            base,
            content_fingerprint(&objects),
            "saved objects resolve by id"
        );

        assert!(!original.chains.is_empty(), "the fixture needs a chain");
        let mut chain_fixture = original.clone();
        let mut extra_chain = chain_fixture.chains[0].clone();
        extra_chain.id = "another_chain".to_string();
        extra_chain.advertised_by = ObjectDefId(
            (0..chain_fixture.objects.len())
                .find(|index| *index as u32 != chain_fixture.chains[0].advertised_by.0)
                .expect("the shipped pack has another chain advertiser") as u32,
        );
        chain_fixture.chains.push(extra_chain);
        let chain_base = content_fingerprint(&chain_fixture);
        let mut chains = chain_fixture;
        chains.chains.swap(0, 1);
        assert_eq!(
            chain_base,
            content_fingerprint(&chains),
            "chain declaration order is free across different flyouts"
        );

        let mut flyout_fixture = original.clone();
        let mut second_flyout_chain = flyout_fixture.chains[0].clone();
        second_flyout_chain.id = "another_chain".to_string();
        flyout_fixture.chains.push(second_flyout_chain);
        let flyout_base = content_fingerprint(&flyout_fixture);
        let mut reordered_flyout = flyout_fixture;
        reordered_flyout.chains.swap(0, 1);
        assert_ne!(
            flyout_base,
            content_fingerprint(&reordered_flyout),
            "chain order within one object's numeric flyout must remain stable"
        );

        assert!(!original.careers.is_empty(), "the fixture needs a career");
        let mut career_fixture = original.clone();
        let mut extra_career = career_fixture.careers[0].clone();
        extra_career.id = "another_career".to_string();
        career_fixture.careers.push(extra_career);
        let career_base = content_fingerprint(&career_fixture);
        let mut careers = career_fixture;
        careers.careers.swap(0, 1);
        for member in &mut careers.household {
            member.career = member.career.map(swap_zero_and_one);
        }
        assert_eq!(
            career_base,
            content_fingerprint(&careers),
            "saved careers resolve by id"
        );

        assert!(
            original.item_kinds.len() > 1,
            "the fixture needs two item kinds"
        );
        let mut items = original.clone();
        items.item_kinds.swap(0, 1);
        for chain in &mut items.chains {
            for step in &mut chain.steps {
                step.yields = step.yields.map(swap_zero_and_one);
                step.transforms = step
                    .transforms
                    .map(|(from, to)| (swap_zero_and_one(from), swap_zero_and_one(to)));
                step.consumes = step.consumes.map(swap_zero_and_one);
            }
        }
        assert_eq!(
            base,
            content_fingerprint(&items),
            "saved carried items resolve by id"
        );

        assert!(original.roles.len() > 1, "the fixture needs two roles");
        let mut role_fixture = original.clone();
        role_fixture.objects[0].roles = vec![0, 1];
        let role_base = content_fingerprint(&role_fixture);
        let mut roles = role_fixture;
        roles.roles.swap(0, 1);
        for object in &mut roles.objects {
            for role in &mut object.roles {
                *role = swap_zero_and_one(*role);
            }
            object.roles.sort_unstable();
        }
        for chain in &mut roles.chains {
            for step in &mut chain.steps {
                step.role = swap_zero_and_one(step.role);
            }
        }
        assert_eq!(
            role_base,
            content_fingerprint(&roles),
            "station roles resolve by name"
        );

        assert!(original.traits.len() > 1, "the fixture needs two traits");
        let mut traits = original.clone();
        traits.traits.swap(0, 1);
        for member in &mut traits.household {
            for index in &mut member.traits {
                *index = swap_zero_and_one(*index);
            }
        }
        assert_eq!(
            base,
            content_fingerprint(&traits),
            "saved traits resolve by id"
        );
    }

    #[test]
    fn the_fingerprint_allows_visual_presentation_changes() {
        let original = pack().clone();
        let base = content_fingerprint(&original);
        assert_eq!(
            original.social[0].visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Talk,
                anchor: CompiledVisualAnchor::Partner,
                facing: CompiledVisualFacing::TowardAnchor,
                socket: None,
            }),
            "the shipped chat must exercise the complete visual contract"
        );

        let mut presentation_only = original;
        presentation_only.social[0].visual = None;
        assert_eq!(
            base,
            content_fingerprint(&presentation_only),
            "presentation metadata must not invalidate a Save V1"
        );
    }

    #[test]
    fn the_fingerprint_allows_object_visual_presentation_changes() {
        let original = pack().clone();
        let base = content_fingerprint(&original);
        let fridge = original.find("fridge").expect("shipped fridge exists");
        let snack = original
            .object(fridge)
            .interactions
            .iter()
            .position(|interaction| interaction.id == "grab_snack")
            .expect("shipped snack interaction exists");
        assert_eq!(
            original.object(fridge).interactions[snack].visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Eat,
                anchor: CompiledVisualAnchor::Object,
                facing: CompiledVisualFacing::TowardAnchor,
                socket: None,
            }),
            "the shipped snack must exercise the object-eating contract"
        );

        let mut presentation_only = original;
        presentation_only.objects[fridge.0 as usize].interactions[snack].visual = None;
        assert_eq!(
            base,
            content_fingerprint(&presentation_only),
            "object visual metadata must not invalidate a Save V1"
        );
    }

    #[test]
    fn the_shipped_bookshelf_uses_standing_read_without_changing_the_fingerprint() {
        let original = pack().clone();
        let base = content_fingerprint(&original);
        let bookshelf = original
            .find("bookshelf")
            .expect("the shipped bookshelf exists");
        let read = original
            .object(bookshelf)
            .interactions
            .iter()
            .position(|interaction| interaction.id == "read")
            .expect("the shipped bookshelf read interaction exists");
        assert_eq!(
            original.object(bookshelf).interactions[read].visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Read,
                anchor: CompiledVisualAnchor::Object,
                facing: CompiledVisualFacing::TowardAnchor,
                socket: None,
            }),
            "the bookshelf must ship the exact standing-read contract"
        );

        let mut presentation_only = original;
        presentation_only.objects[bookshelf.0 as usize].interactions[read].visual = None;
        assert_eq!(
            base,
            content_fingerprint(&presentation_only),
            "standing-read presentation metadata must not invalidate a Save V1"
        );
    }

    #[test]
    fn the_fingerprint_allows_reading_socket_presentation_changes() {
        let original = pack().clone();
        let base = content_fingerprint(&original);
        let chair = original
            .find("reading_chair")
            .expect("the shipped reading chair exists");
        let settle = original
            .object(chair)
            .interactions
            .iter()
            .position(|interaction| interaction.id == "settle_in")
            .expect("the shipped reading interaction exists");
        assert_eq!(
            original.object(chair).interactions[settle].visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Read,
                anchor: CompiledVisualAnchor::ObjectSocket,
                facing: CompiledVisualFacing::Socket,
                socket: Some(0),
            })
        );
        assert_eq!(
            original.object(chair).action_sockets,
            vec![CompiledActionSocket {
                id: "seat".to_string(),
                x: 0.0,
                y: 0.0,
                facing: CompiledSocketFacing::PositiveX,
            }]
        );
        let placement = original
            .lot
            .placements
            .iter()
            .find(|placement| placement.object == chair)
            .expect("the shipped reading chair is placed");
        assert_eq!(
            placement.action_sockets,
            vec![CompiledPlacementSocket {
                x: placement.x,
                y: placement.y,
                facing: CompiledSocketFacing::PositiveX,
            }],
            "the shipped zero-offset SE seat resolves to its chair position"
        );

        let mut id_changed = original.clone();
        id_changed.objects[chair.0 as usize].action_sockets[0].id = "cushion".to_string();
        assert_eq!(base, content_fingerprint(&id_changed));

        let mut x_changed = original.clone();
        x_changed.objects[chair.0 as usize].action_sockets[0].x = 0.25;
        assert_eq!(base, content_fingerprint(&x_changed));

        let mut y_changed = original.clone();
        y_changed.objects[chair.0 as usize].action_sockets[0].y = -0.25;
        assert_eq!(base, content_fingerprint(&y_changed));

        let mut facing_changed = original;
        facing_changed.objects[chair.0 as usize].action_sockets[0].facing =
            CompiledSocketFacing::NegativeY;
        assert_eq!(base, content_fingerprint(&facing_changed));
    }

    #[test]
    fn the_fingerprint_allows_chain_step_visual_presentation_changes() {
        let original = pack().clone();
        let base = content_fingerprint(&original);
        let dinner = original
            .chains
            .iter()
            .position(|chain| chain.id == "cook_dinner")
            .expect("shipped dinner chain exists");
        let terminal = original.chains[dinner]
            .steps
            .len()
            .checked_sub(1)
            .expect("shipped dinner has a terminal step");
        assert_eq!(
            original.chains[dinner].steps[terminal].visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Eat,
                anchor: CompiledVisualAnchor::Station,
                facing: CompiledVisualFacing::TowardAnchor,
                socket: None,
            }),
            "the shipped dinner must exercise the station-eating contract"
        );

        let mut presentation_only = original;
        presentation_only.chains[dinner].steps[terminal].visual = None;
        assert_eq!(
            base,
            content_fingerprint(&presentation_only),
            "chain-step visual metadata must not invalidate a Save V1"
        );
    }

    #[test]
    fn interaction_id_lengths_are_part_of_the_fingerprint() {
        let mut left = pack().clone();
        let mut first = left.objects[0].interactions[0].clone();
        first.id = "ab".to_string();
        let mut second = first.clone();
        second.id = "c".to_string();
        left.objects[0].interactions = vec![first.clone(), second];

        let mut right = left.clone();
        right.objects[0].interactions[0].id = "a".to_string();
        right.objects[0].interactions[1].id = "bc".to_string();
        assert_ne!(
            content_fingerprint(&left),
            content_fingerprint(&right),
            "without length prefixes both inputs flatten to the same bytes"
        );
    }

    #[test]
    fn every_public_full_pack_fingerprint_migrates_only_to_the_reviewed_shape() {
        assert_eq!(
            content_fingerprint(pack()),
            0xb8d0_2015_e030_64d9,
            "a structural content edit must review or retire each legacy bridge"
        );
        for &(legacy, target) in LEGACY_FULL_PACK_FINGERPRINT_MIGRATIONS {
            assert_eq!(target, 0xb8d0_2015_e030_64d9);
            assert!(
                content_fingerprint_matches(pack(), legacy),
                "deployed fingerprint {legacy:#018x} lost its migration"
            );
        }
        assert!(content_fingerprint_matches(
            pack(),
            content_fingerprint(pack())
        ));
        assert!(!content_fingerprint_is_legacy(
            pack(),
            content_fingerprint(pack())
        ));
        assert!(LEGACY_FULL_PACK_FINGERPRINT_MIGRATIONS
            .iter()
            .all(|(legacy, _)| content_fingerprint_is_legacy(pack(), *legacy)));
        assert!(!content_fingerprint_matches(pack(), 0));
        assert!(!content_fingerprint_is_legacy(pack(), 0));
    }

    #[test]
    fn the_prior_structural_shape_migrates_without_becoming_a_legacy_name_save() {
        let prior = 0x26d5_982c_9af8_3de8;
        assert_eq!(
            PRIOR_STRUCTURAL_FINGERPRINT_MIGRATIONS,
            &[(prior, 0xb8d0_2015_e030_64d9)],
            "each structural bridge must name exactly one reviewed destination"
        );
        assert!(content_fingerprint_matches(pack(), prior));
        assert!(content_fingerprint_is_prior_structural(pack(), prior));
        assert!(content_fingerprint_is_pre_aquarium_bike(pack(), prior));
        assert!(
            !content_fingerprint_is_legacy(pack(), prior),
            "adding interactions to inert objects must not rewrite household names"
        );
        assert!(!content_fingerprint_is_prior_structural(
            pack(),
            content_fingerprint(pack())
        ));
        assert!(!content_fingerprint_is_pre_aquarium_bike(
            pack(),
            content_fingerprint(pack())
        ));
    }

    #[test]
    fn changing_either_new_interaction_closes_every_old_fingerprint_bridge() {
        let current = pack().clone();
        for object in ["moving_box", "reference_shelf"] {
            let id = current.find(object).expect("shipped persistence key");
            for (mutation, changed) in [
                ("renamed", {
                    let mut changed = current.clone();
                    changed.objects[id.0 as usize].interactions[0]
                        .id
                        .push_str("_changed");
                    changed
                }),
                ("removed", {
                    let mut changed = current.clone();
                    changed.objects[id.0 as usize].interactions.clear();
                    changed
                }),
            ] {
                assert_ne!(content_fingerprint(&changed), content_fingerprint(&current));
                for saved in [
                    0x26d5_982c_9af8_3de8,
                    0x9d22_8822_6933_d3c7,
                    0x263e_ed3b_bdcb_a7d0,
                    0x08ec_6011_bc11_7ad8,
                    0x2eb2_02fa_e70e_4939,
                ] {
                    assert!(
                        !content_fingerprint_matches(&changed, saved),
                        "{mutation} interaction on {object:?} must close bridge from {saved:#018x}"
                    );
                }
            }
        }
    }

    #[test]
    fn the_shipped_pack_carries_the_exact_bike_and_aquarium_contracts() {
        let p = pack();
        let bike = p.find("moving_box").expect("bike persistence key");
        let aquarium = p.find("reference_shelf").expect("aquarium persistence key");

        assert_eq!(p.object(bike).name, "Wellness Initiative, Indoor");
        assert_eq!(p.object(aquarium).name, "Aquarium of Managed Expectations");
        assert_eq!(p.object(bike).footprint, Footprint::default());
        assert_eq!(p.object(aquarium).footprint, Footprint::default());

        let bike_action = &p.object(bike).interactions[0];
        assert_eq!(bike_action.id, "use_exercise_bike");
        assert_eq!(bike_action.label, "Use the exercise bike");
        assert_eq!(
            bike_action.advertises,
            vec![(1, -8.0), (2, -5.0), (5, 28.0)]
        );
        assert_eq!((bike_action.duration_ticks, bike_action.slots), (83, 1));
        assert_eq!(bike_action.tags, vec!["exercise"]);
        assert_eq!(bike_action.satisfaction, 2.0);
        assert_eq!(
            bike_action.visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Exercise,
                anchor: CompiledVisualAnchor::ObjectSocket,
                facing: CompiledVisualFacing::Socket,
                socket: Some(0),
            })
        );
        assert_eq!(p.object(bike).action_sockets.len(), 1);
        let saddle = &p.object(bike).action_sockets[0];
        assert_eq!(saddle.id, "saddle");
        assert_eq!((saddle.x, saddle.y), (0.0, 0.0));
        assert_eq!(saddle.facing, CompiledSocketFacing::PositiveX);

        let watch = &p.object(aquarium).interactions[0];
        assert_eq!(watch.id, "watch_fish");
        assert_eq!(watch.label, "Watch the fish");
        assert_eq!(watch.advertises, vec![(5, 25.0), (6, 21.0)]);
        assert_eq!((watch.duration_ticks, watch.slots), (67, 1));
        assert_eq!(watch.tags, vec!["aquarium"]);
        assert_eq!(watch.satisfaction, 1.0);
        assert_eq!(
            watch.visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Watch,
                anchor: CompiledVisualAnchor::Object,
                facing: CompiledVisualFacing::TowardAnchor,
                socket: None,
            })
        );

        for (object, x, y) in [(bike, 4.0, 11.0), (aquarium, 6.0, 10.0)] {
            let placement = p
                .lot
                .placements
                .iter()
                .find(|placement| placement.object == object)
                .expect("each repurposed object keeps its unique placement");
            assert_eq!((placement.x, placement.y), (x, y));
        }
        let bike_placement = p
            .lot
            .placements
            .iter()
            .find(|placement| placement.object == bike)
            .expect("bike placement");
        assert_eq!(bike_placement.action_sockets.len(), 1);
        assert_eq!(
            (
                bike_placement.action_sockets[0].x,
                bike_placement.action_sockets[0].y,
                bike_placement.action_sockets[0].facing,
            ),
            (4.0, 11.0, CompiledSocketFacing::PositiveX)
        );
    }

    #[test]
    fn the_shipped_armchair_carries_the_exact_sitting_contract() {
        let p = pack();
        let armchair = p.find("armchair").expect("shipped armchair");
        let object = p.object(armchair);
        let action = object
            .interactions
            .iter()
            .find(|interaction| interaction.id == "take_the_chair")
            .expect("shipped sitting interaction");

        assert_eq!(action.label, "Sit down");
        assert_eq!((action.duration_ticks, action.slots), (41, 1));
        assert_eq!(
            action.visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Sit,
                anchor: CompiledVisualAnchor::ObjectSocket,
                facing: CompiledVisualFacing::Socket,
                socket: Some(0),
            })
        );
        assert_eq!(object.action_sockets.len(), 1);
        assert_eq!(object.action_sockets[0].id, "seat");
        assert_eq!(
            (
                object.action_sockets[0].x,
                object.action_sockets[0].y,
                object.action_sockets[0].facing,
            ),
            (0.0, 0.0, CompiledSocketFacing::PositiveX)
        );

        let placement = p
            .lot
            .placements
            .iter()
            .find(|placement| placement.object == armchair)
            .expect("armchair placement");
        assert_eq!(placement.action_sockets.len(), 1);
        assert_eq!(
            (
                placement.action_sockets[0].x,
                placement.action_sockets[0].y,
                placement.action_sockets[0].facing,
            ),
            (13.0, 0.0, CompiledSocketFacing::PositiveX)
        );
    }

    fn swap_zero_and_one(index: u32) -> u32 {
        match index {
            0 => 1,
            1 => 0,
            other => other,
        }
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
    /// A counter, a coat rack, a freestanding plant: they advertise nothing,
    /// so `select_action` never scores them, and they
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
        assert_eq!(t.wander_radius_tiles, 3);
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
    /// outgrown the eye.** Shipped object content carries 19 interactions and
    /// 35 deltas, against 8 and 10 when the rule was written, and every one
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
