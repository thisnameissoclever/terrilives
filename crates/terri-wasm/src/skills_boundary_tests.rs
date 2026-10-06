use super::*;
use terri_core::SimName;

/// The entity index of the household member called `name`. The household
/// spawns after the placed objects, so a short scan past them finds it.
fn index_named(handle: &SimHandle, name: &str) -> u32 {
    let bound = handle
        .sim
        .world()
        .resource::<Content>()
        .0
        .lot
        .placements
        .len() as u32
        + 16;
    (0..bound)
        .find(|&index| handle.sim_name(index) == name)
        .unwrap_or_else(|| panic!("{name} is in the shipped household"))
}

#[test]
fn skill_columns_follow_pack_order_and_align() {
    let handle = SimHandle::from_lot();
    let pack = handle.sim.world().resource::<Content>().0;
    assert_eq!(handle.skill_labels(), ["Cooking", "Fitness", "Reading"]);
    assert_eq!(handle.skill_levels(), [10, 10, 10]);
    assert_eq!(
        handle.skill_descriptions(),
        pack.skills
            .iter()
            .map(|skill| skill.description.clone())
            .collect::<Vec<_>>()
    );
    assert!(handle
        .skill_descriptions()
        .iter()
        .all(|description| !description.is_empty()));
}

#[test]
fn skills_of_flattens_each_standing_into_level_progress_mastery() {
    let handle = SimHandle::from_lot();
    let bytes = handle.save_bytes();
    for name in ["Tim", "Bill", "Casey"] {
        let index = index_named(&handle, name);
        let expected: Vec<f32> = handle
            .sim
            .skills_of(index)
            .expect("a living person has skills")
            .into_iter()
            .flat_map(|standing| {
                [
                    f32::from(standing.level),
                    standing.progress,
                    standing.mastery,
                ]
            })
            .collect();
        assert_eq!(expected.len(), 3 * handle.skill_levels().len());
        assert_eq!(handle.skills_of(index), expected, "{name}");
    }
    // Casey wears "Can't cook" at 0.25, which seeds cooking practice to
    // mastery 0.25 on a ten-level ladder: level 2, half way to level 3.
    let casey = handle.skills_of(index_named(&handle, "Casey"));
    assert_eq!(casey[0], 2.0);
    assert!((casey[1] - 0.5).abs() < 1e-4, "progress {}", casey[1]);
    assert!((casey[2] - 0.25).abs() < 1e-6, "mastery {}", casey[2]);
    assert_eq!(handle.save_bytes(), bytes, "reading skills saves nothing");
}

#[test]
fn skills_of_rejects_non_people_in_release() {
    let mut handle = SimHandle::from_lot();
    let tim = index_named(&handle, "Tim");
    assert_eq!(handle.skills_of(tim).len(), 3 * handle.skill_levels().len());

    // Tim dies of hunger on the first tick it is empty, so his index is
    // retired the way a real death retires it.
    let mut retuned = handle.sim.world().resource::<Content>().0.clone();
    retuned.tuning.death_after_ticks = 1;
    handle
        .sim
        .world_mut()
        .insert_resource(Content(Box::leak(Box::new(retuned))));
    assert!(handle.set_death_enabled(true));
    handle.flush_commands();
    for _ in 0..8 {
        if handle.sim_name(tim).is_empty() {
            break;
        }
        let world = handle.sim.world_mut();
        let mut people = world.query::<(&SimName, &mut Needs)>();
        for (name, mut needs) in people.iter_mut(world) {
            if name.0 == "Tim" {
                needs.set(NeedId::Hunger, 0.0);
            }
        }
        handle.tick();
    }
    assert!(handle.sim_name(tim).is_empty(), "Tim died");
    assert!(handle.sim.save_snapshot_v5().retired_indices.contains(&tim));

    let object = 0;
    assert!(object < tim, "index 0 is a placed object");
    assert!(handle.sim_name(object).is_empty());
    let bytes = handle.save_bytes();
    let hash = handle.world_hash();
    for index in [object, u32::MAX, tim] {
        assert!(handle.skills_of(index).is_empty(), "{index}");
    }
    assert_eq!(handle.save_bytes(), bytes);
    assert_eq!(handle.world_hash(), hash);
}

/// Review finding [M1]: an agent spawned through `spawn_agent` holds empty
/// practice from the start, so a tagged completion teaches it, and its
/// world continues identically after a save and load.
#[test]
fn a_spawned_agent_learns_and_its_reload_continues_identically() {
    let mut handle = SimHandle::from_lot();
    let content = handle.sim.world().resource::<Content>().0;
    let shelf_def = content.find("bookshelf").expect("the shipped bookshelf");
    let interaction = content
        .object(shelf_def)
        .interactions
        .iter()
        .position(|offer| offer.tags.iter().any(|tag| tag == "reading"))
        .expect("a reading interaction") as u32;
    let reading = content
        .skills
        .iter()
        .position(|skill| skill.tag == "reading")
        .expect("the reading skill") as u32;
    let world = handle.sim.world_mut();
    let shelf = world
        .query::<(terri_core::Entity, &terri_core::SmartObject)>()
        .iter(world)
        .find(|(_, object)| object.0 == shelf_def)
        .expect("the lot has a bookshelf")
        .0;
    let start = *world
        .query::<(&terri_core::Position, &SimName)>()
        .iter(world)
        .next()
        .expect("a household member stands somewhere walkable")
        .0;
    handle.spawn_agent(start.x, start.y, 100.0);
    let world = handle.sim.world_mut();
    let spawned = world
        .query::<(terri_core::Entity, &Agent, Option<&SimName>)>()
        .iter(world)
        .find(|(_, _, name)| name.is_none())
        .expect("spawn_agent spawned an agent")
        .0;
    let practice = |handle: &SimHandle| {
        handle
            .sim
            .world()
            .get::<terri_core::Skills>(spawned)
            .map_or(0.0, |skills| skills.practice(reading))
    };
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: spawned.index_u32(),
            object: shelf.index_u32(),
            interaction,
        });
    for _ in 0..600 {
        handle.tick();
    }
    assert!(
        practice(&handle) >= content.skills[reading as usize].practice_per_attempt,
        "the ordered read taught the spawned agent"
    );
    let mut resumed = SimHandle::from_lot();
    assert!(resumed.load_bytes(&handle.save_bytes()));
    assert_eq!(resumed.world_hash(), handle.world_hash());
    for _ in 0..300 {
        handle.tick();
        resumed.tick();
        assert_eq!(resumed.world_hash(), handle.world_hash());
    }
}
