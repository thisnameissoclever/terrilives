//! Object affinities - `docs/specs/2026-10-06-object-affinities.md`.
//!
//! Every person holds one value per affinity kind, from -1.0 (hates) to
//! 1.0 (loves), drawn once when the person is created ([OA-values]).

use bevy_ecs::prelude::*;
use terri_core::{
    Affinities, Agent, AtWork, Eating, Path, Position, Relationships, SimClock, SimId, SimName,
    SimRng, SmartObject, Target, Traits,
};
use terri_data::{AffinityReach, CompiledTrait, CompiledTraitKind, ContentPack};

use crate::relationship_effects::{RelationshipCause, RelationshipDiagnostics, RelationshipEffect};
use crate::room_regions::RoomRegions;
use crate::{Content, Moodlet};

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

/// The room the tile under `position` belongs to, or `None` for the yard
/// and anywhere off the lot - [OA-presence]. Rounded exactly as the
/// relationship system rounds a person's position.
fn tile_room(rooms: &RoomRegions, position: &Position) -> Option<u32> {
    rooms.at((position.x.round() as i32, position.y.round() as i32))
}

/// The room `person` stands in. `None` for the yard, off the lot, without
/// a position, and at work: a worker's position stays frozen where they
/// left, which on a lot with no street is the front door's tile inside the
/// house, yet they are outside it ([OA-presence], [OA-use]).
fn room_of(world: &World, person: Entity, rooms: &RoomRegions) -> Option<u32> {
    if world.get::<AtWork>(person).is_some() {
        return None;
    }
    tile_room(rooms, world.get::<Position>(person)?)
}

/// The affinity kind of the object `person` is actually using: standing
/// at it with its interaction running, the test `relationship_dynamics`
/// uses for an activity, and not walking (no `Path`). `None` when the
/// person uses nothing, or something no kind covers.
fn using_kind(world: &World, pack: &ContentPack, person: Entity) -> Option<u32> {
    if world.get::<Path>(person).is_some() {
        return None;
    }
    let eating = world.get::<Eating>(person)?;
    let target = world.get::<Target>(person)?;
    let object = world.get::<SmartObject>(target.object)?;
    if object.0 != eating.object || target.interaction != eating.interaction {
        return None;
    }
    pack.affinity_kind_of(eating.object.0)
}

/// The moodlets the things in `subject`'s room give - [OA-presence]: one
/// per `presence` kind with at least one object in the room and a value
/// whose magnitude is at least `affinity_presence_threshold`, in kinds
/// order. Nobody in the yard, off the lot or at work gets one, and nothing
/// outside the house counts.
pub(crate) fn presence_moodlets(
    world: &World,
    pack: &ContentPack,
    subject: Entity,
) -> Vec<Moodlet> {
    let Some(affinities) = world.get::<Affinities>(subject) else {
        return Vec::new();
    };
    if !pack
        .affinities
        .iter()
        .any(|kind| kind.reach == AffinityReach::Presence)
    {
        return Vec::new();
    }
    let rooms = RoomRegions::from_world(world);
    let Some(room) = room_of(world, subject, &rooms) else {
        return Vec::new();
    };
    let mut counts = vec![0_u32; pack.affinities.len()];
    if let Some(mut objects) = world.try_query::<(&SmartObject, &Position)>() {
        for (object, position) in objects.iter(world) {
            if tile_room(&rooms, position) != Some(room) {
                continue;
            }
            if let Some(kind) = pack.affinity_kind_of(object.0 .0) {
                counts[kind as usize] += 1;
            }
        }
    }
    let tuning = &pack.tuning;
    pack.affinities
        .iter()
        .zip(counts)
        .enumerate()
        .filter(|(_, (kind, count))| kind.reach == AffinityReach::Presence && *count > 0)
        .filter_map(|(index, (kind, count))| {
            let value = affinities.value(index as u32);
            if value.abs() < tuning.affinity_presence_threshold {
                return None;
            }
            let extra = (count - 1).min(tuning.affinity_presence_extra_cap);
            Some(Moodlet {
                label: if value > 0.0 {
                    format!("Likes the {} here", kind.label)
                } else {
                    format!("Bothered by the {} here", kind.label)
                },
                score: value
                    * (tuning.affinity_presence_points
                        + tuning.affinity_presence_extra_points * extra as f32),
            })
        })
        .collect()
}

/// One person bothering another by using something they hate - [OA-use].
struct Nuisance {
    user: Entity,
    kind: u32,
    value: f32,
}

