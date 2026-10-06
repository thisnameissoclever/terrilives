//! Tests for editing a living person in place - [ES-atomic], [ES-traits],
//! [ES-personality] in `docs/specs/2026-09-30-edit-sims.md`.

use super::*;
use crate::household::MAX_HOUSEHOLD_SIZE;
use crate::placement::LotEditState;
use crate::Sim;
use terri_core::layout::{FamilyTies, Relation};
use terri_core::save::SavedDomestic;
use terri_core::{CommandQueue, Needs, Personality, SimClock, SimCommand, SimName, Traits};

fn edit(
    sim: &mut Sim,
    target: u32,
    name: &str,
    personality: Option<u32>,
    traits: &[u32],
    ties: &[(u32, Option<Relation>)],
) -> EditResult {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::EditHousemate {
            sim: target,
            name: name.to_string(),
            personality,
            traits: traits.to_vec(),
            ties: ties.to_vec(),
        });
    sim.flush_commands();
    sim.world()
        .resource::<LotEditState>()
        .last_edit_result
        .expect("the drain recorded the edit")
}

fn person(sim: &Sim, sim_id: u32) -> Entity {
    living_entity(sim.world(), sim_id).expect("a living person with that SimId")
}

fn name_of(sim: &Sim, sim_id: u32) -> String {
    sim.world()
        .get::<SimName>(person(sim, sim_id))
        .unwrap()
        .0
        .clone()
}

fn traits_of(sim: &Sim, sim_id: u32) -> Vec<(u32, f32)> {
    sim.world()
        .get::<Traits>(person(sim, sim_id))
        .unwrap()
        .entries()
        .to_vec()
}

fn move_in(sim: &mut Sim, name: &str, personality: u32, traits: &[u32]) -> u32 {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::AddHousemate {
            name: name.to_string(),
            personality,
            traits: traits.to_vec(),
        });
    sim.flush_commands();
    let entity_index = sim
        .world()
        .resource::<LotEditState>()
        .last_housemate_result
        .unwrap()
        .sim
        .expect("the newcomer moved in");
    crate::family::sim_id_at(sim.world(), entity_index).unwrap()
}

/// The simulation clock's tick count.
fn tick_count(sim: &Sim) -> u64 {
    sim.world().resource::<SimClock>().tick
}

/// The family ties, or none when the world has never recorded one: the
/// shipped lot starts without a `FamilyTies` resource.
fn family(sim: &Sim) -> FamilyTies {
    sim.world()
        .get_resource::<FamilyTies>()
        .cloned()
        .unwrap_or_default()
}

/// Records a tie directly, creating the resource on first use.
fn tie(sim: &mut Sim, who: u32, to: u32, relation: Option<Relation>) {
    sim.world_mut()
        .get_resource_or_insert_with(FamilyTies::default)
        .set(who, to, relation);
}

#[test]
fn a_name_only_edit_changes_the_name_and_nothing_else() {
    let mut sim = Sim::new_from_shipped_lot();
    let before_entity = person(&sim, 0);
    let before_personality = sim
        .world()
        .get::<Personality>(before_entity)
        .unwrap()
        .clone();
    let before_traits = traits_of(&sim, 0);
    let before_needs = *sim.world().get::<Needs>(before_entity).unwrap();
    tie(&mut sim, 0, 1, Some(Relation::Parent));
    let before_ties = family(&sim).ties().to_vec();
    assert!(
        !before_ties.is_empty(),
        "the comparison needs a tie to keep"
    );
    let worn: Vec<u32> = before_traits.iter().map(|(index, _)| *index).collect();
    let result = edit(&mut sim, 0, "  Timothy  ", None, &worn, &[]);
    assert_eq!(result.reason, None);
    assert_eq!(result.sim, Some(before_entity.index_u32()));
    assert_eq!(result.handled, 1);
    assert_eq!(name_of(&sim, 0), "Timothy");
    assert_eq!(person(&sim, 0), before_entity);
    assert_eq!(
        sim.world().get::<Personality>(before_entity).unwrap(),
        &before_personality
    );
    assert_eq!(traits_of(&sim, 0), before_traits);
    assert_eq!(
        sim.world().get::<Needs>(before_entity).unwrap(),
        &before_needs
    );
    assert_eq!(family(&sim).ties(), &before_ties[..]);
}

#[test]
fn editing_works_in_a_full_household_and_issues_no_sim_id() {
    let mut sim = Sim::new_from_shipped_lot();
    let vacancies = MAX_HOUSEHOLD_SIZE - crate::household::household_size(sim.world());
    for _ in 0..vacancies {
        move_in(&mut sim, "Extra", 0, &[]);
    }
    assert_eq!(
        crate::household::household_size(sim.world()),
        MAX_HOUSEHOLD_SIZE,
        "the household is full before the edit"
    );
    let issued = sim
        .world()
        .resource::<terri_core::SimIdAllocator>()
        .issued();
    let result = edit(&mut sim, 0, "Tim Again", None, &[], &[]);
    assert_eq!(result.reason, None);
    assert_eq!(name_of(&sim, 0), "Tim Again");
    assert_eq!(
        sim.world()
            .resource::<terri_core::SimIdAllocator>()
            .issued(),
        issued
    );
    assert_eq!(
        crate::household::household_size(sim.world()),
        MAX_HOUSEHOLD_SIZE
    );
}

#[test]
fn retained_traits_keep_their_exact_state_and_new_ones_start_authored() {
    let mut sim = Sim::new_from_shipped_lot();
    let capability = content_index_of_kind(&sim, "cannot_cook");
    let disposition = content_index_of_kind(&sim, "bookworm");
    let condition = content_index_of_kind(&sim, "low_spirits");
    let who = move_in(&mut sim, "Ann", 0, &[capability]);
    let entity = person(&sim, who);
    sim.world_mut()
        .get_mut::<Traits>(entity)
        .unwrap()
        .set_state(capability, 0.77);
    let result = edit(
        &mut sim,
        who,
        "Ann",
        None,
        &[capability, disposition, condition],
        &[],
    );
    assert_eq!(result.reason, None);
    let content = sim.world().resource::<crate::Content>().0;
    let mut expected = vec![
        (capability, 0.77),
        (disposition, 0.0),
        (
            condition,
            crate::household::authored_trait_state(&content.traits[condition as usize]),
        ),
    ];
    expected.sort_by_key(|(index, _)| *index);
    assert_eq!(traits_of(&sim, who), expected);
}

#[test]
fn a_committed_removal_resets_a_re_added_trait_to_its_authored_state() {
    let mut sim = Sim::new_from_shipped_lot();
    let capability = content_index_of_kind(&sim, "cannot_cook");
    let who = move_in(&mut sim, "Ann", 0, &[capability]);
    let entity = person(&sim, who);
    sim.world_mut()
        .get_mut::<Traits>(entity)
        .unwrap()
        .set_state(capability, 0.77);
    assert_eq!(edit(&mut sim, who, "Ann", None, &[], &[]).reason, None);
    assert_eq!(traits_of(&sim, who), vec![]);
    assert_eq!(
        edit(&mut sim, who, "Ann", None, &[capability], &[]).reason,
        None
    );
    let content = sim.world().resource::<crate::Content>().0;
    assert_eq!(
        traits_of(&sim, who),
        vec![(
            capability,
            crate::household::authored_trait_state(&content.traits[capability as usize])
        )]
    );
}

#[test]
fn an_explicit_personality_change_replaces_every_effect_including_chronotype_and_cleanliness() {
    let mut sim = Sim::new_from_shipped_lot();
    // Tick once so domestic::tick has filled the cleanliness rows.
    sim.tick();
    let entity = person(&sim, 0);
    let content = sim.world().resource::<crate::Content>().0;
    let target = content
        .personalities
        .iter()
        .position(|p| p.id == "the_flitting")
        .unwrap() as u32;
    let authored = &content.personalities[target as usize];
    assert_ne!(
        authored.chronotype_offset_ticks, 0,
        "the test needs a nonzero authored offset"
    );
    let row = |sim: &Sim| {
        sim.world()
            .resource::<SavedDomestic>()
            .cleanliness
            .iter()
            .find(|(index, _)| *index == entity.index_u32())
            .map(|(_, score)| *score)
    };
    let row_before = row(&sim);
    assert!(
        row_before.is_some_and(|score| score != authored.cleanliness),
        "the test needs an existing row that differs from the target's"
    );
    let expected = crate::household::personality_from(authored);
    let result = edit(&mut sim, 0, "Tim", Some(target), &[], &[]);
    assert_eq!(result.reason, None);
    let edited = sim.world().get::<Personality>(entity).unwrap();
    assert_eq!(
        edited.chronotype_offset_ticks, authored.chronotype_offset_ticks,
        "the authored chronotype offset arrives with the personality"
    );
    assert_eq!(edited, &expected);
    assert_eq!(row(&sim), Some(authored.cleanliness));
}

