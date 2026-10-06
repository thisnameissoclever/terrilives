//! Object affinities - `docs/specs/2026-10-06-object-affinities.md`.
//!
//! Every person holds one value per affinity kind, from -1.0 (hates) to
//! 1.0 (loves), drawn once when the person is created ([OA-values]).

use bevy_ecs::prelude::*;
use terri_core::{Affinities, Agent, SimRng, Traits};
use terri_data::{CompiledTrait, CompiledTraitKind, ContentPack};

/// A person's starting values: one uniform draw in -1.0..1.0 from `rng`
/// per kind, in kinds order - [OA-values]. A worn disposition trait whose
/// tag is a kind's trait tag replaces that kind's draw with
/// `affinity_from_trait`, or its negative, when the trait loves or hates
/// ([`trait_value`]). The draw is taken either way, so the generator
/// advances by one value per kind whatever the person wears.
pub fn draw(rng: &mut SimRng, pack: &ContentPack, worn: Option<&Traits>) -> Affinities {
    draw_with_defs(rng, pack, &pack.traits, worn)
}

/// [`draw`] with the worn indices resolved against `trait_defs` rather
/// than `pack.traits`, for `spawn_member`, which is handed the trait list
/// separately. The kinds and the tuning come from `pack`.
pub(crate) fn draw_with_defs(
    rng: &mut SimRng,
    pack: &ContentPack,
    trait_defs: &[CompiledTrait],
    worn: Option<&Traits>,
) -> Affinities {
    let values = pack
        .affinities
        .iter()
        .map(|kind| {
            let drawn = rng.next_f32() * 2.0 - 1.0;
            match (kind.trait_tag.as_deref(), worn) {
                (Some(tag), Some(worn)) => {
                    trait_value(pack, trait_defs, worn, tag).unwrap_or(drawn)
                }
                _ => drawn,
            }
        })
        .collect();
    Affinities::from_values(values)
}

/// The value a worn disposition trait with tag `tag` sets: the first such
/// trait, in worn order, whose score multiplier is at or above
/// `affinity_loves_from` gives `affinity_from_trait`, and one at or below
/// `affinity_hates_to` gives its negative. A disposition between the two
/// bands, or a trait of another kind, sets nothing.
fn trait_value(
    pack: &ContentPack,
    trait_defs: &[CompiledTrait],
    worn: &Traits,
    tag: &str,
) -> Option<f32> {
    let tuning = &pack.tuning;
    worn.entries().iter().find_map(|&(index, _)| {
        let definition = trait_defs.get(index as usize)?;
        let CompiledTraitKind::Disposition { score_multiplier } = definition.kind else {
            return None;
        };
        if definition.tag != tag {
            None
        } else if score_multiplier >= tuning.affinity_loves_from {
            Some(tuning.affinity_from_trait)
        } else if score_multiplier <= tuning.affinity_hates_to {
            Some(-tuning.affinity_from_trait)
        } else {
            None
        }
    })
}

