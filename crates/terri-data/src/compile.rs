//! Validation, and the compilation of validated content into a pack.
//!
//! Every failure mode in this module is a build failure by design. The
//! checks live here rather than in the schema because serde can express
//! shape but not meaning: "this need name is one rustc knows about" and
//! "every `NeedId` appears exactly once" are not shapes.

use crate::error::ContentError;
use crate::pack::{Circadian, CompiledHouseholdMember, CompiledPersonality};
use crate::pack::{
    CompiledActionSocket, CompiledInteraction, CompiledLot, CompiledObject, CompiledPlacement,
    CompiledPlacementSocket, CompiledSocketFacing, CompiledVisual, CompiledVisualAction,
    CompiledVisualAnchor, CompiledVisualFacing, ContentPack, ObjectDefId, Tuning,
};
use crate::schema::{
    AtlasFile, CareersFile, ChainsFile, HouseholdFile, InteractionDef, LotFile, NeedsFile,
    ObjectsFile, PersonalitiesFile, SocialFile, TraitsFile, TuningFile, VisualDef,
};
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{Footprint, NeedId, NEED_COUNT, NEED_MAX, NEED_MIN};

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
///
/// One parameter per content file, deliberately, and the clippy arity
/// lint is answered rather than obeyed: a `ContentSources` struct would
/// hold the same eight names one level down, turn every call site's
/// compile-time "you forgot the new file" error into field-init noise,
/// and buy nothing else. The parameter list IS the manifest of what a
/// pack is made from.
#[allow(clippy::too_many_arguments)]
pub fn compile(
    needs: NeedsFile,
    objects: ObjectsFile,
    lot: LotFile,
    atlas: AtlasFile,
    tuning: TuningFile,
    personalities: PersonalitiesFile,
    household: HouseholdFile,
    social: SocialFile,
    traits: TraitsFile,
    careers: CareersFile,
    chains: ChainsFile,
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
    // The station-role vocabulary, in first-appearance order across the
    // file - [K1]. First-appearance rather than sorted so that adding a
    // role to a LATER object never renumbers an earlier one's indices.
    let mut roles: Vec<String> = Vec::new();

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

        let mut seen_sockets = BTreeSet::new();
        let mut action_sockets = Vec::with_capacity(object.action_socket.len());
        for socket in &object.action_socket {
            if socket.id.trim().is_empty() {
                return Err(ContentError::EmptyActionSocketId {
                    object: object.id.clone(),
                });
            }
            if !seen_sockets.insert(socket.id.clone()) {
                return Err(ContentError::DuplicateActionSocketId {
                    object: object.id.clone(),
                    socket: socket.id.clone(),
                });
            }
            check_finite(
                socket.x,
                &format!("x on action socket '{}' of '{}'", socket.id, object.id),
            )?;
            check_finite(
                socket.y,
                &format!("y on action socket '{}' of '{}'", socket.id, object.id),
            )?;
            let facing = match socket.facing.as_str() {
                "SE" => CompiledSocketFacing::PositiveX,
                "NW" => CompiledSocketFacing::NegativeX,
                "SW" => CompiledSocketFacing::PositiveY,
                "NE" => CompiledSocketFacing::NegativeY,
                unknown => {
                    return Err(ContentError::UnknownActionSocketFacing {
                        object: object.id.clone(),
                        socket: socket.id.clone(),
                        facing: unknown.to_string(),
                    })
                }
            };
            let x = (object.footprint.width - 1) as f32 / 2.0 + socket.x;
            let y = (object.footprint.depth - 1) as f32 / 2.0 + socket.y;
            if x.floor() < 0.0
                || y.floor() < 0.0
                || x.floor() >= object.footprint.width as f32
                || y.floor() >= object.footprint.depth as f32
            {
                return Err(ContentError::ActionSocketOutsideFootprint {
                    object: object.id.clone(),
                    socket: socket.id.clone(),
                    x,
                    y,
                });
            }
            action_sockets.push(CompiledActionSocket {
                id: socket.id.clone(),
                x: socket.x,
                y: socket.y,
                facing,
            });
        }

        // Scoped to the object, so two objects may each declare a
        // `use` interaction without colliding.
        //
        // The per-interaction rules from here down are mirrored in
        // `compile_social` with social-flavoured error variants; a rule
        // that changes here must change there too.
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

            let (tags, satisfaction, visual) = compile_activity_extras(
                act,
                &object.id,
                InteractionVisualOwner::Object,
                &action_sockets,
            )?;
            interactions.push(CompiledInteraction {
                id: act.id.clone(),
                advertises,
                duration_ticks: act.duration_ticks,
                slots: act.slots,
                label,
                tags,
                satisfaction,
                visual,
            });
        }

        // Roles resolve into the shared vocabulary, minted on first
        // appearance. Blank and repeated entries reject: a blank role
        // is unmatchable by any chain, and a repeat is an author
        // saying one thing twice - both silent-nothing shapes ([D9]).
        let mut worn_roles = Vec::with_capacity(object.roles.len());
        for role in &object.roles {
            if role.trim().is_empty() {
                return Err(ContentError::EmptyObjectRole {
                    object: object.id.clone(),
                });
            }
            let index = match roles.iter().position(|r| r == role) {
                Some(index) => index as u32,
                None => {
                    roles.push(role.clone());
                    (roles.len() - 1) as u32
                }
            };
            if worn_roles.contains(&index) {
                return Err(ContentError::DuplicateObjectRole {
                    object: object.id.clone(),
                    role: role.clone(),
                });
            }
            worn_roles.push(index);
        }
        worn_roles.sort_unstable();

        compiled.push(CompiledObject {
            id: object.id.clone(),
            name: object.name.clone(),
            sprite: sprite as u32,
            interactions,
            footprint: object.footprint,
            roles: worn_roles,
            action_sockets,
        });
    }

    // The authored sprite names ride beside the compiled objects only
    // for the length of this call: facing resolution needs the NAME to
    // suffix, and the compiled object deliberately holds the index.
    let sprite_names: Vec<String> = objects.object.iter().map(|o| o.sprite.clone()).collect();
    let lot = compile_lot(lot, &compiled, &sprite_names, &sprite_index)?;
    let (tuning, circadian, sleep_tag) = compile_tuning(tuning)?;

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

    // Personalities before the household, because a household member
    // resolves an archetype by name and the typo should be reported
    // against whichever file actually contains it.
    let personalities = compile_personalities(personalities, &compiled)?;

    // Social BEFORE the household since M2e, and the order is
    // load-bearing: a hobby resolves against the union of every tag any
    // interaction carries, and the social vocabulary carries tags too -
    // "socialising" is a hobby precisely because Chat is tagged with it.
    // Social itself compiles after tuning, because the clipped-duration
    // rule needs the floor and the variance, and social interactions are
    // subject to it for exactly the reasons the object loop's copy
    // documents. Traits sit between for the same dependency shape: they
    // key on the tag universe (so after social) and the household
    // resolves them by id (so before it).
    let social = compile_social(social, &tuning)?;
    // Chains BEFORE traits and the household, because their step tags
    // join the activity-tag universe both resolve against - a cooking
    // capability keys on the hob step now that the stove's standalone
    // interaction is retired. After the lot (the coverage rule needs
    // the placements) and after tuning (steps obey the clipped rule).
    let (chains, item_kinds) = compile_chains(chains, &compiled, &roles, &lot, &tuning)?;
    let traits = compile_traits(traits, &compiled, &social, &chains)?;
    // Careers after tuning for the day-clock cross-check, before the
    // household which resolves them by id - the traits pattern again.
    let careers = compile_careers(careers, &tuning)?;
    let household = compile_household(
        household,
        &personalities,
        &compiled,
        &social,
        &traits,
        &careers,
        &chains,
        &lot,
    )?;

    Ok(ContentPack {
        decay_per_tick: decay,
        objects: compiled,
        sim_sprite,
        lot,
        tuning,
        personalities,
        household,
        social,
        traits,
        careers,
        roles,
        item_kinds,
        chains,
        circadian,
        sleep_tag,
    })
}

/// Validates `content/chains.toml` - [K1]'s multi-step sequences.
///
/// Returns the compiled chains and the item-kind vocabulary their
/// steps mint. Two rules do the heavy lifting. The HANDS rule walks
/// each chain tracking what the sim would be carrying, so a step that
/// yields into a full hand, transforms or consumes the wrong thing,
/// or ends the chain still carrying has no representation. The
/// COVERAGE rule requires every step's role to be worn by an object
/// PLACED on the shipped lot - "build mode cannot author a lot where
/// eating is impossible" ([M-3]), enforced from day one. Placement
/// implies reachability: [F5] rule 3 already rejected any placed
/// object nothing can walk up to.
fn compile_chains(
    chains: ChainsFile,
    objects: &[CompiledObject],
    roles: &[String],
    lot: &CompiledLot,
    tuning: &Tuning,
) -> Result<(Vec<crate::pack::CompiledChain>, Vec<String>), ContentError> {
    let mut seen = BTreeSet::new();
    let mut item_kinds: Vec<String> = Vec::new();
    let mut compiled = Vec::with_capacity(chains.chain.len());

    for def in &chains.chain {
        if !seen.insert(def.id.clone()) {
            return Err(ContentError::DuplicateChain { id: def.id.clone() });
        }
        if def.label.trim().is_empty() {
            return Err(ContentError::EmptyChainLabel { id: def.id.clone() });
        }
        let Some(advertiser) = objects.iter().position(|o| o.id == def.advertised_by) else {
            return Err(ContentError::UnknownChainAdvertiser {
                chain: def.id.clone(),
                object: def.advertised_by.clone(),
            });
        };
        if def.step.is_empty() {
            return Err(ContentError::EmptyChain { id: def.id.clone() });
        }

        let mut advertises = Vec::with_capacity(def.advertises.len());
        for (need_name, delta) in &def.advertises {
            let Some(id) = NeedId::from_name(need_name) else {
                return Err(ContentError::UnknownChainNeed {
                    chain: def.id.clone(),
                    need: need_name.clone(),
                });
            };
            check_finite(
                *delta,
                &format!("advert '{}' on chain '{}'", need_name, def.id),
            )?;
            advertises.push((id.index() as u8, *delta));
        }
        advertises.sort_unstable_by_key(|(i, _)| *i);

        check_finite(
            def.satisfaction,
            &format!("satisfaction on chain '{}'", def.id),
        )?;
        if def.satisfaction < 0.0 {
            return Err(ContentError::NegativeValue {
                context: format!("satisfaction on chain '{}'", def.id),
            });
        }

        // The hands rule's ledger: what the sim is carrying entering
        // each step, by kind name.
        let mut carrying: Option<String> = None;
        let mut steps = Vec::with_capacity(def.step.len());
        for (index, step) in def.step.iter().enumerate() {
            if step.label.trim().is_empty() {
                return Err(ContentError::EmptyChainStepLabel {
                    chain: def.id.clone(),
                    step: index,
                });
            }
            if step.duration_ticks == 0 {
                return Err(ContentError::ZeroChainStepDuration {
                    chain: def.id.clone(),
                    step: index,
                });
            }
            // The same clipped-duration rule interactions obey, and
            // for the same three-silent-failures reason - under its own
            // variant, because "object 'cook_dinner'" would send the
            // author hunting objects.toml for a chain.
            let variance = tuning.duration_variance;
            let floor = tuning.min_interaction_ticks;
            if (step.duration_ticks as f32) * (1.0 - variance) < floor as f32 {
                let minimum = ((floor as f32) / (1.0 - variance)).ceil() as u32;
                return Err(ContentError::ClippedChainStepDuration {
                    chain: def.id.clone(),
                    step: index,
                    duration_ticks: step.duration_ticks,
                    minimum,
                    floor,
                    variance,
                });
            }
            for tag in &step.tags {
                if tag.trim().is_empty() {
                    return Err(ContentError::EmptyChainStepTag {
                        chain: def.id.clone(),
                        step: index,
                    });
                }
            }
            let visual = compile_visual(
                step.visual.as_ref(),
                VisualOwner::ChainStep {
                    chain: &def.id,
                    step: index,
                },
                &[],
            )?;

            // The role, resolved against the vocabulary the objects
            // minted, then against the LOT: a role nobody wears is a
            // typo, a role nobody PLACED is a kitchen with no stove.
            let Some(role) = roles.iter().position(|r| r == &step.role) else {
                return Err(ContentError::UnknownChainRole {
                    chain: def.id.clone(),
                    step: index,
                    role: step.role.clone(),
                });
            };
            let role = role as u32;
            let placed = lot
                .placements
                .iter()
                .any(|placement| objects[placement.object.0 as usize].roles.contains(&role));
            if !placed {
                return Err(ContentError::UnstationedChainRole {
                    chain: def.id.clone(),
                    step: index,
                    role: step.role.clone(),
                });
            }

            // The hands rule. Kinds are MINTED by yields/transforms.to
            // (first appearance); from/consumes must name what is
            // actually in hand, which subsumes "unknown kind". Blank
            // names reject first - a blank would mint an empty
            // vocabulary entry and make every later hands error
            // unreadable.
            let blank = [
                step.yields.as_deref(),
                step.transforms.as_ref().map(|t| t.from.as_str()),
                step.transforms.as_ref().map(|t| t.to.as_str()),
                step.consumes.as_deref(),
            ]
            .iter()
            .any(|name| name.is_some_and(|n| n.trim().is_empty()));
            if blank {
                return Err(ContentError::EmptyChainItemKind {
                    chain: def.id.clone(),
                    step: index,
                });
            }
            let mut yields = None;
            let mut transforms = None;
            let mut consumes = None;
            let too_many = [
                step.yields.is_some(),
                step.transforms.is_some(),
                step.consumes.is_some(),
            ]
            .iter()
            .filter(|set| **set)
            .count()
                > 1;
            if too_many {
                return Err(ContentError::ChainHandsMismatch {
                    chain: def.id.clone(),
                    step: index,
                    detail: "a step does at most one thing to the hands".to_string(),
                });
            }
            if let Some(kind) = &step.yields {
                if let Some(held) = &carrying {
                    return Err(ContentError::ChainHandsMismatch {
                        chain: def.id.clone(),
                        step: index,
                        detail: format!("yields '{kind}' while already carrying '{held}'"),
                    });
                }
                yields = Some(mint_kind(&mut item_kinds, kind));
                carrying = Some(kind.clone());
            } else if let Some(change) = &step.transforms {
                if carrying.as_deref() != Some(change.from.as_str()) {
                    return Err(ContentError::ChainHandsMismatch {
                        chain: def.id.clone(),
                        step: index,
                        detail: format!(
                            "transforms '{}' while carrying {}",
                            change.from,
                            carrying.as_deref().unwrap_or("nothing")
                        ),
                    });
                }
                transforms = Some((
                    mint_kind(&mut item_kinds, &change.from),
                    mint_kind(&mut item_kinds, &change.to),
                ));
                carrying = Some(change.to.clone());
            } else if let Some(kind) = &step.consumes {
                if carrying.as_deref() != Some(kind.as_str()) {
                    return Err(ContentError::ChainHandsMismatch {
                        chain: def.id.clone(),
                        step: index,
                        detail: format!(
                            "consumes '{}' while carrying {}",
                            kind,
                            carrying.as_deref().unwrap_or("nothing")
                        ),
                    });
                }
                consumes = Some(mint_kind(&mut item_kinds, kind));
                carrying = None;
            }

            steps.push(crate::pack::CompiledChainStep {
                role,
                label: step.label.clone(),
                duration_ticks: step.duration_ticks,
                tags: step.tags.clone(),
                yields,
                transforms,
                consumes,
                visual,
            });
        }
        if let Some(held) = carrying {
            return Err(ContentError::ChainEndsCarrying {
                chain: def.id.clone(),
                item: held,
            });
        }

        compiled.push(crate::pack::CompiledChain {
            id: def.id.clone(),
            label: def.label.clone(),
            advertised_by: ObjectDefId(advertiser as u32),
            advertises,
            satisfaction: def.satisfaction,
            steps,
        });
    }
    Ok((compiled, item_kinds))
}

/// The item-kind vocabulary's one writer: an existing kind's index, or
/// a fresh one minted at the tail so earlier indices never move.
fn mint_kind(item_kinds: &mut Vec<String>, name: &str) -> u32 {
    match item_kinds.iter().position(|k| k == name) {
        Some(index) => index as u32,
        None => {
            item_kinds.push(name.to_string());
            (item_kinds.len() - 1) as u32
        }
    }
}

/// Validates `content/careers.toml` - [E4]'s rabbit holes.
///
/// The one cross-file rule is the day clock: a shift that starts past
/// the day never begins, and one as long as the day (or longer) sends
/// the sim back out the moment it returns - both silent versions of
/// "the career is the whole life", which is satire the SIMULATION
/// should not commit by accident.
fn compile_careers(
    careers: CareersFile,
    tuning: &Tuning,
) -> Result<Vec<crate::pack::CompiledCareer>, ContentError> {
    let mut seen = BTreeSet::new();
    let mut compiled = Vec::with_capacity(careers.career.len());
    for def in &careers.career {
        if !seen.insert(def.id.clone()) {
            return Err(ContentError::DuplicateCareer { id: def.id.clone() });
        }
        if def.label.trim().is_empty() {
            return Err(ContentError::EmptyCareerLabel { id: def.id.clone() });
        }
        if def.shift_ticks == 0 {
            return Err(ContentError::ZeroShift { id: def.id.clone() });
        }
        if def.shift_start >= tuning.day_ticks {
            return Err(ContentError::ShiftStartsPastTheDay {
                id: def.id.clone(),
                shift_start: def.shift_start,
                day_ticks: tuning.day_ticks,
            });
        }
        if def.shift_ticks >= tuning.day_ticks {
            return Err(ContentError::ShiftLongerThanTheDay {
                id: def.id.clone(),
                shift_ticks: def.shift_ticks,
                day_ticks: tuning.day_ticks,
            });
        }
        check_finite(
            def.energy_cost,
            &format!("energy_cost on career '{}'", def.id),
        )?;
        if !(0.0..=terri_core::NEED_MAX).contains(&def.energy_cost) {
            return Err(ContentError::CareerEnergyCostOutOfRange {
                id: def.id.clone(),
                value: def.energy_cost,
            });
        }
        check_finite(
            def.satisfaction,
            &format!("satisfaction on career '{}'", def.id),
        )?;
        if def.satisfaction < 0.0 {
            return Err(ContentError::NegativeCareerSatisfaction {
                id: def.id.clone(),
                value: def.satisfaction,
            });
        }
        compiled.push(crate::pack::CompiledCareer {
            id: def.id.clone(),
            label: def.label.clone(),
            shift_start: def.shift_start,
            shift_ticks: def.shift_ticks,
            pay: def.pay,
            energy_cost: def.energy_cost,
            satisfaction: def.satisfaction,
        });
    }
    Ok(compiled)
}

/// Validates `content/traits.toml` - [E3]'s three mechanisms, one file.
///
/// The per-kind field rules are the strictest thing here, and they cut
/// BOTH ways: a kind's own numbers are required (a capability with no
/// learning rate is a question the simulation would answer with a
/// default nobody chose), and another kind's numbers are REJECTED (a
/// `score_multiplier` on a condition is a statement the simulation
/// silently ignores - the [D9] shape, caught at build time).
fn compile_traits(
    traits: TraitsFile,
    objects: &[CompiledObject],
    social: &[CompiledInteraction],
    chains: &[crate::pack::CompiledChain],
) -> Result<Vec<crate::pack::CompiledTrait>, ContentError> {
    use crate::pack::{CompiledTrait, CompiledTraitKind};

    let known_tags: BTreeSet<&str> = objects
        .iter()
        .flat_map(|object| &object.interactions)
        .chain(social)
        .flat_map(|act| &act.tags)
        .chain(chains.iter().flat_map(|c| &c.steps).flat_map(|s| &s.tags))
        .map(String::as_str)
        .collect();

    let mut seen = BTreeSet::new();
    let mut compiled = Vec::with_capacity(traits.trait_def.len());
    for def in &traits.trait_def {
        if !seen.insert(def.id.clone()) {
            return Err(ContentError::DuplicateTrait { id: def.id.clone() });
        }
        if def.label.trim().is_empty() {
            return Err(ContentError::EmptyTraitLabel { id: def.id.clone() });
        }
        if !known_tags.contains(def.tag.as_str()) {
            return Err(ContentError::TraitAboutNothing {
                id: def.id.clone(),
                tag: def.tag.clone(),
            });
        }

        // One closure per rule so every error names the trait and the
        // field, which is where the author's cursor needs to land.
        let unit = |value: Option<f32>, field: &str| -> Result<f32, ContentError> {
            let value = value.ok_or_else(|| ContentError::MissingTraitField {
                id: def.id.clone(),
                kind: def.kind.clone(),
                field: field.to_string(),
            })?;
            check_finite(value, &format!("{field} on trait '{}'", def.id))?;
            if !(0.0..=1.0).contains(&value) {
                return Err(ContentError::TraitFieldOutOfRange {
                    id: def.id.clone(),
                    field: field.to_string(),
                    value,
                });
            }
            Ok(value)
        };
        let forbid = |value: Option<f32>, field: &str| -> Result<(), ContentError> {
            if value.is_some() {
                return Err(ContentError::TraitFieldForWrongKind {
                    id: def.id.clone(),
                    kind: def.kind.clone(),
                    field: field.to_string(),
                });
            }
            Ok(())
        };

        let kind = match def.kind.as_str() {
            "disposition" => {
                let multiplier =
                    def.score_multiplier
                        .ok_or_else(|| ContentError::MissingTraitField {
                            id: def.id.clone(),
                            kind: def.kind.clone(),
                            field: "score_multiplier".to_string(),
                        })?;
                check_finite(
                    multiplier,
                    &format!("score_multiplier on trait '{}'", def.id),
                )?;
                // Zero is legal and IS the fear ([S4]); negative would
                // turn a benefit into a cost behind nobody's decision,
                // the same rule relationship_delta_scale carries.
                if multiplier < 0.0 {
                    return Err(ContentError::TraitFieldOutOfRange {
                        id: def.id.clone(),
                        field: "score_multiplier".to_string(),
                        value: multiplier,
                    });
                }
                forbid(def.start_level, "start_level")?;
                forbid(def.fail_delta_scale, "fail_delta_scale")?;
                forbid(def.learn_per_attempt, "learn_per_attempt")?;
                forbid(def.accrual_scale, "accrual_scale")?;
                forbid(def.manage_per_completion, "manage_per_completion")?;
                forbid(def.start_severity, "start_severity")?;
                CompiledTraitKind::Disposition {
                    score_multiplier: multiplier,
                }
            }
            "capability" => {
                let start_level = unit(def.start_level, "start_level")?;
                let fail_delta_scale = unit(def.fail_delta_scale, "fail_delta_scale")?;
                let learn_per_attempt = unit(def.learn_per_attempt, "learn_per_attempt")?;
                forbid(def.score_multiplier, "score_multiplier")?;
                forbid(def.accrual_scale, "accrual_scale")?;
                forbid(def.manage_per_completion, "manage_per_completion")?;
                forbid(def.start_severity, "start_severity")?;
                CompiledTraitKind::Capability {
                    start_level,
                    fail_delta_scale,
                    learn_per_attempt,
                }
            }
            "condition" => {
                let accrual_scale = unit(def.accrual_scale, "accrual_scale")?;
                let manage_per_completion =
                    unit(def.manage_per_completion, "manage_per_completion")?;
                let start_severity = unit(def.start_severity, "start_severity")?;
                forbid(def.score_multiplier, "score_multiplier")?;
                forbid(def.start_level, "start_level")?;
                forbid(def.fail_delta_scale, "fail_delta_scale")?;
                forbid(def.learn_per_attempt, "learn_per_attempt")?;
                CompiledTraitKind::Condition {
                    accrual_scale,
                    manage_per_completion,
                    start_severity,
                }
            }
            other => {
                return Err(ContentError::UnknownTraitKind {
                    id: def.id.clone(),
                    kind: other.to_string(),
                })
            }
        };

        compiled.push(CompiledTrait {
            id: def.id.clone(),
            label: def.label.clone(),
            tag: def.tag.clone(),
            kind,
        });
    }

    Ok(compiled)
}

