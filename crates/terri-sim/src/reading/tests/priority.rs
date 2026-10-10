use super::*;
use terri_core::books::TitleMemory;

fn bookmarked_elsewhere() -> (Sim, Entity, Entity, String) {
    let (mut sim, person, source, other, title) = fixture("bookshelf");
    purchase(&mut sim, Some(other), &title);
    purchase(&mut sim, Some(source), "the_locked_laundry");
    sim.world_mut().resource_mut::<SimClock>().tick = 20;
    let id = *sim.world().get::<SimId>(person).unwrap();
    let mut saved = sim.world().resource::<BookLibrary>().state().clone();
    saved.memories.push(TitleMemory {
        sim_id: id,
        title_id: title.clone(),
        progress_ticks: 10,
        progress_fraction: 0.0,
        pass_novelty: Some(1.0),
        familiarity: 0.0,
        last_read_tick: 10,
        completed_passes: 0,
    });
    let library =
        with_book_world(sim.world(), |world| BookLibrary::from_saved(saved, world)).unwrap();
    sim.world_mut().insert_resource(library);
    (sim, person, source, title)
}

#[test]
fn unfinished_title_on_another_case_wins_even_against_higher_unread_utility() {
    let (mut sim, person, source, title) = bookmarked_elsewhere();
    let origin = Target {
        object: source,
        interaction: 0,
    };
    let mut choices = plans(sim.world_mut(), person, origin, None);
    assert!(
        choices.iter().any(|plan| plan.title == title),
        "reachable bookmark must be offered across cases"
    );
    for plan in &mut choices {
        plan.score = if plan.title == title {
            -1000.0
        } else {
            1_000_000.0
        };
    }
    let occupancy = crate::seating::occupancy(sim.world_mut());
    assert_eq!(
        best_plan(&choices, person, &occupancy, &Default::default())
            .unwrap()
            .title,
        title
    );
    let pack = sim.world().resource::<Content>().0;
    for seed in 0..32 {
        let chosen = choose_plan(
            &choices,
            person,
            None,
            &occupancy,
            &Default::default(),
            &mut SimRng::from_seed(seed),
            pack,
        )
        .unwrap();
        assert_eq!(chosen.title, title);
    }
}

#[test]
fn cross_case_journey_round_trips_under_current_contract() {
    let (mut sim, person, source, title) = bookmarked_elsewhere();
    issue(
        &mut sim,
        SimCommand::UseObject {
            agent: person.index_u32(),
            object: source.index_u32(),
            interaction: 0,
        },
    );
    sim.flush_commands();
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<ReadingJourney>(person).is_some() {
            break;
        }
    }
    let journey = sim.world().get::<ReadingJourney>(person).unwrap();
    assert_ne!(journey.origin.object, journey.shelf);
    assert_eq!(
        sim.world()
            .resource::<BookLibrary>()
            .copy(journey.copy)
            .unwrap()
            .title_id,
        title
    );
    let snapshot = sim.save_snapshot_v6();
    assert!(sim.load_snapshot_v7(snapshot.clone()).is_err());
    sim.load_snapshot_v6(snapshot.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), snapshot);
}

#[test]
fn unread_titles_remain_weighted_and_preview_does_not_promise_a_random_choice() {
    let (mut sim, person, source, _, title) = fixture("bookshelf");
    purchase(&mut sim, Some(source), &title);
    purchase(&mut sim, Some(source), "the_locked_laundry");
    let origin = Target {
        object: source,
        interaction: 0,
    };
    let choices = plans(sim.world_mut(), person, origin, None);
    let occupancy = crate::seating::occupancy(sim.world_mut());
    assert!(planning::preview_plan(&choices, person, &occupancy).is_none());
    assert_eq!(
        sim.automatic_reading_choice(person.index_u32(), source.index_u32(), "read"),
        Some((String::new(), String::new(), 0.0))
    );
    let pack = sim.world().resource::<Content>().0;
    let mut chosen_titles = std::collections::BTreeSet::new();
    for seed in 0..128 {
        let chosen = choose_plan(
            &choices,
            person,
            None,
            &occupancy,
            &Default::default(),
            &mut SimRng::from_seed(seed),
            pack,
        )
        .unwrap();
        chosen_titles.insert(chosen.title);
    }
    assert_eq!(chosen_titles.len(), 2);
}
