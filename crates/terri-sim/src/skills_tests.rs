//! Tests for the skill ladder, practice and the fumble roll - [SK-model],
//! [SK-learning], [SK-capability] and [SK-evidence] items 1 to 4 in
//! `docs/specs/2026-10-05-skills.md`.

use super::*;
use crate::placement::LotEditState;
use crate::systems::trait_effects::roll_fumble;
use crate::Sim;
use bevy_ecs::entity::Entity;
use terri_core::{CommandQueue, SimClock, SimCommand, SimRng, Skills, Traits};
use terri_data::{CompiledChain, CompiledChainStep};

fn ladder() -> Ladder {
    Ladder {
        cost: 0.1,
        growth: 1.25,
    }
}

/// A ten-level skill keyed on `tag`, named after it.
fn skill(tag: &str, practice_per_attempt: f32) -> CompiledSkill {
    CompiledSkill {
        id: tag.to_string(),
        label: tag.to_string(),
        description: String::new(),
        tag: tag.to_string(),
        levels: 10,
        practice_per_attempt,
    }
}

fn tags(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| name.to_string()).collect()
}

fn clock(sim: &Sim) -> u64 {
    sim.world().resource::<SimClock>().tick
}

#[test]
fn the_ladder_steps_at_exact_boundaries() {
    let l = ladder();
    assert_eq!(l.level_cost(1), 0.1);
    assert!((l.level_cost(2) - 0.125).abs() < 1e-6);
    assert!((l.cumulative(2) - 0.225).abs() < 1e-6);
    let at_two = l.cumulative(2);
    assert_eq!(
        standing(&l, 10, at_two),
        Standing {
            level: 2,
            progress: 0.0,
            mastery: 0.2
        }
    );
    let below = f32::from_bits(at_two.to_bits() - 1);
    let s = standing(&l, 10, below);
    assert_eq!(s.level, 1);
    assert!(s.progress > 0.99 && s.progress < 1.0);
    assert!(s.mastery < 0.2);
    assert_eq!(
        standing(&l, 10, 0.0),
        Standing {
            level: 0,
            progress: 0.0,
            mastery: 0.0
        }
    );
    let top = l.max_practice(10);
    assert_eq!(
        standing(&l, 10, top),
        Standing {
            level: 10,
            progress: 0.0,
            mastery: 1.0
        }
    );
    assert_eq!(
        standing(&l, 10, top * 2.0),
        Standing {
            level: 10,
            progress: 0.0,
            mastery: 1.0
        }
    );
}

/// Every boundary of the ten-level ladder, and the midpoint of every
/// level: a boundary is reached exactly at its cumulative cost, one f32
/// step below stays on the level beneath, and halfway reads as half.
#[test]
fn every_boundary_and_midpoint_reads_its_level() {
    let l = ladder();
    for level in 1..=10u8 {
        let at = l.cumulative(level);
        let reached = standing(&l, 10, at);
        assert_eq!(reached.level, level, "at boundary {level}");
        assert_eq!(reached.progress, 0.0, "at boundary {level}");
        let below = standing(&l, 10, f32::from_bits(at.to_bits() - 1));
        assert_eq!(below.level, level - 1, "one step below boundary {level}");
        assert!(
            below.mastery < f32::from(level) / 10.0,
            "one step below boundary {level} reads {}",
            below.mastery
        );
        let middle = l.cumulative(level - 1) + 0.5 * l.level_cost(level);
        let halfway = standing(&l, 10, middle);
        assert_eq!(halfway.level, level - 1);
        assert!((halfway.progress - 0.5).abs() < 1e-5, "{halfway:?}");
        assert!((halfway.mastery - (f32::from(level) - 0.5) / 10.0).abs() < 1e-5);
    }
}

#[test]
fn the_inverse_ladder_reproduces_a_mastery() {
    let l = ladder();
    for mastery in [0.0f32, 0.25, 0.42, 0.58, 0.5, 0.999, 1.0] {
        let practice = practice_for_mastery(&l, 10, mastery);
        let back = standing(&l, 10, practice).mastery;
        assert!(
            (back - mastery).abs() <= 1e-5,
            "{mastery} -> {practice} -> {back}"
        );
    }
    assert_eq!(practice_for_mastery(&l, 10, 1.0), l.max_practice(10));
}