#[test]
fn keeping_the_personality_preserves_custom_effects_and_cleanliness() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.tick();
    let entity = person(&sim, 0);
    let mut custom = sim.world().get::<Personality>(entity).unwrap().clone();
    custom.drain[0] = 3.5;
    custom.chronotype_offset_ticks = 41;
    sim.world_mut().entity_mut(entity).insert(custom.clone());
    // A sentinel no archetype authors, so a rewrite from any archetype shows.
    const SENTINEL: f32 = 0.123;
    {
        let mut domestic = sim.world_mut().resource_mut::<SavedDomestic>();
        let row = domestic
            .cleanliness
            .iter_mut()
            .find(|(index, _)| *index == entity.index_u32())
            .expect("the tick filled this person's cleanliness row");
        row.1 = SENTINEL;
    }
    let content = sim.world().resource::<crate::Content>().0;
    assert!(content
        .personalities
        .iter()
        .all(|p| p.cleanliness != SENTINEL));
    let row_before = sim.world().resource::<SavedDomestic>().cleanliness.clone();
    assert_eq!(edit(&mut sim, 0, "Tim", None, &[], &[]).reason, None);
    assert_eq!(sim.world().get::<Personality>(entity).unwrap(), &custom);
    let row_after = sim
        .world()
        .resource::<SavedDomestic>()
        .cleanliness
        .iter()
        .find(|(index, _)| *index == entity.index_u32())
        .map(|(_, score)| *score);
    assert_eq!(row_after, Some(SENTINEL));
    assert_eq!(
        sim.world().resource::<SavedDomestic>().cleanliness,
        row_before
    );
}

#[test]
fn ties_replace_only_the_submitted_pairs_in_both_directions() {
    let mut sim = Sim::new_from_shipped_lot();
    let ann = move_in(&mut sim, "Ann", 0, &[]);
    // Existing ties: 0 is the parent of 1; 1 and 2 are siblings.
    tie(&mut sim, 0, 1, Some(Relation::Parent));
    tie(&mut sim, 1, 2, Some(Relation::Sibling));
    let result = edit(
        &mut sim,
        1,
        "Bill",
        None,
        &[],
        &[(0, Some(Relation::Partner)), (ann, Some(Relation::Child))],
    );
    assert_eq!(result.reason, None);
    let ties = family(&sim);
    assert_eq!(ties.relation(1, 0), Some(Relation::Partner));
    assert_eq!(ties.relation(0, 1), Some(Relation::Partner));
    assert_eq!(ties.relation(1, ann), Some(Relation::Child));
    assert_eq!(ties.relation(ann, 1), Some(Relation::Parent));
    assert_eq!(
        ties.relation(1, 2),
        Some(Relation::Sibling),
        "an unsubmitted pair survives"
    );
    assert_eq!(
        edit(&mut sim, 1, "Bill", None, &[], &[(0, None)]).reason,
        None
    );
    assert_eq!(family(&sim).relation(1, 0), None);
    assert_eq!(family(&sim).relation(1, ann), Some(Relation::Child));
}

#[test]
fn ties_to_the_dead_survive_an_edit_of_living_ties() {
    let mut sim = Sim::new_from_shipped_lot();
    let ann = move_in(&mut sim, "Ann", 0, &[]);
    tie(&mut sim, 0, ann, Some(Relation::Child));
    let dead = person(&sim, ann);
    crate::mortality::remove_person(sim.world_mut(), dead);
    assert!(living_entity(sim.world(), ann).is_none());
    assert_eq!(
        edit(
            &mut sim,
            0,
            "Tim",
            None,
            &[],
            &[(1, Some(Relation::Sibling))]
        )
        .reason,
        None
    );
    assert_eq!(family(&sim).relation(0, ann), Some(Relation::Child));
    assert_eq!(family(&sim).relation(0, 1), Some(Relation::Sibling));
    // A tie submitted to the dead person is refused outright.
    let result = edit(&mut sim, 0, "Tim", None, &[], &[(ann, None)]);
    assert_eq!(result.reason, Some(EditRefusal::UnknownRelative));
}

/// One invalid edit: a label, the target SimId, the name, the personality,
/// the traits, the ties, and the refusal it must draw.
type InvalidEdit<'a> = (
    &'a str,
    u32,
    &'a str,
    Option<u32>,
    Vec<u32>,
    Vec<(u32, Option<Relation>)>,
    EditRefusal,
);

#[test]
fn every_invalid_field_refuses_the_whole_edit_without_writing() {
    let mut sim = Sim::new_from_shipped_lot();
    let content = sim.world().resource::<crate::Content>().0;
    let max_traits = content.tuning.housemate_max_traits as usize;
    let trait_count = content.traits.len() as u32;
    let personality_count = content.personalities.len() as u32;
    let too_long: String = "x".repeat(content.tuning.housemate_name_max_chars as usize + 1);
    let at_limit: String = "y".repeat(content.tuning.housemate_name_max_chars as usize);
    let cases: Vec<InvalidEdit> = vec![
        (
            "never issued",
            99,
            "Tim",
            None,
            vec![],
            vec![],
            EditRefusal::UnknownPerson,
        ),
        (
            "empty name",
            0,
            "   ",
            None,
            vec![],
            vec![],
            EditRefusal::BadName,
        ),
        (
            "long name",
            0,
            too_long.as_str(),
            None,
            vec![],
            vec![],
            EditRefusal::BadName,
        ),
        (
            "unknown personality",
            0,
            "Tim",
            Some(personality_count),
            vec![],
            vec![],
            EditRefusal::UnknownPersonality,
        ),
        (
            "too many traits",
            0,
            "Tim",
            None,
            (0..=max_traits as u32).collect(),
            vec![],
            EditRefusal::TooManyTraits,
        ),
        (
            "unknown trait",
            0,
            "Tim",
            None,
            vec![trait_count],
            vec![],
            EditRefusal::UnknownTrait,
        ),
        (
            "repeated trait",
            0,
            "Tim",
            None,
            vec![1, 1],
            vec![],
            EditRefusal::RepeatedTrait,
        ),
        (
            "self tie",
            0,
            "Tim",
            None,
            vec![],
            vec![(0, Some(Relation::Sibling))],
            EditRefusal::SelfTie,
        ),
        (
            "unknown relative",
            0,
            "Tim",
            None,
            vec![],
            vec![(99, Some(Relation::Sibling))],
            EditRefusal::UnknownRelative,
        ),
        (
            "repeated relative",
            0,
            "Tim",
            None,
            vec![],
            vec![(1, Some(Relation::Sibling)), (1, None)],
            EditRefusal::RepeatedRelative,
        ),
    ];
    let hash = sim.world_hash();
    let saved = sim.save_snapshot_v5();
    let names: Vec<String> = (0..3).map(|id| name_of(&sim, id)).collect();
    for (index, (label, target, name, personality, traits, ties, expected)) in
        cases.into_iter().enumerate()
    {
        let result = edit(&mut sim, target, name, personality, &traits, &ties);
        assert_eq!(result.reason, Some(expected), "{label}");
        assert_eq!(result.sim, None, "{label}");
        assert_eq!(
            result.handled as usize,
            index + 1,
            "{label}: every answer is numbered"
        );
        assert_eq!(sim.world_hash(), hash, "{label} wrote something");
        assert_eq!(sim.save_snapshot_v5(), saved, "{label} changed the save");
        assert_eq!(
            (0..3).map(|id| name_of(&sim, id)).collect::<Vec<_>>(),
            names,
            "{label} renamed someone"
        );
    }
    // The boundary name is accepted; mixed valid fields with one invalid one
    // still refuse the whole edit, including the valid name.
    let result = edit(
        &mut sim,
        0,
        at_limit.as_str(),
        Some(1),
        &[0, trait_count],
        &[],
    );
    assert_eq!(result.reason, Some(EditRefusal::UnknownTrait));
    assert_eq!(name_of(&sim, 0), names[0]);
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.save_snapshot_v5(), saved);
    assert_eq!(
        edit(&mut sim, 0, at_limit.as_str(), None, &[], &[]).reason,
        None
    );
    assert_eq!(name_of(&sim, 0), at_limit);
}

#[test]
fn a_retired_sim_id_is_refused_after_a_newcomer_arrives() {
    let mut sim = Sim::new_from_shipped_lot();
    let ann = move_in(&mut sim, "Ann", 0, &[]);
    let dead = person(&sim, ann);
    crate::mortality::remove_person(sim.world_mut(), dead);
    let bob = move_in(&mut sim, "Bob", 0, &[]);
    assert_ne!(bob, ann);
    let result = edit(&mut sim, ann, "Ghost", None, &[], &[]);
    assert_eq!(result.reason, Some(EditRefusal::UnknownPerson));
    assert_eq!(name_of(&sim, bob), "Bob");
}

