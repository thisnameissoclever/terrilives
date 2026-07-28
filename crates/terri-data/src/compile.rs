//! Validation, and the compilation of validated content into a pack.
//!
//! Every failure mode in this module is a build failure by design. The
//! checks live here rather than in the schema because serde can express
//! shape but not meaning: "this need name is one rustc knows about" and
//! "every `NeedId` appears exactly once" are not shapes.

use crate::error::ContentError;
use crate::pack::{CompiledInteraction, CompiledObject, ContentPack};
use crate::schema::{NeedsFile, ObjectsFile};
use std::collections::BTreeSet;
use terri_core::{NeedId, NEED_COUNT};

/// Rejects the two ways an authored number is meaningless rather than
/// merely wrong. `NaN` is the dangerous one: it propagates silently
/// through the scoring arithmetic instead of failing anywhere near the
/// content that produced it.
fn check_number(value: f32, context: &str) -> Result<(), ContentError> {
    if !value.is_finite() {
        return Err(ContentError::NonFiniteValue {
            context: context.to_string(),
        });
    }
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
pub fn compile(needs: NeedsFile, objects: ObjectsFile) -> Result<ContentPack, ContentError> {
    let mut decay = [f32::NAN; NEED_COUNT];
    // A fixed-size array rather than a set: `NeedId` is `Eq + Hash` but
    // not `Ord`, and the need space is closed and small, so indexing it
    // directly needs no allocation and no ordering it does not have.
    let mut seen_needs = [false; NEED_COUNT];

    for def in &needs.need {
        let Some(id) = NeedId::from_name(&def.id) else {
            return Err(ContentError::UnknownNeedDecay {
                need: def.id.clone(),
            });
        };
        if seen_needs[id.index()] {
            return Err(ContentError::DuplicateNeedDecay {
                need: def.id.clone(),
            });
        }
        seen_needs[id.index()] = true;
        check_number(
            def.decay_per_tick,
            &format!("decay_per_tick for '{}'", def.id),
        )?;
        decay[id.index()] = def.decay_per_tick;
    }

    // Without this loop a need omitted from the file keeps the `NaN`
    // seeded above, and a `NaN` decay rate poisons that need's level on
    // the first tick with nothing pointing back at the content.
    for id in NeedId::ALL {
        if !seen_needs[id.index()] {
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
                check_number(*delta, &format!("advert '{}' on '{}'", need_name, act.id))?;
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
            interactions,
        });
    }

    Ok(ContentPack {
        decay_per_tick: decay,
        objects: compiled,
    })
}

#[cfg(test)]
mod tests {
    // `super::*` already supplies ContentError, NeedsFile, ObjectsFile,
    // NeedId and NEED_COUNT. Only the types production code does not
    // name are imported here.
    use super::*;
    use crate::pack::ObjectDefId;
    use crate::schema::{InteractionDef, NeedDef, ObjectDef};

    /// A decay rate that differs per need. `0.1` everywhere would let a
    /// compile step that wrote every rate into slot 0 pass unnoticed.
    fn distinct_decay(id: NeedId) -> f32 {
        (id.index() as f32 + 1.0) / 10.0
    }