#[test]
fn the_component_inserts_in_order_and_never_holds_a_negative() {
    let mut skills = Skills::default();
    assert!(skills.is_empty());
    assert_eq!(skills.practice(4), 0.0);
    skills.set_practice(4, 0.5);
    skills.set_practice(1, 0.25);
    skills.set_practice(4, 0.75);
    assert_eq!(skills.entries(), &[(1, 0.25), (4, 0.75)]);
    skills.set_practice(1, -1.0);
    assert_eq!(skills.practice(1), 0.0);
    assert_eq!(
        Skills::from_entries(vec![(3, 0.1), (0, 0.2)]).entries(),
        &[(0, 0.2), (3, 0.1)]
    );
}

#[test]
fn practice_tops_out_and_an_untagged_attempt_teaches_nothing() {
    let pack = terri_data::pack();
    let (cooking, definition) = skill_for_tag(pack, "cooking").expect("shipped skill");
    let top = Ladder::from_tuning(&pack.tuning).max_practice(definition.levels);

    let mut skills = Skills::default();
    practise(&mut skills, pack, &tags(&["television"]));
    assert!(skills.is_empty(), "an untagged completion adds nothing");

    practise(&mut skills, pack, &tags(&["cooking"]));
    assert_eq!(skills.practice(cooking), definition.practice_per_attempt);

    skills.set_practice(cooking, top);
    practise(&mut skills, pack, &tags(&["cooking"]));
    assert_eq!(skills.practice(cooking), top, "clamped at the top");

    // Just below the top: the attempt fills the ladder and no further.
    skills.set_practice(cooking, top - definition.practice_per_attempt * 0.5);
    practise(&mut skills, pack, &tags(&["cooking"]));
    assert_eq!(skills.practice(cooking), top);
}

// ---- Learning through the running schedule --------------------------

/// The cook's one interaction lasts 20 ticks with no variance.
const COOK_TICKS: u64 = 20;
/// Ticks from the world's start to the middle of the ordered attempt. The
/// cook starts beside the stove, so the attempt opens on tick 1.
const TICKS_TO_MID_COOK: u64 = 10;
/// Practice one completed cooking attempt adds in `cooking_pack`.
const COOK_PRACTICE: f32 = 0.015;

/// The pack of `a_fumbled_meal_starves_the_soul_but_teaches_the_hands` in
/// `systems/trait_effects.rs`: one stove whose 20-tick cook is tagged
/// cooking, no duration variance, a cooking capability (start level 0.25)
/// and a cooking skill.
fn cooking_pack() -> &'static ContentPack {
    let mut cook_act =
        crate::test_content::interaction("cook", &[(terri_core::NeedId::Hunger, 40.0)], 20);
    cook_act.tags = tags(&["cooking"]);
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
    Box::leak(Box::new(ContentPack {
        traits: vec![CompiledTrait {
            starting_satisfaction_offset: 0.0,
            id: "cannot_cook".to_string(),
            label: "Can't cook".to_string(),
            tag: "cooking".to_string(),
            kind: CompiledTraitKind::Capability {
                start_level: 0.25,
                fail_delta_scale: 0.0,
            },
            description: String::new(),
        }],
        skills: vec![skill("cooking", COOK_PRACTICE)],
        ..base.clone()
    }))
}