#[test]
fn an_accepted_edit_changes_the_world_hash_and_a_refused_one_does_not() {
    let mut sim = Sim::new_from_shipped_lot();
    let before = sim.world_hash();
    assert_eq!(
        edit(
            &mut sim,
            0,
            "Tim",
            None,
            &[],
            &[(1, Some(Relation::Parent))]
        )
        .reason,
        None
    );
    let after = sim.world_hash();
    assert_ne!(before, after);
    assert_eq!(
        edit(&mut sim, 0, "", None, &[], &[]).reason,
        Some(EditRefusal::BadName)
    );
    assert_eq!(sim.world_hash(), after);
}

#[test]
fn world_replacement_restarts_the_handled_count() {
    let mut sim = Sim::new_from_shipped_lot();
    assert_eq!(edit(&mut sim, 0, "Tim", None, &[], &[]).handled, 1);
    assert_eq!(edit(&mut sim, 0, "Tim", None, &[], &[]).handled, 2);
    // Load back into the same Sim, whose last answer is numbered 2, so a
    // count carried across the replacement would show.
    let snapshot = sim.save_snapshot_v5();
    sim.load_snapshot_v5(snapshot).unwrap();
    assert_eq!(
        sim.world().resource::<LotEditState>().last_edit_result,
        None
    );
    assert_eq!(edit(&mut sim, 0, "Tim", None, &[], &[]).handled, 1);
}

/// [ES-atomic]'s check order: person, name, personality, traits, then each
/// tie in submitted order. Each case breaks two fields and expects the
/// earlier check's refusal, which pins every adjacent pair in that order.
///
/// Within one tie the order (self-tie, unknown relative, repeated relative)
/// cannot be observed: a self-tie names the living target, and a repeated
/// relative's first appearance already passed the living check. The tie
/// cases pin instead that the first bad tie in the list decides the answer.
#[test]
fn the_earliest_failing_check_decides_the_refusal() {
    let mut sim = Sim::new_from_shipped_lot();
    let content = sim.world().resource::<crate::Content>().0;
    let max_traits = content.tuning.housemate_max_traits;
    let unknown_trait = content.traits.len() as u32;
    let unknown_personality = Some(content.personalities.len() as u32);
    // More traits than the limit, the first of them unknown.
    let too_many: Vec<u32> = std::iter::once(unknown_trait)
        .chain(0..max_traits)
        .collect();
    let self_tie = (0, Some(Relation::Sibling));
    let unknown_relative = (99, Some(Relation::Sibling));
    let bill = (1, Some(Relation::Sibling));
    let cases: Vec<InvalidEdit> = vec![
        (
            "person before name",
            99,
            "   ",
            None,
            vec![],
            vec![],
            EditRefusal::UnknownPerson,
        ),
        (
            "name before personality",
            0,
            "   ",
            unknown_personality,
            vec![],
            vec![],
            EditRefusal::BadName,
        ),
        (
            "personality before traits",
            0,
            "Tim",
            unknown_personality,
            vec![unknown_trait],
            vec![],
            EditRefusal::UnknownPersonality,
        ),
        (
            "trait count before trait index",
            0,
            "Tim",
            None,
            too_many,
            vec![],
            EditRefusal::TooManyTraits,
        ),
        (
            "trait index before repeat",
            0,
            "Tim",
            None,
            vec![1, 1, unknown_trait],
            vec![],
            EditRefusal::UnknownTrait,
        ),
        (
            "traits before ties",
            0,
            "Tim",
            None,
            vec![1, 1],
            vec![self_tie],
            EditRefusal::RepeatedTrait,
        ),
        (
            "an earlier self-tie before a later unknown relative",
            0,
            "Tim",
            None,
            vec![],
            vec![self_tie, unknown_relative],
            EditRefusal::SelfTie,
        ),
        (
            "an earlier unknown relative before a later self-tie",
            0,
            "Tim",
            None,
            vec![],
            vec![unknown_relative, self_tie],
            EditRefusal::UnknownRelative,
        ),
        (
            "an earlier repeat before a later unknown relative",
            0,
            "Tim",
            None,
            vec![],
            vec![bill, bill, unknown_relative],
            EditRefusal::RepeatedRelative,
        ),
    ];
    let hash = sim.world_hash();
    for (label, target, name, personality, traits, ties, expected) in cases {
        let result = edit(&mut sim, target, name, personality, &traits, &ties);
        assert_eq!(result.reason, Some(expected), "{label}");
        assert_eq!(sim.world_hash(), hash, "{label} wrote something");
    }
}

/// Ticks from `cooking_world`'s start to the middle of the first cooking
/// attempt. The cook starts beside the stove, so the attempt opens on tick 1
/// and, with no duration variance, completes on tick 20.
const TICKS_TO_START_COOKING: u64 = 10;
/// Further ticks from that point until the attempt completes on tick 20.
const TICKS_TO_FINISH_COOKING: u64 = 10;
/// The cook's SimId in `cooking_world`.
const COOK: u32 = 0;

/// The world of `a_fumbled_meal_starves_the_soul_but_teaches_the_hands` in
/// `systems/trait_effects.rs`: a hungry person wearing a level-0 cooking
/// capability beside a stove, so the first meal is a certain fumble. The
/// person also carries SimId 0, which an edit needs to find them. Ticked a
/// fixed count until the attempt is under way, and checked to be so.
fn cooking_world() -> (Sim, Entity) {
    use terri_data::{CompiledTrait, CompiledTraitKind, ContentPack};
    let mut cook_act =
        crate::test_content::interaction("cook", &[(terri_core::NeedId::Hunger, 40.0)], 20);
    cook_act.tags = vec!["cooking".to_string()];
    cook_act.satisfaction = 3.0;
    let base = crate::test_content::pack_tuned(
        vec![crate::test_content::object_offering(
            "stove",
            vec![cook_act],
        )],
        terri_data::Tuning {
            duration_variance: 0.0,
            ..crate::test_content::tuning()
        },
    );
    let pack: &'static ContentPack = Box::leak(Box::new(ContentPack {
        traits: vec![CompiledTrait {
            starting_satisfaction_offset: 0.0,
            id: "cannot_cook".to_string(),
            label: "Can't cook".to_string(),
            tag: "cooking".to_string(),
            kind: CompiledTraitKind::Capability {
                start_level: 0.0,
                fail_delta_scale: 0.0,
            },
            description: String::new(),
        }],
        ..base.clone()
    }));
    let mut sim = crate::test_content::sim_with(8, 8, pack);
    let stove = pack.find("stove").expect("fixture");
    sim.world_mut().spawn((
        terri_core::Position { x: 3.0, y: 1.0 },
        terri_core::SmartObject(stove),
    ));
    let mut needs = Needs::all_at(terri_core::NEED_MAX);
    needs.set(terri_core::NeedId::Hunger, 20.0);
    let entity = sim
        .world_mut()
        .spawn((
            terri_core::Agent,
            terri_core::SimId(COOK),
            terri_core::Position { x: 2.0, y: 1.0 },
            needs,
            terri_core::Satisfaction::from_value(0.0),
            Traits::from_entries(vec![(0, 0.0)]),
        ))
        .id();
    (sim, entity)
}

/// `cooking_world` ticked a fixed count until the fumbled attempt is under
/// way, and checked to be so. Returns the person's entity, their SimId and
/// the capability's pack index.
fn cooking_attempt_under_way() -> (Sim, Entity, u32, u32) {
    let (mut sim, entity) = cooking_world();
    for _ in 0..TICKS_TO_START_COOKING {
        sim.tick();
    }
    assert!(
        sim.world().get::<terri_core::Fumbled>(entity).is_some(),
        "the fumbled attempt is under way"
    );
    assert!(
        sim.world().get::<terri_core::Eating>(entity).is_some(),
        "the attempt has not completed"
    );
    (sim, entity, COOK, 0)
}

#[test]
fn removing_a_trait_mid_action_does_not_recreate_it_at_completion() {
    let (mut sim, entity, who, capability) = cooking_attempt_under_way();
    assert!(sim
        .world()
        .get::<Traits>(entity)
        .unwrap()
        .state(capability)
        .is_some());
    let before = sim.world().get::<Traits>(entity).unwrap().clone();
    assert_eq!(edit(&mut sim, who, "Ann", None, &[], &[]).reason, None);
    assert!(
        sim.world().get::<terri_core::Fumbled>(entity).is_some(),
        "the edit leaves the attempt under way"
    );
    let tick = tick_count(&sim);
    for _ in 0..TICKS_TO_FINISH_COOKING {
        sim.tick();
    }
    assert_eq!(
        tick_count(&sim),
        tick + TICKS_TO_FINISH_COOKING,
        "one tick per Sim::tick"
    );
    assert!(
        sim.world().get::<terri_core::Eating>(entity).is_none()
            && sim.world().get::<terri_core::Fumbled>(entity).is_none(),
        "the attempt completed"
    );
    assert_eq!(
        sim.world().get::<Traits>(entity).unwrap().state(capability),
        None
    );
    assert_ne!(before.state(capability), None);
}

