use super::{validate_character_values, CharacterRefusal};
use crate::{edit::living_entity, Content};
use bevy_ecs::prelude::*;
use terri_core::appearance::{CharacterAppearanceV1, F32Bits};
use terri_core::character::{
    AffinityDraft, CharacterBehaviorDraft, CharacterDraftV1, CharacterPatchV1, CharacterPronouns,
    DispositionDraft, SkillDraft, TraitDraft,
};
use terri_core::layout::FamilyTies;
use terri_core::{
    Affinities, Hobbies, Personality, SelfPreservation, Shyness, SimId, SimName, Skills, Traits,
};

/// Preserve the three existing shirt assignments without drawing randomness.
pub fn legacy_appearance(sim: u32) -> CharacterAppearanceV1 {
    let mut appearance = CharacterAppearanceV1::default();
    appearance.colors.shirt = match sim {
        0 => [62, 117, 164],
        2 => [168, 71, 62],
        _ => appearance.colors.shirt,
    };
    appearance
}

pub(crate) fn ensure_appearance_components(world: &mut World) {
    let mut query = world.query::<(
        Entity,
        &terri_core::Agent,
        &SimId,
        Option<&CharacterAppearanceV1>,
        Option<&CharacterPronouns>,
    )>();
    let missing: Vec<_> = query
        .iter(world)
        .filter(|(_, _, _, appearance, pronouns)| appearance.is_none() || pronouns.is_none())
        .map(|(entity, _, id, appearance, pronouns)| {
            (entity, id.0, appearance.is_none(), pronouns.is_none())
        })
        .collect();
    for (entity, id, appearance, pronouns) in missing {
        if appearance {
            world.entity_mut(entity).insert(legacy_appearance(id));
        }
        if pronouns {
            world
                .entity_mut(entity)
                .insert(CharacterPronouns::default());
        }
    }
}

pub(crate) fn hash_hobby_changes(world: &World, hash: &mut terri_core::FnvHasher) {
    let pack = world.resource::<Content>().0;
    let mut rows = world
        .try_query::<(&terri_core::Agent, &SimId, &Hobbies)>()
        .map_or_else(Vec::new, |mut query| {
            query
                .iter(world)
                .filter(|(_, id, hobbies)| {
                    pack.household
                        .get(id.0 as usize)
                        .map_or(&[][..], |member| member.hobbies.as_slice())
                        != hobbies.0
                })
                .map(|(_, id, hobbies)| (id.0, hobbies.0.clone()))
                .collect()
        });
    rows.sort_by_key(|row| row.0);
    if rows.is_empty() {
        return;
    }
    hash.write_bytes(b"character-hobby-overrides-v1");
    hash.write_u64(rows.len() as u64);
    for (sim, hobbies) in rows {
        hash.write_u64(u64::from(sim));
        hash.write_u64(hobbies.len() as u64);
        for hobby in hobbies {
            hash.write_u64(hobby.len() as u64);
            hash.write_bytes(hobby.as_bytes());
        }
    }
}