/// A fed cook beside the stove who has been ordered to use it. When
/// `wearing`, they wear the cooking capability and their practice is
/// seeded from it as spawning seeds it. Returns the world and the cook.
fn ordered_cook(wearing: bool) -> (Sim, Entity) {
    let pack = cooking_pack();
    let mut sim = crate::test_content::sim_with(8, 8, pack);
    let stove = pack.find("stove").expect("fixture");
    let stove = sim
        .world_mut()
        .spawn((
            terri_core::Position { x: 3.0, y: 1.0 },
            terri_core::SmartObject(stove),
        ))
        .id();
    let worn = if wearing {
        Traits::from_entries(vec![(0, 0.25)])
    } else {
        Traits::default()
    };
    let mut skills = Skills::default();
    seed_from_capabilities(&mut skills, &worn, pack);
    // Fed, unlike the copied fixture's cook: the order alone starts the
    // attempt, so autonomy does not open a fresh one the moment a cancel
    // ends it.
    let needs = terri_core::Needs::all_at(terri_core::NEED_MAX);
    let cook = sim
        .world_mut()
        .spawn((
            terri_core::Agent,
            terri_core::SimId(0),
            terri_core::Position { x: 2.0, y: 1.0 },
            needs,
            terri_core::Satisfaction::from_value(0.0),
            worn,
            skills,
        ))
        .id();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: cook.index_u32(),
            object: stove.index_u32(),
            interaction: 0,
        });
    (sim, cook)
}

fn cooking_practice(sim: &Sim, who: Entity) -> f32 {
    sim.world().get::<Skills>(who).unwrap().practice(0)
}

#[test]
fn a_completed_tagged_interaction_teaches_each_person_once_and_an_interrupted_one_nothing() {
    let seeded = practice_for_mastery(&ladder(), 10, 0.25);
    for (wearing, start) in [(true, seeded), (false, 0.0)] {
        let (mut sim, cook) = ordered_cook(wearing);
        assert_eq!(cooking_practice(&sim, cook), start, "wearing {wearing}");
        for _ in 0..TICKS_TO_MID_COOK {
            sim.tick();
        }
        assert!(
            sim.world().get::<terri_core::Eating>(cook).is_some(),
            "the attempt is under way (wearing {wearing})"
        );
        assert_eq!(
            cooking_practice(&sim, cook),
            start,
            "nothing learned before completion (wearing {wearing})"
        );
        for _ in TICKS_TO_MID_COOK..COOK_TICKS {
            sim.tick();
        }
        assert_eq!(clock(&sim), COOK_TICKS);
        assert!(
            sim.world().get::<terri_core::Eating>(cook).is_none(),
            "the attempt completed on tick {COOK_TICKS} (wearing {wearing})"
        );
        assert_eq!(
            cooking_practice(&sim, cook),
            start + COOK_PRACTICE,
            "one attempt's practice, worn or not (wearing {wearing})"
        );
    }

    // Cancelled half way: the attempt ends and teaches nothing, then or at
    // the tick it would have completed.
    let (mut sim, cook) = ordered_cook(true);
    for _ in 0..TICKS_TO_MID_COOK {
        sim.tick();
    }
    assert!(sim.world().get::<terri_core::Eating>(cook).is_some());
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: cook.index_u32(),
        });
    sim.tick();
    assert!(
        sim.world().get::<terri_core::Eating>(cook).is_none(),
        "the cancel ended the attempt"
    );
    // Past the cancelled attempt's completion tick, and short of any new
    // attempt's: one opened after the cancel cannot finish before tick 31.
    for _ in TICKS_TO_MID_COOK + 1..COOK_TICKS + 5 {
        sim.tick();
    }
    assert_eq!(clock(&sim), COOK_TICKS + 5);
    assert_eq!(cooking_practice(&sim, cook), seeded);
}