/// Pack index of the trait with this authored id.
fn content_index_of_kind(sim: &Sim, id: &str) -> u32 {
    sim.world()
        .resource::<crate::Content>()
        .0
        .traits
        .iter()
        .position(|worn| worn.id == id)
        .unwrap_or_else(|| panic!("content has no trait {id}")) as u32
}

fn replace_personality(
    sim: &mut Sim,
    entity: Entity,
    change: impl FnOnce(&mut Personality) -> Personality,
) {
    let current = sim.world().get::<Personality>(entity).unwrap().clone();
    let mut current = current;
    let next = change(&mut current);
    sim.world_mut().entity_mut(entity).insert(next);
}

#[test]
fn the_world_hash_observes_each_personality_effect_and_not_the_name() {
    let mut sim = Sim::new_from_shipped_lot();
    let entity = person(&sim, 0);
    let base = sim.world_hash();

    replace_personality(&mut sim, entity, |p| {
        p.drain[2] += 0.25;
        p.clone()
    });
    let drain = sim.world_hash();
    assert_ne!(base, drain, "drain is hashed");

    replace_personality(&mut sim, entity, |p| {
        p.drain[2] -= 0.25;
        p.satisfaction[4] += 0.25;
        p.clone()
    });
    let satisfaction = sim.world_hash();
    assert_ne!(base, satisfaction, "satisfaction is hashed");
    assert_ne!(drain, satisfaction);

    replace_personality(&mut sim, entity, |p| {
        p.satisfaction[4] -= 0.25;
        let mut dispositions = p.dispositions().to_vec();
        dispositions.push((terri_core::ObjectDefId(0), 0, 2.0));
        let mut next = Personality::with_dispositions(p.drain, p.satisfaction, dispositions);
        next.chronotype_offset_ticks = p.chronotype_offset_ticks;
        next
    });
    let dispositions = sim.world_hash();
    assert_ne!(base, dispositions, "dispositions are hashed");

    replace_personality(&mut sim, entity, |p| {
        // `with_dispositions` sorts by key, so the added row sits wherever
        // its key falls; remove that row, not the last one.
        let mut dispositions = p.dispositions().to_vec();
        let added = dispositions
            .iter()
            .position(|row| *row == (terri_core::ObjectDefId(0), 0, 2.0))
            .expect("the added disposition is present");
        dispositions.remove(added);
        let mut next = Personality::with_dispositions(p.drain, p.satisfaction, dispositions);
        next.chronotype_offset_ticks = p.chronotype_offset_ticks;
        next
    });
    assert_eq!(
        sim.world_hash(),
        base,
        "restoring the effects restores the hash"
    );

    // Same number of rows, one weight changed: the rows themselves are
    // hashed, not only their count.
    let reweigh = |delta: f32| {
        move |p: &mut Personality| {
            let mut dispositions = p.dispositions().to_vec();
            dispositions[0].2 += delta;
            let mut next = Personality::with_dispositions(p.drain, p.satisfaction, dispositions);
            next.chronotype_offset_ticks = p.chronotype_offset_ticks;
            next
        }
    };
    replace_personality(&mut sim, entity, reweigh(0.25));
    assert_ne!(sim.world_hash(), base, "disposition weights are hashed");
    replace_personality(&mut sim, entity, reweigh(-0.25));
    assert_eq!(
        sim.world_hash(),
        base,
        "restoring the weight restores the hash"
    );

    // One f32 step, far inside a 1e-4 rounding bucket, is still a change.
    let original = sim.world().get::<Personality>(entity).unwrap().drain[2];
    replace_personality(&mut sim, entity, |p| {
        p.drain[2] = f32::from_bits(original.to_bits() + 1);
        p.clone()
    });
    assert_ne!(sim.world_hash(), base, "a one-step drain change is hashed");
    replace_personality(&mut sim, entity, |p| {
        p.drain[2] = original;
        p.clone()
    });
    assert_eq!(
        sim.world_hash(),
        base,
        "restoring the step restores the hash"
    );

    // The same for a refill multiplier and a disposition weight.
    let original = sim.world().get::<Personality>(entity).unwrap().satisfaction[4];
    replace_personality(&mut sim, entity, |p| {
        p.satisfaction[4] = f32::from_bits(original.to_bits() + 1);
        p.clone()
    });
    assert_ne!(
        sim.world_hash(),
        base,
        "a one-step satisfaction change is hashed"
    );
    replace_personality(&mut sim, entity, |p| {
        p.satisfaction[4] = original;
        p.clone()
    });
    assert_eq!(sim.world_hash(), base, "restoring the satisfaction step");
    let step_weight = |up: bool| {
        move |p: &mut Personality| {
            let mut dispositions = p.dispositions().to_vec();
            let bits = dispositions[0].2.to_bits();
            dispositions[0].2 = f32::from_bits(if up { bits + 1 } else { bits - 1 });
            let mut next = Personality::with_dispositions(p.drain, p.satisfaction, dispositions);
            next.chronotype_offset_ticks = p.chronotype_offset_ticks;
            next
        }
    };
    replace_personality(&mut sim, entity, step_weight(true));
    assert_ne!(
        sim.world_hash(),
        base,
        "a one-step disposition weight change is hashed"
    );
    replace_personality(&mut sim, entity, step_weight(false));
    assert_eq!(sim.world_hash(), base, "restoring the weight step");

    sim.world_mut().get_mut::<SimName>(entity).unwrap().0 = "Somebody Else".to_string();
    assert_eq!(sim.world_hash(), base, "names stay out of the hash");
}

#[test]
fn the_archetype_is_derived_only_from_a_complete_exact_match() {
    let mut sim = Sim::new_from_shipped_lot();
    let content = sim.world().resource::<crate::Content>().0;
    let correspondent = content
        .personalities
        .iter()
        .position(|p| p.id == "the_correspondent")
        .unwrap() as u32;
    let entity = person(&sim, 0);
    assert_eq!(
        sim.personality_archetype_of(entity.index_u32()),
        Some(correspondent)
    );
    assert_eq!(archetype_of(sim.world(), entity), Some(correspondent));

    // A legacy person whose chronotype stayed at the historical zero is not
    // the archetype, even though every multiplier matches. That only tests
    // something while the archetype's authored offset is nonzero.
    assert_ne!(
        content.personalities[correspondent as usize].chronotype_offset_ticks, 0,
        "the archetype has an authored chronotype"
    );
    replace_personality(&mut sim, entity, |p| {
        p.chronotype_offset_ticks = 0;
        p.clone()
    });
    assert_eq!(sim.personality_archetype_of(entity.index_u32()), None);

    replace_personality(&mut sim, entity, |p| {
        p.chronotype_offset_ticks =
            content.personalities[correspondent as usize].chronotype_offset_ticks;
        p.drain[0] += 0.5;
        p.clone()
    });
    assert_eq!(
        sim.personality_archetype_of(entity.index_u32()),
        None,
        "a rebalanced multiplier breaks the match"
    );

    // Adopting an archetype through an edit makes the match exact again.
    let settled = content
        .personalities
        .iter()
        .position(|p| p.id == "the_settled")
        .unwrap() as u32;
    assert_eq!(
        edit(&mut sim, 0, "Tim", Some(settled), &[], &[]).reason,
        None
    );
    assert_eq!(
        sim.personality_archetype_of(entity.index_u32()),
        Some(settled)
    );

    // Not a person: an object entity index, and an index past the world.
    let object = sim
        .world_mut()
        .query_filtered::<Entity, With<terri_core::SmartObject>>()
        .iter(sim.world())
        .next()
        .expect("the shipped lot has furniture");
    assert_eq!(sim.personality_archetype_of(object.index_u32()), None);
    assert_eq!(sim.personality_archetype_of(u32::MAX - 1), None);
}

/// A personality for the ambiguity fixture: every drain multiplier at
/// `drain`, every refill multiplier at 0.75, and a 60-tick late chronotype.
fn fixture_personality(id: &str, drain: f32) -> terri_data::CompiledPersonality {
    terri_data::CompiledPersonality {
        cleanliness: 0.5,
        id: id.to_string(),
        drain: [drain; terri_core::NEED_COUNT],
        satisfaction: [0.75; terri_core::NEED_COUNT],
        dispositions: vec![(terri_core::ObjectDefId(0), 0, 1.5)],
        chronotype_offset_ticks: 60,
        description: String::new(),
    }
}

#[test]
fn two_archetypes_with_identical_effects_match_neither() {
    let base = crate::test_content::pack_tuned(Vec::new(), crate::test_content::tuning());
    let pack: &'static terri_data::ContentPack = Box::leak(Box::new(terri_data::ContentPack {
        personalities: vec![
            fixture_personality("first_twin", 1.25),
            fixture_personality("second_twin", 1.25),
            fixture_personality("loner", 1.5),
        ],
        ..base.clone()
    }));
    let mut sim = crate::test_content::sim_with(8, 8, pack);
    let twin = sim
        .world_mut()
        .spawn((
            terri_core::Agent,
            crate::household::personality_from(&pack.personalities[0]),
        ))
        .id();
    let loner = sim
        .world_mut()
        .spawn((
            terri_core::Agent,
            crate::household::personality_from(&pack.personalities[2]),
        ))
        .id();
    assert_eq!(
        archetype_of(sim.world(), loner),
        Some(2),
        "a unique match in the same pack is found"
    );
    assert_eq!(
        archetype_of(sim.world(), twin),
        None,
        "two equal archetypes are ambiguous"
    );
    let not_a_person = sim
        .world_mut()
        .spawn(crate::household::personality_from(&pack.personalities[2]))
        .id();
    assert_eq!(
        archetype_of(sim.world(), not_a_person),
        None,
        "a personality without a person matches nothing"
    );
}