/// Everyone bothering `subject`: for each `use` kind, in kinds order, at
/// which `subject` holds a value at or below `-affinity_presence_threshold`,
/// every other living person in the same room actually using an object of
/// that kind, in ascending entity-index order. A person's own use never
/// counts, and a person who merely likes the kind is bothered by nobody.
fn nuisances(
    world: &World,
    pack: &ContentPack,
    rooms: &RoomRegions,
    subject: Entity,
) -> Vec<Nuisance> {
    let Some(affinities) = world.get::<Affinities>(subject) else {
        return Vec::new();
    };
    let threshold = pack.tuning.affinity_presence_threshold;
    let hated: Vec<(u32, f32)> = pack
        .affinities
        .iter()
        .enumerate()
        .filter(|(_, kind)| kind.reach == AffinityReach::Use)
        .map(|(index, _)| (index as u32, affinities.value(index as u32)))
        .filter(|&(_, value)| value <= -threshold)
        .collect();
    if hated.is_empty() {
        return Vec::new();
    }
    let Some(room) = room_of(world, subject, rooms) else {
        return Vec::new();
    };
    let mut users: Vec<(Entity, u32)> = world
        .try_query_filtered::<Entity, With<Agent>>()
        .map_or_else(Vec::new, |mut people| {
            people
                .iter(world)
                .filter(|&person| person != subject)
                .filter(|&person| room_of(world, person, rooms) == Some(room))
                .filter_map(|person| Some((person, using_kind(world, pack, person)?)))
                .collect()
        });
    users.sort_unstable_by_key(|(person, _)| person.index());
    hated
        .into_iter()
        .flat_map(|(kind, value)| {
            users
                .iter()
                .filter(move |(_, used)| *used == kind)
                .map(move |&(user, _)| Nuisance { user, kind, value })
        })
        .collect()
}

/// The moodlets other people's use gives `subject` - [OA-use]: one
/// `Bothered by {name} using the {kind}` per [`nuisances`] entry, worth
/// `value * affinity_use_points`.
pub(crate) fn use_moodlets(world: &World, pack: &ContentPack, subject: Entity) -> Vec<Moodlet> {
    let rooms = RoomRegions::from_world(world);
    nuisances(world, pack, &rooms, subject)
        .into_iter()
        .map(|nuisance| {
            let name = world
                .get::<SimName>(nuisance.user)
                .map_or("Somebody", |name| name.0.as_str());
            Moodlet {
                label: format!(
                    "Bothered by {name} using the {}",
                    pack.affinities[nuisance.kind as usize].label
                ),
                score: nuisance.value * pack.tuning.affinity_use_points,
            }
        })
        .collect()
}

/// The relationship half of [OA-use]: every person bothered by another's
/// use feels `|value| * affinity_use_feeling_per_hour / 60` less toward
/// the user this tick, recorded as a `Nuisance` effect. Bothered people in
/// ascending entity-index order, then their users in the same order.
/// Runs directly after `relationship_dynamics::tick`.
pub(crate) fn bother(world: &mut World) {
    let pack = world.resource::<Content>().0;
    let rooms = RoomRegions::from_world(world);
    let mut people: Vec<Entity> = world
        .query_filtered::<Entity, With<Agent>>()
        .iter(world)
        .collect();
    people.sort_unstable_by_key(|person| person.index());
    let mut pairs = Vec::new();
    for person in people {
        let mut found = nuisances(world, pack, &rooms, person);
        found.sort_by_key(|nuisance| nuisance.user.index());
        pairs.extend(found.into_iter().map(|nuisance| (person, nuisance)));
    }
    let tick = world.resource::<SimClock>().tick;
    let per_tick = pack.tuning.affinity_use_feeling_per_hour / 60.0;
    for (person, nuisance) in pairs {
        let (Some(&affected), Some(&responsible)) = (
            world.get::<SimId>(person),
            world.get::<SimId>(nuisance.user),
        ) else {
            continue;
        };
        let requested = -nuisance.value.abs() * per_tick;
        let mut feelings = world
            .get::<Relationships>(person)
            .cloned()
            .unwrap_or_default();
        let before = feelings.feeling(responsible);
        feelings.bump(responsible, requested);
        let actual = feelings.feeling(responsible) - before;
        world.entity_mut(person).insert(feelings);
        world
            .resource_mut::<RelationshipDiagnostics>()
            .effects
            .push(RelationshipEffect {
                tick,
                event: 0,
                cause: RelationshipCause::Nuisance,
                responsible,
                affected,
                requested,
                actual,
                emergency: false,
                directed: false,
            });
    }
}

/// The word the HUD shows for a value - [OA-hud]: `Loves` at or above
/// 0.6, `Likes` at or above 0.2, `Hates` at or below -0.6, `Dislikes` at
/// or below -0.2, and `Indifferent` strictly between -0.2 and 0.2.
pub fn band(value: f32) -> &'static str {
    if value >= 0.6 {
        "Loves"
    } else if value >= 0.2 {
        "Likes"
    } else if value <= -0.6 {
        "Hates"
    } else if value <= -0.2 {
        "Dislikes"
    } else {
        "Indifferent"
    }
}

#[cfg(test)]
#[path = "affinity_tests.rs"]
mod presence_and_use_tests;

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