/// A two-step chain: the Cook step at the pantry is tagged cooking and
/// yields the dinner; the terminal Eat step at the table is untagged. The
/// world of the cook_dinner tests in `systems/chain.rs`, with the tag moved
/// to the first step so the tagged step and the terminal delivery differ.
fn chain_pack() -> &'static ContentPack {
    let mut pantry = crate::test_content::object_offering("pantry", vec![]);
    pantry.roles = vec![0];
    let mut table = crate::test_content::object_offering("table", vec![]);
    table.roles = vec![1];
    let fridge = crate::test_content::object("fridge", &[(terri_core::NeedId::Hunger, 40.0)], 30);
    let base = crate::test_content::pack_tuned(
        vec![fridge, pantry, table],
        terri_data::Tuning {
            duration_variance: 0.0,
            choice_temperature: 0.0001,
            ..crate::test_content::tuning()
        },
    );
    let step = |label: &str, role: u32, duration_ticks: u32, tagged: bool| CompiledChainStep {
        role,
        label: label.to_string(),
        duration_ticks,
        tags: if tagged { tags(&["cooking"]) } else { vec![] },
        yields: None,
        transforms: None,
        consumes: None,
        visual: None,
        sound_action: None,
        activity: None,
    };
    let chain = CompiledChain {
        id: "cook_dinner".to_string(),
        label: "Cook dinner".to_string(),
        advertised_by: terri_data::ObjectDefId(0),
        advertises: vec![(0, 48.0), (6, 12.0)],
        satisfaction: 2.5,
        steps: vec![
            CompiledChainStep {
                yields: Some(0),
                ..step("Cook", 0, 16, true)
            },
            CompiledChainStep {
                consumes: Some(0),
                ..step("Eat", 1, 20, false)
            },
        ],
    };
    Box::leak(Box::new(ContentPack {
        roles: vec!["pantry_shelf".to_string(), "eating_surface".to_string()],
        item_kinds: vec!["dinner".to_string()],
        chains: vec![chain],
        traits: vec![CompiledTrait {
            starting_satisfaction_offset: 0.0,
            id: "kitchen_nerves".to_string(),
            label: "Kitchen nerves".to_string(),
            tag: "cooking".to_string(),
            kind: CompiledTraitKind::Condition {
                accrual_scale: 0.5,
                manage_per_completion: 0.25,
                start_severity: 1.0,
            },
            description: String::new(),
        }],
        skills: vec![skill("cooking", COOK_PRACTICE)],
        ..base.clone()
    }))
}

#[test]
fn a_tagged_chain_step_teaches_each_participant_once() {
    const TICKS: u64 = 200;
    let pack = chain_pack();
    let mut sim = crate::test_content::sim_with(12, 8, pack);
    for (id, x) in [("fridge", 1.0), ("pantry", 4.0), ("table", 8.0)] {
        let definition = pack.find(id).expect("fixture");
        sim.world_mut().spawn((
            terri_core::Position { x, y: 1.0 },
            terri_core::SmartObject(definition),
        ));
    }
    let mut needs = terri_core::Needs::all_at(80.0);
    needs.set(terri_core::NeedId::Hunger, 20.0);
    let cook = sim
        .world_mut()
        .spawn((
            terri_core::Agent,
            terri_core::Position { x: 2.0, y: 4.0 },
            needs,
            terri_core::Satisfaction::from_value(0.0),
            Traits::from_entries(vec![(0, 1.0)]),
            Skills::default(),
        ))
        .id();
    sim.world_mut()
        .entity_mut(cook)
        .insert(terri_core::ChainState::begin(0));

    let read = |sim: &Sim| {
        (
            cooking_practice(sim, cook),
            sim.world().get::<Traits>(cook).unwrap().state(0).unwrap(),
        )
    };
    let mut after_cook_step = None;
    let mut after_terminal = None;
    for _ in 0..TICKS {
        sim.tick();
        match sim.world().get::<terri_core::ChainState>(cook) {
            Some(state) if state.step == 1 && after_cook_step.is_none() => {
                after_cook_step = Some(read(&sim));
            }
            None if after_cook_step.is_some() && after_terminal.is_none() => {
                after_terminal = Some(read(&sim));
            }
            _ => {}
        }
    }
    assert_eq!(clock(&sim), TICKS);
    assert_eq!(
        after_cook_step,
        Some((COOK_PRACTICE, 0.75)),
        "the tagged step taught once and managed the condition once"
    );
    assert_eq!(
        after_terminal, after_cook_step,
        "the untagged terminal delivery adds nothing more"
    );
}