/// Replaces the person's dispositions with exactly `rows`, keeping every
/// other effect.
fn set_dispositions(sim: &mut Sim, entity: Entity, rows: Vec<(terri_core::ObjectDefId, u32, f32)>) {
    replace_personality(sim, entity, |p| {
        let mut next = Personality::with_dispositions(p.drain, p.satisfaction, rows);
        next.chronotype_offset_ticks = p.chronotype_offset_ticks;
        next
    });
}

#[test]
fn the_world_hash_observes_each_disposition_key() {
    use terri_core::ObjectDefId;
    let mut sim = Sim::new_from_shipped_lot();
    let entity = person(&sim, 0);
    let authored = sim
        .world()
        .get::<Personality>(entity)
        .unwrap()
        .dispositions()
        .to_vec();
    let base = sim.world_hash();

    // One row each time, same weight, so only the key differs.
    set_dispositions(&mut sim, entity, vec![(ObjectDefId(0), 0, 2.0)]);
    let first = sim.world_hash();
    set_dispositions(&mut sim, entity, vec![(ObjectDefId(0), 1, 2.0)]);
    let other_interaction = sim.world_hash();
    set_dispositions(&mut sim, entity, vec![(ObjectDefId(1), 0, 2.0)]);
    let other_object = sim.world_hash();
    assert_ne!(
        first, other_interaction,
        "a disposition's interaction is hashed"
    );
    assert_ne!(first, other_object, "a disposition's object is hashed");

    set_dispositions(&mut sim, entity, authored);
    assert_eq!(
        sim.world_hash(),
        base,
        "restoring the dispositions restores the hash"
    );
}

/// A personality with no chronotype offset, so the chronotype block (which
/// writes entity indices of its own) stays absent.
fn offsetless_personality(drain: f32) -> Personality {
    Personality::with_dispositions(
        [drain; terri_core::NEED_COUNT],
        [0.75; terri_core::NEED_COUNT],
        vec![(terri_core::ObjectDefId(0), 0, 1.5)],
    )
}

/// An empty fixture world with no content-driven people.
fn empty_world() -> Sim {
    crate::test_content::sim_with(
        8,
        8,
        crate::test_content::pack_tuned(Vec::new(), crate::test_content::tuning()),
    )
}

#[test]
fn the_world_hash_keys_personality_effects_by_person() {
    let mut sim = empty_world();
    let first = sim
        .world_mut()
        .spawn((terri_core::Agent, offsetless_personality(1.25)))
        .id();
    let second = sim.world_mut().spawn(terri_core::Agent).id();
    let before = sim.world_hash();
    assert_eq!(crate::edit::personality_rows(sim.world()).len(), 1);

    // The same effects, the same row count, on a different person.
    let moved = sim
        .world_mut()
        .entity_mut(first)
        .take::<Personality>()
        .unwrap();
    sim.world_mut().entity_mut(second).insert(moved);
    assert_eq!(crate::edit::personality_rows(sim.world()).len(), 1);
    assert_ne!(
        sim.world_hash(),
        before,
        "the person's entity index is hashed"
    );
}

/// Two people with different effects, spawned in index order. With
/// `perturb`, the lower-indexed person is moved into the other's archetype
/// after it, so the query yields the higher index first.
fn two_people(perturb: bool) -> (Sim, Entity, Entity) {
    let mut sim = empty_world();
    let low = if perturb {
        sim.world_mut()
            .spawn((terri_core::Agent, offsetless_personality(1.25)))
            .id()
    } else {
        sim.world_mut()
            .spawn((
                terri_core::Agent,
                offsetless_personality(1.25),
                terri_core::Selected,
            ))
            .id()
    };
    let high = sim
        .world_mut()
        .spawn((
            terri_core::Agent,
            offsetless_personality(1.5),
            terri_core::Selected,
        ))
        .id();
    if perturb {
        sim.world_mut().entity_mut(low).insert(terri_core::Selected);
    }
    (sim, low, high)
}

/// Entity indices in the order the ECS yields people with personalities.
fn raw_personality_order(sim: &Sim) -> Vec<u32> {
    sim.world()
        .try_query::<(Entity, &terri_core::Agent, &Personality)>()
        .unwrap()
        .iter(sim.world())
        .map(|(entity, _, _)| entity.index_u32())
        .collect()
}

#[test]
fn personality_effects_hash_in_entity_index_order_whatever_the_table_order() {
    let (sorted, low, high) = two_people(false);
    let (perturbed, perturbed_low, perturbed_high) = two_people(true);
    assert_eq!(
        (low, high),
        (perturbed_low, perturbed_high),
        "same entities in both worlds"
    );
    assert_eq!(
        raw_personality_order(&sorted),
        vec![low.index_u32(), high.index_u32()]
    );
    assert_eq!(
        raw_personality_order(&perturbed),
        vec![high.index_u32(), low.index_u32()],
        "the fixture really yields the higher index first"
    );
    assert_eq!(
        crate::edit::personality_rows(perturbed.world()),
        crate::edit::personality_rows(sorted.world())
    );
    assert_eq!(
        perturbed.world_hash(),
        sorted.world_hash(),
        "table order does not reach the hash"
    );
}

#[test]
fn a_changed_cleanliness_score_breaks_the_match_until_an_explicit_edit() {
    let mut sim = Sim::new_from_shipped_lot();
    let content = sim.world().resource::<crate::Content>().0;
    let correspondent = content
        .personalities
        .iter()
        .position(|p| p.id == "the_correspondent")
        .unwrap() as u32;
    let entity = person(&sim, 0);
    assert_eq!(archetype_of(sim.world(), entity), Some(correspondent));
    let authored = content.personalities[correspondent as usize].cleanliness;
    assert_ne!(authored, 0.123);

    // A stored score that is not the archetype's, every other effect equal.
    if sim.world().get_resource::<SavedDomestic>().is_none() {
        sim.world_mut().insert_resource(SavedDomestic::default());
    }
    {
        let mut domestic = sim.world_mut().resource_mut::<SavedDomestic>();
        let index = entity.index_u32();
        match domestic.cleanliness.iter_mut().find(|row| row.0 == index) {
            Some(row) => row.1 = 0.123,
            None => {
                domestic.cleanliness.push((index, 0.123));
                domestic.cleanliness.sort_unstable_by_key(|row| row.0);
            }
        }
    }
    assert_eq!(crate::domestic::cleanliness(sim.world(), entity), 0.123);
    assert_eq!(
        sim.personality_archetype_of(entity.index_u32()),
        None,
        "a different cleanliness score breaks the match"
    );

    // Choosing the archetype explicitly rewrites the score.
    assert_eq!(
        edit(&mut sim, 0, "Tim", Some(correspondent), &[], &[]).reason,
        None
    );
    assert_eq!(crate::domestic::cleanliness(sim.world(), entity), authored);
    assert_eq!(
        sim.personality_archetype_of(entity.index_u32()),
        Some(correspondent)
    );
}

// ---- Evidence item 7: an edit leaves every running action alone ----------

/// Appends what an editable fixture person needs to a mid-action fixture
/// pack, which carries no personalities or traits of its own: personalities
/// `before_edit` (index 0) and `after_edit` (index 1), and one trait (index
/// 0). Both personalities keep every drain and refill multiplier at 1 and
/// carry no dispositions; they differ only in chronotype, which these packs
/// cannot act on because they have no circadian curve. The trait is a
/// disposition on a tag no fixture activity carries. The edit therefore
/// changes the person's name, personality and traits without changing what
/// the new values would make them do, which isolates what these tests ask:
/// whether the edit disturbs a running action, chain, reservation,
/// conversation or shift.
fn with_edit_fixtures(base: &terri_data::ContentPack) -> &'static terri_data::ContentPack {
    let personality = |id: &str, chronotype: i32| terri_data::CompiledPersonality {
        cleanliness: 0.5,
        id: id.to_string(),
        drain: [1.0; terri_core::NEED_COUNT],
        satisfaction: [1.0; terri_core::NEED_COUNT],
        dispositions: Vec::new(),
        chronotype_offset_ticks: chronotype,
        description: String::new(),
    };
    Box::leak(Box::new(terri_data::ContentPack {
        personalities: vec![
            personality("before_edit", 0),
            personality("after_edit", AFTER_EDIT_CHRONOTYPE),
        ],
        traits: vec![terri_data::CompiledTrait {
            starting_satisfaction_offset: 0.0,
            id: "edit_fixture".to_string(),
            label: "Edit fixture".to_string(),
            tag: "edit_fixture".to_string(),
            kind: terri_data::CompiledTraitKind::Disposition {
                score_multiplier: 1.0,
            },
            description: String::new(),
        }],
        ..base.clone()
    }))
}