/// Validates `content/social.toml` and compiles the interactions every sim
/// advertises to other sims - [H4]/[H6].
///
/// The checks mirror the per-interaction rules in the object loop of
/// [`compile`], with their own error variants so a mistake is reported
/// against `social.toml` rather than against an object that does not
/// exist; that is the same reason the household has `SpawnOutOfBounds`
/// instead of reusing `PlacementOutOfBounds`. If a rule changes in one
/// place it must change in the other; each side carries this pointer.
///
/// An EMPTY vocabulary is legal here, because a test pack has no social
/// life and forcing one on it would push a talk interaction into every
/// fixture in the workspace. The shipped pack is the one that must let
/// sims talk, and `the_shipped_pack_gives_sims_a_way_to_talk` in
/// `lib.rs` holds that line - the same split as
/// `every_declared_object_is_placed_on_the_lot`.
fn compile_social(
    social: SocialFile,
    tuning: &Tuning,
) -> Result<Vec<CompiledInteraction>, ContentError> {
    let mut seen = BTreeSet::new();
    let mut compiled = Vec::with_capacity(social.interaction.len());

    for act in &social.interaction {
        if !seen.insert(act.id.clone()) {
            return Err(ContentError::DuplicateSocialInteraction { id: act.id.clone() });
        }
        if act.duration_ticks == 0 {
            return Err(ContentError::SocialZeroDuration {
                interaction: act.id.clone(),
            });
        }
        if act.slots == 0 {
            return Err(ContentError::SocialZeroSlots {
                interaction: act.id.clone(),
            });
        }
        // Absent falls back to the id; blank is rejected. The object
        // loop's copy of this rule explains why the two authoring states
        // are different and why only the emptiness TEST trims.
        let label = match &act.label {
            Some(label) if label.trim().is_empty() => {
                return Err(ContentError::SocialEmptyLabel {
                    interaction: act.id.clone(),
                })
            }
            Some(label) => label.clone(),
            None => act.id.clone(),
        };

        let mut advertises = Vec::with_capacity(act.advertises.len());
        for (need_name, delta) in &act.advertises {
            let Some(id) = NeedId::from_name(need_name) else {
                return Err(ContentError::SocialUnknownNeed {
                    interaction: act.id.clone(),
                    need: need_name.clone(),
                });
            };
            check_finite(
                *delta,
                &format!("advert '{}' on social '{}'", need_name, act.id),
            )?;
            advertises.push((id.index() as u8, *delta));
        }
        advertises.sort_unstable_by_key(|(i, _)| *i);

        // The clipped-duration rule, inline rather than in a second pass,
        // because unlike the object loop this function already holds the
        // compiled tuning. Same arithmetic, same div-ceil boundary.
        let variance = tuning.duration_variance;
        let floor = tuning.min_interaction_ticks;
        if (act.duration_ticks as f32) * (1.0 - variance) < floor as f32 {
            let minimum = ((floor as f32) / (1.0 - variance)).ceil() as u32;
            return Err(ContentError::ClippedSocialDuration {
                interaction: act.id.clone(),
                duration_ticks: act.duration_ticks,
                minimum,
                floor,
                variance,
            });
        }

        let (tags, satisfaction, visual) =
            compile_activity_extras(act, "social.toml", InteractionVisualOwner::Social, &[])?;
        compiled.push(CompiledInteraction {
            id: act.id.clone(),
            advertises,
            duration_ticks: act.duration_ticks,
            slots: act.slots,
            label,
            tags,
            satisfaction,
            visual,
        });
    }

    Ok(compiled)
}

/// Validates and copies an interaction's M2e activity fields - the tags
/// hobbies and traits key on, and the completion satisfaction ([E1]/
/// [E2] in the M2e design). One function shared VERBATIM by the object
/// loop and [`compile_social`], because the two loops' mirror comments
/// exist precisely to warn that a rule changed in one and not the other
/// - a shared body is that warning made unnecessary for these fields.
///
/// `owner` is the object id, or `social.toml` for the vocabulary, so an
/// error names the file that actually holds the mistake.
fn compile_activity_extras(
    act: &InteractionDef,
    owner: &str,
    visual_owner: InteractionVisualOwner,
    action_sockets: &[CompiledActionSocket],
) -> Result<(Vec<String>, f32, Option<CompiledVisual>), ContentError> {
    for tag in &act.tags {
        if tag.trim().is_empty() {
            return Err(ContentError::EmptyActivityTag {
                owner: owner.to_string(),
                interaction: act.id.clone(),
            });
        }
    }
    check_finite(
        act.satisfaction,
        &format!("satisfaction on '{}' of '{owner}'", act.id),
    )?;
    if act.satisfaction < 0.0 {
        return Err(ContentError::NegativeSatisfaction {
            owner: owner.to_string(),
            interaction: act.id.clone(),
            satisfaction: act.satisfaction,
        });
    }
    let visual_owner = match visual_owner {
        InteractionVisualOwner::Object => VisualOwner::Object {
            object: owner,
            interaction: &act.id,
        },
        InteractionVisualOwner::Social => VisualOwner::Social {
            interaction: &act.id,
        },
    };
    let visual = compile_visual(act.visual.as_ref(), visual_owner, action_sockets)?;
    Ok((act.tags.clone(), act.satisfaction, visual))
}

#[derive(Clone, Copy)]
enum InteractionVisualOwner {
    Object,
    Social,
}

#[derive(Clone, Copy)]
enum VisualOwner<'a> {
    Object {
        object: &'a str,
        interaction: &'a str,
    },
    Social {
        interaction: &'a str,
    },
    ChainStep {
        chain: &'a str,
        step: usize,
    },
}

impl VisualOwner<'_> {
    fn incomplete(self, field: &'static str) -> ContentError {
        match self {
            Self::Object {
                object,
                interaction,
            } => ContentError::IncompleteVisual {
                owner: object.to_string(),
                interaction: interaction.to_string(),
                field,
            },
            Self::Social { interaction } => ContentError::IncompleteVisual {
                owner: "social.toml".to_string(),
                interaction: interaction.to_string(),
                field,
            },
            Self::ChainStep { chain, step } => ContentError::IncompleteChainStepVisual {
                chain: chain.to_string(),
                step,
                field,
            },
        }
    }

    fn unknown_action(self, action: &str) -> ContentError {
        match self {
            Self::Object {
                object,
                interaction,
            } => ContentError::UnknownVisualAction {
                owner: object.to_string(),
                interaction: interaction.to_string(),
                action: action.to_string(),
            },
            Self::Social { interaction } => ContentError::UnknownVisualAction {
                owner: "social.toml".to_string(),
                interaction: interaction.to_string(),
                action: action.to_string(),
            },
            Self::ChainStep { chain, step } => ContentError::UnknownChainStepVisualAction {
                chain: chain.to_string(),
                step,
                action: action.to_string(),
            },
        }
    }

    fn unknown_anchor(self, anchor: &str) -> ContentError {
        match self {
            Self::Object {
                object,
                interaction,
            } => ContentError::UnknownVisualAnchor {
                owner: object.to_string(),
                interaction: interaction.to_string(),
                anchor: anchor.to_string(),
            },
            Self::Social { interaction } => ContentError::UnknownVisualAnchor {
                owner: "social.toml".to_string(),
                interaction: interaction.to_string(),
                anchor: anchor.to_string(),
            },
            Self::ChainStep { chain, step } => ContentError::UnknownChainStepVisualAnchor {
                chain: chain.to_string(),
                step,
                anchor: anchor.to_string(),
            },
        }
    }

    fn unknown_facing(self, facing: &str) -> ContentError {
        match self {
            Self::Object {
                object,
                interaction,
            } => ContentError::UnknownVisualFacing {
                owner: object.to_string(),
                interaction: interaction.to_string(),
                facing: facing.to_string(),
            },
            Self::Social { interaction } => ContentError::UnknownVisualFacing {
                owner: "social.toml".to_string(),
                interaction: interaction.to_string(),
                facing: facing.to_string(),
            },
            Self::ChainStep { chain, step } => ContentError::UnknownChainStepVisualFacing {
                chain: chain.to_string(),
                step,
                facing: facing.to_string(),
            },
        }
    }

    fn invalid_contract(self, action: &str, anchor: &str) -> ContentError {
        let (owner, activity) = match self {
            Self::Object {
                object,
                interaction,
            } => (
                format!("object '{object}'"),
                format!("interaction '{interaction}'"),
            ),
            Self::Social { interaction } => (
                "social.toml".to_string(),
                format!("interaction '{interaction}'"),
            ),
            Self::ChainStep { chain, step } => (format!("chain '{chain}'"), format!("step {step}")),
        };
        ContentError::InvalidVisualContract {
            owner,
            activity,
            action: action.to_string(),
            anchor: anchor.to_string(),
        }
    }
}

/// Validates the authored presentation vocabulary and exact owner matrix once
/// for object interactions, social interactions, and chain steps. The schema
/// keeps strings so errors can name content; the compiled pack carries enums
/// so an unknown or mixed value cannot reach runtime.
fn compile_visual(
    visual: Option<&VisualDef>,
    owner: VisualOwner<'_>,
    action_sockets: &[CompiledActionSocket],
) -> Result<Option<CompiledVisual>, ContentError> {
    let Some(visual) = visual else {
        return Ok(None);
    };

    let action = visual
        .action
        .as_deref()
        .ok_or_else(|| owner.incomplete("action"))?;
    let anchor = visual
        .anchor
        .as_deref()
        .ok_or_else(|| owner.incomplete("anchor"))?;
    let facing = visual
        .facing
        .as_deref()
        .ok_or_else(|| owner.incomplete("facing"))?;

    let action = match action {
        "talk" => CompiledVisualAction::Talk,
        "eat" => CompiledVisualAction::Eat,
        "read" => CompiledVisualAction::Read,
        "exercise" => CompiledVisualAction::Exercise,
        "watch" => CompiledVisualAction::Watch,
        unknown => return Err(owner.unknown_action(unknown)),
    };
    let anchor = match anchor {
        "partner" => CompiledVisualAnchor::Partner,
        "object" => CompiledVisualAnchor::Object,
        "station" => CompiledVisualAnchor::Station,
        "object_socket" => CompiledVisualAnchor::ObjectSocket,
        unknown => return Err(owner.unknown_anchor(unknown)),
    };
    let facing = match facing {
        "toward_anchor" => CompiledVisualFacing::TowardAnchor,
        "socket" => CompiledVisualFacing::Socket,
        unknown => return Err(owner.unknown_facing(unknown)),
    };

    if matches!(
        action,
        CompiledVisualAction::Read | CompiledVisualAction::Exercise
    ) && anchor == CompiledVisualAnchor::ObjectSocket
        && visual.socket.is_none()
    {
        return Err(owner.incomplete("socket"));
    }

    let legal = matches!(
        (owner, action, anchor, facing, visual.socket.as_ref()),
        (
            VisualOwner::Social { .. },
            CompiledVisualAction::Talk,
            CompiledVisualAnchor::Partner,
            CompiledVisualFacing::TowardAnchor,
            None
        ) | (
            VisualOwner::Object { .. },
            CompiledVisualAction::Eat,
            CompiledVisualAnchor::Object,
            CompiledVisualFacing::TowardAnchor,
            None
        ) | (
            VisualOwner::ChainStep { .. },
            CompiledVisualAction::Eat,
            CompiledVisualAnchor::Station,
            CompiledVisualFacing::TowardAnchor,
            None
        ) | (
            VisualOwner::Object { .. },
            CompiledVisualAction::Read,
            CompiledVisualAnchor::Object,
            CompiledVisualFacing::TowardAnchor,
            None
        ) | (
            VisualOwner::Object { .. },
            CompiledVisualAction::Read,
            CompiledVisualAnchor::ObjectSocket,
            CompiledVisualFacing::Socket,
            Some(_)
        ) | (
            VisualOwner::Object { .. },
            CompiledVisualAction::Exercise,
            CompiledVisualAnchor::ObjectSocket,
            CompiledVisualFacing::Socket,
            Some(_)
        ) | (
            VisualOwner::Object { .. },
            CompiledVisualAction::Watch,
            CompiledVisualAnchor::Object,
            CompiledVisualFacing::TowardAnchor,
            None
        )
    );
    if !legal {
        let action = match action {
            CompiledVisualAction::Talk => "talk",
            CompiledVisualAction::Eat => "eat",
            CompiledVisualAction::Read => "read",
            CompiledVisualAction::Exercise => "exercise",
            CompiledVisualAction::Watch => "watch",
        };
        let anchor = match anchor {
            CompiledVisualAnchor::Partner => "partner",
            CompiledVisualAnchor::Object => "object",
            CompiledVisualAnchor::Station => "station",
            CompiledVisualAnchor::ObjectSocket => "object_socket",
        };
        return Err(owner.invalid_contract(action, anchor));
    }

    let socket = match visual.socket.as_deref() {
        Some(socket) => Some(
            action_sockets
                .iter()
                .position(|candidate| candidate.id == socket)
                .ok_or_else(|| match owner {
                    VisualOwner::Object {
                        object,
                        interaction,
                    } => ContentError::UnknownVisualSocket {
                        owner: object.to_string(),
                        interaction: interaction.to_string(),
                        socket: socket.to_string(),
                    },
                    _ => owner.invalid_contract(
                        match action {
                            CompiledVisualAction::Talk => "talk",
                            CompiledVisualAction::Eat => "eat",
                            CompiledVisualAction::Read => "read",
                            CompiledVisualAction::Exercise => "exercise",
                            CompiledVisualAction::Watch => "watch",
                        },
                        "object_socket",
                    ),
                })? as u32,
        ),
        None => None,
    };

    Ok(Some(CompiledVisual {
        action,
        anchor,
        facing,
        socket,
    }))
}

/// Validates `content/personalities.toml` against the compiled objects and
/// densifies the sparse authored maps - [H3].
///
/// Absent map entries become 1.0, so a read site is an index rather than a
/// lookup-with-default each caller could write differently. The floors
/// differ between the two maps on purpose: a DRAIN of 0 is a placid trait
/// (the need never troubles this sim), while a SATISFACTION of 0 makes the
/// need dynamically unsatisfiable for this one sim - [C2] with a face on
/// it, and invisible to the static
/// `every_declared_need_can_be_satisfied_by_some_interaction`.
fn compile_personalities(
    personalities: PersonalitiesFile,
    objects: &[CompiledObject],
) -> Result<Vec<CompiledPersonality>, ContentError> {
    let mut compiled: Vec<CompiledPersonality> = Vec::with_capacity(personalities.archetype.len());

    for archetype in &personalities.archetype {
        if compiled.iter().any(|p| p.id == archetype.id) {
            return Err(ContentError::DuplicateArchetype {
                id: archetype.id.clone(),
            });
        }

        let mut drain = [1.0f32; NEED_COUNT];
        for (need_name, value) in &archetype.drain {
            let Some(id) = NeedId::from_name(need_name) else {
                return Err(ContentError::UnknownPersonalityNeed {
                    archetype: archetype.id.clone(),
                    map: "drain",
                    need: need_name.clone(),
                });
            };
            check_number(
                *value,
                &format!("archetype '{}' drain for '{need_name}'", archetype.id),
            )?;
            drain[id.index()] = *value;
        }

        let mut satisfaction = [1.0f32; NEED_COUNT];
        for (need_name, value) in &archetype.satisfaction {
            let Some(id) = NeedId::from_name(need_name) else {
                return Err(ContentError::UnknownPersonalityNeed {
                    archetype: archetype.id.clone(),
                    map: "satisfaction",
                    need: need_name.clone(),
                });
            };
            check_finite(
                *value,
                &format!(
                    "archetype '{}' satisfaction for '{need_name}'",
                    archetype.id
                ),
            )?;
            if *value <= 0.0 {
                return Err(ContentError::NonPositiveSatisfaction {
                    archetype: archetype.id.clone(),
                    need: need_name.clone(),
                    value: *value,
                });
            }
            satisfaction[id.index()] = *value;
        }

        let mut dispositions: Vec<(ObjectDefId, u32, f32)> = Vec::new();
        for disposition in &archetype.disposition {
            // Object first, then the interaction ON that object, so a typo
            // is reported as the mistake it is rather than as its
            // consequence - the same ordering the placement checks use.
            let Some(object_index) = objects.iter().position(|o| o.id == disposition.object) else {
                return Err(ContentError::UnknownDispositionObject {
                    archetype: archetype.id.clone(),
                    object: disposition.object.clone(),
                });
            };
            let Some(interaction_index) = objects[object_index]
                .interactions
                .iter()
                .position(|i| i.id == disposition.interaction)
            else {
                return Err(ContentError::UnknownDispositionInteraction {
                    archetype: archetype.id.clone(),
                    object: disposition.object.clone(),
                    interaction: disposition.interaction.clone(),
                });
            };
            // Weight 0 is legal and IS the "fear of couches" the design
            // brief asks for, so `check_number` (non-negative) rather than
            // a strict-positive rule.
            check_number(
                disposition.weight,
                &format!(
                    "archetype '{}' disposition toward '{}.{}'",
                    archetype.id, disposition.object, disposition.interaction
                ),
            )?;
            let key = (ObjectDefId(object_index as u32), interaction_index as u32);
            if dispositions
                .iter()
                .any(|(object, interaction, _)| (*object, *interaction) == key)
            {
                return Err(ContentError::DuplicateDisposition {
                    archetype: archetype.id.clone(),
                    object: disposition.object.clone(),
                    interaction: disposition.interaction.clone(),
                });
            }
            dispositions.push((key.0, key.1, disposition.weight));
        }
        // Sorted because `Personality::disposition` binary-searches the
        // list, and because its iteration order has to be deterministic
        // for anything that ever walks it; authored order is a fact about
        // the TOML, not about the sim.
        dispositions.sort_by_key(|(object, interaction, _)| (object.0, *interaction));

        compiled.push(CompiledPersonality {
            id: archetype.id.clone(),
            drain,
            satisfaction,
            dispositions,
            // Carried through verbatim. Unlike every other number here it
            // needs no range check: any offset is legal because the phase
            // wraps, and "three hours later than everyone" and "twenty-one
            // hours earlier" are the same sim.
            chronotype_offset_ticks: archetype.chronotype_offset_ticks,
        });
    }

    Ok(compiled)
}