#[test]
fn a_social_completion_teaches_both_participants() {
    const TICKS: u64 = 200;
    const CHAT_PRACTICE: f32 = 0.02;
    let mut chat =
        crate::test_content::interaction("chat", &[(terri_core::NeedId::Social, 30.0)], 40);
    chat.tags = tags(&["socialising"]);
    chat.satisfaction = 2.0;
    let base =
        crate::test_content::pack_with_social(vec![], vec![chat], crate::test_content::tuning());
    let pack: &'static ContentPack = Box::leak(Box::new(ContentPack {
        skills: vec![skill("socialising", CHAT_PRACTICE)],
        ..base.clone()
    }));
    let mut sim = crate::test_content::sim_with(8, 8, pack);
    let mut spawn = |id: u32, x: f32, social: f32| {
        sim.world_mut()
            .spawn((
                terri_core::Agent,
                terri_core::SimId(id),
                terri_core::Position { x, y: 1.0 },
                terri_core::Needs::with(terri_core::NeedId::Social, social),
                terri_core::Satisfaction::from_value(0.0),
                Skills::default(),
            ))
            .id()
    };
    let lonely = spawn(0, 1.0, 20.0);
    let listener = spawn(1, 4.0, 60.0);

    let practice = |sim: &Sim, who: Entity| sim.world().get::<Skills>(who).unwrap().practice(0);
    let mut talked = false;
    let mut at_first_completion = None;
    for _ in 0..TICKS {
        sim.tick();
        talked |= sim.world().get::<terri_core::Socialising>(lonely).is_some();
        let both = (practice(&sim, lonely), practice(&sim, listener));
        if at_first_completion.is_none() && (both.0 > 0.0 || both.1 > 0.0) {
            at_first_completion = Some(both);
        }
    }
    assert_eq!(clock(&sim), TICKS);
    assert!(talked, "a conversation began");
    assert_eq!(
        at_first_completion,
        Some((CHAT_PRACTICE, CHAT_PRACTICE)),
        "both sides learned one attempt's practice on the same tick"
    );
}

// ---- The roll -------------------------------------------------------

#[test]
fn the_fumble_roll_reads_skill_mastery_and_keeps_its_draw_count() {
    let pack = terri_data::pack();
    let cannot_cook = trait_index(pack, "cannot_cook");
    let CompiledTraitKind::Capability {
        fail_delta_scale, ..
    } = pack.traits[cannot_cook as usize].kind
    else {
        panic!("cannot_cook is a capability");
    };
    let (cooking, definition) = skill_for_tag(pack, "cooking").expect("shipped skill");
    let top = Ladder::from_tuning(&pack.tuning).max_practice(definition.levels);
    let master = Skills::from_entries(vec![(cooking, top)]);
    let novice = Skills::from_entries(vec![(cooking, 0.0)]);
    // The trait state says the opposite of the skill each time, so a roll
    // that read the state would flip both outcomes.
    let state_says_hopeless = Traits::from_entries(vec![(cannot_cook, 0.0)]);
    let state_says_master = Traits::from_entries(vec![(cannot_cook, 1.0)]);
    let without_the_trait = Traits::default();
    let no_skills: &'static ContentPack = Box::leak(Box::new(ContentPack {
        skills: vec![],
        ..pack.clone()
    }));
    let cooking_tags = tags(&["cooking"]);

    // One draw taken from a fresh generator on this seed.
    let one_draw = |seed: u64| {
        let mut control = SimRng::from_seed(seed);
        control.next_f32();
        control
    };
    for seed in 0..200u64 {
        let mut rng = SimRng::from_seed(seed);
        assert_eq!(
            roll_fumble(
                &state_says_hopeless,
                Some(&master),
                pack,
                &cooking_tags,
                &mut rng
            ),
            None,
            "a master never fumbles (seed {seed})"
        );
        assert_eq!(rng, one_draw(seed), "one draw, pass (seed {seed})");

        let mut rng = SimRng::from_seed(seed);
        assert_eq!(
            roll_fumble(
                &state_says_master,
                Some(&novice),
                pack,
                &cooking_tags,
                &mut rng
            ),
            Some(fail_delta_scale),
            "a novice always fumbles (seed {seed})"
        );
        assert_eq!(rng, one_draw(seed), "one draw, fail (seed {seed})");

        let mut rng = SimRng::from_seed(seed);
        assert_eq!(
            roll_fumble(
                &without_the_trait,
                Some(&novice),
                pack,
                &cooking_tags,
                &mut rng
            ),
            None,
            "no trait, no roll (seed {seed})"
        );
        assert_eq!(rng, SimRng::from_seed(seed), "no draw (seed {seed})");

        // No skill keys on the tag: the roll reads the trait state.
        let mut rng = SimRng::from_seed(seed);
        assert_eq!(
            roll_fumble(
                &state_says_master,
                Some(&novice),
                no_skills,
                &cooking_tags,
                &mut rng
            ),
            None,
            "the state of 1 passes without a skill (seed {seed})"
        );
        assert_eq!(rng, one_draw(seed));
        let mut rng = SimRng::from_seed(seed);
        assert_eq!(
            roll_fumble(
                &state_says_hopeless,
                Some(&master),
                no_skills,
                &cooking_tags,
                &mut rng
            ),
            Some(fail_delta_scale),
            "the state of 0 fails without a skill (seed {seed})"
        );
        assert_eq!(rng, one_draw(seed));
    }
}

