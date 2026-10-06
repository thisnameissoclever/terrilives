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
                learn_per_attempt: 0.05,
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
    // the archetype, even though every multiplier matches.
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