pub fn snapshot(world: &World, sim: u32) -> Result<CharacterDraftV1, CharacterRefusal> {
    let entity = living_entity(world, sim).ok_or(CharacterRefusal::UnknownPerson)?;
    let pack = world.resource::<Content>().0;
    let personality = world
        .get::<Personality>(entity)
        .cloned()
        .unwrap_or_default();
    let bits = |value: f32| F32Bits(value.to_bits());
    let dispositions = personality
        .dispositions()
        .iter()
        .map(|(object, action, value)| {
            let definition = pack
                .objects
                .get(object.0 as usize)
                .ok_or(CharacterRefusal::InvalidBehavior)?;
            let action = definition
                .interactions
                .get(*action as usize)
                .ok_or(CharacterRefusal::InvalidBehavior)?;
            Ok(DispositionDraft {
                object: definition.id.clone(),
                action: action.id.clone(),
                weight: bits(*value),
            })
        })
        .collect::<Result<Vec<_>, CharacterRefusal>>()?;
    let mut ties = Vec::new();
    if let Some(mut query) = world.try_query::<(&terri_core::Agent, &SimId)>() {
        for (_, id) in query.iter(world) {
            if id.0 != sim {
                ties.push((
                    id.0,
                    world
                        .get_resource::<FamilyTies>()
                        .and_then(|family| family.relation(sim, id.0)),
                ));
            }
        }
    }
    ties.sort_by_key(|row| row.0);
    Ok(CharacterDraftV1 {
        version: 1,
        name: world
            .get::<SimName>(entity)
            .map_or_else(|| "Housemate".into(), |name| name.0.clone()),
        pronouns: world
            .get::<CharacterPronouns>(entity)
            .map_or_else(String::new, |value| value.0.clone()),
        appearance: world
            .get::<CharacterAppearanceV1>(entity)
            .cloned()
            .unwrap_or_else(|| legacy_appearance(sim)),
        behavior: CharacterBehaviorDraft {
            shyness: world
                .get::<Shyness>(entity)
                .copied()
                .unwrap_or_else(|| Shyness::initial(SimId(sim)))
                .value(),
            cleanliness: bits(crate::domestic::cleanliness(world, entity)),
            self_preservation: world
                .get::<SelfPreservation>(entity)
                .map_or(50, |value| value.0),
            chronotype_offset_ticks: personality.chronotype_offset_ticks,
            drain: personality.drain.map(bits),
            recovery: personality.satisfaction.map(bits),
            dispositions,
        },
        traits: world.get::<Traits>(entity).map_or_else(Vec::new, |traits| {
            traits
                .entries()
                .iter()
                .map(|(index, value)| TraitDraft {
                    id: pack.traits[*index as usize].id.clone(),
                    state: bits(*value),
                })
                .collect()
        }),
        affinities: pack
            .affinities
            .iter()
            .enumerate()
            .map(|(index, kind)| AffinityDraft {
                id: kind.id.clone(),
                value: bits(
                    world
                        .get::<Affinities>(entity)
                        .map_or(0., |values| values.value(index as u32)),
                ),
            })
            .collect(),
        hobbies: world
            .get::<Hobbies>(entity)
            .map_or_else(Vec::new, |hobbies| hobbies.0.clone()),
        skills: world.get::<Skills>(entity).map_or_else(Vec::new, |skills| {
            skills
                .entries()
                .iter()
                .map(|(index, value)| SkillDraft {
                    id: pack.skills[*index as usize].id.clone(),
                    practice: bits(*value),
                })
                .collect()
        }),
        ties,
    })
}

fn validate_ties(
    world: &World,
    draft: &CharacterDraftV1,
    sim: Option<u32>,
) -> Result<(), CharacterRefusal> {
    for (relative, _) in &draft.ties {
        if Some(*relative) == sim || living_entity(world, *relative).is_none() {
            return Err(CharacterRefusal::InvalidTies);
        }
    }
    Ok(())
}
fn affinity_values(pack: &terri_data::ContentPack, draft: &CharacterDraftV1) -> Affinities {
    Affinities::from_values(
        pack.affinities
            .iter()
            .map(|kind| {
                draft
                    .affinities
                    .iter()
                    .find(|row| row.id == kind.id)
                    .expect("validated affinity")
                    .value
                    .value()
            })
            .collect(),
    )
}

/// Every fallible check completes before spawning or mutating a person.
pub fn create_character(
    world: &mut World,
    draft: &CharacterDraftV1,
) -> Result<u32, CharacterRefusal> {
    let pack = world.resource::<Content>().0;
    validate_character_values(pack, draft, None)?;
    validate_ties(world, draft, None)?;
    if crate::household::household_size(world) >= crate::household::MAX_HOUSEHOLD_SIZE {
        return Err(CharacterRefusal::HouseholdFull);
    }
    let (position, steps) =
        crate::household::arrival(world).map_err(|_| CharacterRefusal::NoWayIn)?;
    let traits: Vec<_> = draft
        .traits
        .iter()
        .map(|trait_| {
            pack.traits
                .iter()
                .position(|kind| kind.id == trait_.id)
                .expect("validated trait") as u32
        })
        .collect();
    let entity = crate::household::spawn_member_with_affinities(
        world,
        &pack.personalities,
        &pack.traits,
        crate::household::Member {
            name: draft.name.clone(),
            personality: 0,
            position,
            needs: [terri_core::NEED_MAX; terri_core::NEED_COUNT],
            hobbies: draft.hobbies.clone(),
            traits: &traits,
            career: None,
            instinct: Some(draft.behavior.self_preservation),
        },
        Some(affinity_values(pack, draft)),
    );
    if !steps.is_empty() {
        world
            .entity_mut(entity)
            .insert(terri_core::Path { steps, cursor: 0 });
    }
    apply(world, entity, draft, None);
    Ok(world.get::<SimId>(entity).expect("new person identity").0)
}