// ---- Seeding and the reads ------------------------------------------

fn trait_index(pack: &ContentPack, id: &str) -> u32 {
    pack.traits
        .iter()
        .position(|definition| definition.id == id)
        .unwrap_or_else(|| panic!("content has no trait {id}")) as u32
}

fn skill_index(pack: &ContentPack, tag: &str) -> usize {
    skill_for_tag(pack, tag).expect("shipped skill").0 as usize
}

fn entity_named(sim: &Sim, name: &str) -> Entity {
    let mut people = sim
        .world()
        .try_query::<(Entity, &terri_core::SimName)>()
        .unwrap();
    people
        .iter(sim.world())
        .find(|(_, n)| n.0 == name)
        .unwrap_or_else(|| panic!("nobody named {name}"))
        .0
}

fn mastery(sim: &Sim, who: Entity, tag: &str) -> f32 {
    let pack = terri_data::pack();
    sim.skills_of(who.index_u32()).expect("a person")[skill_index(pack, tag)].mastery
}

fn move_in(sim: &mut Sim, name: &str, traits: &[u32]) -> Entity {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::AddHousemate {
            name: name.to_string(),
            personality: 0,
            traits: traits.to_vec(),
        });
    sim.flush_commands();
    let index = sim
        .world()
        .resource::<LotEditState>()
        .last_housemate_result
        .unwrap()
        .sim
        .expect("the newcomer moved in");
    let entity = entity_named(sim, name);
    assert_eq!(entity.index_u32(), index);
    entity
}

fn edit_traits(sim: &mut Sim, who: Entity, name: &str, traits: &[u32]) {
    let sim_id = crate::family::sim_id_at(sim.world(), who.index_u32()).expect("a person");
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::EditHousemate {
            sim: sim_id,
            name: name.to_string(),
            personality: None,
            traits: traits.to_vec(),
            ties: vec![],
        });
    sim.flush_commands();
    let result = sim
        .world()
        .resource::<LotEditState>()
        .last_edit_result
        .expect("the drain recorded the edit");
    assert_eq!(result.reason, None, "the edit was accepted");
}

#[test]
fn spawning_and_editing_seed_practice_from_capability_start_levels_and_never_lower_it() {
    let mut sim = Sim::new_from_shipped_lot();
    let pack = terri_data::pack();
    // Casey wears cannot_cook (start 0.25) and slow_reader (start 0.58) in
    // content/household.toml; Bill wears no capability at all.
    let casey = entity_named(&sim, "Casey");
    assert!((mastery(&sim, casey, "cooking") - 0.25).abs() < 1e-5);
    assert!((mastery(&sim, casey, "reading") - 0.58).abs() < 1e-5);
    assert_eq!(mastery(&sim, casey, "exercise"), 0.0);
    let bill = entity_named(&sim, "Bill");
    assert!(sim.world().get::<Skills>(bill).unwrap().is_empty());

    let out_of_shape = trait_index(pack, "out_of_shape");
    let exercise = skill_index(pack, "exercise") as u32;
    let ann = move_in(&mut sim, "Ann", &[out_of_shape]);
    assert!((mastery(&sim, ann, "exercise") - 0.42).abs() < 1e-5);

    let top = Ladder::from_tuning(&pack.tuning).max_practice(pack.skills[exercise as usize].levels);
    sim.world_mut()
        .get_mut::<Skills>(ann)
        .unwrap()
        .set_practice(exercise, top);
    let practice = |sim: &Sim| sim.world().get::<Skills>(ann).unwrap().practice(exercise);
    edit_traits(&mut sim, ann, "Ann", &[]);
    assert_eq!(practice(&sim), top, "removing the trait keeps the skill");
    edit_traits(&mut sim, ann, "Ann", &[out_of_shape]);
    assert_eq!(practice(&sim), top, "re-adding the trait never lowers it");
    edit_traits(&mut sim, ann, "Ann", &[]);
    assert_eq!(practice(&sim), top, "removing it again keeps the skill");

    // An edit that adds a capability raises practice to its start level.
    let cannot_cook = trait_index(pack, "cannot_cook");
    assert_eq!(mastery(&sim, ann, "cooking"), 0.0);
    edit_traits(&mut sim, ann, "Ann", &[cannot_cook]);
    assert!((mastery(&sim, ann, "cooking") - 0.25).abs() < 1e-5);
}