const BEFORE_EDIT: u32 = 0;
const AFTER_EDIT: u32 = 1;
const AFTER_EDIT_CHRONOTYPE: i32 = 90;
const FIXTURE_TRAIT: u32 = 0;

/// Gives a fixture person what an edit acts on: a SimId, a name, the
/// `before_edit` personality and the fixture trait.
fn make_editable(sim: &mut Sim, entity: Entity, sim_id: u32) {
    let content = sim.world().resource::<crate::Content>().0;
    let personality =
        crate::household::personality_from(&content.personalities[BEFORE_EDIT as usize]);
    sim.world_mut().entity_mut(entity).insert((
        terri_core::SimId(sim_id),
        SimName("Before".to_string()),
        personality,
        Traits::from_entries(vec![(FIXTURE_TRAIT, 0.0)]),
    ));
}

/// The mid-action edit, checked to have landed: a new name, the other
/// personality, and the trait removed.
fn edit_mid_action(sim: &mut Sim, sim_id: u32) {
    let result = edit(sim, sim_id, "After", Some(AFTER_EDIT), &[], &[]);
    assert_eq!(result.reason, None, "the mid-action edit is accepted");
    let entity = person(sim, sim_id);
    assert_eq!(name_of(sim, sim_id), "After");
    assert_eq!(
        sim.world()
            .get::<Personality>(entity)
            .unwrap()
            .chronotype_offset_ticks,
        AFTER_EDIT_CHRONOTYPE
    );
    assert_eq!(traits_of(sim, sim_id), vec![]);
}

/// Ticks two sims the same fixed count.
fn tick_both(edited: &mut Sim, control: &mut Sim, ticks: u64) {
    for _ in 0..ticks {
        edited.tick();
        control.tick();
    }
}

/// A copy of `a_chain` in `systems/chain.rs`'s tests: fetch at the pantry
/// for 16 ticks, eat at the table for 20, paying 2.5 satisfaction at the end.
fn edit_test_chain() -> terri_data::CompiledChain {
    let step = |role: u32, label: &str, duration_ticks: u32| terri_data::CompiledChainStep {
        role,
        label: label.to_string(),
        duration_ticks,
        tags: vec![],
        yields: None,
        transforms: None,
        consumes: None,
        visual: None,
        sound_action: None,
        activity: None,
    };
    terri_data::CompiledChain {
        id: "cook_dinner".to_string(),
        label: "Cook dinner".to_string(),
        advertised_by: terri_data::ObjectDefId(0),
        advertises: vec![(0, 48.0), (6, 12.0)],
        satisfaction: 2.5,
        steps: vec![
            terri_data::CompiledChainStep {
                yields: Some(0),
                ..step(0, "Fetch", 16)
            },
            terri_data::CompiledChainStep {
                tags: vec!["cooking".to_string()],
                consumes: Some(0),
                ..step(1, "Eat", 20)
            },
        ],
    }
}

/// `chain_world` from `systems/chain.rs`'s tests with the chain begun and
/// the agent made editable as SimId 0. Returns (sim, agent, fridge, pantry,
/// table).
fn edit_chain_world() -> (Sim, Entity, Entity, Entity, Entity) {
    use crate::test_content;
    let mut pantry = test_content::object_offering("pantry", vec![]);
    pantry.roles = vec![0];
    let mut table = test_content::object_offering("table", vec![]);
    table.roles = vec![1];
    let fridge = test_content::object("fridge", &[(terri_core::NeedId::Hunger, 40.0)], 30);
    let base = test_content::pack_tuned(
        vec![fridge, pantry, table],
        terri_data::Tuning {
            duration_variance: 0.0,
            choice_temperature: 0.0001,
            ..test_content::tuning()
        },
    );
    let pack = with_edit_fixtures(&terri_data::ContentPack {
        roles: vec!["pantry_shelf".to_string(), "eating_surface".to_string()],
        item_kinds: vec!["dinner".to_string()],
        chains: vec![edit_test_chain()],
        ..base.clone()
    });
    let mut sim = test_content::sim_with(12, 8, pack);
    let station = |sim: &mut Sim, id: &str, x: f32| {
        let def = pack.find(id).expect("fixture");
        sim.world_mut()
            .spawn((
                terri_core::Position { x, y: 1.0 },
                terri_core::SmartObject(def),
            ))
            .id()
    };
    let fridge = station(&mut sim, "fridge", 1.0);
    let pantry = station(&mut sim, "pantry", 4.0);
    let table = station(&mut sim, "table", 8.0);
    let mut needs = Needs::all_at(80.0);
    needs.set(terri_core::NeedId::Hunger, 20.0);
    let agent = sim
        .world_mut()
        .spawn((
            terri_core::Agent,
            terri_core::Position { x: 2.0, y: 4.0 },
            needs,
            terri_core::Satisfaction::from_value(0.0),
            terri_core::Hobbies(vec!["cooking".to_string()]),
        ))
        .id();
    make_editable(&mut sim, agent, 0);
    sim.world_mut()
        .entity_mut(agent)
        .insert(terri_core::ChainState::begin(0));
    (sim, agent, fridge, pantry, table)
}

/// `chat_pack` and `household_of_two` from `systems/social.rs`'s tests:
/// a lonely initiator (SimId 0) three tiles from a partner (SimId 1), both
/// made editable. Returns (sim, initiator, partner).
fn edit_talk_world() -> (Sim, Entity, Entity) {
    use crate::test_content;
    let base = test_content::pack_with_social(
        vec![],
        vec![test_content::interaction(
            "chat",
            &[(terri_core::NeedId::Social, 30.0)],
            40,
        )],
        test_content::tuning(),
    );
    let pack = with_edit_fixtures(base);
    let mut sim = test_content::sim_with(8, 8, pack);
    let initiator = sim
        .world_mut()
        .spawn((
            terri_core::Agent,
            terri_core::Position { x: 1.0, y: 1.0 },
            Needs::with(terri_core::NeedId::Social, 20.0),
        ))
        .id();
    let partner = sim
        .world_mut()
        .spawn((
            terri_core::Agent,
            terri_core::Position { x: 4.0, y: 1.0 },
            Needs::with(terri_core::NeedId::Social, 60.0),
        ))
        .id();
    make_editable(&mut sim, initiator, 0);
    make_editable(&mut sim, partner, 1);
    (sim, initiator, partner)
}

/// `career_pack` and `a_worker` from `systems/career.rs`'s tests: a 6-tick
/// shift from day-tick 3 of a 30-tick day paying 130, 11.5 energy and 2.25
/// satisfaction, and one worker near the front door, made editable as SimId
/// 0. Returns (sim, worker).
fn edit_work_world() -> (Sim, Entity) {
    use crate::test_content;
    let base = test_content::pack_tuned(
        vec![],
        terri_data::Tuning {
            day_ticks: 30,
            duration_variance: 0.0,
            ..test_content::tuning()
        },
    );
    let pack = with_edit_fixtures(&terri_data::ContentPack {
        careers: vec![terri_data::CompiledCareer {
            id: "office_job".to_string(),
            label: "Office clerk".to_string(),
            shift_start: 3,
            shift_ticks: 6,
            pay: 130,
            energy_cost: 11.5,
            satisfaction: 2.25,
            working_days: 0b1111111,
        }],
        ..base.clone()
    });
    let mut sim = test_content::sim_with(16, 12, pack);
    let worker = sim
        .world_mut()
        .spawn((
            terri_core::Agent,
            terri_core::Position { x: 13.0, y: 2.0 },
            Needs::all_at(80.0),
            terri_core::Satisfaction::from_value(0.0),
            terri_core::Career(0),
        ))
        .id();
    make_editable(&mut sim, worker, 0);
    (sim, worker)
}

fn satisfaction_of(sim: &Sim, entity: Entity) -> f32 {
    sim.world()
        .get::<terri_core::Satisfaction>(entity)
        .unwrap()
        .value()
}

/// One chain payout, read the way `a_chain_runs_both_stations_and_pays_only_at_the_end`
/// in `systems/chain.rs` reads it: base satisfaction times the hobby
/// multiplier, on the reward scale.
fn one_chain_payout() -> f32 {
    2.5 * crate::test_content::tuning().hobby_multiplier * terri_core::Satisfaction::REWARD_SCALE
}

/// Tick 40 of `edit_chain_world` is inside the tagged eating step (the
/// chain moves to step 1 on tick 32); the chain completes on tick 68.
const CHAIN_EDIT_TICK: u64 = 40;
const CHAIN_DONE_TICK: u64 = 68;