/// Validates `content/household.toml` against everything else - [H2].
///
/// The geometric rules mirror the placement rules and exist for the same
/// [D9] reason, with one twist that earns the flood fill a second caller:
/// a sim spawned on a WALKABLE tile inside a sealed pocket is not a build
/// error anywhere else, because no OBJECT is unreachable - the sim itself
/// is what cannot get out, and it would starve there with no error from
/// anything.
#[allow(clippy::too_many_arguments)]
fn compile_household(
    household: HouseholdFile,
    personalities: &[CompiledPersonality],
    objects: &[CompiledObject],
    social: &[CompiledInteraction],
    traits: &[crate::pack::CompiledTrait],
    careers: &[crate::pack::CompiledCareer],
    chains: &[crate::pack::CompiledChain],
    lot: &CompiledLot,
) -> Result<Vec<CompiledHouseholdMember>, ContentError> {
    if household.sim.len() > crate::schema::MAX_HOUSEHOLD_SIZE {
        return Err(ContentError::TooManyHouseholdMembers {
            count: household.sim.len(),
            max: crate::schema::MAX_HOUSEHOLD_SIZE,
        });
    }

    // Every tag any activity in the pack carries - object and social
    // interactions plus chain STEPS - which is what a hobby must
    // resolve against ([D9]: a hobby nothing can ever pay has no
    // representation once a pack exists). A set because the question is
    // membership; BTreeSet only for determinism discipline, though
    // nothing here iterates it.
    let known_tags: BTreeSet<&str> = objects
        .iter()
        .flat_map(|object| &object.interactions)
        .chain(social)
        .flat_map(|act| &act.tags)
        .chain(chains.iter().flat_map(|c| &c.steps).flat_map(|s| &s.tags))
        .map(String::as_str)
        .collect();
    // The blocked set the simulation will actually enforce - walls plus
    // footprint tiles - rebuilt the same way `Sim::new_from_lot` builds
    // it. Everything in it is in bounds: `compile_lot` has already
    // rejected anything that is not, which is what makes the additions
    // here unable to overflow.
    let mut blocked: BTreeSet<(u32, u32)> = lot.walls.iter().copied().collect();
    for placement in &lot.placements {
        let object = &objects[placement.object.0 as usize];
        let tile = (placement.x as u32, placement.y as u32);
        for dy in 0..object.footprint.depth {
            for dx in 0..object.footprint.width {
                blocked.insert((tile.0 + dx, tile.1 + dy));
            }
        }
    }
    let root = (0..lot.height)
        .flat_map(|y| (0..lot.width).map(move |x| (x, y)))
        .find(|tile| !blocked.contains(tile));
    let reached = root.map(|root| flood_fill(lot.width, lot.height, &blocked, root));

    let mut compiled = Vec::with_capacity(household.sim.len());
    for (index, sim) in household.sim.iter().enumerate() {
        if sim.name.trim().is_empty() {
            return Err(ContentError::EmptySimName { index });
        }
        let Some(personality) = personalities.iter().position(|p| p.id == sim.archetype) else {
            return Err(ContentError::UnknownArchetype {
                sim: sim.name.clone(),
                archetype: sim.archetype.clone(),
            });
        };

        // Finiteness before the bounds comparison, for the reason the
        // placement checks give: every comparison against NaN is false, so
        // a NaN coordinate would sail through the range check and land on
        // tile 0 after the cast.
        check_finite(sim.x, &format!("household spawn x for '{}'", sim.name))?;
        check_finite(sim.y, &format!("household spawn y for '{}'", sim.name))?;
        if sim.x < 0.0 || sim.y < 0.0 || sim.x >= lot.width as f32 || sim.y >= lot.height as f32 {
            return Err(ContentError::SpawnOutOfBounds {
                sim: sim.name.clone(),
                x: sim.x,
                y: sim.y,
                width: lot.width,
                height: lot.height,
            });
        }
        let tile = (sim.x as u32, sim.y as u32);
        if blocked.contains(&tile) {
            return Err(ContentError::SpawnOnBlockedTile {
                sim: sim.name.clone(),
                x: tile.0,
                y: tile.1,
            });
        }
        if let (Some(root), Some(reached)) = (root, reached.as_ref()) {
            let index = (tile.1 as usize) * (lot.width as usize) + tile.0 as usize;
            if !reached[index] {
                return Err(ContentError::SpawnUnreachable {
                    sim: sim.name.clone(),
                    x: tile.0,
                    y: tile.1,
                    root_x: root.0,
                    root_y: root.1,
                });
            }
        }

        // Absent needs start FULL, not at zero: the interesting authoring
        // statement is "Terri arrives hungry", and a default of zero would
        // spawn every under-specified sim in simultaneous crisis.
        let mut needs = [NEED_MAX; NEED_COUNT];
        for (need_name, value) in &sim.needs {
            let Some(id) = NeedId::from_name(need_name) else {
                return Err(ContentError::UnknownStartingNeed {
                    sim: sim.name.clone(),
                    need: need_name.clone(),
                });
            };
            check_finite(
                *value,
                &format!("household starting '{need_name}' for '{}'", sim.name),
            )?;
            if !(NEED_MIN..=NEED_MAX).contains(value) {
                return Err(ContentError::StartingNeedOutOfRange {
                    sim: sim.name.clone(),
                    need: need_name.clone(),
                    value: *value,
                });
            }
            needs[id.index()] = *value;
        }

        for hobby in &sim.hobbies {
            if !known_tags.contains(hobby.as_str()) {
                return Err(ContentError::UnknownHobby {
                    sim: sim.name.clone(),
                    hobby: hobby.clone(),
                });
            }
        }

        // Traits resolve to indices, the standing rule for every id
        // space; a worn trait nobody declared has no representation.
        // Neither has one worn twice: `Traits` keys its state by index
        // with a binary search, so a duplicate entry would leave one
        // copy stale behind every `set_state` - the review finding this
        // check answers. Rejected here so the component's sorted-unique
        // invariant is a fact about any pack that exists ([D9]).
        let mut worn = Vec::with_capacity(sim.traits.len());
        for trait_id in &sim.traits {
            let Some(index) = traits.iter().position(|t| &t.id == trait_id) else {
                return Err(ContentError::UnknownSimTrait {
                    sim: sim.name.clone(),
                    trait_id: trait_id.clone(),
                });
            };
            if worn.contains(&(index as u32)) {
                return Err(ContentError::DuplicateWornTrait {
                    sim: sim.name.clone(),
                    trait_id: trait_id.clone(),
                });
            }
            worn.push(index as u32);
        }

        // The career resolves by id like a trait, or stays None for
        // the unemployed.
        let career = match &sim.career {
            None => None,
            Some(id) => match careers.iter().position(|c| &c.id == id) {
                Some(index) => Some(index as u32),
                None => {
                    return Err(ContentError::UnknownSimCareer {
                        sim: sim.name.clone(),
                        career: id.clone(),
                    })
                }
            },
        };
        // A worker needs somewhere to leave from. Checked here rather
        // than in the lot's own validation because it is a property of
        // the PAIR: a doorless lot is fine until somebody living on it
        // holds a job.
        if career.is_some() && lot.front_door.is_none() {
            return Err(ContentError::CareerWithoutFrontDoor {
                sim: sim.name.clone(),
            });
        }

        compiled.push(CompiledHouseholdMember {
            name: sim.name.clone(),
            personality: personality as u32,
            x: sim.x,
            y: sim.y,
            needs,
            hobbies: sim.hobbies.clone(),
            traits: worn,
            career,
        });
    }

    Ok(compiled)
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
/// Validates the tuning knobs, and the circadian table beside them.
///
/// Returns both because the circadian rhythm is validated AGAINST tuning,
/// since every control point has to fall inside `day_ticks`, but is stored
/// beside it on the pack rather than within it: `Tuning` is `Copy` and a
/// circadian rhythm owns a `String` and a `Vec`.
type CompiledTuning = (Tuning, Option<Circadian>, String);

fn compile_tuning(tuning: TuningFile) -> Result<CompiledTuning, ContentError> {
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
        tuning.contested_score_multiplier,
        "contested_score_multiplier in tuning.toml",
    )?;
    check_finite(
        tuning.habituation_per_use,
        "habituation_per_use in tuning.toml",
    )?;
    check_finite(
        tuning.habituation_decay_per_tick,
        "habituation_decay_per_tick in tuning.toml",
    )?;
    check_finite(tuning.habituation_floor, "habituation_floor in tuning.toml")?;
    check_finite(
        tuning.relationship_gain_per_talk,
        "relationship_gain_per_talk in tuning.toml",
    )?;
    check_finite(
        tuning.relationship_decay_per_tick,
        "relationship_decay_per_tick in tuning.toml",
    )?;
    check_finite(
        tuning.relationship_delta_scale,
        "relationship_delta_scale in tuning.toml",
    )?;

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
    if tuning.wander_radius_tiles == 0 {
        return Err(ContentError::ZeroWanderRadius);
    }
    if tuning.wander_radius_tiles > i32::MAX as u32 {
        return Err(ContentError::WanderRadiusTooLarge {
            value: tuning.wander_radius_tiles,
        });
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
    // INCLUSIVE at both ends, unlike the variance immediately above, and
    // the difference is not an oversight. 1.0 means a contested object is
    // worth exactly what a free one is, so a sim waits for anything it
    // would have acted on - that is coherent, and it is what shipped
    // between the [C3] fix and this knob. 0.0 means it never waits.
    // Neither end is degenerate, so neither is excluded.
    if !(0.0..=1.0).contains(&tuning.contested_score_multiplier) {
        return Err(ContentError::ContestedScoreMultiplierOutOfRange {
            value: tuning.contested_score_multiplier,
        });
    }
    // The relationship trio mirrors the habituation trio rule for rule,
    // because it is the same mechanism shape pointed at people instead of
    // objects: a per-use rise, a per-tick decay, and a bounded multiplier.
    // Each guard protects against the same quiet failure its habituation
    // twin documents above.
    if !(0.0..=1.0).contains(&tuning.relationship_gain_per_talk) {
        return Err(ContentError::RelationshipGainOutOfRange {
            value: tuning.relationship_gain_per_talk,
        });
    }
    if tuning.relationship_decay_per_tick <= 0.0 {
        return Err(ContentError::NonPositiveRelationshipDecay {
            value: tuning.relationship_decay_per_tick,
        });
    }
    // The delta-scale bound is the one rule with no habituation twin: the
    // habituation floor keeps its multiplier positive by construction,
    // while `1 + relationship * scale` goes negative the moment scale
    // exceeds 1 and a relationship is bad enough - turning an authored
    // BENEFIT into a cost, which [S2] reserves for content that says so.
    if !(0.0..=1.0).contains(&tuning.relationship_delta_scale) {
        return Err(ContentError::RelationshipDeltaScaleOutOfRange {
            value: tuning.relationship_delta_scale,
        });
    }
    if tuning.idle_threshold > tuning.action_threshold {
        return Err(ContentError::IdleThresholdAboveAction {
            idle: tuning.idle_threshold,
            action: tuning.action_threshold,
        });
    }
    // The M2e satisfaction trio ([E1]/[E2]). Finiteness first like every
    // other f32 knob, then the one range each fails quietly outside of.
    check_finite(tuning.hobby_multiplier, "hobby_multiplier in tuning.toml")?;
    check_finite(tuning.neglect_floor, "neglect_floor in tuning.toml")?;
    check_finite(
        tuning.at_work_decay_scale,
        "at_work_decay_scale in tuning.toml",
    )?;
    if !(0.0..=1.0).contains(&tuning.at_work_decay_scale) {
        return Err(ContentError::AtWorkDecayScaleOutOfRange {
            value: tuning.at_work_decay_scale,
        });
    }
    check_finite(
        tuning.asleep_decay_scale,
        "asleep_decay_scale in tuning.toml",
    )?;
    if !(0.0..=1.0).contains(&tuning.asleep_decay_scale) {
        return Err(ContentError::AsleepDecayScaleOutOfRange {
            value: tuning.asleep_decay_scale,
        });
    }
    // An empty tag matches nothing, so every reader of it - the sleep
    // drive, the decay scale, the Zzz bubble - would quietly do nothing.
    // Trimmed, because a tag of one space is the same failure wearing a
    // character.
    if tuning.sleep_tag.trim().is_empty() {
        return Err(ContentError::EmptySleepTag);
    }
    check_finite(
        tuning.neglect_bleed_per_tick,
        "neglect_bleed_per_tick in tuning.toml",
    )?;
    // Below 1 a hobby pays LESS for being loved - the mechanic inverted
    // by a typo, with no error anywhere and no test that knows what a
    // hobby is supposed to feel like. Exactly 1 is the legal disable.
    if tuning.hobby_multiplier < 1.0 {
        return Err(ContentError::HobbyMultiplierBelowOne {
            value: tuning.hobby_multiplier,
        });
    }
    // The floor lives on the need scale. Above NEED_MAX every need is
    // neglected from tick one and the accumulator only ever falls,
    // which reads as a broken axis rather than as a knob set wrong.
    if !(0.0..=terri_core::NEED_MAX).contains(&tuning.neglect_floor) {
        return Err(ContentError::NeglectFloorOutOfRange {
            value: tuning.neglect_floor,
        });
    }
    // Zero is the legal disable; negative would make starvation EARN.
    if tuning.neglect_bleed_per_tick < 0.0 {
        return Err(ContentError::NegativeNeglectBleed {
            value: tuning.neglect_bleed_per_tick,
        });
    }
    // A zero-tick day makes `tick % day_ticks` a division by zero the
    // first time a career asks the hour.
    if tuning.day_ticks == 0 {
        return Err(ContentError::ZeroDayTicks);
    }

    // The circadian curve, if authored. Every rule here converts a shape
    // of failure that would otherwise be silent into a build error, which
    // is what [D9] exists for.
    //
    // An unsorted or out-of-range curve does not crash: it interpolates
    // to something, and the sims sleep at a plausible-looking wrong time
    // that nobody would think to question.
    let circadian = match tuning.circadian {
        None => None,
        Some(file) => {
            if file.sleep_drive.len() < 2 {
                return Err(ContentError::CircadianTooFewPoints {
                    points: file.sleep_drive.len(),
                });
            }
            let mut previous: Option<u32> = None;
            for (tick, multiplier) in &file.sleep_drive {
                if *tick >= tuning.day_ticks {
                    return Err(ContentError::CircadianPointPastTheDay {
                        tick: *tick,
                        day_ticks: tuning.day_ticks,
                    });
                }
                if !multiplier.is_finite() || *multiplier < 0.0 {
                    return Err(ContentError::CircadianNegativeMultiplier {
                        tick: *tick,
                        value: *multiplier,
                    });
                }
                // Sorted STRICTLY: two points on the same tick would make
                // the segment between them zero-length, and the
                // interpolation divide by it.
                if previous.is_some_and(|p| p >= *tick) {
                    return Err(ContentError::CircadianPointsOutOfOrder { tick: *tick });
                }
                previous = Some(*tick);
            }
            // The exhaustion ramp, validated on the same principle as the
            // curve above: each rule turns a silent wrong-looking
            // simulation into a build error.
            check_finite(file.exhaustion_energy, "exhaustion_energy in tuning.toml")?;
            if !(0.0..=100.0).contains(&file.exhaustion_energy) {
                return Err(ContentError::ExhaustionEnergyOutOfRange {
                    value: file.exhaustion_energy,
                });
            }
            if file.exhaustion_ramp_ticks == 0 {
                return Err(ContentError::ZeroExhaustionRamp);
            }
            check_finite(file.exhaustion_bonus, "exhaustion_bonus in tuning.toml")?;
            if file.exhaustion_bonus < 1.0 {
                return Err(ContentError::ExhaustionBonusBelowOne {
                    value: file.exhaustion_bonus,
                });
            }
            // **The two halves have to add up.** The curve says when bed
            // is appealing and the ramp says a tired sim eventually goes
            // anyway, but the ramp MULTIPLIES the curve - so a deep
            // enough trough survives any finite bonus and the promise
            // quietly stops being true. Content in which nobody ever
            // sleeps in the morning is a pair of numbers that never met,
            // and it reads as a simulation bug rather than as tuning.
            let trough = file
                .sleep_drive
                .iter()
                .map(|(_, value)| *value)
                .fold(f32::INFINITY, f32::min);
            if trough * file.exhaustion_bonus < 1.0 {
                return Err(ContentError::ExhaustionCannotBeatTheTrough {
                    trough,
                    bonus: file.exhaustion_bonus,
                });
            }
            Some(Circadian {
                sleep_drive: file.sleep_drive,
                exhaustion_energy: file.exhaustion_energy,
                exhaustion_ramp_ticks: file.exhaustion_ramp_ticks,
                exhaustion_bonus: file.exhaustion_bonus,
            })
        }
    };

    Ok((
        Tuning {
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
            contested_score_multiplier: tuning.contested_score_multiplier,
            relationship_gain_per_talk: tuning.relationship_gain_per_talk,
            relationship_decay_per_tick: tuning.relationship_decay_per_tick,
            relationship_delta_scale: tuning.relationship_delta_scale,
            hobby_multiplier: tuning.hobby_multiplier,
            at_work_decay_scale: tuning.at_work_decay_scale,
            neglect_floor: tuning.neglect_floor,
            neglect_bleed_per_tick: tuning.neglect_bleed_per_tick,
            day_ticks: tuning.day_ticks,
            asleep_decay_scale: tuning.asleep_decay_scale,
            wander_radius_tiles: tuning.wander_radius_tiles,
        },
        circadian,
        tuning.sleep_tag,
    ))
}

/// Validates the lot against the objects that were just compiled, and
/// resolves every placement's object id to its index in them.
///
fn rotate_socket_terms(x: f32, y: f32, placement_facing: &str) -> (f32, f32) {
    match placement_facing {
        "SE" => (x, y),
        "SW" => (-y, x),
        "NW" => (-x, -y),
        "NE" => (y, -x),
        _ => unreachable!("placement facing is validated before socket resolution"),
    }
}

fn resolve_socket_facing(
    socket_facing: CompiledSocketFacing,
    placement_facing: &str,
) -> CompiledSocketFacing {
    let (x, y) = match socket_facing {
        CompiledSocketFacing::PositiveX => (1, 0),
        CompiledSocketFacing::NegativeX => (-1, 0),
        CompiledSocketFacing::PositiveY => (0, 1),
        CompiledSocketFacing::NegativeY => (0, -1),
    };
    let rotated = match placement_facing {
        "SE" => (x, y),
        "SW" => (-y, x),
        "NW" => (-x, -y),
        "NE" => (y, -x),
        _ => unreachable!("placement facing is validated before socket resolution"),
    };
    match rotated {
        (1, 0) => CompiledSocketFacing::PositiveX,
        (-1, 0) => CompiledSocketFacing::NegativeX,
        (0, 1) => CompiledSocketFacing::PositiveY,
        (0, -1) => CompiledSocketFacing::NegativeY,
        _ => unreachable!("rotating a unit axis produces a unit axis"),
    }
}

/// Taking the compiled objects rather than the authored ones is what
/// makes the last rule a real dangling-reference check: a placement can
/// only name something that survived object validation.
fn compile_lot(
    lot: LotFile,
    objects: &[CompiledObject],
    // The authored atlas NAME per compiled object, in the same order as
    // `objects`, because facing resolution is string arithmetic on the
    // name and the compiled object holds only the resolved index.
    sprite_names: &[String],
    sprite_index: &dyn Fn(&str) -> Option<usize>,
) -> Result<CompiledLot, ContentError> {
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

        // A facing is presentation, resolved here so a variant nobody
        // imported has no representation past this point ([D9]). The
        // variant naming convention is the atlas's: the plain name is
        // the `_SE` import and a directional variant appends its facing,
        // so `kitchenCabinet` facing SW is the atlas entry
        // `kitchenCabinetSW`.
        let sprite = match &place.facing {
            None => objects[index].sprite,
            Some(facing) => {
                if !crate::schema::FACINGS.contains(&facing.as_str()) {
                    return Err(ContentError::UnknownFacing {
                        object: place.object.clone(),
                        facing: facing.clone(),
                    });
                }
                // The unsuffixed atlas name IS the SE facing. A builder that
                // writes facing = "SE" must not look for `kitchenCabinetSE`.
                if facing == "SE" {
                    objects[index].sprite
                } else {
                    let variant = format!("{}{}", sprite_names[index], facing);
                    match sprite_index(&variant) {
                        Some(resolved) => resolved as u32,
                        None => {
                            return Err(ContentError::FacingSpriteMissing {
                                object: place.object.clone(),
                                facing: facing.clone(),
                                sprite: variant,
                            })
                        }
                    }
                }
            }
        };

        let placement_facing = place.facing.as_deref().unwrap_or("SE");
        let centre_x = place.x + (objects[index].footprint.width - 1) as f32 / 2.0;
        let centre_y = place.y + (objects[index].footprint.depth - 1) as f32 / 2.0;
        let mut action_sockets = Vec::with_capacity(objects[index].action_sockets.len());
        for socket in &objects[index].action_sockets {
            let (offset_x, offset_y) = rotate_socket_terms(socket.x, socket.y, placement_facing);
            let x = centre_x + offset_x;
            let y = centre_y + offset_y;
            let socket_tile = (x.floor() as i64, y.floor() as i64);
            if socket_tile.0 < tile.0 as i64
                || socket_tile.1 < tile.1 as i64
                || socket_tile.0 >= tile.0 as i64 + objects[index].footprint.width as i64
                || socket_tile.1 >= tile.1 as i64 + objects[index].footprint.depth as i64
            {
                return Err(ContentError::ActionSocketOutsideFootprint {
                    object: place.object.clone(),
                    socket: socket.id.clone(),
                    x,
                    y,
                });
            }
            action_sockets.push(CompiledPlacementSocket {
                x,
                y,
                facing: resolve_socket_facing(socket.facing, placement_facing),
            });
        }

        rects.push((place.object.clone(), tile, objects[index].footprint));
        placements.push(CompiledPlacement {
            object: ObjectDefId(index as u32),
            x: place.x,
            y: place.y,
            sprite,
            action_sockets,
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
    // The front door, validated like a spawn tile: in bounds, standing
    // on floor rather than in a wall or a footprint, and connected to
    // the rest of the lot ([E4]). Bounds and blockage here; the
    // reachability half joins the flood fill below, where the bitmap
    // already exists.
    let front_door = match &lot.front_door {
        None => None,
        Some(door) => {
            let (Ok(x), Ok(y)) = (u32::try_from(door.x), u32::try_from(door.y)) else {
                return Err(ContentError::FrontDoorOutOfBounds {
                    x: door.x,
                    y: door.y,
                    width: lot.width,
                    height: lot.height,
                });
            };
            if x >= lot.width || y >= lot.height {
                return Err(ContentError::FrontDoorOutOfBounds {
                    x: door.x,
                    y: door.y,
                    width: lot.width,
                    height: lot.height,
                });
            }
            if blocked.contains(&(x, y)) {
                return Err(ContentError::FrontDoorBlocked { x, y });
            }
            Some((x, y))
        }
    };

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
        // A door in a sealed pocket is the spawn-in-a-pocket failure
        // wearing the exit's costume: no rule about objects can see it,
        // and the symptom would be a worker pathing nowhere forever.
        if let Some((x, y)) = front_door {
            if !reached[index_of(x, y)] {
                return Err(ContentError::FrontDoorUnreachable {
                    x,
                    y,
                    root_x: root.0,
                    root_y: root.1,
                });
            }
        }
    }

    Ok(CompiledLot {
        width: lot.width,
        height: lot.height,
        walls,
        placements,
        front_door,
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

    // Every push marks its tile reached first, so correct code pushes each
    // tile at most once and this counter can never pass the tile count.
    // The bound exists because this loop RUNS INSIDE THE BUILD: build.rs
    // compiles the shipped content, so an unbounded revisit here is not a
    // slow test but a build that never returns. Exactly that happened -
    // mutating the `reached[index] ||` guard below into `&&` un-gates
    // revisits, and the mutant burned a full CI build-timeout (and, before
    // that timeout existed, entire runner-reclaimed jobs) instead of
    // failing anything. A hang is always a weaker signal than an assertion
    // ([L15] rule 4), so the loop carries its own bound, the same shape as
    // SimRng::draw_below_bound and roll_wander_path.
    let mut pushed = 1usize;

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
            pushed += 1;
            assert!(
                pushed <= reached.len(),
                "flood_fill pushed more tiles than the lot holds; a tile \
                 is being revisited, which marking-before-push makes \
                 impossible in correct code"
            );
            stack.push(next);
        }
    }

    // The counter is the bound's only witness, so it must be observable on
    // CORRECT runs too: without this, `pushed += 1` mutated into a no-op
    // (`*= 1`) leaves the bound above comparing 1 against the tile count
    // forever - a guard that can be silently disabled is behaviour nothing
    // constrains, which is the exact disease the mutation gate exists to
    // catch. Marking-before-push makes pushes and marked tiles the same
    // events, so the two counts are equal by construction, and any drift
    // in the counter's arithmetic fails every test that reaches here.
    assert_eq!(
        pushed,
        reached.iter().filter(|r| **r).count(),
        "flood_fill's push counter disagrees with the reached bitmap"
    );

    reached
}

#[cfg(test)]
mod tests {
    /// `compile` with no personalities and no household, which is the
    /// state every fixture predating M2c was written in. An empty
    /// household is legal content - a furnished lot with nobody home -
    /// so these fixtures stay statements about the thing each names
    /// rather than about people.
    fn compile_bare(
        needs: NeedsFile,
        objects: ObjectsFile,
        lot: LotFile,
        atlas: AtlasFile,
        tuning: TuningFile,
    ) -> Result<ContentPack, ContentError> {
        compile(
            needs,
            objects,
            lot,
            atlas,
            tuning,
            PersonalitiesFile { archetype: vec![] },
            HouseholdFile { sim: vec![] },
            SocialFile {
                interaction: vec![],
            },
            TraitsFile { trait_def: vec![] },
            CareersFile { career: vec![] },
            ChainsFile { chain: vec![] },
        )
    }

    // `super::*` already supplies ContentError, NeedsFile, ObjectsFile,
    // NeedId and NEED_COUNT. Only the types production code does not
    // name are imported here.
    use super::*;
    use crate::schema::{
        ActionSocketDef, ArchetypeDef, AtlasSpriteDef, CareerDef, CircadianFile, DispositionDef,
        HouseholdSimDef, InteractionDef, NeedDef, ObjectDef, PlacementDef, TraitDef, VisualDef,
        WallDef,
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
        // **[ML-curve] appended one field, and it is the single trailing
        // `0`.** `ContentPack` gained `circadian: Option<Circadian>`, and
        // this fixture authors no rhythm, so postcard writes `None` as one
        // byte at the very end. Every byte before it is unchanged, which
        // is the whole point of the appending rule on `ContentPack::lot`
        // and is what makes this vector reviewable rather than opaque.
        //
        // **The alpha acceptance pass appended one tuning field**,
        // `at_work_decay_scale` - [X2] in
        // docs/specs/2026-08-01-alpha-acceptance-findings.md. The four
        // bytes `154, 153, 25, 63` near the end are the fixture's 0.6
        // as a little-endian f32, sitting where `CompiledTuning` gained
        // it; every byte before them is unchanged, which is what an
        // append is supposed to look like. Read off the failing
        // assertion per the standing rule.
        //
        // **M2f PR 1 moved it four ways, all appends.** `CompiledObject`
        // gained a trailing `roles` list - the new 0 immediately after
        // the fixture object's `1, 1` footprint, its empty list - and
        // `ContentPack` gained three trailing vocabularies (roles,
        // item_kinds, chains), the three new 0s at the very end. The
        // object one sits mid-pack, so the lot and tuning bytes after
        // it shifted by one; the non-empty round trips live in
        // pack.rs's `three_objects`.
        //
        // **The eating action contract now exercises the presentation option
        // on this object interaction.** After the authored label ending in
        // `117, 112` come an empty tags list, four zero satisfaction bytes,
        // then `1, 1, 1, 0`: Some, Eat, Object, TowardAnchor. The following
        // `1, 1, 0` remains the 1x1 footprint and empty role list. These values
        // were read from the failing assertion after the append-only enums
        // gained their eating variants.
        //
        // **Action sockets append three empty slots in this old-world
        // fixture.** The first `0` follows TowardAnchor and is the established
        // eat visual's appended `socket = None`. The second follows the
        // object's empty role list and is its empty action-socket list. The
        // third follows the placement sprite and is its empty resolved-socket
        // list. Every prior field retains its value and order.
        //
        // **Moved three times at M2e PR 3, all appends.** `Tuning`
        // gained a trailing `day_ticks` - the lone `19` near the end -
        // and `ContentPack` a trailing `careers` list, one more
        // empty-vec 0 at the very end (this fixture holds no careers;
        // the round trip that exercises non-empty ones lives in
        // pack.rs). `CompiledLot` also gained a trailing `front_door`
        // option: the extra 0 immediately after the placement's sprite
        // `2`, this fixture's None. That one sits mid-pack because the
        // lot block does, so the tuning bytes after it shifted by one;
        // everything before it kept its offset, which is what the
        // append discipline buys.
        //
        // **Local idle wandering appended one tuning field.** The lone
        // `29` after `asleep_decay_scale`'s four bytes is the fixture's
        // `wander_radius_tiles`. It is at the end of the `Tuning` record,
        // immediately before the following empty personality list. Every
        // established tuning byte is unchanged. This byte was read from the
        // failing golden assertion after reviewing that exact one-byte
        // insertion; `pack.rs` separately proves it is the final tuning slot.
        //
        // **Regenerated wholesale at M2e PR 2**: `ContentPack` gained a
        // trailing `traits` list (empty in this fixture), and
        // `CompiledHouseholdMember` a trailing trait-index list; this
        // fixture has no household, so the whole movement is one byte
        // of empty-vec length at the tail. The PR 1 annotations (tags
        // after the label, the tuning trio) and the object-block
        // annotations in the doc comment above remain valid;
        // predecessors are one `git log -p` away.
        205, 204, 204, 61, 205, 204, 76, 62, 154, 153, 153, 62,
        205, 204, 204, 62, 0, 0, 0, 63, 154, 153, 25, 63,
        51, 51, 51, 63, 1, 6, 102, 114, 105, 100, 103, 101,
        6, 70, 114, 105, 100, 103, 101, 2, 1, 10, 103, 114,
        97, 98, 95, 115, 110, 97, 99, 107, 3, 0, 0, 0,
        12, 66, 1, 0, 0, 64, 64, 6, 0, 0, 160, 64,
        15, 1, 15, 69, 97, 116, 32, 115, 116, 97, 110, 100,
        105, 110, 103, 32, 117, 112, 0, 0, 0, 0, 0, 1, 1,
        1, 0, 0, 1, 1, 0, 0, 1, 5, 3, 2, 4, 2, 1, 0, 1, 0,
        0, 0, 32, 64, 0, 0, 160, 63, 2, 0, 0, 0, 0,
        128, 62, 0, 0, 0, 63, 0, 0, 0, 62, 9, 6,
        0, 0, 160, 62, 10, 215, 35, 59, 0, 0, 32, 63,
        0, 0, 64, 63, 3, 172, 2, 7, 11, 13, 0, 0,
        192, 62, 0, 0, 64, 62, 0, 0, 64, 61, 0, 0,
        80, 63, 0, 0, 224, 63, 0, 0, 184, 65, 154, 153,
        25, 63, 0, 0, 0, 60, 19, 0, 0, 192, 62, 29, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 5, 115, 108, 101,
        101, 112,
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
        compile_bare(needs, objects, bare_lot(), test_atlas(), tuning)
    }

    fn bare_lot() -> LotFile {
        LotFile {
            width: 1,
            height: 1,
            wall: Vec::new(),
            place: Vec::new(),
            front_door: None,
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
                facing: None,
            }],
            front_door: None,
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
                    roles: vec![],
                    action_socket: vec![],
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
            circadian: None,
            // Not "sleep" by accident: `full_tuning` is the fixture the
            // golden vector reads, and its objects come from
            // `distinct_tuning`'s neighbours. See the fixture object in
            // `compile_tuned`, which carries this exact tag.
            sleep_tag: "sleep".to_string(),
            // Distinct from `at_work_decay_scale` below and exact in
            // binary32, for the same reason every other knob here is:
            // the golden vector reads these bytes, and two knobs sharing
            // a value cannot tell a swap from a match.
            asleep_decay_scale: 0.375,
            // The M2e trio, distinct like everything else here and exact
            // in binary32; the golden vector reads these bytes directly,
            // and a 0.0 would be indistinguishable from a dropped field.
            hobby_multiplier: 1.75,
            at_work_decay_scale: 0.6,
            neglect_floor: 23.0,
            neglect_bleed_per_tick: 0.0078125,
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
            contested_score_multiplier: 0.375,
            rng_seed: 300,
            max_queued_intents: 7,
            max_queued_commands: 11,
            need_bar_refresh_ms: 13,
            // Distinct from every other knob in this fixture and exact in
            // binary32, like everything above: a value read off the wrong
            // slot must move an assertion somewhere.
            relationship_gain_per_talk: 0.1875,
            relationship_decay_per_tick: 0.046875,
            relationship_delta_scale: 0.8125,
            day_ticks: 19,
            wander_radius_tiles: 29,
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
        compile_bare(
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
                roles: vec![],
                action_socket: vec![],
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
            tags: vec![],
            satisfaction: 0.0,
            visual: None,
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
        act.visual = Some(VisualDef {
            action: Some("eat".to_string()),
            anchor: Some("object".to_string()),
            facing: Some("toward_anchor".to_string()),
            socket: None,
        });
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
        assert!(pack.objects[0].action_sockets.is_empty());
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
            compile_bare(
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
            roles: vec![],
            action_socket: vec![],
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
            roles: vec![],
            action_socket: vec![],
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
                        compile_bare(
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
        let pack = compile_bare(
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
        // The M2e trio, distinct values per [L29] like everything above.
        assert_eq!(tuning.hobby_multiplier, 1.75);
        assert_eq!(tuning.at_work_decay_scale, 0.6);
        assert_eq!(tuning.neglect_floor, 23.0);
        assert_eq!(tuning.neglect_bleed_per_tick, 0.0078125);
        assert_eq!(tuning.wander_radius_tiles, 29);
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
    fn rejects_a_hobby_multiplier_below_one_and_accepts_the_disable() {
        // 0.5 is the value that pins `<` against `==` (both reject 0.99
        // shapes only if the comparison is a real range test), and the
        // failure it guards is the mechanic INVERTED: a hobby paying
        // less for being loved, silently, behind a tuning typo.
        for bad in [0.5, 0.0, -1.0] {
            assert_eq!(
                compile_tuned(tuning_where(|t| t.hobby_multiplier = bad)).unwrap_err(),
                ContentError::HobbyMultiplierBelowOne { value: bad },
                "a hobby_multiplier of {bad} pays less for love"
            );
        }
        // Exactly 1.0 is ACCEPTED - the documented disable - and it is
        // the input that pins `<` against `<=`.
        let pack = compile_tuned(tuning_where(|t| t.hobby_multiplier = 1.0))
            .expect("1.0 is the legal disable");
        assert_eq!(pack.tuning.hobby_multiplier, 1.0);
    }

    #[test]
    fn rejects_a_negative_neglect_bleed_and_accepts_zero() {
        // -0.25 pins `<` against `==`; the failure is [S1] broken by a
        // sign error - starvation EARNING satisfaction.
        for bad in [-0.25, -f32::MIN_POSITIVE] {
            assert_eq!(
                compile_tuned(tuning_where(|t| t.neglect_bleed_per_tick = bad)).unwrap_err(),
                ContentError::NegativeNeglectBleed { value: bad },
                "a bleed of {bad} would pay for neglect"
            );
        }
        // Zero is ACCEPTED - the documented disable - and pins `<`
        // against `<=`.
        let pack = compile_tuned(tuning_where(|t| t.neglect_bleed_per_tick = 0.0))
            .expect("0.0 is the legal disable");
        assert_eq!(pack.tuning.neglect_bleed_per_tick, 0.0);
    }

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

    /// A radius of zero cannot produce a non-empty wander path, while a radius
    /// above `i32::MAX` makes `2 * radius + 1` too large for a WebAssembly
    /// `usize` and the RNG's `u32` range. One and `i32::MAX` pin both inclusive
    /// boundaries so the validator cannot quietly narrow either one.
    #[test]
    fn validates_wander_radius_bounds() {
        assert_eq!(
            compile_tuned(tuning_where(|t| t.wander_radius_tiles = 0)).unwrap_err(),
            ContentError::ZeroWanderRadius
        );

        let pack = compile_tuned(tuning_where(|t| t.wander_radius_tiles = 1))
            .expect("a one-tile local wander is legal");
        assert_eq!(pack.tuning.wander_radius_tiles, 1);

        let pack = compile_tuned(tuning_where(|t| t.wander_radius_tiles = i32::MAX as u32))
            .expect("i32::MAX keeps the sampling diameter representable");
        assert_eq!(pack.tuning.wander_radius_tiles, i32::MAX as u32);

        assert_eq!(
            compile_tuned(tuning_where(|t| {
                t.wander_radius_tiles = i32::MAX as u32 + 1
            }))
            .unwrap_err(),
            ContentError::WanderRadiusTooLarge {
                value: i32::MAX as u32 + 1
            }
        );
    }

    /// A queue cap of zero is not "no queueing"; `drain_commands` refuses
    /// any intent that would take the queue past this, so at zero every
    /// `UseObject` command is refused and directing a sim never succeeds.
    /// The shell now reports that capacity rejection, but the game would
    /// still run while every object order failed, which is the shape [D9]
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
        let err = compile_bare(
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
            compile_bare(
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

    /// `contested_score_multiplier` is closed at BOTH ends, and both ends
    /// are meaningful content rather than merely tolerated.
    ///
    /// 0.0 is "never wait for an object somebody else is using". 1.0 is
    /// "wait for anything you would have acted on", which is exactly how
    /// selection behaved between the [C3] fix and this knob, so a pack is
    /// entitled to ask for it.
    ///
    /// Asserted because the realistic mutation is to an EXCLUSIVE range,
    /// `0.0..1.0`, copied from `duration_variance` a few lines above it in
    /// the source. That would reject a perfectly good pack, and no
    /// rejection test would notice.
    #[test]
    fn accepts_a_contested_score_multiplier_at_either_end_of_its_range() {
        for good in [0.0, 1.0] {
            let pack = compile_tuned(tuning_where(|t| t.contested_score_multiplier = good))
                .expect("both ends of the range are legal content");
            assert_eq!(pack.tuning.contested_score_multiplier, good);
        }
    }

    /// Every authored float in the tuning file, against every non-finite
    /// value.
    ///
    /// All five are asserted rather than one, because the realistic
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
        const KNOBS: [(&str, Setter); 5] = [
            ("action_threshold", |t, v| t.action_threshold = v),
            ("choice_temperature", |t, v| t.choice_temperature = v),
            ("idle_threshold", |t, v| t.idle_threshold = v),
            ("duration_variance", |t, v| t.duration_variance = v),
            ("contested_score_multiplier", |t, v| {
                t.contested_score_multiplier = v
            }),
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
                tuning_where(|t| t.contested_score_multiplier = 1.5),
                "tuning.toml has contested_score_multiplier of 1.5; must be at least 0 and at most 1",
            ),
            (
                tuning_where(|t| t.contested_score_multiplier = -0.5),
                "tuning.toml has contested_score_multiplier of -0.5; must be at least 0 and at most 1",
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
                tuning_where(|t| t.wander_radius_tiles = i32::MAX as u32 + 1),
                "tuning.toml has wander_radius_tiles of 2147483648; it must be at most 2147483647 so the 2 * radius + 1 sampling diameter fits WebAssembly usize and the simulation RNG range",
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
        let pack = compile_bare(
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
        assert!(lot.placements[0].action_sockets.is_empty());
    }

    /// A placement's object id is an index into the pack, and one object
    /// cannot tell a resolved index from a hardcoded zero. Three objects
    /// placed in an order that is not their declaration order make both
    /// `position(...)` collapsing to 0 and the list being reordered
    /// visible. This is [L29] in the lot's costume.
    #[test]
    fn placements_resolve_to_the_declared_object_index() {
        let lot = LotFile {
            front_door: None,
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
                    facing: None,
                })
                .collect(),
        };

        let pack = compile_bare(
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
                compile_bare(
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
                compile_bare(
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
        let pack = compile_bare(
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
                compile_bare(
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
        let pack = compile_bare(
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
            compile_bare(
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
        compile_bare(
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
            compile_bare(
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
        let pack = compile_bare(
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
                compile_bare(
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
                    roles: vec![],
                    action_socket: vec![],
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

    // ---- Personalities and the household - [H2], [H3] -------------------

    /// One archetype whose every number is distinguishable from every
    /// other and from 1.0, so a value landing in the wrong slot moves an
    /// assertion ([L34]).
    fn archetype(id: &str) -> ArchetypeDef {
        ArchetypeDef {
            chronotype_offset_ticks: 0,
            id: id.to_string(),
            drain: [("fun".to_string(), 1.5)].into_iter().collect(),
            satisfaction: [("hunger".to_string(), 0.75)].into_iter().collect(),
            disposition: vec![DispositionDef {
                object: "fridge".to_string(),
                interaction: "grab_snack".to_string(),
                weight: 1.25,
            }],
        }
    }

    fn member(name: &str, archetype: &str, x: f32, y: f32) -> HouseholdSimDef {
        HouseholdSimDef {
            traits: vec![],
            hobbies: vec![],
            career: None,
            name: name.to_string(),
            archetype: archetype.to_string(),
            x,
            y,
            needs: [("hunger".to_string(), 62.5)].into_iter().collect(),
        }
    }

    /// Compiles the standard object fixtures plus the given people, on a
    /// 4x3 lot whose fridge sits at (2, 1) with a wall at (1, 0) - so
    /// there is real walkable floor to spawn on, a real footprint to
    /// spawn into, and a real wall to spawn onto.
    fn compile_people(
        archetypes: Vec<ArchetypeDef>,
        sims: Vec<HouseholdSimDef>,
    ) -> Result<ContentPack, ContentError> {
        compile_people_with_traits(archetypes, sims, vec![])
    }

    /// The same, with a trait file - the trait tests' entry point. The
    /// snack fixture carries no tags, so trait fixtures tag their own
    /// interaction via `one_object` variants or key on the snack's need
    /// space through a tagged copy below.
    fn compile_people_with_traits(
        archetypes: Vec<ArchetypeDef>,
        sims: Vec<HouseholdSimDef>,
        trait_def: Vec<TraitDef>,
    ) -> Result<ContentPack, ContentError> {
        compile_people_full(archetypes, sims, trait_def, vec![])
    }

    /// The same again with a careers file - the career tests' entry
    /// point, and the widest of the people helpers.
    fn compile_people_full(
        archetypes: Vec<ArchetypeDef>,
        sims: Vec<HouseholdSimDef>,
        trait_def: Vec<TraitDef>,
        career: Vec<CareerDef>,
    ) -> Result<ContentPack, ContentError> {
        // The snack gains one tag so traits have something real to key
        // on; untagged fixtures elsewhere are untouched because this
        // helper is the traits tests' own.
        let mut snack = snack();
        snack.tags = vec!["snacking".to_string()];
        // The far corner, free of the wall and the fridge, so the
        // career tests' holders have somewhere to leave from; the
        // doorless-lot rejection builds its own lot below.
        let mut lot = lot_of(4, 3, &[(1, 0)], &[("fridge", 2.0, 1.0)]);
        lot.front_door = Some(crate::schema::FrontDoorDef { x: 3, y: 2 });
        compile(
            full_needs(),
            one_object(snack),
            lot,
            test_atlas(),
            full_tuning(),
            PersonalitiesFile {
                archetype: archetypes,
            },
            HouseholdFile { sim: sims },
            SocialFile {
                interaction: vec![],
            },
            TraitsFile { trait_def },
            CareersFile { career },
            ChainsFile { chain: vec![] },
        )
    }

    /// A career that passes every rule against `full_tuning`'s 19-tick
    /// day, with pairwise distinct values so a field written into the
    /// wrong slot moves an assertion - [L34] again.
    fn a_career(id: &str) -> CareerDef {
        CareerDef {
            id: id.to_string(),
            label: format!("The {id} job"),
            shift_start: 5,
            shift_ticks: 7,
            pay: 130,
            energy_cost: 11.5,
            satisfaction: 2.25,
        }
    }

    /// The accepting half of the career rules: every compiled field read
    /// back, the holder resolved to the SECOND entry's index so a
    /// resolver collapsing to 0 (or to None) is visible, and a jobless
    /// member staying None so the option is real - [L29] and [L34] in
    /// the careers' costume.
    #[test]
    fn compiles_careers_and_resolves_the_household_holder() {
        let mut worker = member("Terri", "the_settled", 0.5, 2.0);
        worker.career = Some("second_job".to_string());
        let idle = member("Doug", "the_settled", 0.5, 0.0);

        let mut second = a_career("second_job");
        second.shift_start = 2;
        second.shift_ticks = 4;
        second.pay = 55;
        second.energy_cost = 8.75;
        second.satisfaction = 0.5;

        let pack = compile_people_full(
            vec![archetype("the_settled")],
            vec![worker, idle],
            vec![],
            vec![a_career("first_job"), second],
        )
        .expect("two valid careers and one holder");

        assert_eq!(pack.careers.len(), 2);
        let first = &pack.careers[0];
        assert_eq!(first.id, "first_job");
        assert_eq!(first.label, "The first_job job");
        assert_eq!(first.shift_start, 5);
        assert_eq!(first.shift_ticks, 7);
        assert_eq!(first.pay, 130);
        assert_eq!(first.energy_cost, 11.5);
        assert_eq!(first.satisfaction, 2.25);

        assert_eq!(
            pack.household[0].career,
            Some(1),
            "Terri holds the SECOND career, not the list's first"
        );
        assert_eq!(pack.household[1].career, None, "Doug holds no job");
    }

    #[test]
    fn rejects_a_duplicate_career_id() {
        assert_eq!(
            compile_people_full(
                vec![],
                vec![],
                vec![],
                vec![a_career("office_job"), a_career("office_job")]
            )
            .unwrap_err(),
            ContentError::DuplicateCareer {
                id: "office_job".into()
            }
        );
    }

    #[test]
    fn rejects_a_blank_career_label() {
        let mut blank = a_career("office_job");
        blank.label = "   ".to_string();
        assert_eq!(
            compile_people_full(vec![], vec![], vec![], vec![blank]).unwrap_err(),
            ContentError::EmptyCareerLabel {
                id: "office_job".into()
            }
        );
    }

    #[test]
    fn rejects_a_zero_tick_shift() {
        let mut lazy = a_career("office_job");
        lazy.shift_ticks = 0;
        assert_eq!(
            compile_people_full(vec![], vec![], vec![], vec![lazy]).unwrap_err(),
            ContentError::ZeroShift {
                id: "office_job".into()
            }
        );
    }

    /// Both day-clock rules against `full_tuning`'s 19-tick day, each
    /// pinned from BOTH sides of its boundary: a start AT day_ticks is
    /// rejected (the clock counts 0..19, so 19 never comes) and 18
    /// accepted, separating `>=` from `>`; a shift OF day_ticks is
    /// rejected (return lands exactly on the next departure and the sim
    /// never lives) and 18 accepted, same separation.
    #[test]
    fn rejects_a_shift_the_day_cannot_hold() {
        let with_times = |start: u32, ticks: u32| {
            let mut career = a_career("office_job");
            career.shift_start = start;
            career.shift_ticks = ticks;
            compile_people_full(vec![], vec![], vec![], vec![career])
        };

        assert_eq!(
            with_times(19, 7).unwrap_err(),
            ContentError::ShiftStartsPastTheDay {
                id: "office_job".into(),
                shift_start: 19,
                day_ticks: 19
            }
        );
        assert!(with_times(18, 7).is_ok(), "18 of 19 is a legal start");

        assert_eq!(
            with_times(5, 19).unwrap_err(),
            ContentError::ShiftLongerThanTheDay {
                id: "office_job".into(),
                shift_ticks: 19,
                day_ticks: 19
            }
        );
        assert!(with_times(5, 18).is_ok(), "18 of 19 is a legal shift");
    }

    /// The two numeric field rules, each from both sides. Energy is on
    /// the need scale: -0.5 and 100.5 rejected, 0.0 and 100.0 accepted,
    /// separating the closed range from an open one; NaN is the shared
    /// finiteness rule with the field named. Satisfaction: -0.25
    /// rejected and 0.0 accepted, because a zero-meaning job is exactly
    /// the satire [E4] ships.
    #[test]
    fn rejects_career_numbers_off_their_scales() {
        let with_energy = |value: f32| {
            let mut career = a_career("office_job");
            career.energy_cost = value;
            compile_people_full(vec![], vec![], vec![], vec![career])
        };
        for bad in [-0.5, 100.5] {
            assert_eq!(
                with_energy(bad).unwrap_err(),
                ContentError::CareerEnergyCostOutOfRange {
                    id: "office_job".into(),
                    value: bad
                }
            );
        }
        for legal in [0.0, 100.0] {
            assert!(with_energy(legal).is_ok(), "{legal} is on the scale");
        }
        assert!(matches!(
            with_energy(f32::NAN).unwrap_err(),
            ContentError::NonFiniteValue { .. }
        ));

        let with_satisfaction = |value: f32| {
            let mut career = a_career("office_job");
            career.satisfaction = value;
            compile_people_full(vec![], vec![], vec![], vec![career])
        };
        assert_eq!(
            with_satisfaction(-0.25).unwrap_err(),
            ContentError::NegativeCareerSatisfaction {
                id: "office_job".into(),
                value: -0.25
            }
        );
        assert!(
            with_satisfaction(0.0).is_ok(),
            "a job that means nothing is legal, and is the point"
        );
    }

    #[test]
    fn rejects_a_sim_holding_an_undeclared_career() {
        let mut worker = member("Terri", "the_settled", 0.5, 2.0);
        worker.career = Some("astronaut".to_string());
        assert_eq!(
            compile_people_full(
                vec![archetype("the_settled")],
                vec![worker],
                vec![],
                vec![a_career("office_job")]
            )
            .unwrap_err(),
            ContentError::UnknownSimCareer {
                sim: "Terri".into(),
                career: "astronaut".into()
            }
        );
    }

    /// The front door's three rules, each with its accepting side. The
    /// fixture is `compile_people_full`'s own 4x3 lot (wall at (1, 0),
    /// fridge on (2, 1)) so the numbers below are checkable against one
    /// map: -1 and 4 straddle the width from both directions, (1, 0)
    /// IS the wall and (2, 1) IS the fridge's tile, and the legal door
    /// at (3, 2) is the far corner.
    #[test]
    fn a_front_door_must_stand_on_reachable_floor() {
        let with_door = |x: i32, y: i32| {
            let mut lot = lot_of(4, 3, &[(1, 0)], &[("fridge", 2.0, 1.0)]);
            lot.front_door = Some(crate::schema::FrontDoorDef { x, y });
            compile_bare(
                full_needs(),
                one_object(snack()),
                lot,
                test_atlas(),
                full_tuning(),
            )
        };

        for (x, y) in [(-1, 1), (4, 1), (0, -1), (0, 3)] {
            assert_eq!(
                with_door(x, y).unwrap_err(),
                ContentError::FrontDoorOutOfBounds {
                    x,
                    y,
                    width: 4,
                    height: 3
                }
            );
        }
        assert_eq!(
            with_door(1, 0).unwrap_err(),
            ContentError::FrontDoorBlocked { x: 1, y: 0 },
            "the wall tile"
        );
        assert_eq!(
            with_door(2, 1).unwrap_err(),
            ContentError::FrontDoorBlocked { x: 2, y: 1 },
            "the fridge's own tile"
        );

        let pack = with_door(3, 2).expect("the far corner is legal floor");
        assert_eq!(
            pack.lot.front_door,
            Some((3, 2)),
            "the compiled lot must carry the door it was authored"
        );
    }

    /// The sealed-pocket half, on the sealed-spawn fixture's geometry: a
    /// wall column at x = 2 splits the 4x3 lot, the flood fill roots at
    /// (1, 0) beside the fridge on (0, 0), and a door east of the column
    /// is in the other region.
    #[test]
    fn rejects_a_front_door_sealed_off_from_the_rest_of_the_lot() {
        let mut lot = lot_of(4, 3, &[(2, 0), (2, 1), (2, 2)], &[("fridge", 0.0, 0.0)]);
        lot.front_door = Some(crate::schema::FrontDoorDef { x: 3, y: 1 });
        assert_eq!(
            compile_bare(
                full_needs(),
                one_object(snack()),
                lot,
                test_atlas(),
                full_tuning()
            )
            .unwrap_err(),
            ContentError::FrontDoorUnreachable {
                x: 3,
                y: 1,
                root_x: 1,
                root_y: 0
            }
        );
    }

    /// The pair rule: a worker needs a door, checked against the PAIR
    /// rather than either file alone - the same doorless lot is legal
    /// under a jobless household, pinned here from both sides.
    #[test]
    fn rejects_a_worker_on_a_doorless_lot() {
        let compile_doorless = |career: Option<&str>| {
            let mut worker = member("Terri", "the_settled", 0.5, 2.0);
            worker.career = career.map(str::to_string);
            compile(
                full_needs(),
                one_object(snack()),
                lot_of(4, 3, &[(1, 0)], &[("fridge", 2.0, 1.0)]),
                test_atlas(),
                full_tuning(),
                PersonalitiesFile {
                    archetype: vec![archetype("the_settled")],
                },
                HouseholdFile { sim: vec![worker] },
                SocialFile {
                    interaction: vec![],
                },
                TraitsFile { trait_def: vec![] },
                CareersFile {
                    career: vec![a_career("office_job")],
                },
                ChainsFile { chain: vec![] },
            )
        };

        assert_eq!(
            compile_doorless(Some("office_job")).unwrap_err(),
            ContentError::CareerWithoutFrontDoor {
                sim: "Terri".into()
            }
        );
        assert!(
            compile_doorless(None).is_ok(),
            "the same doorless lot is legal until somebody on it works"
        );
    }

    /// The day itself: zero rejected, one accepted - the smallest legal
    /// day, absurd but arithmetically sound, separating `== 0` from a
    /// stricter floor nobody declared.
    #[test]
    fn rejects_a_zero_tick_day() {
        assert_eq!(
            compile_tuned(tuning_where(|t| t.day_ticks = 0)).unwrap_err(),
            ContentError::ZeroDayTicks
        );
        assert!(compile_tuned(tuning_where(|t| t.day_ticks = 1)).is_ok());
    }

    // ---- The circadian curve -------------------------------------------
    //
    // Four rules, each pinned at its BOUNDARY rather than with one obviously
    // bad value. The mutation sweep is why: it rewrites `<` to `<=`, `>=` to
    // `<`, and deletes `!`, and a test that only checks a wildly invalid
    // curve passes under every one of those. The first version of this
    // validation shipped with no tests at all and the sweep found ten
    // survivors across these four lines in one shard.

    /// **The two halves of the rhythm have to add up.**
    ///
    /// The ramp multiplies the curve, so a deep enough trough survives
    /// any finite bonus and the promise that an exhausted sim eventually
    /// sleeps quietly stops holding. This is the rule that makes that a
    /// build error rather than a household nobody can explain.
    #[test]
    fn rejects_a_trough_no_amount_of_exhaustion_can_beat() {
        // 0.2 x 2.5 is 0.5: still below neutral, so a sim at the worst
        // hour is talked out of bed however long it has been awake.
        let err = compile_tuned(tuning_where(|t| {
            t.day_ticks = 1440;
            let mut table = circadian(vec![(0, 1.4), (420, 0.2), (1320, 1.3)]);
            table.exhaustion_bonus = 2.5;
            t.circadian = Some(table);
        }))
        .unwrap_err();
        assert!(
            matches!(err, ContentError::ExhaustionCannotBeatTheTrough { .. }),
            "got {err:?}"
        );

        // Exactly 1.0 is the boundary and it is LEGAL: neutral is enough
        // to stop the curve vetoing, which is all the rule promises.
        assert!(
            compile_tuned(tuning_where(|t| {
                t.day_ticks = 1440;
                let mut table = circadian(vec![(0, 1.4), (420, 0.4), (1320, 1.3)]);
                table.exhaustion_bonus = 2.5;
                t.circadian = Some(table);
            }))
            .is_ok(),
            "0.4 x 2.5 is exactly 1.0, which is the edge rather than past it"
        );
    }

    #[test]
    fn rejects_an_exhaustion_ramp_that_cannot_ramp() {
        for (bad, matches_zero) in [(0u32, true), (1, false)] {
            let result = compile_tuned(tuning_where(|t| {
                t.day_ticks = 1440;
                let mut table = circadian(vec![(0, 1.4), (700, 1.2)]);
                table.exhaustion_ramp_ticks = bad;
                t.circadian = Some(table);
            }));
            if matches_zero {
                assert_eq!(result.unwrap_err(), ContentError::ZeroExhaustionRamp);
            } else {
                // One tick is a legal ramp, just an abrupt one. The rule
                // is about dividing by zero, not about taste.
                assert!(result.is_ok(), "a one-tick ramp is steep, not invalid");
            }
        }
    }

    #[test]
    fn rejects_exhaustion_knobs_outside_their_ranges() {
        for bad in [-0.001_f32, 100.001, f32::NAN] {
            let err = compile_tuned(tuning_where(|t| {
                t.day_ticks = 1440;
                let mut table = circadian(vec![(0, 1.4), (700, 1.2)]);
                table.exhaustion_energy = bad;
                t.circadian = Some(table);
            }))
            .unwrap_err();
            assert!(
                matches!(
                    err,
                    ContentError::ExhaustionEnergyOutOfRange { .. }
                        | ContentError::NonFiniteValue { .. }
                ),
                "energy {bad} must be rejected, got {err:?}"
            );
        }
        // Below 1 the mechanic inverts: exhaustion would make a bed LESS
        // attractive the longer a sim went without one.
        let err = compile_tuned(tuning_where(|t| {
            t.day_ticks = 1440;
            let mut table = circadian(vec![(0, 1.4), (700, 1.2)]);
            table.exhaustion_bonus = 0.999;
            t.circadian = Some(table);
        }))
        .unwrap_err();
        assert!(
            matches!(err, ContentError::ExhaustionBonusBelowOne { .. }),
            "got {err:?}"
        );
        // Exactly 1 is the legal way to disable the ramp.
        assert!(
            compile_tuned(tuning_where(|t| {
                t.day_ticks = 1440;
                let mut table = circadian(vec![(0, 1.4), (700, 1.2)]);
                table.exhaustion_bonus = 1.0;
                t.circadian = Some(table);
            }))
            .is_ok(),
            "exactly 1 disables the ramp rather than being invalid"
        );
    }

    /// **The sleep knobs, at their boundaries.** Same shape as the
    /// `at_work_decay_scale` rules above, because they are the same rule
    /// one need-state along.
    #[test]
    fn rejects_an_asleep_decay_scale_outside_its_range() {
        for bad in [-0.001_f32, 1.001, f32::NAN, f32::INFINITY] {
            let err = compile_tuned(tuning_where(|t| t.asleep_decay_scale = bad)).unwrap_err();
            assert!(
                matches!(
                    err,
                    ContentError::AsleepDecayScaleOutOfRange { .. }
                        | ContentError::NonFiniteValue { .. }
                ),
                "{bad} must be rejected, got {err:?}"
            );
        }
        // Both ends are LEGAL, and each one means something: 0 is a bed
        // that suspends decay entirely and 1 is the behaviour before this
        // existed, which is how the knob's effect gets measured again.
        for good in [0.0_f32, 1.0] {
            assert!(
                compile_tuned(tuning_where(|t| t.asleep_decay_scale = good)).is_ok(),
                "{good} is the legal edge of the range, not outside it"
            );
        }
    }

    #[test]
    fn rejects_a_blank_sleep_tag() {
        // An empty tag matches no interaction, so the drive, the decay
        // scale and the Zzz bubble would all quietly do nothing - the
        // silent-nothing case [D9] exists to convert into a build error.
        for blank in ["", " ", "\t", "  \n "] {
            assert_eq!(
                compile_tuned(tuning_where(|t| t.sleep_tag = blank.to_string())).unwrap_err(),
                ContentError::EmptySleepTag,
                "{blank:?} is blank and must be rejected"
            );
        }
        assert!(
            compile_tuned(tuning_where(|t| t.sleep_tag = "x".to_string())).is_ok(),
            "one non-space character is a tag"
        );
    }

    fn circadian(points: Vec<(u32, f32)>) -> CircadianFile {
        CircadianFile {
            sleep_drive: points,
            // Valid and distinct, so a rule about the CURVE cannot pass
            // or fail for a reason belonging to the ramp beside it.
            exhaustion_energy: 12.0,
            exhaustion_ramp_ticks: 240,
            exhaustion_bonus: 2.5,
        }
    }

    /// Two points is the smallest real curve; one is a constant wearing a
    /// curve's clothes, and the interpolation has nothing to interpolate.
    #[test]
    fn rejects_a_circadian_curve_with_fewer_than_two_points() {
        for points in [vec![], vec![(0, 1.0)]] {
            let count = points.len();
            assert_eq!(
                compile_tuned(tuning_where(|t| t.circadian = Some(circadian(points)))).unwrap_err(),
                ContentError::CircadianTooFewPoints { points: count }
            );
        }
        assert!(
            compile_tuned(tuning_where(
                |t| t.circadian = Some(circadian(vec![(0, 1.0), (1, 1.0)]))
            ))
            .is_ok(),
            "two points is the smallest legal curve"
        );
    }

    /// Every point must fall INSIDE the day, because the curve wraps: a
    /// point at `day_ticks` is the same instant as one at 0 and the
    /// wrapping segment's length would come out negative.
    #[test]
    fn rejects_a_circadian_point_outside_the_day() {
        // `day_ticks` itself is already outside - the last legal tick is
        // one below it. That boundary is what separates `>=` from `>`.
        assert_eq!(
            compile_tuned(tuning_where(|t| {
                t.day_ticks = 100;
                t.circadian = Some(circadian(vec![(0, 1.0), (100, 1.0)]));
            }))
            .unwrap_err(),
            ContentError::CircadianPointPastTheDay {
                tick: 100,
                day_ticks: 100
            }
        );
        assert!(
            compile_tuned(tuning_where(|t| {
                t.day_ticks = 100;
                t.circadian = Some(circadian(vec![(0, 1.0), (99, 1.0)]));
            }))
            .is_ok(),
            "one below the day is the last legal tick"
        );
    }

    /// Zero is legal and means "never chooses sleep unprompted", which is
    /// the same thing an authored fear means elsewhere. Below zero has no
    /// meaning, and a non-finite multiplier poisons every score it
    /// touches without erroring anywhere.
    #[test]
    fn rejects_a_negative_or_non_finite_sleep_multiplier() {
        // A zero point USED to be legal here, as the authored "never on
        // its own". It is not any more, and the reason is a real
        // interaction rather than a tightened rule: exhaustion multiplies
        // the curve, so a zero survives any bonus and the promise that a
        // tired sim eventually sleeps stops holding. Zero and "eventually
        // always" cannot both be true, and the trough rule is where that
        // is now said - see `rejects_a_trough_no_amount_of_exhaustion_can_beat`.
        //
        // A small POSITIVE trough is still legal and is what "barely ever
        // on its own" is written as now.
        assert!(
            compile_tuned(tuning_where(
                |t| t.circadian = Some(circadian(vec![(0, 0.4), (1, 1.0)]))
            ))
            .is_ok(),
            "a small positive trough is the authored 'barely ever'"
        );
        for bad in [-0.001_f32, f32::NAN, f32::INFINITY] {
            let err = compile_tuned(tuning_where(|t| {
                t.circadian = Some(circadian(vec![(0, bad), (1, 1.0)]))
            }))
            .unwrap_err();
            assert!(
                matches!(
                    err,
                    ContentError::CircadianNegativeMultiplier { tick: 0, .. }
                ),
                "{bad} must be rejected, got {err:?}"
            );
        }
    }

    /// Strictly ascending, so equal ticks are rejected too: two points on
    /// the same tick make a zero-length segment, and the interpolation
    /// divides by it.
    #[test]
    fn rejects_circadian_points_that_do_not_strictly_ascend() {
        assert_eq!(
            compile_tuned(tuning_where(
                |t| t.circadian = Some(circadian(vec![(10, 1.0), (5, 1.0)]))
            ))
            .unwrap_err(),
            ContentError::CircadianPointsOutOfOrder { tick: 5 },
            "descending is rejected"
        );
        assert_eq!(
            compile_tuned(tuning_where(
                |t| t.circadian = Some(circadian(vec![(10, 1.0), (10, 1.0)]))
            ))
            .unwrap_err(),
            ContentError::CircadianPointsOutOfOrder { tick: 10 },
            "EQUAL is rejected too - this is what separates >= from >"
        );
        assert!(
            compile_tuned(tuning_where(
                |t| t.circadian = Some(circadian(vec![(10, 1.0), (11, 1.0)]))
            ))
            .is_ok(),
            "one tick apart is enough to ascend"
        );
    }

    /// The absence of a table is not an error, and is what every pack had
    /// before the rhythm existed.
    #[test]
    fn a_pack_without_a_circadian_table_compiles_and_carries_none() {
        let pack = compile_tuned(tuning_where(|t| t.circadian = None)).expect("valid");
        assert!(pack.circadian.is_none());
    }

    /// A valid table survives compilation intact, tag and all - otherwise
    /// the rules above could all pass while the curve never reached the
    /// simulation.
    #[test]
    fn a_valid_circadian_table_reaches_the_pack() {
        // `day_ticks` set explicitly rather than assumed: the shared
        // fixture's day is 19 ticks, not the shipped 1440, and a curve
        // authored against the wrong one is rejected - correctly, which
        // is how the first draft of this test found out.
        let pack = compile_tuned(tuning_where(|t| {
            t.day_ticks = 1440;
            t.circadian = Some(circadian(vec![(0, 1.5), (700, 0.45)]));
        }))
        .expect("valid");
        let circadian = pack.circadian.expect("the table must survive compilation");
        assert_eq!(circadian.sleep_drive, vec![(0, 1.5), (700, 0.45)]);
        // The tag rides on the pack rather than on the table, so it is
        // there whether or not a rhythm was authored.
        assert_eq!(pack.sleep_tag, "sleep");
    }

    fn a_trait(id: &str) -> TraitDef {
        TraitDef {
            id: id.to_string(),
            label: format!("The {id} one"),
            kind: "disposition".to_string(),
            tag: "snacking".to_string(),
            score_multiplier: Some(1.25),
            start_level: None,
            fail_delta_scale: None,
            learn_per_attempt: None,
            accrual_scale: None,
            manage_per_completion: None,
            start_severity: None,
        }
    }

    /// A disposition's one range rule, pinned from BOTH sides of its
    /// boundary: negative is rejected (a benefit turned cost behind
    /// nobody's decision) and ZERO is accepted, because zero IS the
    /// authored fear ([S4]). -0.5 separates `<` from `==`; 0.0 accepted
    /// separates `<` from `<=`.
    #[test]
    fn rejects_a_negative_disposition_and_accepts_the_fear() {
        for bad in [-0.5, -f32::MIN_POSITIVE] {
            let mut t = a_trait("wary");
            t.score_multiplier = Some(bad);
            assert_eq!(
                compile_people_with_traits(vec![], vec![], vec![t]).unwrap_err(),
                ContentError::TraitFieldOutOfRange {
                    id: "wary".to_string(),
                    field: "score_multiplier".to_string(),
                    value: bad,
                },
                "a negative disposition turns benefits into costs"
            );
        }
        let mut fear = a_trait("terrified");
        fear.score_multiplier = Some(0.0);
        let pack = compile_people_with_traits(vec![], vec![], vec![fear])
            .expect("zero IS the fear and must compile");
        assert_eq!(
            pack.traits[0].kind,
            crate::pack::CompiledTraitKind::Disposition {
                score_multiplier: 0.0
            }
        );
    }

    /// One trait, worn once - the review finding: `Traits` keys state
    /// by index with a binary search, so a duplicate entry would sit
    /// stale behind every write. Two DIFFERENT traits stay legal, so
    /// the test separates "repeated id" from "more than one trait".
    #[test]
    fn rejects_a_sim_wearing_the_same_trait_twice() {
        let mut sim = member("Terri", "the_settled", 0.5, 2.25);
        sim.traits = vec!["first".to_string(), "first".to_string()];
        assert_eq!(
            compile_people_with_traits(
                vec![archetype("the_settled")],
                vec![sim],
                vec![a_trait("first"), a_trait("second")]
            )
            .unwrap_err(),
            ContentError::DuplicateWornTrait {
                sim: "Terri".into(),
                trait_id: "first".into()
            }
        );

        let mut sim = member("Terri", "the_settled", 0.5, 2.25);
        sim.traits = vec!["first".to_string(), "second".to_string()];
        assert!(
            compile_people_with_traits(
                vec![archetype("the_settled")],
                vec![sim],
                vec![a_trait("first"), a_trait("second")]
            )
            .is_ok(),
            "two different traits are an outfit, not a duplicate"
        );
    }

    /// A worn trait resolves BY ID to its index - and the fixture wears
    /// the SECOND declared trait, because a resolver that matched any
    /// non-equal id (the `==`-to-`!=` mutant) or always answered zero is
    /// only visible when the right answer is not the first entry.
    #[test]
    fn a_worn_trait_resolves_to_the_index_of_its_own_id() {
        let mut sim = member("Terri", "the_settled", 0.5, 2.25);
        sim.traits = vec!["second".to_string()];
        let pack = compile_people_with_traits(
            vec![archetype("the_settled")],
            vec![sim],
            vec![a_trait("first"), a_trait("second")],
        )
        .expect("valid");
        assert_eq!(
            pack.household[0].traits,
            vec![1],
            "wearing 'second' must resolve to index 1, not to whichever \
             entry a broken comparison matched first"
        );
    }

    /// The happy path, with every landing slot asserted. Sparse authored
    /// maps become dense arrays with 1.0 in every unnamed slot - not 0.0,
    /// which would freeze decay and nullify benefits silently - and the
    /// household member's absent needs start at NEED_MAX.
    #[test]
    fn compiles_an_archetype_and_a_household_member_into_their_slots() {
        let pack = compile_people(
            vec![archetype("the_settled")],
            vec![member("Terri", "the_settled", 0.5, 2.25)],
        )
        .expect("valid people");

        let personality = &pack.personalities[0];
        assert_eq!(personality.id, "the_settled");
        for id in NeedId::ALL {
            let expected_drain = if id == NeedId::Fun { 1.5 } else { 1.0 };
            let expected_satisfaction = if id == NeedId::Hunger { 0.75 } else { 1.0 };
            assert_eq!(
                personality.drain[id.index()],
                expected_drain,
                "drain for {}",
                id.as_str()
            );
            assert_eq!(
                personality.satisfaction[id.index()],
                expected_satisfaction,
                "satisfaction for {}",
                id.as_str()
            );
        }
        assert_eq!(
            personality.dispositions,
            vec![(ObjectDefId(0), 0, 1.25)],
            "the disposition must resolve both names to indices"
        );

        let sim = &pack.household[0];
        assert_eq!(sim.name, "Terri");
        assert_eq!(sim.personality, 0);
        assert_eq!((sim.x, sim.y), (0.5, 2.25), "coordinates kept verbatim");
        for id in NeedId::ALL {
            let expected = if id == NeedId::Hunger { 62.5 } else { NEED_MAX };
            assert_eq!(sim.needs[id.index()], expected, "{}", id.as_str());
        }
    }

    /// Dispositions are stored SORTED whatever order authoring used,
    /// because the component binary-searches them and their iteration
    /// order must be deterministic. Declared out of order with distinct
    /// weights, so a sort that dropped or duplicated an entry is visible
    /// in the values.
    #[test]
    fn dispositions_compile_sorted_by_key_not_by_declaration_order() {
        let mut hostile = archetype("the_settled");
        hostile.disposition = vec![
            DispositionDef {
                object: "couch".to_string(),
                interaction: "lounge".to_string(),
                weight: 1.75,
            },
            DispositionDef {
                object: "fridge".to_string(),
                interaction: "grab_snack".to_string(),
                weight: 0.25,
            },
        ];
        // A second object so there are two ObjectDefIds to sort between.
        let mut objects = one_object(snack());
        objects.object.push(ObjectDef {
            roles: vec![],
            action_socket: vec![],
            id: "couch".into(),
            name: "Couch".into(),
            sprite: "couch_art".into(),
            footprint: Footprint::SINGLE,
            interaction: vec![InteractionDef {
                tags: vec![],
                satisfaction: 0.0,
                visual: None,
                id: "lounge".into(),
                label: None,
                advertises: [("comfort".to_string(), 20.0)].into_iter().collect(),
                duration_ticks: 25,
                slots: 1,
            }],
        });
        let pack = compile(
            full_needs(),
            objects,
            lot_of(5, 3, &[], &[("fridge", 2.0, 1.0), ("couch", 4.0, 1.0)]),
            test_atlas(),
            full_tuning(),
            PersonalitiesFile {
                archetype: vec![hostile],
            },
            HouseholdFile { sim: vec![] },
            SocialFile {
                interaction: vec![],
            },
            TraitsFile { trait_def: vec![] },
            CareersFile { career: vec![] },
            ChainsFile { chain: vec![] },
        )
        .expect("two dispositions on two objects are valid");

        // fridge is ObjectDefId 0 and couch is 1, so sorted order is the
        // reverse of the declaration order above.
        assert_eq!(
            pack.personalities[0].dispositions,
            vec![(ObjectDefId(0), 0, 0.25), (ObjectDefId(1), 0, 1.75)]
        );
    }

    #[test]
    fn rejects_a_duplicate_archetype_id() {
        assert_eq!(
            compile_people(
                vec![archetype("the_settled"), archetype("the_settled")],
                vec![]
            )
            .unwrap_err(),
            ContentError::DuplicateArchetype {
                id: "the_settled".into()
            }
        );
    }

    /// Both maps, because they are validated by separate loops and the
    /// `map` field in the error is what tells the author which line to
    /// fix.
    #[test]
    fn rejects_an_unknown_need_in_either_personality_map() {
        let mut bad_drain = archetype("a");
        bad_drain.drain.insert("moxie".into(), 1.1);
        assert_eq!(
            compile_people(vec![bad_drain], vec![]).unwrap_err(),
            ContentError::UnknownPersonalityNeed {
                archetype: "a".into(),
                map: "drain",
                need: "moxie".into()
            }
        );

        let mut bad_satisfaction = archetype("a");
        bad_satisfaction.satisfaction.insert("moxie".into(), 1.1);
        assert_eq!(
            compile_people(vec![bad_satisfaction], vec![]).unwrap_err(),
            ContentError::UnknownPersonalityNeed {
                archetype: "a".into(),
                map: "satisfaction",
                need: "moxie".into()
            }
        );
    }

    /// **The floors DIFFER between the two maps, and the asymmetry is the
    /// rule.** A drain of 0 is a placid trait - the need never troubles
    /// this sim - and must compile. A satisfaction of 0 makes the need
    /// dynamically unsatisfiable for this one sim, which is [C2] with a
    /// face on it, and must not.
    #[test]
    fn a_zero_drain_is_a_trait_and_a_zero_satisfaction_is_a_trap() {
        let mut placid = archetype("a");
        placid.drain.insert("social".into(), 0.0);
        compile_people(vec![placid], vec![]).expect("a need that never drains is legal content");

        let mut trapped = archetype("a");
        trapped.satisfaction.insert("social".into(), 0.0);
        assert_eq!(
            compile_people(vec![trapped], vec![]).unwrap_err(),
            ContentError::NonPositiveSatisfaction {
                archetype: "a".into(),
                need: "social".into(),
                value: 0.0
            }
        );
        // And the smallest positive float is legal, pinning `<=` rather
        // than `<`.
        let mut barely = archetype("a");
        barely
            .satisfaction
            .insert("social".into(), f32::MIN_POSITIVE);
        compile_people(vec![barely], vec![]).expect("any positive satisfaction is legal");
    }

    /// A weight of 0 is the "fear of couches" the design brief asks for
    /// and must compile; a negative weight would flip a benefit's sign
    /// inside scoring and is rejected as the sign error it is.
    #[test]
    fn a_zero_disposition_is_a_fear_and_a_negative_one_is_rejected() {
        let mut fearful = archetype("a");
        fearful.disposition[0].weight = 0.0;
        compile_people(vec![fearful], vec![]).expect("a refusal is legal content");

        let mut backwards = archetype("a");
        backwards.disposition[0].weight = -0.5;
        assert!(matches!(
            compile_people(vec![backwards], vec![]).unwrap_err(),
            ContentError::NegativeValue { .. }
        ));
    }

    #[test]
    fn rejects_a_disposition_toward_missing_content() {
        let mut no_object = archetype("a");
        no_object.disposition[0].object = "hovercraft".into();
        assert_eq!(
            compile_people(vec![no_object], vec![]).unwrap_err(),
            ContentError::UnknownDispositionObject {
                archetype: "a".into(),
                object: "hovercraft".into()
            }
        );

        let mut no_interaction = archetype("a");
        no_interaction.disposition[0].interaction = "defrost".into();
        assert_eq!(
            compile_people(vec![no_interaction], vec![]).unwrap_err(),
            ContentError::UnknownDispositionInteraction {
                archetype: "a".into(),
                object: "fridge".into(),
                interaction: "defrost".into()
            }
        );
    }

    #[test]
    fn rejects_two_dispositions_for_one_interaction() {
        let mut doubled = archetype("a");
        // Different WEIGHT, same key: the ambiguity is which weight wins,
        // and a fixture with equal weights could not show it mattered.
        let first_weight = doubled.disposition[0].weight;
        doubled.disposition.push(DispositionDef {
            object: "fridge".to_string(),
            interaction: "grab_snack".to_string(),
            weight: 0.5,
        });
        assert_ne!(doubled.disposition[1].weight, first_weight);
        assert_eq!(
            compile_people(vec![doubled], vec![]).unwrap_err(),
            ContentError::DuplicateDisposition {
                archetype: "a".into(),
                object: "fridge".into(),
                interaction: "grab_snack".into()
            }
        );
    }

    #[test]
    fn rejects_a_household_member_with_a_missing_archetype_or_a_blank_name() {
        assert_eq!(
            compile_people(vec![], vec![member("Terri", "the_settled", 0.5, 2.0)]).unwrap_err(),
            ContentError::UnknownArchetype {
                sim: "Terri".into(),
                archetype: "the_settled".into()
            }
        );
        // Whitespace, not just empty: "   " renders exactly as blank in
        // the needs panel, and a trim is what the rule uses.
        assert_eq!(
            compile_people(
                vec![archetype("the_settled")],
                vec![member("   ", "the_settled", 0.5, 2.0)]
            )
            .unwrap_err(),
            ContentError::EmptySimName { index: 0 }
        );
    }

    /// The roadmap's "up to ~6" is an actual content contract: empty remains
    /// legal for fixtures, exactly six compile in declaration order, and the
    /// first value beyond the ceiling is rejected before any member-specific
    /// validation can obscure the useful error.
    #[test]
    fn household_capacity_accepts_six_and_rejects_seven() {
        let six: Vec<_> = (0..crate::schema::MAX_HOUSEHOLD_SIZE)
            .map(|index| member(&format!("Person {}", index + 1), "the_settled", 0.5, 2.0))
            .collect();
        let pack = compile_people(vec![archetype("the_settled")], six)
            .expect("six household members are legal");
        assert_eq!(
            pack.household
                .iter()
                .map(|member| member.name.as_str())
                .collect::<Vec<_>>(),
            ["Person 1", "Person 2", "Person 3", "Person 4", "Person 5", "Person 6",],
            "compilation preserves the roster's authored order"
        );

        let seven: Vec<_> = (0..=crate::schema::MAX_HOUSEHOLD_SIZE)
            .map(|index| member("", "missing", index as f32, f32::NAN))
            .collect();
        assert_eq!(
            compile_people(vec![], seven).unwrap_err(),
            ContentError::TooManyHouseholdMembers {
                count: 7,
                max: crate::schema::MAX_HOUSEHOLD_SIZE,
            },
            "capacity is checked before irrelevant per-member errors"
        );
    }

    /// The three geometric spawn rules, each against the mistake it
    /// exists for: off the lot, inside the fridge's footprint, on the
    /// wall tile - plus NaN, which must be rejected as non-finite BEFORE
    /// the bounds comparison every NaN would pass.
    #[test]
    fn rejects_a_spawn_off_the_lot_or_inside_something_solid() {
        let people = |x, y| {
            compile_people(
                vec![archetype("the_settled")],
                vec![member("Terri", "the_settled", x, y)],
            )
        };

        assert_eq!(
            people(4.0, 1.0).unwrap_err(),
            ContentError::SpawnOutOfBounds {
                sim: "Terri".into(),
                x: 4.0,
                y: 1.0,
                width: 4,
                height: 3
            }
        );
        // **The negative side, per axis, separately - three mutants lived
        // here.** The bounds check is four clauses joined by `||`, and the
        // positive-overflow case above exercises only the third: with
        // nothing spawning at a negative coordinate, `< 0.0` was free to
        // become `== 0.0` or `<= 0.0`, and the first `||` free to become
        // `&&`, all three surviving the whole workspace - found by the M2c
        // targeted sweep. One axis negative at a time, because the `&&`
        // mutant is only visible on an input where exactly one clause
        // fires; both-negative would satisfy either operator.
        //
        // A negative spawn that slipped past this check would not stay a
        // bounds problem: `sim.x as u32` saturates a negative to 0 in Rust,
        // so the sim would silently spawn on the west wall's column instead
        // of failing - an authoring typo turned into a wrong position with
        // no error anywhere.
        assert!(matches!(
            people(-0.5, 1.0).unwrap_err(),
            ContentError::SpawnOutOfBounds { .. }
        ));
        assert!(matches!(
            people(0.5, -0.5).unwrap_err(),
            ContentError::SpawnOutOfBounds { .. }
        ));
        // And exactly 0.0 is LEGAL - the north-west walkable corner is a
        // real spawn tile, and this is the input that pins `<` against
        // `<=`. (0.0, 2.0) rather than (0.0, 0.0) because row 0 of this
        // fixture holds the wall and the check being pinned is bounds,
        // not blockedness.
        people(0.0, 2.0).expect("the lot's west edge is a legal spawn column");
        assert_eq!(
            people(2.5, 1.5).unwrap_err(),
            ContentError::SpawnOnBlockedTile {
                sim: "Terri".into(),
                x: 2,
                y: 1
            },
            "the fridge's own tile; a sim born inside a footprint can never step out"
        );
        assert_eq!(
            people(1.0, 0.0).unwrap_err(),
            ContentError::SpawnOnBlockedTile {
                sim: "Terri".into(),
                x: 1,
                y: 0
            },
            "the wall tile"
        );
        assert!(matches!(
            people(f32::NAN, 1.0).unwrap_err(),
            ContentError::NonFiniteValue { .. }
        ));
    }

    /// A sim spawned on a walkable tile inside a sealed pocket is a
    /// failure no other rule can see: no OBJECT is unreachable, so [F5]
    /// rule 3 passes - the sim itself is what cannot get out.
    #[test]
    fn rejects_a_spawn_sealed_off_from_the_rest_of_the_lot() {
        let err = compile(
            full_needs(),
            one_object(snack()),
            lot_of(4, 3, &[(2, 0), (2, 1), (2, 2)], &[("fridge", 0.0, 0.0)]),
            test_atlas(),
            full_tuning(),
            PersonalitiesFile {
                archetype: vec![archetype("the_settled")],
            },
            HouseholdFile {
                sim: vec![member("Terri", "the_settled", 3.0, 1.0)],
            },
            SocialFile {
                interaction: vec![],
            },
            TraitsFile { trait_def: vec![] },
            CareersFile { career: vec![] },
            ChainsFile { chain: vec![] },
        )
        .unwrap_err();
        assert_eq!(
            err,
            ContentError::SpawnUnreachable {
                sim: "Terri".into(),
                x: 3,
                y: 1,
                root_x: 1,
                root_y: 0
            },
            "root is (1, 0): (0, 0) holds the fridge, so the first \
             walkable tile scanning row-major is the one east of it"
        );
    }

    #[test]
    fn rejects_a_starting_need_that_is_unknown_or_out_of_range() {
        let with_need = |need: &str, value: f32| {
            let mut sim = member("Terri", "the_settled", 0.5, 2.0);
            sim.needs = [(need.to_string(), value)].into_iter().collect();
            compile_people(vec![archetype("the_settled")], vec![sim])
        };

        assert_eq!(
            with_need("moxie", 50.0).unwrap_err(),
            ContentError::UnknownStartingNeed {
                sim: "Terri".into(),
                need: "moxie".into()
            }
        );
        assert_eq!(
            with_need("hunger", 620.0).unwrap_err(),
            ContentError::StartingNeedOutOfRange {
                sim: "Terri".into(),
                need: "hunger".into(),
                value: 620.0
            },
            "the typo this rule exists for: 620.0 written for 62.0"
        );
        assert_eq!(
            with_need("hunger", -0.5).unwrap_err(),
            ContentError::StartingNeedOutOfRange {
                sim: "Terri".into(),
                need: "hunger".into(),
                value: -0.5
            }
        );
        // Both boundaries are legal: 0 is desperate, not invalid.
        with_need("hunger", 0.0).expect("a sim may arrive at rock bottom");
        with_need("hunger", 100.0).expect("or perfectly content");
    }

    fn lot_of(
        width: u32,
        height: u32,
        walls: &[(i32, i32)],
        places: &[(&str, f32, f32)],
    ) -> LotFile {
        LotFile {
            front_door: None,
            width,
            height,
            wall: walls.iter().map(|&(x, y)| WallDef { x, y }).collect(),
            place: places
                .iter()
                .map(|&(object, x, y)| PlacementDef {
                    object: object.to_string(),
                    x,
                    y,
                    facing: None,
                })
                .collect(),
        }
    }

    /// Compiles a geometry fixture against valid needs, tuning and atlas, so
    /// each test below varies only the objects and the lot.
    fn compile_geometry(objects: ObjectsFile, lot: LotFile) -> Result<ContentPack, ContentError> {
        compile_bare(full_needs(), objects, lot, test_atlas(), full_tuning())
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

    /// The social-vocabulary happy path, with every compiled field
    /// asserted - [H6].
    ///
    /// Two entries, one with a declared label and one relying on the id
    /// fallback, so both authoring states of the label rule are pinned in
    /// the same pack. The advert pair is chosen because its NAME order
    /// and INDEX order disagree: the authored `BTreeMap` iterates "fun"
    /// (index 5) before "social" (index 4), so the compiled list reads
    /// social-first only if the compile actually sorted by index.
    #[test]
    fn compiles_the_social_vocabulary_into_the_pack() {
        let pack = compile_bare_with_social(vec![
            InteractionDef {
                tags: vec![],
                satisfaction: 0.0,
                visual: Some(VisualDef {
                    action: Some("talk".into()),
                    anchor: Some("partner".into()),
                    facing: Some("toward_anchor".into()),
                    socket: None,
                }),
                id: "chat".into(),
                label: Some("Compare complaints".into()),
                advertises: [("social".to_string(), 30.0), ("fun".to_string(), 6.0)]
                    .into_iter()
                    .collect(),
                duration_ticks: 40,
                slots: 2,
            },
            InteractionDef {
                tags: vec![],
                satisfaction: 0.0,
                visual: None,
                id: "nod_politely".into(),
                label: None,
                advertises: [("social".to_string(), 8.0)].into_iter().collect(),
                duration_ticks: 15,
                slots: 2,
            },
        ])
        .expect("a valid vocabulary compiles");

        assert_eq!(pack.social.len(), 2);
        let chat = &pack.social[0];
        assert_eq!(chat.id, "chat");
        assert_eq!(chat.label, "Compare complaints");
        assert_eq!(chat.duration_ticks, 40);
        assert_eq!(chat.slots, 2);
        assert_eq!(
            chat.visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Talk,
                anchor: CompiledVisualAnchor::Partner,
                facing: CompiledVisualFacing::TowardAnchor,
                socket: None,
            })
        );
        // Social is need index 4 and fun is 5; name order ("fun" first in
        // the BTreeMap) disagrees with index order, so this equality holds
        // only if the compile sorted by index.
        assert_eq!(chat.advertises, vec![(4, 30.0), (5, 6.0)]);
        assert_eq!(
            pack.social[1].label, "nod_politely",
            "an absent label must fall back to the id"
        );
        assert_eq!(
            pack.social[1].visual, None,
            "an absent visual table must stay absent"
        );
    }

    /// The visual table is all-or-nothing, every authored string crosses a
    /// closed vocabulary boundary before runtime. These are the legal
    /// no-socket rows, including standing object reading and watching fish;
    /// the two exact socket rows have separate coverage below. Known vocabulary
    /// in the wrong combination is still an error rather than a request for
    /// the renderer to improvise.
    #[test]
    fn validates_the_exact_visual_contract_matrix() {
        let visual = |action: Option<&str>, anchor: Option<&str>, facing: Option<&str>| {
            Some(VisualDef {
                action: action.map(str::to_string),
                anchor: anchor.map(str::to_string),
                facing: facing.map(str::to_string),
                socket: None,
            })
        };
        let chat = |visual| InteractionDef {
            tags: vec![],
            satisfaction: 0.0,
            visual,
            id: "chat".into(),
            label: None,
            advertises: [("social".to_string(), 30.0)].into_iter().collect(),
            duration_ticks: 40,
            slots: 2,
        };

        for (owner, owner_name, activity) in [
            (
                VisualOwner::Social {
                    interaction: "chat",
                },
                "social.toml",
                "interaction 'chat'",
            ),
            (
                VisualOwner::Object {
                    object: "fridge",
                    interaction: "grab_snack",
                },
                "object 'fridge'",
                "interaction 'grab_snack'",
            ),
            (
                VisualOwner::ChainStep {
                    chain: "cook_dinner",
                    step: 3,
                },
                "chain 'cook_dinner'",
                "step 3",
            ),
        ] {
            for action in ["talk", "eat", "read", "exercise", "watch"] {
                for anchor in ["partner", "object", "station"] {
                    let authored = visual(Some(action), Some(anchor), Some("toward_anchor"))
                        .expect("the test authors a visual");
                    let result = compile_visual(Some(&authored), owner, &[]);
                    let legal = match owner {
                        VisualOwner::Social { .. } => action == "talk" && anchor == "partner",
                        VisualOwner::Object { .. } => {
                            matches!(action, "eat" | "read" | "watch") && anchor == "object"
                        }
                        VisualOwner::ChainStep { .. } => action == "eat" && anchor == "station",
                    };
                    if legal {
                        assert!(result.is_ok(), "{owner_name} {activity} must compile");
                    } else {
                        assert_eq!(
                            result.unwrap_err(),
                            ContentError::InvalidVisualContract {
                                owner: owner_name.to_string(),
                                activity: activity.to_string(),
                                action: action.to_string(),
                                anchor: anchor.to_string(),
                            },
                            "{owner_name} {activity} must reject {action}/{anchor}"
                        );
                    }
                }
            }
        }

        for (missing, authored) in [
            (
                "action",
                visual(None, Some("partner"), Some("toward_anchor")),
            ),
            ("anchor", visual(Some("talk"), None, Some("toward_anchor"))),
            ("facing", visual(Some("talk"), Some("partner"), None)),
        ] {
            assert_eq!(
                compile_bare_with_social(vec![chat(authored)]).unwrap_err(),
                ContentError::IncompleteVisual {
                    owner: "social.toml".into(),
                    interaction: "chat".into(),
                    field: missing,
                }
            );
        }

        assert_eq!(
            compile_bare_with_social(vec![chat(visual(
                Some("dance"),
                Some("partner"),
                Some("toward_anchor")
            ))])
            .unwrap_err(),
            ContentError::UnknownVisualAction {
                owner: "social.toml".into(),
                interaction: "chat".into(),
                action: "dance".into(),
            }
        );
        assert_eq!(
            compile_bare_with_social(vec![chat(visual(
                Some("talk"),
                Some("moon"),
                Some("toward_anchor")
            ))])
            .unwrap_err(),
            ContentError::UnknownVisualAnchor {
                owner: "social.toml".into(),
                interaction: "chat".into(),
                anchor: "moon".into(),
            }
        );
        assert_eq!(
            compile_bare_with_social(vec![chat(visual(
                Some("talk"),
                Some("partner"),
                Some("away_from_anchor")
            ))])
            .unwrap_err(),
            ContentError::UnknownVisualFacing {
                owner: "social.toml".into(),
                interaction: "chat".into(),
                facing: "away_from_anchor".into(),
            }
        );

        let mut object_action = snack();
        object_action.visual = visual(Some("eat"), Some("object"), Some("toward_anchor"));
        let pack = compile_objects(full_needs(), one_object(object_action))
            .expect("the legal object visual compiles");
        assert_eq!(
            pack.objects[0].interactions[0].visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Eat,
                anchor: CompiledVisualAnchor::Object,
                facing: CompiledVisualFacing::TowardAnchor,
                socket: None,
            })
        );

        let mut standing_read = snack();
        standing_read.visual = visual(Some("read"), Some("object"), Some("toward_anchor"));
        let pack = compile_objects(full_needs(), one_object(standing_read))
            .expect("the legal standing-read visual compiles without a socket");
        assert_eq!(
            pack.objects[0].interactions[0].visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Read,
                anchor: CompiledVisualAnchor::Object,
                facing: CompiledVisualFacing::TowardAnchor,
                socket: None,
            })
        );

        // Exercise and watch add exactly two rows to the closed matrix. Walk
        // every combination of known owner, action, anchor, facing, and socket
        // state so accepting a near-miss cannot hide behind one happy-path
        // fixture.
        let action_sockets = vec![CompiledActionSocket {
            id: "saddle".to_string(),
            x: 0.0,
            y: 0.0,
            facing: CompiledSocketFacing::PositiveX,
        }];
        for (owner, owner_name) in [
            (
                VisualOwner::Social {
                    interaction: "chat",
                },
                "social",
            ),
            (
                VisualOwner::Object {
                    object: "moving_box",
                    interaction: "use_exercise_bike",
                },
                "object",
            ),
            (
                VisualOwner::ChainStep {
                    chain: "cook_dinner",
                    step: 3,
                },
                "chain step",
            ),
        ] {
            for action in ["talk", "eat", "read", "exercise", "watch"] {
                for anchor in ["partner", "object", "station", "object_socket"] {
                    for facing in ["toward_anchor", "socket"] {
                        for socket in [None, Some("saddle")] {
                            let authored = VisualDef {
                                action: Some(action.to_string()),
                                anchor: Some(anchor.to_string()),
                                facing: Some(facing.to_string()),
                                socket: socket.map(str::to_string),
                            };
                            let legal = matches!(
                                (owner, action, anchor, facing, socket),
                                (
                                    VisualOwner::Social { .. },
                                    "talk",
                                    "partner",
                                    "toward_anchor",
                                    None
                                ) | (
                                    VisualOwner::Object { .. },
                                    "eat" | "read" | "watch",
                                    "object",
                                    "toward_anchor",
                                    None
                                ) | (
                                    VisualOwner::ChainStep { .. },
                                    "eat",
                                    "station",
                                    "toward_anchor",
                                    None
                                ) | (
                                    VisualOwner::Object { .. },
                                    "read" | "exercise",
                                    "object_socket",
                                    "socket",
                                    Some("saddle")
                                )
                            );
                            let result = compile_visual(Some(&authored), owner, &action_sockets);
                            assert_eq!(
                                result.is_ok(),
                                legal,
                                "{owner_name} must {} {action}/{anchor}/{facing}/{socket:?}",
                                if legal { "accept" } else { "reject" }
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn rejects_incomplete_and_unknown_object_visuals() {
        let visual = |action: Option<&str>, anchor: Option<&str>, facing: Option<&str>| {
            Some(VisualDef {
                action: action.map(str::to_string),
                anchor: anchor.map(str::to_string),
                facing: facing.map(str::to_string),
                socket: None,
            })
        };

        for (field, authored) in [
            (
                "action",
                visual(None, Some("object"), Some("toward_anchor")),
            ),
            ("anchor", visual(Some("eat"), None, Some("toward_anchor"))),
            ("facing", visual(Some("eat"), Some("object"), None)),
        ] {
            let mut object_action = snack();
            object_action.visual = authored;
            assert_eq!(
                compile_objects(full_needs(), one_object(object_action)).unwrap_err(),
                ContentError::IncompleteVisual {
                    owner: "fridge".to_string(),
                    interaction: "grab_snack".to_string(),
                    field,
                }
            );
        }

        for (authored, expected) in [
            (
                visual(Some("dance"), Some("object"), Some("toward_anchor")),
                ContentError::UnknownVisualAction {
                    owner: "fridge".to_string(),
                    interaction: "grab_snack".to_string(),
                    action: "dance".to_string(),
                },
            ),
            (
                visual(Some("eat"), Some("moon"), Some("toward_anchor")),
                ContentError::UnknownVisualAnchor {
                    owner: "fridge".to_string(),
                    interaction: "grab_snack".to_string(),
                    anchor: "moon".to_string(),
                },
            ),
            (
                visual(Some("eat"), Some("object"), Some("away_from_anchor")),
                ContentError::UnknownVisualFacing {
                    owner: "fridge".to_string(),
                    interaction: "grab_snack".to_string(),
                    facing: "away_from_anchor".to_string(),
                },
            ),
        ] {
            let mut object_action = snack();
            object_action.visual = authored;
            assert_eq!(
                compile_objects(full_needs(), one_object(object_action)).unwrap_err(),
                expected
            );
        }
    }

    fn reading_object() -> ObjectDef {
        ObjectDef {
            id: "reading_chair".to_string(),
            name: "Reading chair".to_string(),
            sprite: "fridge_art".to_string(),
            footprint: Footprint { width: 3, depth: 3 },
            interaction: vec![InteractionDef {
                id: "settle_in".to_string(),
                label: Some("Sit and read".to_string()),
                advertises: [("fun".to_string(), 19.0)].into_iter().collect(),
                duration_ticks: 46,
                slots: 1,
                tags: vec!["reading".to_string()],
                satisfaction: 3.0,
                visual: Some(VisualDef {
                    action: Some("read".to_string()),
                    anchor: Some("object_socket".to_string()),
                    facing: Some("socket".to_string()),
                    socket: Some("seat".to_string()),
                }),
            }],
            roles: vec![],
            action_socket: vec![
                ActionSocketDef {
                    id: "unused".to_string(),
                    x: -0.5,
                    y: 0.25,
                    facing: "NW".to_string(),
                },
                ActionSocketDef {
                    id: "seat".to_string(),
                    x: 0.75,
                    y: -0.25,
                    facing: "SE".to_string(),
                },
                ActionSocketDef {
                    id: "south".to_string(),
                    x: -0.25,
                    y: -0.5,
                    facing: "SW".to_string(),
                },
                ActionSocketDef {
                    id: "north".to_string(),
                    x: 0.25,
                    y: 0.5,
                    facing: "NE".to_string(),
                },
            ],
        }
    }

    #[test]
    fn compiles_read_against_the_owning_objects_second_socket() {
        let pack = compile_objects(
            full_needs(),
            ObjectsFile {
                object: vec![reading_object()],
            },
        )
        .expect("the exact reading contract compiles");

        assert_eq!(
            pack.objects[0].action_sockets,
            vec![
                CompiledActionSocket {
                    id: "unused".to_string(),
                    x: -0.5,
                    y: 0.25,
                    facing: CompiledSocketFacing::NegativeX,
                },
                CompiledActionSocket {
                    id: "seat".to_string(),
                    x: 0.75,
                    y: -0.25,
                    facing: CompiledSocketFacing::PositiveX,
                },
                CompiledActionSocket {
                    id: "south".to_string(),
                    x: -0.25,
                    y: -0.5,
                    facing: CompiledSocketFacing::PositiveY,
                },
                CompiledActionSocket {
                    id: "north".to_string(),
                    x: 0.25,
                    y: 0.5,
                    facing: CompiledSocketFacing::NegativeY,
                },
            ]
        );
        assert_eq!(
            pack.objects[0].interactions[0].visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Read,
                anchor: CompiledVisualAnchor::ObjectSocket,
                facing: CompiledVisualFacing::Socket,
                socket: Some(1),
            }),
            "seat is deliberately index 1, so a hardcoded first socket fails"
        );
    }

    #[test]
    fn rejects_invalid_action_sockets_and_cross_object_lookup() {
        let compile_one = |object| {
            compile_objects(
                full_needs(),
                ObjectsFile {
                    object: vec![object],
                },
            )
        };

        let mut object = reading_object();
        object.action_socket[0].id = "  ".to_string();
        assert_eq!(
            compile_one(object).unwrap_err(),
            ContentError::EmptyActionSocketId {
                object: "reading_chair".to_string(),
            }
        );

        let mut object = reading_object();
        object.action_socket[0].id = "seat".to_string();
        assert_eq!(
            compile_one(object).unwrap_err(),
            ContentError::DuplicateActionSocketId {
                object: "reading_chair".to_string(),
                socket: "seat".to_string(),
            }
        );

        let mut object = reading_object();
        object.action_socket[1].facing = "SSE".to_string();
        assert_eq!(
            compile_one(object).unwrap_err(),
            ContentError::UnknownActionSocketFacing {
                object: "reading_chair".to_string(),
                socket: "seat".to_string(),
                facing: "SSE".to_string(),
            }
        );

        for (axis, mutate) in [
            (
                "x",
                (|socket: &mut ActionSocketDef| socket.x = f32::NAN) as fn(&mut ActionSocketDef),
            ),
            ("y", |socket: &mut ActionSocketDef| socket.y = f32::INFINITY),
        ] {
            let mut object = reading_object();
            mutate(&mut object.action_socket[1]);
            assert_eq!(
                compile_one(object).unwrap_err(),
                ContentError::NonFiniteValue {
                    context: format!("{axis} on action socket 'seat' of 'reading_chair'"),
                }
            );
        }

        let mut object = reading_object();
        object.action_socket[1].x = 2.0;
        assert_eq!(
            compile_one(object).unwrap_err(),
            ContentError::ActionSocketOutsideFootprint {
                object: "reading_chair".to_string(),
                socket: "seat".to_string(),
                x: 3.0,
                y: 0.75,
            }
        );

        for (axis, mutate, x, y) in [
            (
                "x",
                (|socket: &mut ActionSocketDef| socket.x = -1.25) as fn(&mut ActionSocketDef),
                -0.25,
                0.75,
            ),
            (
                "y",
                (|socket: &mut ActionSocketDef| socket.y = -1.25) as fn(&mut ActionSocketDef),
                1.75,
                -0.25,
            ),
        ] {
            let mut object = reading_object();
            mutate(&mut object.action_socket[1]);
            assert_eq!(
                compile_one(object).unwrap_err(),
                ContentError::ActionSocketOutsideFootprint {
                    object: "reading_chair".to_string(),
                    socket: "seat".to_string(),
                    x,
                    y,
                },
                "negative {axis} alone must place the socket outside the footprint"
            );
        }

        let mut donor = reading_object();
        donor.id = "donor_chair".to_string();
        donor.sprite = "bed_art".to_string();
        donor.interaction[0].visual = None;
        let mut reader = reading_object();
        reader.action_socket.clear();
        assert_eq!(
            compile_objects(
                full_needs(),
                ObjectsFile {
                    object: vec![donor, reader],
                }
            )
            .unwrap_err(),
            ContentError::UnknownVisualSocket {
                owner: "reading_chair".to_string(),
                interaction: "settle_in".to_string(),
                socket: "seat".to_string(),
            },
            "a socket on another object must not satisfy this visual"
        );
    }

    #[test]
    fn rejects_missing_mixed_cross_owner_and_surplus_read_fields() {
        let sockets = vec![CompiledActionSocket {
            id: "seat".to_string(),
            x: 0.0,
            y: 0.0,
            facing: CompiledSocketFacing::PositiveX,
        }];
        let authored = |action: &str, anchor: &str, facing: &str, socket: Option<&str>| VisualDef {
            action: Some(action.to_string()),
            anchor: Some(anchor.to_string()),
            facing: Some(facing.to_string()),
            socket: socket.map(str::to_string),
        };
        let object_owner = VisualOwner::Object {
            object: "reading_chair",
            interaction: "settle_in",
        };

        assert_eq!(
            compile_visual(
                Some(&authored("read", "object_socket", "socket", None)),
                object_owner,
                &sockets,
            )
            .unwrap_err(),
            ContentError::IncompleteVisual {
                owner: "reading_chair".to_string(),
                interaction: "settle_in".to_string(),
                field: "socket",
            }
        );

        for visual in [
            authored("read", "object", "socket", Some("seat")),
            authored("read", "object_socket", "toward_anchor", Some("seat")),
            authored("read", "object", "toward_anchor", Some("seat")),
            authored("eat", "object", "toward_anchor", Some("seat")),
        ] {
            assert!(matches!(
                compile_visual(Some(&visual), object_owner, &sockets),
                Err(ContentError::InvalidVisualContract { .. })
            ));
        }

        let social_owner = VisualOwner::Social {
            interaction: "chat",
        };
        let chain_owner = VisualOwner::ChainStep {
            chain: "cook_dinner",
            step: 2,
        };
        let read = authored("read", "object_socket", "socket", Some("seat"));
        assert!(matches!(
            compile_visual(Some(&read), social_owner, &sockets),
            Err(ContentError::InvalidVisualContract { .. })
        ));
        assert!(matches!(
            compile_visual(Some(&read), chain_owner, &sockets),
            Err(ContentError::InvalidVisualContract { .. })
        ));

        let standing_read = authored("read", "object", "toward_anchor", None);
        assert!(matches!(
            compile_visual(Some(&standing_read), social_owner, &sockets),
            Err(ContentError::InvalidVisualContract { .. })
        ));
        assert!(matches!(
            compile_visual(Some(&standing_read), chain_owner, &sockets),
            Err(ContentError::InvalidVisualContract { .. })
        ));
    }

    #[test]
    fn socket_facing_rotation_covers_every_source_and_placement_facing() {
        use CompiledSocketFacing::{NegativeX, NegativeY, PositiveX, PositiveY};

        for (source, expected) in [
            (PositiveX, [PositiveX, PositiveY, NegativeX, NegativeY]),
            (NegativeX, [NegativeX, NegativeY, PositiveX, PositiveY]),
            (PositiveY, [PositiveY, NegativeX, NegativeY, PositiveX]),
            (NegativeY, [NegativeY, PositiveX, PositiveY, NegativeX]),
        ] {
            for (placement, expected) in ["SE", "SW", "NW", "NE"].into_iter().zip(expected) {
                assert_eq!(
                    resolve_socket_facing(source, placement),
                    expected,
                    "source {source:?} rotated by placement {placement}"
                );
            }
        }
    }

    #[test]
    fn placement_facing_rotates_both_socket_axes_and_socket_facing() {
        let atlas = || AtlasFile {
            sprite: [
                "fridge_art",
                "fridge_artSW",
                "fridge_artNW",
                "fridge_artNE",
                SIM_SPRITE,
            ]
            .iter()
            .map(|name| AtlasSpriteDef {
                name: (*name).to_string(),
            })
            .collect(),
        };

        for (placement_facing, expected) in [
            (None, (2.75, 1.75, CompiledSocketFacing::PositiveX)),
            (Some("SW"), (2.25, 2.75, CompiledSocketFacing::PositiveY)),
            (Some("NW"), (1.25, 2.25, CompiledSocketFacing::NegativeX)),
            (Some("NE"), (1.75, 1.25, CompiledSocketFacing::NegativeY)),
        ] {
            let mut lot = lot_of(6, 6, &[], &[("reading_chair", 1.0, 1.0)]);
            lot.place[0].facing = placement_facing.map(str::to_string);
            let pack = compile_bare(
                full_needs(),
                ObjectsFile {
                    object: vec![reading_object()],
                },
                lot,
                atlas(),
                full_tuning(),
            )
            .expect("the rotated socket remains inside its placement");
            let socket = &pack.lot.placements[0].action_sockets[1];
            assert_eq!((socket.x, socket.y, socket.facing), expected);
        }
    }

    #[test]
    fn rejects_a_socket_inside_before_rotation_but_outside_the_rotated_non_square_footprint() {
        let mut object = reading_object();
        object.footprint = Footprint { width: 3, depth: 1 };
        object.action_socket = vec![ActionSocketDef {
            id: "seat".to_string(),
            x: 1.0,
            y: 0.25,
            facing: "SE".to_string(),
        }];

        let mut lot = lot_of(6, 4, &[], &[("reading_chair", 1.0, 1.0)]);
        lot.place[0].facing = Some("SW".to_string());
        let atlas = AtlasFile {
            sprite: ["fridge_art", "fridge_artSW", SIM_SPRITE]
                .iter()
                .map(|name| AtlasSpriteDef {
                    name: (*name).to_string(),
                })
                .collect(),
        };

        assert_eq!(
            compile_bare(
                full_needs(),
                ObjectsFile {
                    object: vec![object],
                },
                lot,
                atlas,
                full_tuning(),
            )
            .unwrap_err(),
            ContentError::ActionSocketOutsideFootprint {
                object: "reading_chair".to_string(),
                socket: "seat".to_string(),
                x: 1.75,
                y: 2.0,
            },
            "the unrotated socket is inside 3x1; SW rotation moves it beyond the depth-1 placement"
        );

        let mut object = reading_object();
        object.footprint = Footprint { width: 3, depth: 1 };
        object.action_socket = vec![ActionSocketDef {
            id: "seat".to_string(),
            x: 1.0,
            y: 0.25,
            facing: "SE".to_string(),
        }];
        let mut lot = lot_of(6, 4, &[], &[("reading_chair", 1.0, 1.0)]);
        lot.place[0].facing = Some("NE".to_string());
        let atlas = AtlasFile {
            sprite: ["fridge_art", "fridge_artNE", SIM_SPRITE]
                .iter()
                .map(|name| AtlasSpriteDef {
                    name: (*name).to_string(),
                })
                .collect(),
        };
        assert_eq!(
            compile_bare(
                full_needs(),
                ObjectsFile {
                    object: vec![object],
                },
                lot,
                atlas,
                full_tuning(),
            )
            .unwrap_err(),
            ContentError::ActionSocketOutsideFootprint {
                object: "reading_chair".to_string(),
                socket: "seat".to_string(),
                x: 2.25,
                y: 0.0,
            },
            "the unrotated socket is inside 3x1; NE rotation moves it below the depth-1 placement"
        );
    }

    /// One rejection test per rule, each pinning its own error variant so
    /// a mistake in social.toml is reported against social.toml - the
    /// same per-file-variant argument compile_household's tests make.
    #[test]
    fn rejects_social_content_that_breaks_each_rule() {
        let chat = |mutate: fn(&mut InteractionDef)| {
            let mut act = InteractionDef {
                tags: vec![],
                satisfaction: 0.0,
                visual: None,
                id: "chat".into(),
                label: None,
                advertises: [("social".to_string(), 30.0)].into_iter().collect(),
                duration_ticks: 40,
                slots: 2,
            };
            mutate(&mut act);
            act
        };

        assert_eq!(
            compile_bare_with_social(vec![chat(|_| {}), chat(|_| {})]).unwrap_err(),
            ContentError::DuplicateSocialInteraction { id: "chat".into() }
        );
        assert_eq!(
            compile_bare_with_social(vec![chat(|a| a.duration_ticks = 0)]).unwrap_err(),
            ContentError::SocialZeroDuration {
                interaction: "chat".into()
            }
        );
        assert_eq!(
            compile_bare_with_social(vec![chat(|a| a.slots = 0)]).unwrap_err(),
            ContentError::SocialZeroSlots {
                interaction: "chat".into()
            }
        );
        assert_eq!(
            compile_bare_with_social(vec![chat(|a| a.label = Some("  ".into()))]).unwrap_err(),
            ContentError::SocialEmptyLabel {
                interaction: "chat".into()
            }
        );
        assert_eq!(
            compile_bare_with_social(vec![chat(|a| {
                a.advertises = [("charisma".to_string(), 5.0)].into_iter().collect();
            })])
            .unwrap_err(),
            ContentError::SocialUnknownNeed {
                interaction: "chat".into(),
                need: "charisma".into()
            }
        );
        assert_eq!(
            compile_bare_with_social(vec![chat(|a| {
                a.advertises = [("social".to_string(), f32::NAN)].into_iter().collect();
            })])
            .unwrap_err(),
            ContentError::NonFiniteValue {
                context: "advert 'social' on social 'chat'".into()
            }
        );
    }

    /// The clipped-duration rule applies to a talk exactly as it applies
    /// to a shower, with the same div-ceil boundary: `full_tuning` has a
    /// floor of 3 and a variance of 0.75, so anything under
    /// ceil(3 / 0.25) = 12 is clipped and 12 itself is legal.
    #[test]
    fn rejects_a_social_interaction_the_duration_floor_would_clip() {
        let talk = |duration_ticks| InteractionDef {
            tags: vec![],
            satisfaction: 0.0,
            visual: None,
            id: "chat".into(),
            label: None,
            advertises: [("social".to_string(), 30.0)].into_iter().collect(),
            duration_ticks,
            slots: 2,
        };

        assert_eq!(
            compile_bare_with_social(vec![talk(11)]).unwrap_err(),
            ContentError::ClippedSocialDuration {
                interaction: "chat".into(),
                duration_ticks: 11,
                minimum: 12,
                floor: 3,
                variance: 0.75
            }
        );
        assert!(
            compile_bare_with_social(vec![talk(12)]).is_ok(),
            "the smallest unclipped duration must compile, or the boundary is off by one on the safe-looking side"
        );
    }

    /// The [A-11] facing pipeline: a placement's `facing` resolves at
    /// compile time to a directional sprite variant by name suffix, and
    /// both ways it can be wrong are its OWN errors so lot.toml is
    /// blamed with the exact missing import named.
    #[test]
    fn a_placement_facing_resolves_a_sprite_variant_or_fails_by_name() {
        let atlas = || AtlasFile {
            sprite: ["couch_art", SIM_SPRITE, "fridge_art", "fridge_artSW"]
                .iter()
                .map(|name| AtlasSpriteDef {
                    name: (*name).to_string(),
                })
                .collect(),
        };
        let compile_facing = |facing: Option<&str>| {
            let mut lot = lot_of(4, 3, &[], &[("fridge", 2.0, 1.0)]);
            lot.place[0].facing = facing.map(str::to_string);
            compile(
                full_needs(),
                one_object(snack()),
                lot,
                atlas(),
                full_tuning(),
                PersonalitiesFile { archetype: vec![] },
                HouseholdFile { sim: vec![] },
                SocialFile {
                    interaction: vec![],
                },
                TraitsFile { trait_def: vec![] },
                CareersFile { career: vec![] },
                ChainsFile { chain: vec![] },
            )
        };

        // Resolved: the SW variant's own index, not the definition's.
        let pack = compile_facing(Some("SW")).expect("an imported facing compiles");
        assert_eq!(
            pack.lot.placements[0].sprite, 3,
            "the placement must carry fridge_artSW's index"
        );
        assert_eq!(
            pack.objects[0].sprite, 2,
            "the object definition keeps its own plain sprite"
        );

        // Absent or SE: the definition's sprite, which is the SE facing.
        let pack = compile_facing(None).expect("no facing is the old world");
        assert_eq!(pack.lot.placements[0].sprite, 2);
        let pack = compile_facing(Some("SE")).expect("SE is the unsuffixed sprite");
        assert_eq!(pack.lot.placements[0].sprite, 2);

        // A typo'd facing is a typo, not a missing import.
        assert_eq!(
            compile_facing(Some("SSW")).unwrap_err(),
            ContentError::UnknownFacing {
                object: "fridge".into(),
                facing: "SSW".into()
            }
        );

        // A legal facing nobody imported names the exact atlas entry to
        // add.
        assert_eq!(
            compile_facing(Some("NE")).unwrap_err(),
            ContentError::FacingSpriteMissing {
                object: "fridge".into(),
                facing: "NE".into(),
                sprite: "fridge_artNE".into()
            }
        );
    }

    // ---- Chains ---------------------------------------------------------

    /// A world with two placed stations for the chain tests: the fridge
    /// wearing cold_storage and the sink wearing eating_surface, both
    /// on a 5x3 lot. The sink doubles as a station on purpose - roles
    /// are facts about placements, not about what an object is for.
    fn compile_chain_world(
        chain: Vec<crate::schema::ChainDef>,
    ) -> Result<ContentPack, ContentError> {
        let mut fridge = one_object(snack()).object.remove(0);
        fridge.roles = vec!["cold_storage".to_string()];
        let sink = ObjectDef {
            roles: vec!["eating_surface".to_string()],
            action_socket: vec![],
            id: "sink".into(),
            name: "Sink".into(),
            sprite: "sink_art".into(),
            footprint: Footprint::SINGLE,
            interaction: vec![],
        };
        compile(
            full_needs(),
            ObjectsFile {
                object: vec![fridge, sink],
            },
            lot_of(5, 3, &[], &[("fridge", 1.0, 1.0), ("sink", 3.0, 1.0)]),
            test_atlas(),
            full_tuning(),
            PersonalitiesFile { archetype: vec![] },
            HouseholdFile { sim: vec![] },
            SocialFile {
                interaction: vec![],
            },
            TraitsFile { trait_def: vec![] },
            CareersFile { career: vec![] },
            ChainsFile { chain },
        )
    }

    /// A two-step chain that passes every rule against the world above,
    /// with pairwise distinct numbers ([L34]).
    fn a_chain(id: &str) -> crate::schema::ChainDef {
        crate::schema::ChainDef {
            id: id.to_string(),
            label: format!("The {id} errand"),
            advertised_by: "fridge".to_string(),
            advertises: [("hunger".to_string(), 41.0)].into_iter().collect(),
            satisfaction: 2.75,
            step: vec![
                crate::schema::ChainStepDef {
                    role: "cold_storage".to_string(),
                    label: "Fetch".to_string(),
                    duration_ticks: 17,
                    tags: vec![],
                    yields: Some("leftovers".to_string()),
                    transforms: None,
                    consumes: None,
                    visual: None,
                },
                crate::schema::ChainStepDef {
                    role: "eating_surface".to_string(),
                    label: "Eat".to_string(),
                    duration_ticks: 23,
                    tags: vec!["snacking".to_string()],
                    yields: None,
                    transforms: None,
                    consumes: Some("leftovers".to_string()),
                    visual: Some(VisualDef {
                        action: Some("eat".to_string()),
                        anchor: Some("station".to_string()),
                        facing: Some("toward_anchor".to_string()),
                        socket: None,
                    }),
                },
            ],
        }
    }

    /// The accepting half: every compiled field read back, against a
    /// chain whose steps sit at DIFFERENT roles and whose transform's
    /// halves differ, so nothing is interchangeable ([L34]). The item
    /// vocabulary asserts MINTING order - first appearance, not
    /// alphabetical.
    #[test]
    fn compiles_a_chain_and_mints_its_vocabularies() {
        let mut chain = a_chain("cook_dinner");
        chain.step.insert(
            1,
            crate::schema::ChainStepDef {
                role: "eating_surface".to_string(),
                label: "Warm through".to_string(),
                duration_ticks: 31,
                tags: vec!["cooking".to_string()],
                yields: None,
                transforms: Some(crate::schema::TransformDef {
                    from: "leftovers".to_string(),
                    to: "dinner".to_string(),
                }),
                consumes: None,
                visual: None,
            },
        );
        chain.step[2].consumes = Some("dinner".to_string());

        let pack = compile_chain_world(vec![chain]).expect("a valid chain compiles");

        assert_eq!(
            pack.roles,
            vec!["cold_storage".to_string(), "eating_surface".to_string()],
            "the vocabulary is minted in object-declaration order"
        );
        assert_eq!(pack.objects[0].roles, vec![0], "the fridge wears index 0");
        assert_eq!(pack.objects[1].roles, vec![1]);
        assert_eq!(
            pack.item_kinds,
            vec!["leftovers".to_string(), "dinner".to_string()],
            "item kinds mint at first appearance"
        );

        let chain = &pack.chains[0];
        assert_eq!(chain.id, "cook_dinner");
        assert_eq!(chain.label, "The cook_dinner errand");
        assert_eq!(chain.advertised_by, ObjectDefId(0));
        assert_eq!(chain.advertises, vec![(0, 41.0)]);
        assert_eq!(chain.satisfaction, 2.75);
        assert_eq!(chain.steps.len(), 3);
        assert_eq!(
            (chain.steps[0].role, chain.steps[0].duration_ticks),
            (0, 17)
        );
        assert_eq!(chain.steps[0].yields, Some(0));
        assert_eq!(chain.steps[1].transforms, Some((0, 1)));
        assert_eq!(chain.steps[1].tags, vec!["cooking".to_string()]);
        assert_eq!(chain.steps[2].consumes, Some(1));
        assert_eq!(chain.steps[2].label, "Eat");
        assert_eq!(chain.steps[0].visual, None);
        assert_eq!(chain.steps[1].visual, None);
        assert_eq!(
            chain.steps[2].visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Eat,
                anchor: CompiledVisualAnchor::Station,
                facing: CompiledVisualFacing::TowardAnchor,
                socket: None,
            })
        );
    }

    /// Chain-step diagnostics name the chain and zero-based step rather than
    /// pretending the presentation contract belongs to an object interaction.
    #[test]
    fn rejects_incomplete_and_unknown_chain_step_visuals() {
        let visual = |action: Option<&str>, anchor: Option<&str>, facing: Option<&str>| {
            Some(VisualDef {
                action: action.map(str::to_string),
                anchor: anchor.map(str::to_string),
                facing: facing.map(str::to_string),
                socket: None,
            })
        };

        for (field, authored) in [
            (
                "action",
                visual(None, Some("station"), Some("toward_anchor")),
            ),
            ("anchor", visual(Some("eat"), None, Some("toward_anchor"))),
            ("facing", visual(Some("eat"), Some("station"), None)),
        ] {
            let mut chain = a_chain("cook_dinner");
            chain.step[1].visual = authored;
            let error = compile_chain_world(vec![chain]).unwrap_err();
            assert_eq!(
                error,
                ContentError::IncompleteChainStepVisual {
                    chain: "cook_dinner".to_string(),
                    step: 1,
                    field,
                }
            );
            assert!(
                error
                    .to_string()
                    .contains("object-socket read or exercise also requires socket"),
                "chain-step diagnostics must name the complete socket requirement"
            );
        }

        let mut chain = a_chain("cook_dinner");
        chain.step[1].visual = visual(Some("dance"), Some("station"), Some("toward_anchor"));
        let error = compile_chain_world(vec![chain]).unwrap_err();
        assert_eq!(
            error,
            ContentError::UnknownChainStepVisualAction {
                chain: "cook_dinner".to_string(),
                step: 1,
                action: "dance".to_string(),
            }
        );
        assert!(
            error
                .to_string()
                .contains("talk, eat, read, exercise, watch"),
            "chain-step diagnostics must name the complete action vocabulary"
        );

        let mut chain = a_chain("cook_dinner");
        chain.step[1].visual = visual(Some("eat"), Some("moon"), Some("toward_anchor"));
        assert_eq!(
            compile_chain_world(vec![chain]).unwrap_err(),
            ContentError::UnknownChainStepVisualAnchor {
                chain: "cook_dinner".to_string(),
                step: 1,
                anchor: "moon".to_string(),
            }
        );

        let mut chain = a_chain("cook_dinner");
        chain.step[1].visual = visual(Some("eat"), Some("station"), Some("away_from_anchor"));
        assert_eq!(
            compile_chain_world(vec![chain]).unwrap_err(),
            ContentError::UnknownChainStepVisualFacing {
                chain: "cook_dinner".to_string(),
                step: 1,
                facing: "away_from_anchor".to_string(),
            }
        );
    }

    /// Every per-chain shape rule, one rejection each.
    #[test]
    fn rejects_malformed_chains() {
        assert_eq!(
            compile_chain_world(vec![a_chain("dup"), a_chain("dup")]).unwrap_err(),
            ContentError::DuplicateChain { id: "dup".into() }
        );

        let mut blank = a_chain("blank");
        blank.label = "  ".to_string();
        assert_eq!(
            compile_chain_world(vec![blank]).unwrap_err(),
            ContentError::EmptyChainLabel { id: "blank".into() }
        );

        let mut lost = a_chain("lost");
        lost.advertised_by = "microwave".to_string();
        assert_eq!(
            compile_chain_world(vec![lost]).unwrap_err(),
            ContentError::UnknownChainAdvertiser {
                chain: "lost".into(),
                object: "microwave".into()
            }
        );

        let mut hollow = a_chain("hollow");
        hollow.step.clear();
        assert_eq!(
            compile_chain_world(vec![hollow]).unwrap_err(),
            ContentError::EmptyChain {
                id: "hollow".into()
            }
        );

        let mut moxie = a_chain("moxie");
        moxie.advertises.insert("moxie".to_string(), 1.0);
        assert_eq!(
            compile_chain_world(vec![moxie]).unwrap_err(),
            ContentError::UnknownChainNeed {
                chain: "moxie".into(),
                need: "moxie".into()
            }
        );

        // The satisfaction sign, from both sides: negative rejected
        // (content can never write the second axis downward, [S1]) and
        // exactly zero accepted - a chore chain is legal - separating
        // `<` from `<=`.
        let mut drain = a_chain("drain");
        drain.satisfaction = -0.25;
        assert!(matches!(
            compile_chain_world(vec![drain]).unwrap_err(),
            ContentError::NegativeValue { .. }
        ));
        let mut chore = a_chain("chore");
        chore.satisfaction = 0.0;
        assert!(
            compile_chain_world(vec![chore]).is_ok(),
            "a chain that means nothing is legal content"
        );
    }

    /// Every per-step rule, one rejection each - and the clipped
    /// duration rule applies to steps exactly as it does to
    /// interactions, for the same three silent failures.
    #[test]
    fn rejects_malformed_chain_steps() {
        let mut blank = a_chain("blank_step");
        blank.step[1].label = " ".to_string();
        assert_eq!(
            compile_chain_world(vec![blank]).unwrap_err(),
            ContentError::EmptyChainStepLabel {
                chain: "blank_step".into(),
                step: 1
            }
        );

        let mut zero = a_chain("zero_step");
        zero.step[0].duration_ticks = 0;
        assert_eq!(
            compile_chain_world(vec![zero]).unwrap_err(),
            ContentError::ZeroChainStepDuration {
                chain: "zero_step".into(),
                step: 0
            }
        );

        // full_tuning: floor 3, variance 0.75, so the smallest legal
        // duration is ceil(3 / 0.25) = 12 and 11 clips. The FULL
        // variant is asserted, not a matches!: `minimum` is derived
        // arithmetic the author has to act on, and the sweep proved a
        // shape-only assertion leaves every operator in it free.
        let mut clipped = a_chain("clipped");
        clipped.step[0].duration_ticks = 11;
        assert_eq!(
            compile_chain_world(vec![clipped]).unwrap_err(),
            ContentError::ClippedChainStepDuration {
                chain: "clipped".into(),
                step: 0,
                duration_ticks: 11,
                minimum: 12,
                floor: 3,
                variance: 0.75
            }
        );

        // The blank-kind rule, on every field that names one.
        for which in ["yields", "from", "to", "consumes"] {
            let mut blank = a_chain("blank_kind");
            match which {
                "yields" => blank.step[0].yields = Some("  ".to_string()),
                "consumes" => blank.step[1].consumes = Some(" ".to_string()),
                from_or_to => {
                    blank.step[1].consumes = None;
                    blank.step[1].transforms = Some(crate::schema::TransformDef {
                        from: if from_or_to == "from" {
                            " "
                        } else {
                            "leftovers"
                        }
                        .to_string(),
                        to: if from_or_to == "to" { " " } else { "dinner" }.to_string(),
                    });
                }
            }
            let err = compile_chain_world(vec![blank]).unwrap_err();
            assert!(
                matches!(err, ContentError::EmptyChainItemKind { .. }),
                "a blank {which} must reject as a blank kind; got {err}"
            );
        }

        let mut tagless = a_chain("blank_tag");
        tagless.step[1].tags = vec!["".to_string()];
        assert_eq!(
            compile_chain_world(vec![tagless]).unwrap_err(),
            ContentError::EmptyChainStepTag {
                chain: "blank_tag".into(),
                step: 1
            }
        );

        let mut nowhere = a_chain("nowhere");
        nowhere.step[1].role = "operating_theatre".to_string();
        assert_eq!(
            compile_chain_world(vec![nowhere]).unwrap_err(),
            ContentError::UnknownChainRole {
                chain: "nowhere".into(),
                step: 1,
                role: "operating_theatre".into()
            }
        );
    }

    /// The coverage rule: a role somebody DECLARES but nobody PLACES is
    /// its own error, distinct from a typo - a kitchen with no stove,
    /// not a misspelled stove. The fixture places only the fridge, so
    /// the sink's eating_surface exists in the vocabulary and stands
    /// nowhere.
    #[test]
    fn rejects_a_chain_whose_station_is_declared_but_not_placed() {
        let mut fridge = one_object(snack()).object.remove(0);
        fridge.roles = vec!["cold_storage".to_string()];
        let sink = ObjectDef {
            roles: vec!["eating_surface".to_string()],
            action_socket: vec![],
            id: "sink".into(),
            name: "Sink".into(),
            sprite: "sink_art".into(),
            footprint: Footprint::SINGLE,
            interaction: vec![],
        };
        let err = compile(
            full_needs(),
            ObjectsFile {
                object: vec![fridge, sink],
            },
            lot_of(5, 3, &[], &[("fridge", 1.0, 1.0)]),
            test_atlas(),
            full_tuning(),
            PersonalitiesFile { archetype: vec![] },
            HouseholdFile { sim: vec![] },
            SocialFile {
                interaction: vec![],
            },
            TraitsFile { trait_def: vec![] },
            CareersFile { career: vec![] },
            ChainsFile {
                chain: vec![a_chain("dinner")],
            },
        )
        .unwrap_err();
        assert_eq!(
            err,
            ContentError::UnstationedChainRole {
                chain: "dinner".into(),
                step: 1,
                role: "eating_surface".into()
            }
        );
    }

    /// The hands rule, every way it can be wrong: yielding into a full
    /// hand, transforming or consuming what is not carried, two hand
    /// operations on one step, and a chain that ends still carrying.
    #[test]
    fn rejects_chains_whose_hands_do_not_add_up() {
        let mut full = a_chain("full_hands");
        full.step[1].yields = Some("seconds".to_string());
        full.step[1].consumes = None;
        assert!(matches!(
            compile_chain_world(vec![full]).unwrap_err(),
            ContentError::ChainHandsMismatch { chain, step: 1, .. } if chain == "full_hands"
        ));

        let mut wrong_from = a_chain("wrong_from");
        wrong_from.step[1].consumes = None;
        wrong_from.step[1].transforms = Some(crate::schema::TransformDef {
            from: "soup".to_string(),
            to: "dinner".to_string(),
        });
        assert!(matches!(
            compile_chain_world(vec![wrong_from]).unwrap_err(),
            ContentError::ChainHandsMismatch { chain, step: 1, .. } if chain == "wrong_from"
        ));

        let mut wrong_eat = a_chain("wrong_eat");
        wrong_eat.step[1].consumes = Some("soup".to_string());
        assert!(matches!(
            compile_chain_world(vec![wrong_eat]).unwrap_err(),
            ContentError::ChainHandsMismatch { chain, step: 1, .. } if chain == "wrong_eat"
        ));

        let mut greedy = a_chain("greedy");
        greedy.step[0].consumes = Some("leftovers".to_string());
        assert!(matches!(
            compile_chain_world(vec![greedy]).unwrap_err(),
            ContentError::ChainHandsMismatch { chain, step: 0, .. } if chain == "greedy"
        ));

        let mut hoarder = a_chain("hoarder");
        hoarder.step[1].consumes = None;
        assert_eq!(
            compile_chain_world(vec![hoarder]).unwrap_err(),
            ContentError::ChainEndsCarrying {
                chain: "hoarder".into(),
                item: "leftovers".into()
            }
        );
    }

    /// The role rules on OBJECTS: blank and repeated roles reject, from
    /// both sides - two different roles on one object are an outfit.
    #[test]
    fn rejects_blank_and_repeated_object_roles() {
        let with_roles = |roles: Vec<&str>| {
            let mut fridge = one_object(snack()).object.remove(0);
            fridge.roles = roles.into_iter().map(str::to_string).collect();
            compile_objects(
                full_needs(),
                ObjectsFile {
                    object: vec![fridge],
                },
            )
        };
        assert_eq!(
            with_roles(vec![" "]).unwrap_err(),
            ContentError::EmptyObjectRole {
                object: "fridge".into()
            }
        );
        assert_eq!(
            with_roles(vec!["hob", "hob"]).unwrap_err(),
            ContentError::DuplicateObjectRole {
                object: "fridge".into(),
                role: "hob".into()
            }
        );
        assert!(
            with_roles(vec!["hob", "cold_storage"]).is_ok(),
            "two different roles are an outfit, not a duplicate"
        );
    }

    /// Everything social tests compile through: the bare fixtures plus
    /// the given vocabulary.
    fn compile_bare_with_social(
        interaction: Vec<InteractionDef>,
    ) -> Result<ContentPack, ContentError> {
        compile(
            full_needs(),
            one_object(snack()),
            bare_lot(),
            test_atlas(),
            full_tuning(),
            PersonalitiesFile { archetype: vec![] },
            HouseholdFile { sim: vec![] },
            SocialFile { interaction },
            TraitsFile { trait_def: vec![] },
            CareersFile { career: vec![] },
            ChainsFile { chain: vec![] },
        )
    }
}