#[test]
fn traits_of_reports_mastery_for_capabilities_and_state_for_the_rest() {
    let mut sim = Sim::new_from_shipped_lot();
    let pack = terri_data::pack();
    let casey = entity_named(&sim, "Casey");
    let cannot_cook = trait_index(pack, "cannot_cook");
    let slow_reader = trait_index(pack, "slow_reader");
    let cooking = skill_index(pack, "cooking") as u32;
    sim.world_mut()
        .get_mut::<Traits>(casey)
        .unwrap()
        .set_state(cannot_cook, 0.9);
    sim.world_mut()
        .get_mut::<Skills>(casey)
        .unwrap()
        .set_practice(cooking, 0.0);
    let pairs = sim.traits_of(casey.index_u32()).expect("a person");
    let reported = |index: u32| pairs.iter().find(|(i, _)| *i == index).unwrap().1;
    assert_eq!(reported(cannot_cook), 0.0, "mastery, not the inert state");
    assert_eq!(
        reported(slow_reader),
        mastery(&sim, casey, "reading"),
        "each capability reports its own skill"
    );

    // Tim's low spirits is a condition: it reports its severity.
    let tim = entity_named(&sim, "Tim");
    let low_spirits = trait_index(pack, "low_spirits");
    sim.world_mut()
        .get_mut::<Traits>(tim)
        .unwrap()
        .set_state(low_spirits, 0.33);
    let pairs = sim.traits_of(tim.index_u32()).expect("a person");
    assert_eq!(
        pairs.iter().find(|(i, _)| *i == low_spirits).unwrap().1,
        0.33
    );

    // An object has no skills to report.
    let object = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .next()
        .expect("the lot has furniture")
        .0;
    assert_eq!(sim.skills_of(object.index_u32()), None);
    // Reading writes nothing.
    let before = sim.save_snapshot_v5();
    let _ = sim.skills_of(casey.index_u32());
    let _ = sim.traits_of(casey.index_u32());
    assert_eq!(sim.save_snapshot_v5(), before);
    assert_eq!(
        sim.skills_of(casey.index_u32()).unwrap().len(),
        pack.skills.len()
    );
}

/// [SK-save]: a save that holds no practice seeds it once, on load, from
/// each worn capability's saved state; a person without a capability loads
/// with no practice.
#[test]
fn a_load_seeds_practice_from_saved_capability_states() {
    let mut live = Sim::new_from_shipped_lot();
    let pack = terri_data::pack();
    let casey = entity_named(&live, "Casey");
    let cannot_cook = trait_index(pack, "cannot_cook");
    live.world_mut()
        .get_mut::<Traits>(casey)
        .unwrap()
        .set_state(cannot_cook, 0.7);
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(live.save_snapshot_v5()).unwrap();
    assert!((mastery(&loaded, casey, "cooking") - 0.7).abs() < 1e-5);
    assert!((mastery(&loaded, casey, "reading") - 0.58).abs() < 1e-5);
    let bill = entity_named(&loaded, "Bill");
    assert!(loaded.world().get::<Skills>(bill).unwrap().is_empty());
}