/// Every living person's values that are not exactly 0.0, as `(entity
/// index, kind index, value)`, ascending by entity index then kind - the
/// rows of the world hash's `affinities-v1` block.
pub(crate) fn hash_rows(world: &World) -> Vec<(u32, u32, f32)> {
    let mut rows: Vec<(u32, u32, f32)> = world
        .try_query::<(Entity, &Agent, &Affinities)>()
        .map_or_else(Vec::new, |mut query| {
            query
                .iter(world)
                .flat_map(|(entity, _, affinities)| {
                    affinities
                        .values()
                        .iter()
                        .enumerate()
                        .filter(|(_, value)| **value != 0.0)
                        .map(move |(kind, &value)| (entity.index_u32(), kind as u32, value))
                })
                .collect()
        });
    rows.sort_unstable_by_key(|&(entity, kind, _)| (entity, kind));
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pack() -> &'static ContentPack {
        terri_data::pack()
    }

    fn trait_index(pack: &ContentPack, id: &str) -> u32 {
        pack.traits
            .iter()
            .position(|definition| definition.id == id)
            .unwrap_or_else(|| panic!("content has no trait {id}")) as u32
    }

    fn wearing(pack: &ContentPack, ids: &[&str]) -> Traits {
        Traits::from_entries(ids.iter().map(|id| (trait_index(pack, id), 0.0)).collect())
    }

    fn kind(pack: &ContentPack, id: &str) -> u32 {
        pack.affinities
            .iter()
            .position(|kind| kind.id == id)
            .unwrap_or_else(|| panic!("content has no affinity kind {id}")) as u32
    }

    /// The four values seed 7 gives, computed once from the generator.
    const DRAWN_FROM_SEVEN: [f32; 4] = [0.884_322_17, -0.921_606_66, -0.771_908_9, 0.968_384_27];

    /// [OA-values]: four draws from seed 7, one per shipped kind in kinds
    /// order, each `next_f32() * 2 - 1`. The literal values pin the order
    /// and the mapping; the reference generator pins that exactly four
    /// draws were taken.
    #[test]
    fn draw_takes_one_value_per_kind_in_order_and_clamps_to_the_unit_range() {
        let pack = pack();
        assert_eq!(pack.affinities.len(), 4, "the shipped kinds");
        let mut rng = SimRng::from_seed(7);
        let drawn = draw(&mut rng, pack, None);
        let mut reference = SimRng::from_seed(7);
        let expected: Vec<f32> = (0..4).map(|_| reference.next_f32() * 2.0 - 1.0).collect();
        assert_eq!(drawn.values(), expected.as_slice());
        assert_eq!(drawn.values(), &DRAWN_FROM_SEVEN);
        assert!(drawn.values().iter().all(|v| (-1.0..=1.0).contains(v)));
        assert!(
            drawn.values().windows(2).all(|pair| pair[0] != pair[1]),
            "distinct draws, so a repeated or reordered draw shows"
        );
        assert_eq!(rng, reference, "exactly four draws");

        // The component's own clamp: out-of-range values are pinned to the
        // ends and NaN is stored as zero.
        let clamped = Affinities::from_values(vec![1.5, -2.0, f32::NAN, 0.25, -1.0, 1.0]);
        assert_eq!(clamped.values(), &[1.0, -1.0, 0.0, 0.25, -1.0, 1.0]);
        assert_eq!(clamped.value(3), 0.25);
        assert_eq!(clamped.value(6), 0.0, "past the end");
    }

    /// [OA-values], Review focus 5: a worn television disposition replaces
    /// only the television value, and the generator ends in the same state
    /// with or without it.
    #[test]
    fn a_trait_overrides_the_value_but_not_the_draw_count() {
        let pack = pack();
        let television = kind(pack, "television");
        let from_trait = pack.tuning.affinity_from_trait;
        assert_eq!(from_trait, 0.8, "the shipped strong value");

        let mut bare = SimRng::from_seed(11);
        let plain = draw(&mut bare, pack, None);
        let drawn_television = plain.value(television);
        assert!(
            drawn_television.abs() < from_trait,
            "the fixture draw is weak"
        );
        for (worn, expected) in [
            (vec!["television_devotee"], from_trait),
            (vec!["television_averse"], -from_trait),
        ] {
            let mut rng = SimRng::from_seed(11);
            let drawn = draw(&mut rng, pack, Some(&wearing(pack, &worn)));
            assert_eq!(drawn.value(television), expected, "{worn:?}");
            for (index, value) in drawn.values().iter().enumerate() {
                if index as u32 != television {
                    assert_eq!(*value, plain.values()[index], "{worn:?} kind {index}");
                }
            }
            assert_eq!(rng, bare, "{worn:?}: the same draws were taken");
            assert_eq!(rng.next_u32(), bare.clone().next_u32(), "{worn:?}");
        }

        // Wearing no television trait leaves the draw.
        let mut rng = SimRng::from_seed(11);
        let unrelated = draw(&mut rng, pack, Some(&Traits::default()));
        assert_eq!(unrelated, plain);

        // The bands are inclusive at both ends, and a disposition between
        // them leaves the draw.
        let devotee = trait_index(pack, "television_devotee") as usize;
        let (loves, hates) = (
            pack.tuning.affinity_loves_from,
            pack.tuning.affinity_hates_to,
        );
        for (multiplier, expected) in [
            (loves, from_trait),
            (f32::from_bits(loves.to_bits() - 1), drawn_television),
            (1.0, drawn_television),
            (f32::from_bits(hates.to_bits() + 1), drawn_television),
            (hates, -from_trait),
        ] {
            let mut edited = pack.clone();
            edited.traits[devotee].kind = CompiledTraitKind::Disposition {
                score_multiplier: multiplier,
            };
            let worn = wearing(&edited, &["television_devotee"]);
            let mut rng = SimRng::from_seed(11);
            let drawn = draw(&mut rng, &edited, Some(&worn));
            assert_eq!(drawn.value(television), expected, "multiplier {multiplier}");
            assert_eq!(rng, bare, "multiplier {multiplier}");
        }

        // A capability with the tag sets nothing: only a disposition does.
        let mut edited = pack.clone();
        edited.traits[devotee].kind = CompiledTraitKind::Capability {
            start_level: 0.9,
            fail_delta_scale: 0.5,
        };
        let worn = wearing(&edited, &["television_devotee"]);
        let mut rng = SimRng::from_seed(11);
        assert_eq!(draw(&mut rng, &edited, Some(&worn)), plain);
    }
}