    /// Regenerated only when the pack format changes on purpose. See
    /// `a_compiled_pack_serialises_to_a_stable_golden_vector`.
    ///
    /// Annotated because an opaque byte blob is a vector nobody can
    /// review. The two annotations that matter are the decay block,
    /// which is in index order while the fixture declares it in reverse,
    /// and the advert block, which is in index order while the fixture's
    /// map iterates it by name.
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
        0x01, // interactions: 1
        0x0A, b'g', b'r', b'a', b'b', b'_', b's', b'n', b'a', b'c', b'k',
        0x03, // advertises: 3, index-ordered
        0x00, 0x00, 0x00, 0x0C, 0x42, // hunger  35.0
        0x01, 0x00, 0x00, 0x40, 0x40, // energy   3.0
        0x06, 0x00, 0x00, 0xA0, 0x40, // comfort  5.0
        0x0F, // duration_ticks: 15
        0x01, // slots: 1
    ];

    fn full_needs() -> NeedsFile {
        NeedsFile {
            need: NeedId::ALL
                .iter()
                .map(|id| NeedDef {
                    id: id.as_str().to_string(),
                    decay_per_tick: 0.1,
                })
                .collect(),
        }
    }

    fn one_object(interaction: InteractionDef) -> ObjectsFile {
        ObjectsFile {
            object: vec![ObjectDef {
                id: "fridge".into(),
                name: "Fridge".into(),
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

    /// Every need present with its own rate, declared in reverse order
    /// so that position in the file and slot in the pack disagree.
    fn distinct_needs() -> NeedsFile {
        NeedsFile {
            need: NeedId::ALL
                .iter()
                .rev()
                .map(|id| NeedDef {
                    id: id.as_str().to_string(),
                    decay_per_tick: distinct_decay(*id),
                })
                .collect(),
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
        let pack = compile(full_needs(), one_object(snack())).expect("valid");
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

    #[test]
    fn rejects_an_advert_naming_an_unknown_need() {
        let mut act = snack();
        act.advertises.insert("vibes".into(), 1.0);
        let err = compile(full_needs(), one_object(act)).unwrap_err();
        assert_eq!(
            err,
            ContentError::UnknownNeed {
                object: "fridge".into(),
                interaction: "grab_snack".into(),
                need: "vibes".into()
            }
        );
    }

    #[test]
    fn rejects_a_missing_need_decay() {
        let mut needs = full_needs();
        needs.need.retain(|n| n.id != "comfort");
        let err = compile(needs, one_object(snack())).unwrap_err();
        assert_eq!(
            err,
            ContentError::MissingNeedDecay {
                need: "comfort".into()
            }
        );
    }

    #[test]
    fn rejects_an_unknown_need_decay() {
        let mut needs = full_needs();
        needs.need.push(NeedDef {
            id: "vibes".into(),
            decay_per_tick: 0.1,
        });
        let err = compile(needs, one_object(snack())).unwrap_err();
        assert_eq!(
            err,
            ContentError::UnknownNeedDecay {
                need: "vibes".into()
            }
        );
    }

    #[test]
    fn rejects_a_duplicate_need_decay() {
        let mut needs = full_needs();
        needs.need.push(NeedDef {
            id: "hunger".into(),
            decay_per_tick: 0.2,
        });
        let err = compile(needs, one_object(snack())).unwrap_err();
        assert_eq!(
            err,
            ContentError::DuplicateNeedDecay {
                need: "hunger".into()
            }
        );
    }

    #[test]
    fn rejects_duplicate_object_ids() {
        let mut objects = one_object(snack());
        objects.object.push(ObjectDef {
            id: "fridge".into(),
            name: "Another".into(),
            interaction: vec![],
        });
        let err = compile(full_needs(), objects).unwrap_err();
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
        let err = compile(full_needs(), objects).unwrap_err();
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
            interaction: vec![snack()],
        });
        compile(full_needs(), objects).expect("ids are scoped to their object");
    }

    #[test]
    fn rejects_zero_duration() {
        let mut act = snack();
        act.duration_ticks = 0;
        let err = compile(full_needs(), one_object(act)).unwrap_err();
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
        let err = compile(full_needs(), one_object(act)).unwrap_err();
        assert_eq!(
            err,
            ContentError::ZeroSlots {
                object: "fridge".into(),
                interaction: "grab_snack".into()
            }
        );
    }

    /// `check_number` guards two error kinds at two call sites, and the
    /// obvious version of this test covers one diagonal of that 2x2.
    /// Both off-diagonal cells are reachable mutations: replacing either
    /// call with a bespoke `value < 0.0` test would drop a finiteness
    /// check while leaving the diagonal green. All four are asserted.
    #[test]
    fn rejects_non_finite_and_negative_numbers() {
        for bad in [f32::NAN, f32::INFINITY] {
            let mut act = snack();
            act.advertises.insert("hunger".into(), bad);
            assert!(
                matches!(
                    compile(full_needs(), one_object(act)).unwrap_err(),
                    ContentError::NonFiniteValue { .. }
                ),
                "an advert of {bad} must be rejected"
            );

            let mut needs = full_needs();
            needs.need[0].decay_per_tick = bad;
            assert!(
                matches!(
                    compile(needs, one_object(snack())).unwrap_err(),
                    ContentError::NonFiniteValue { .. }
                ),
                "a decay rate of {bad} must be rejected"
            );
        }

        let mut act = snack();
        act.advertises.insert("hunger".into(), -1.0);
        assert!(matches!(
            compile(full_needs(), one_object(act)).unwrap_err(),
            ContentError::NegativeValue { .. }
        ));

        let mut needs = full_needs();
        needs.need[0].decay_per_tick = -1.0;
        assert!(matches!(
            compile(needs, one_object(snack())).unwrap_err(),
            ContentError::NegativeValue { .. }
        ));
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

        let pack = compile(full_needs(), one_object(act)).expect("valid");
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
    /// wrong slot, would leave them all green. Declaring the needs in
    /// reverse order additionally pins that the slot comes from the
    /// need's name and not from its position in the file.
    #[test]
    fn decay_rates_land_at_their_own_need_index() {
        let pack = compile(distinct_needs(), one_object(snack())).expect("valid");

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
    /// decorative: seven distinct decay rates declared in reverse, and
    /// three adverts whose name order reverses their index order.
    ///
    /// If this fails, ask which of two things happened. A deliberate
    /// change to the pack format needs the vector regenerated and every
    /// previously written pack rebuilt. Anything else is a determinism
    /// regression, and the vector is doing its job.
    #[test]
    fn a_compiled_pack_serialises_to_a_stable_golden_vector() {
        let pack = compile(
            distinct_needs(),
            one_object(snack_advertising_three_needs()),
        )
        .expect("valid");
        let bytes = postcard::to_allocvec(&pack).expect("pack must serialise");
        assert!(
            !GOLDEN_PACK_BYTES.is_empty(),
            "an emptied vector would assert nothing"
        );
        assert_eq!(bytes, GOLDEN_PACK_BYTES);
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
            compile(full_needs(), one_object(act))
                .unwrap_err()
                .to_string(),
            "object 'fridge' interaction 'grab_snack' advertises unknown need 'vibes'"
        );

        let mut act = snack();
        act.advertises.insert("hunger".into(), f32::NAN);
        assert_eq!(
            compile(full_needs(), one_object(act))
                .unwrap_err()
                .to_string(),
            "advert 'hunger' on 'grab_snack' is not a finite number"
        );

        let mut needs = full_needs();
        needs.need.retain(|n| n.id != "comfort");
        assert_eq!(
            compile(needs, one_object(snack())).unwrap_err().to_string(),
            "needs.toml is missing a decay rate for 'comfort'"
        );

        let mut needs = full_needs();
        needs.need[0].decay_per_tick = -1.0;
        assert_eq!(
            compile(needs, one_object(snack())).unwrap_err().to_string(),
            "decay_per_tick for 'hunger' is negative"
        );
    }
}