#[test]
fn an_edit_mid_chain_leaves_the_chain_to_finish_once_and_release_its_stations() {
    let (mut edited, agent, _fridge, pantry, table) = edit_chain_world();
    let (mut control, ..) = edit_chain_world();
    tick_both(&mut edited, &mut control, CHAIN_EDIT_TICK);
    for sim in [&edited, &control] {
        let chain = sim.world().get::<terri_core::ChainState>(agent);
        assert_eq!(chain.map(|c| c.step), Some(1), "mid-chain at the edit");
    }
    edit_mid_action(&mut edited, 0);
    control.flush_commands();
    tick_both(
        &mut edited,
        &mut control,
        CHAIN_DONE_TICK - CHAIN_EDIT_TICK - 1,
    );
    assert_eq!(tick_count(&edited), CHAIN_DONE_TICK - 1);
    for sim in [&edited, &control] {
        assert!(
            sim.world().get::<terri_core::ChainState>(agent).is_some(),
            "the chain is still running one tick before it completes"
        );
    }
    let before_payout = satisfaction_of(&edited, agent);
    tick_both(&mut edited, &mut control, 1);
    assert_eq!(tick_count(&edited), CHAIN_DONE_TICK);
    let world = edited.world();
    assert!(
        world.get::<terri_core::ChainState>(agent).is_none(),
        "the edited person's chain completed on schedule"
    );
    assert!(world.get::<terri_core::Carrying>(agent).is_none());
    assert!(
        world.get::<terri_core::Reserved>(pantry).is_none()
            && world.get::<terri_core::Reserved>(table).is_none(),
        "every station released"
    );
    let paid = satisfaction_of(&edited, agent) - before_payout;
    assert!(
        (paid - one_chain_payout()).abs() < 0.001,
        "one payout of {} at completion; got {paid}",
        one_chain_payout()
    );
    assert_eq!(
        satisfaction_of(&edited, agent),
        satisfaction_of(&control, agent),
        "the edited run pays exactly what the unedited run pays"
    );
    assert_eq!(
        edited.world().get::<Needs>(agent),
        control.world().get::<Needs>(agent)
    );
}

/// In `edit_chain_world`, a snack ordered after tick 10 is being eaten by
/// tick 20 with the chain held; the chain resumes on tick 43 and completes
/// on tick 98.
const SNACK_ORDER_TICK: u64 = 10;
const SNACK_EDIT_TICK: u64 = 20;
const CHAIN_RESUMED_TICK: u64 = 43;
const RESUMED_DONE_TICK: u64 = 98;

#[test]
fn an_edit_during_an_interrupting_order_lets_the_chain_resume_and_pay_once() {
    let (mut edited, agent, fridge, pantry, table) = edit_chain_world();
    let (mut control, ..) = edit_chain_world();
    tick_both(&mut edited, &mut control, SNACK_ORDER_TICK);
    for sim in [&mut edited, &mut control] {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObject {
                agent: agent.index_u32(),
                object: fridge.index_u32(),
                interaction: 0,
            });
    }
    tick_both(
        &mut edited,
        &mut control,
        SNACK_EDIT_TICK - SNACK_ORDER_TICK,
    );
    for sim in [&edited, &control] {
        let world = sim.world();
        assert!(world.get::<terri_core::Eating>(agent).is_some(), "snacking");
        assert!(
            world.get::<terri_core::ChainState>(agent).is_some(),
            "with the chain held"
        );
    }
    edit_mid_action(&mut edited, 0);
    control.flush_commands();
    tick_both(
        &mut edited,
        &mut control,
        CHAIN_RESUMED_TICK - SNACK_EDIT_TICK,
    );
    for sim in [&edited, &control] {
        let world = sim.world();
        assert!(
            world.get::<terri_core::Eating>(agent).is_none(),
            "snack done"
        );
        assert_eq!(
            world.get::<terri_core::ChainState>(agent).map(|c| c.step),
            Some(0),
            "the chain resumed where the order interrupted it"
        );
        assert!(
            world.get::<terri_core::Target>(agent).is_some(),
            "and is heading for its station again"
        );
    }
    tick_both(
        &mut edited,
        &mut control,
        RESUMED_DONE_TICK - CHAIN_RESUMED_TICK - 1,
    );
    for sim in [&edited, &control] {
        assert!(sim.world().get::<terri_core::ChainState>(agent).is_some());
    }
    let before_payout = satisfaction_of(&edited, agent);
    tick_both(&mut edited, &mut control, 1);
    assert_eq!(tick_count(&edited), RESUMED_DONE_TICK);
    let world = edited.world();
    assert!(world.get::<terri_core::ChainState>(agent).is_none());
    assert!(
        world.get::<terri_core::Reserved>(pantry).is_none()
            && world.get::<terri_core::Reserved>(table).is_none(),
        "every station released"
    );
    let paid = satisfaction_of(&edited, agent) - before_payout;
    assert!(
        (paid - one_chain_payout()).abs() < 0.001,
        "the resumed chain pays once; got {paid}"
    );
    assert_eq!(
        satisfaction_of(&edited, agent),
        satisfaction_of(&control, agent)
    );
}

/// In `edit_talk_world` the conversation runs from tick 9 and ends on tick 41.
const TALK_EDIT_TICK: u64 = 20;
const TALK_DONE_TICK: u64 = 41;

#[test]
fn an_edit_of_either_participant_lets_the_conversation_end_normally() {
    for edited_id in [0, 1] {
        let (mut edited, initiator, partner) = edit_talk_world();
        let (mut control, ..) = edit_talk_world();
        tick_both(&mut edited, &mut control, TALK_EDIT_TICK);
        for sim in [&edited, &control] {
            let world = sim.world();
            assert!(world.get::<terri_core::Socialising>(initiator).is_some());
            assert!(world.get::<terri_core::Reserved>(partner).is_some());
        }
        edit_mid_action(&mut edited, edited_id);
        control.flush_commands();
        tick_both(
            &mut edited,
            &mut control,
            TALK_DONE_TICK - TALK_EDIT_TICK - 1,
        );
        for sim in [&edited, &control] {
            assert!(
                sim.world()
                    .get::<terri_core::Socialising>(initiator)
                    .is_some(),
                "editing SimId {edited_id}: the talk still runs one tick before its end"
            );
        }
        tick_both(&mut edited, &mut control, 1);
        assert_eq!(tick_count(&edited), TALK_DONE_TICK);
        let world = edited.world();
        assert!(
            world.get::<terri_core::Socialising>(initiator).is_none(),
            "editing SimId {edited_id}: the talk ended on schedule"
        );
        assert!(
            world.get::<terri_core::Reserved>(partner).is_none()
                && world.get::<terri_core::Socialising>(partner).is_none(),
            "editing SimId {edited_id}: the partner is released, not stranded"
        );
        for who in [initiator, partner] {
            assert_eq!(
                edited.world().get::<Needs>(who),
                control.world().get::<Needs>(who),
                "editing SimId {edited_id}: both sides were filled as usual"
            );
            assert_eq!(
                edited.world().get::<terri_core::Relationships>(who),
                control.world().get::<terri_core::Relationships>(who),
                "editing SimId {edited_id}: both sides remember the talk as usual"
            );
        }
    }
}

/// In `edit_work_world` the worker clocks in on tick 13 and returns on
/// tick 19.
const WORK_EDIT_TICK: u64 = 15;
const WORK_DONE_TICK: u64 = 19;

/// Ticks both work worlds with mood satisfaction off, as
/// `a_shift_walks_to_the_door_vanishes_and_the_return_pays` does, so the
/// career's satisfaction is the only satisfaction that lands.
fn tick_both_at_work(edited: &mut Sim, control: &mut Sim, ticks: u64) {
    for _ in 0..ticks {
        for sim in [&mut *edited, &mut *control] {
            crate::test_content::disable_mood_satisfaction(sim);
            sim.tick();
        }
    }
}

#[test]
fn an_edit_at_work_keeps_one_wage_and_the_return() {
    let (mut edited, worker) = edit_work_world();
    let (mut control, _) = edit_work_world();
    tick_both_at_work(&mut edited, &mut control, WORK_EDIT_TICK);
    for sim in [&edited, &control] {
        assert!(sim.world().get::<terri_core::AtWork>(worker).is_some());
        assert_eq!(sim.funds(), 0);
    }
    edit_mid_action(&mut edited, 0);
    control.flush_commands();
    tick_both_at_work(
        &mut edited,
        &mut control,
        WORK_DONE_TICK - WORK_EDIT_TICK - 1,
    );
    for sim in [&edited, &control] {
        assert!(
            sim.world().get::<terri_core::AtWork>(worker).is_some(),
            "still at work one tick before the return"
        );
    }
    tick_both_at_work(&mut edited, &mut control, 1);
    assert_eq!(tick_count(&edited), WORK_DONE_TICK);
    assert!(
        edited.world().get::<terri_core::AtWork>(worker).is_none(),
        "the edited worker came back on schedule"
    );
    assert_eq!(edited.funds(), 130, "one shift, one pay packet");
    assert_eq!(
        satisfaction_of(&edited, worker),
        2.25 * terri_core::Satisfaction::REWARD_SCALE,
        "the career's satisfaction lands exactly once"
    );
    assert_eq!(
        edited.world().get::<terri_core::Position>(worker),
        control.world().get::<terri_core::Position>(worker),
        "the return puts the worker where the unedited run puts them"
    );
    assert_eq!(
        edited.world().get::<Needs>(worker),
        control.world().get::<Needs>(worker)
    );
}