pub fn edit_character(
    world: &mut World,
    sim: u32,
    patch: &CharacterPatchV1,
) -> Result<(), CharacterRefusal> {
    let original = snapshot(world, sim)?;
    if patch.version != 1 {
        return Err(CharacterRefusal::InvalidVersion);
    }
    let resolved = patch
        .resolve(&original)
        .map_err(|_| CharacterRefusal::InvalidStructure)?;
    validate_character_values(world.resource::<Content>().0, &resolved, Some(&original))?;
    validate_ties(world, &resolved, Some(sim))?;
    let entity = living_entity(world, sim).expect("validated living person");
    apply(world, entity, &resolved, Some(patch));
    Ok(())
}

fn apply(
    world: &mut World,
    entity: Entity,
    draft: &CharacterDraftV1,
    patch: Option<&CharacterPatchV1>,
) {
    let pack = world.resource::<Content>().0;
    if patch.is_none_or(|p| p.name.is_some()) {
        world.entity_mut(entity).insert(SimName(draft.name.clone()));
    }
    if patch.is_none_or(|p| p.pronouns.is_some()) {
        world
            .entity_mut(entity)
            .insert(CharacterPronouns(draft.pronouns.clone()));
    }
    if patch.is_none_or(|p| p.appearance.is_some()) {
        world.entity_mut(entity).insert(draft.appearance.clone());
    }
    if patch.is_none_or(|p| p.behavior.is_some()) {
        let mut personality = Personality::with_dispositions(
            draft.behavior.drain.map(F32Bits::value),
            draft.behavior.recovery.map(F32Bits::value),
            draft
                .behavior
                .dispositions
                .iter()
                .map(|route| {
                    let object = pack
                        .objects
                        .iter()
                        .position(|object| object.id == route.object)
                        .expect("validated object");
                    let action = pack.objects[object]
                        .interactions
                        .iter()
                        .position(|action| action.id == route.action)
                        .expect("validated action");
                    (
                        terri_core::ObjectDefId(object as u32),
                        action as u32,
                        route.weight.value(),
                    )
                })
                .collect(),
        );
        personality.chronotype_offset_ticks = draft.behavior.chronotype_offset_ticks;
        world.entity_mut(entity).insert((
            personality,
            Shyness::new(draft.behavior.shyness).expect("validated shyness"),
            SelfPreservation(draft.behavior.self_preservation),
        ));
        let mut domestic =
            world.get_resource_or_insert_with(terri_core::save::SavedDomestic::default);
        domestic
            .cleanliness
            .retain(|row| row.0 != entity.index_u32());
        domestic
            .cleanliness
            .push((entity.index_u32(), draft.behavior.cleanliness.value()));
        domestic.cleanliness.sort_by_key(|row| row.0);
    }
    if patch.is_none_or(|p| p.traits.is_some()) {
        world.entity_mut(entity).insert(Traits::from_entries(
            draft
                .traits
                .iter()
                .map(|row| {
                    (
                        pack.traits
                            .iter()
                            .position(|kind| kind.id == row.id)
                            .expect("validated trait") as u32,
                        row.state.value(),
                    )
                })
                .collect(),
        ));
    }
    if patch.is_none_or(|p| p.affinities.is_some()) {
        world
            .entity_mut(entity)
            .insert(affinity_values(pack, draft));
    }
    if patch.is_none_or(|p| p.hobbies.is_some()) {
        world
            .entity_mut(entity)
            .insert(Hobbies(draft.hobbies.clone()));
    }
    if patch.is_none_or(|p| p.skills.is_some()) {
        world.entity_mut(entity).insert(Skills::from_entries(
            draft
                .skills
                .iter()
                .map(|row| {
                    (
                        pack.skills
                            .iter()
                            .position(|kind| kind.id == row.id)
                            .expect("validated skill") as u32,
                        row.practice.value(),
                    )
                })
                .collect(),
        ));
    }
    if patch.is_none_or(|p| p.ties.is_some()) {
        let sim = world.get::<SimId>(entity).expect("person identity").0;
        let mut family = world.get_resource_or_insert_with(FamilyTies::default);
        for (relative, relation) in &draft.ties {
            family.set(sim, *relative, *relation);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Sim;
    use terri_core::layout::Relation;

    fn draft() -> CharacterDraftV1 {
        let mut draft = CharacterDraftV1::neutral("Morgan");
        draft.affinities = terri_data::pack()
            .affinities
            .iter()
            .map(|kind| AffinityDraft {
                id: kind.id.clone(),
                value: F32Bits::new(0.1234567).unwrap(),
            })
            .collect();
        draft
    }

    fn family_edit_world() -> (Sim, u32) {
        let mut sim = Sim::new_from_shipped_lot();
        let absent = sim
            .world_mut()
            .resource_mut::<terri_core::SimIdAllocator>()
            .issue()
            .0;
        let mut family = sim
            .world_mut()
            .get_resource_or_insert_with(FamilyTies::default);
        family.set(2, 1, Some(Relation::Partner));
        family.set(2, 0, Some(Relation::Sibling));
        family.set(2, absent, Some(Relation::Parent));
        (sim, absent)
    }

    #[test]
    fn sparse_relationship_patch_preserves_unsubmitted_pairs_and_inverse_direction() {
        let (mut sim, absent) = family_edit_world();
        let rng = sim.world().resource::<terri_core::SimRng>().clone();
        edit_character(
            sim.world_mut(),
            2,
            &CharacterPatchV1 {
                ties: Some(vec![(1, Some(Relation::Parent))]),
                ..Default::default()
            },
        )
        .unwrap();
        let family = sim.world().resource::<FamilyTies>();
        assert_eq!(family.relation(2, 1), Some(Relation::Parent));
        assert_eq!(family.relation(1, 2), Some(Relation::Child));
        assert_eq!(family.relation(2, 0), Some(Relation::Sibling));
        assert_eq!(family.relation(2, absent), Some(Relation::Parent));
        assert_eq!(family.ties().len(), 3);
        assert_eq!(sim.world().resource::<terri_core::SimRng>(), &rng);
    }

    #[test]
    fn sparse_relationship_clear_removes_only_the_submitted_pair() {
        let (mut sim, absent) = family_edit_world();
        assert!(living_entity(sim.world(), absent).is_none());
        edit_character(
            sim.world_mut(),
            2,
            &CharacterPatchV1 {
                ties: Some(vec![(1, None)]),
                ..Default::default()
            },
        )
        .unwrap();
        let family = sim.world().resource::<FamilyTies>();
        assert_eq!(family.relation(2, 1), None);
        assert_eq!(family.relation(1, 2), None);
        assert_eq!(family.relation(2, 0), Some(Relation::Sibling));
        assert_eq!(family.relation(2, absent), Some(Relation::Parent));
        assert_eq!(family.ties().len(), 2);
    }

    #[test]
    fn sparse_relationship_patch_with_an_absent_relative_rejects_every_change() {
        let (mut sim, absent) = family_edit_world();
        let before = snapshot(sim.world(), 2).unwrap();
        let family = sim.world().resource::<FamilyTies>().clone();
        let hash = sim.world_hash();
        let rng = sim.world().resource::<terri_core::SimRng>().clone();
        assert_eq!(
            edit_character(
                sim.world_mut(),
                2,
                &CharacterPatchV1 {
                    name: Some("Should not apply".into()),
                    ties: Some(vec![(1, Some(Relation::Child)), (absent, None)]),
                    ..Default::default()
                },
            ),
            Err(CharacterRefusal::InvalidTies)
        );
        assert_eq!(snapshot(sim.world(), 2).unwrap(), before);
        assert_eq!(sim.world().resource::<FamilyTies>(), &family);
        assert_eq!(sim.world_hash(), hash);
        assert_eq!(sim.world().resource::<terri_core::SimRng>(), &rng);
    }

    #[test]
    fn resolved_creation_preserves_all_choices_and_spends_no_world_randomness() {
        let mut sim = Sim::new_from_shipped_lot();
        let before = sim.world().resource::<terri_core::SimRng>().clone();
        let mut input = draft();
        input.behavior.shyness = 17;
        input.appearance.body.height = 83;
        input.pronouns = "they/them".into();
        let id = create_character(sim.world_mut(), &input).unwrap();
        let actual = snapshot(sim.world(), id).unwrap();
        let mut expected = input;
        expected.ties = actual.ties.clone();
        assert_eq!(actual, expected);
        assert_eq!(sim.world().resource::<terri_core::SimRng>(), &before);
    }

    #[test]
    fn invalid_request_changes_neither_person_nor_world() {
        let mut sim = Sim::new_from_shipped_lot();
        let before = sim.world_hash();
        let original = snapshot(sim.world(), 0).unwrap();
        let mut invalid = original.appearance.clone();
        invalid.body.height = 101;
        let patch = CharacterPatchV1 {
            name: Some("Should not apply".into()),
            appearance: Some(invalid),
            ..Default::default()
        };
        assert!(edit_character(sim.world_mut(), 0, &patch).is_err());
        assert_eq!(snapshot(sim.world(), 0).unwrap(), original);
        assert_eq!(sim.world_hash(), before);
        let mut input = draft();
        input.ties.push((u32::MAX, None));
        assert_eq!(
            create_character(sim.world_mut(), &input),
            Err(CharacterRefusal::InvalidTies)
        );
        assert_eq!(sim.world_hash(), before);
        assert_eq!(
            edit_character(sim.world_mut(), u32::MAX, &CharacterPatchV1::default()),
            Err(CharacterRefusal::UnknownPerson)
        );
    }

    #[test]
    fn name_and_appearance_edits_preserve_dynamic_and_custom_values_exactly() {
        let mut sim = Sim::new_from_shipped_lot();
        let entity = living_entity(sim.world(), 0).unwrap();
        sim.world_mut()
            .get_mut::<Personality>(entity)
            .unwrap()
            .drain[2] = 0.1234567;
        sim.world_mut()
            .entity_mut(entity)
            .insert(Hobbies(vec!["retired_historical_tag".into()]));
        let before = snapshot(sim.world(), 0).unwrap();
        let needs = *sim.world().get::<terri_core::Needs>(entity).unwrap();
        let position = *sim.world().get::<terri_core::Position>(entity).unwrap();
        let rng = sim.world().resource::<terri_core::SimRng>().clone();
        let mut appearance = before.appearance.clone();
        appearance.body.build = 82;
        let patch = CharacterPatchV1 {
            name: Some("Renamed".into()),
            appearance: Some(appearance.clone()),
            ..Default::default()
        };
        edit_character(sim.world_mut(), 0, &patch).unwrap();
        let mut expected = before;
        expected.name = "Renamed".into();
        expected.appearance = appearance;
        assert_eq!(snapshot(sim.world(), 0).unwrap(), expected);
        assert_eq!(
            sim.world().get::<terri_core::Needs>(entity).unwrap(),
            &needs
        );
        assert_eq!(
            sim.world().get::<terri_core::Position>(entity).unwrap(),
            &position
        );
        assert_eq!(sim.world().resource::<terri_core::SimRng>(), &rng);
    }

    #[test]
    fn appearance_changes_do_not_reorder_simulation_updates() {
        let mut ordinary = Sim::new_from_shipped_lot();
        let mut styled = Sim::new_from_shipped_lot();
        let mut appearance = legacy_appearance(0);
        appearance.body.build = 100;
        appearance.presentation = "feminine".into();
        edit_character(
            styled.world_mut(),
            0,
            &CharacterPatchV1 {
                appearance: Some(appearance),
                ..Default::default()
            },
        )
        .unwrap();
        for _ in 0..240 {
            ordinary.tick();
            styled.tick();
            assert_eq!(ordinary.world_hash(), styled.world_hash());
        }
    }
}