// ---- Evidence items 2, 3 and 6: an accepted edit saves and loads ---------

/// Ticks both sims run after a load before their hashes are compared.
const REPLAY_TICKS: u64 = 300;

#[test]
fn an_accepted_edit_saves_loads_and_replays_identically() {
    let mut sim = Sim::new_from_shipped_lot();
    let content = sim.world().resource::<crate::Content>().0;
    let flitting = content
        .personalities
        .iter()
        .position(|p| p.id == "the_flitting")
        .unwrap() as u32;
    assert_ne!(
        content.personalities[flitting as usize].chronotype_offset_ticks, 0,
        "the test needs a nonzero authored offset"
    );
    let removed = content_index_of_kind(&sim, "bookworm");
    let added = content_index_of_kind(&sim, "cannot_cook");
    let mut traits: Vec<u32> = traits_of(&sim, 0)
        .into_iter()
        .map(|(index, _)| index)
        .filter(|&index| index != removed)
        .collect();
    assert_eq!(traits.len(), 2, "Tim wore bookworm and two others");
    traits.push(added);
    let result = edit(
        &mut sim,
        0,
        "Timothy",
        Some(flitting),
        &traits,
        &[(1, Some(Relation::Sibling))],
    );
    assert_eq!(result.reason, None);
    let entity = person(&sim, 0);
    let personality = sim.world().get::<Personality>(entity).unwrap().clone();
    assert!(!personality.dispositions().is_empty());
    let worn = traits_of(&sim, 0);
    assert!(worn.iter().any(|(index, _)| *index == added));
    assert!(worn.iter().all(|(index, _)| *index != removed));
    assert_eq!(
        sim.personality_archetype_of(entity.index_u32()),
        Some(flitting)
    );

    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    let loaded_entity = person(&loaded, 0);
    assert_eq!(
        loaded.world().get::<Personality>(loaded_entity).unwrap(),
        &personality,
        "drain, refill, dispositions and chronotype all load"
    );
    assert_eq!(traits_of(&loaded, 0), worn);
    assert_eq!(name_of(&loaded, 0), "Timothy");
    assert_eq!(family(&loaded), family(&sim));
    assert_eq!(family(&loaded).relation(0, 1), Some(Relation::Sibling));
    assert_eq!(
        loaded.personality_archetype_of(loaded_entity.index_u32()),
        Some(flitting)
    );
    assert_eq!(loaded.world_hash(), sim.world_hash());

    let tick = tick_count(&sim);
    for _ in 0..REPLAY_TICKS {
        sim.tick();
        loaded.tick();
    }
    assert_eq!(tick_count(&sim), tick + REPLAY_TICKS);
    assert_eq!(tick_count(&loaded), tick + REPLAY_TICKS);
    assert_eq!(
        loaded.world_hash(),
        sim.world_hash(),
        "the loaded world replays the edited one"
    );
}

#[test]
fn a_re_added_trait_saves_and_loads_at_its_authored_state() {
    let mut sim = Sim::new_from_shipped_lot();
    let condition = content_index_of_kind(&sim, "low_spirits");
    let content = sim.world().resource::<crate::Content>().0;
    let authored = crate::household::authored_trait_state(&content.traits[condition as usize]);
    let others: Vec<u32> = traits_of(&sim, 0)
        .into_iter()
        .map(|(index, _)| index)
        .filter(|&index| index != condition)
        .collect();
    let custom = if authored > 0.5 { 0.25 } else { 0.75 };
    let entity = person(&sim, 0);
    sim.world_mut()
        .get_mut::<Traits>(entity)
        .unwrap()
        .set_state(condition, custom);
    assert_eq!(
        sim.world().get::<Traits>(entity).unwrap().state(condition),
        Some(custom)
    );
    assert_eq!(edit(&mut sim, 0, "Tim", None, &others, &[]).reason, None);
    let mut readded = others.clone();
    readded.push(condition);
    assert_eq!(edit(&mut sim, 0, "Tim", None, &readded, &[]).reason, None);

    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    let loaded_entity = person(&loaded, 0);
    assert_eq!(
        loaded
            .world()
            .get::<Traits>(loaded_entity)
            .unwrap()
            .state(condition),
        Some(authored),
        "the re-added trait loads at its authored state, not the removed one's"
    );
    assert_eq!(traits_of(&loaded, 0), traits_of(&sim, 0));
}

// ---- The cleanliness row before the first domestic tick ------------------

/// The cleanliness rows, as (entity index, score); none without domestic state.
fn cleanliness_rows(sim: &Sim) -> Vec<(u32, f32)> {
    sim.world()
        .get_resource::<SavedDomestic>()
        .map_or_else(Vec::new, |domestic| domestic.cleanliness.clone())
}

#[test]
fn an_explicit_personality_change_creates_a_missing_cleanliness_row_in_index_order() {
    let mut sim = Sim::new_from_shipped_lot();
    let content = sim.world().resource::<crate::Content>().0;
    let settled = content
        .personalities
        .iter()
        .position(|p| p.id == "the_settled")
        .unwrap() as u32;
    let authored = content.personalities[settled as usize].cleanliness;
    let [tim, bill, casey] = [0, 1, 2].map(|id| person(&sim, id).index_u32());
    assert!(tim < bill && bill < casey, "the household spawns in order");

    // Empty domestic state, as before the first domestic tick: the edit adds
    // the row.
    sim.world_mut().insert_resource(SavedDomestic::default());
    assert_eq!(
        edit(&mut sim, 0, "Tim", Some(settled), &[], &[]).reason,
        None
    );
    assert_eq!(cleanliness_rows(&sim), vec![(tim, authored)]);

    // Rows on either side of the edited person: the new row lands between
    // them, and the neighbours keep their scores.
    sim.world_mut().insert_resource(SavedDomestic {
        cleanliness: vec![(tim, 0.125), (casey, 0.375)],
        ..SavedDomestic::default()
    });
    assert_eq!(
        edit(&mut sim, 1, "Bill", Some(settled), &[], &[]).reason,
        None
    );
    assert_eq!(
        cleanliness_rows(&sim),
        vec![(tim, 0.125), (bill, authored), (casey, 0.375)]
    );
}

/// Two archetypes with equal drain and refill multipliers, told apart only
/// by a disposition and their cleanliness. The domestic fallback, which
/// matches drain and refill alone, finds `first` for either of them. The
/// pack's one object is what the dispositions name.
fn twin_archetypes() -> &'static terri_data::ContentPack {
    let base = crate::test_content::pack_tuned(
        vec![crate::test_content::object(
            "radio",
            &[(terri_core::NeedId::Fun, 10.0)],
            10,
        )],
        crate::test_content::tuning(),
    );
    let first = terri_data::CompiledPersonality {
        cleanliness: 0.2,
        ..fixture_personality("first_twin", 1.25)
    };
    let second = terri_data::CompiledPersonality {
        cleanliness: 0.8,
        dispositions: vec![(terri_core::ObjectDefId(0), 0, 0.5)],
        ..fixture_personality("second_twin", 1.25)
    };
    Box::leak(Box::new(terri_data::ContentPack {
        personalities: vec![first, second],
        ..base.clone()
    }))
}

#[test]
fn an_explicit_change_without_domestic_state_keeps_the_archetype_after_a_tick() {
    let pack = twin_archetypes();
    let mut sim = crate::test_content::sim_with(8, 8, pack);
    let entity = sim
        .world_mut()
        .spawn((
            terri_core::Agent,
            terri_core::SimId(0),
            terri_core::Position { x: 2.0, y: 2.0 },
            Needs::all_at(terri_core::NEED_MAX),
            crate::household::personality_from(&pack.personalities[0]),
        ))
        .id();
    sim.world_mut().remove_resource::<SavedDomestic>();
    assert_eq!(sim.personality_archetype_of(entity.index_u32()), Some(0));

    assert_eq!(edit(&mut sim, 0, "Twin", Some(1), &[], &[]).reason, None);
    assert_eq!(
        cleanliness_rows(&sim),
        vec![(entity.index_u32(), 0.8)],
        "the edit created the domestic state with the authored row"
    );
    assert_eq!(sim.personality_archetype_of(entity.index_u32()), Some(1));
    let tick = tick_count(&sim);
    sim.tick();
    assert_eq!(tick_count(&sim), tick + 1);
    assert_eq!(
        sim.personality_archetype_of(entity.index_u32()),
        Some(1),
        "the second twin, not the first that shares its drain and refill"
    );
}
