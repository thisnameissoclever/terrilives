//! Choosing a path by chance in the job search: issue 296,
//! `docs/specs/2026-10-18-shifts-and-careers.md`, [WS-search].
use super::*;
use crate::systems::action::sample_softmax;
use crate::Sim;

/// The shipped lot with its tuning changed by `edit`.
fn shipped_with(edit: impl FnOnce(&mut terri_data::Tuning)) -> Sim {
    let mut sim = Sim::new_from_shipped_lot();
    let mut pack = terri_data::pack().clone();
    edit(&mut pack.tuning);
    let pack: &'static ContentPack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    sim
}

/// Every unemployed person in id order, after the shipped worker is made
/// unemployed too: Tim, Bill and Casey.
fn jobless(sim: &mut Sim) -> Vec<(SimId, Entity)> {
    let people = people(sim.world_mut());
    for (id, entity) in &people {
        sim.world_mut().entity_mut(*entity).remove::<Career>();
        sim.world_mut().resource_mut::<Careers>().records.remove(id);
    }
    people
}

/// Each path's first-level fit for `entity`, in path order.
fn fits(sim: &Sim, entity: Entity) -> Vec<f32> {
    let pack = sim.world().resource::<Content>().0;
    pack.career_paths
        .iter()
        .map(|path| {
            fit(
                sim.world(),
                pack,
                &pack.careers[path.levels[0] as usize],
                entity,
            )
        })
        .collect()
}

fn hire_chance(fit: f32) -> f32 {
    (0.5 + 0.5 * fit).clamp(0.1, 0.95)
}

/// [WS-search] item 1: an applicant draws apply, path and hire on the
/// careers stream in that order; a person who does not apply draws once.
/// The stream is replayed by hand from the same state, and the result
/// pinned.
#[test]
fn an_applicant_draws_a_path_between_the_apply_and_hire_draws() {
    let temperature = 0.25;
    // The apply chance sits between the first and fourth numbers of the
    // stream, so the first person applies and the second does not.
    let mut replay = SimRng::from_seed(CAREERS_SEED);
    let numbers: Vec<f32> = (0..4).map(|_| replay.next_f32()).collect();
    assert!(numbers[0] < numbers[3], "{numbers:?}");
    let chance = (numbers[0] + numbers[3]) / 2.0;
    let mut sim = shipped_with(|t| {
        t.career_search_chance = chance;
        t.career_search_temperature = temperature;
    });
    let people = jobless(&mut sim);
    let (applicant, refuser) = (people[1], people[2]);
    sim.world_mut()
        .resource_mut::<Careers>()
        .set_search(people[0].0, false);

    let scores = fits(&sim, applicant.1);
    let mut replay = SimRng::from_seed(CAREERS_SEED);
    assert!(replay.next_f32() < chance, "the apply draw");
    let path = sample_softmax(&scores, temperature, &mut replay);
    let hired = replay.next_f32() < hire_chance(scores[path]);
    assert!(
        replay.next_f32() >= chance,
        "the second person's apply draw"
    );

    search(sim.world_mut());
    let careers = sim.world().resource::<Careers>();
    assert_eq!(careers.draws, 4, "apply, path, hire; apply");
    assert_eq!(careers.rng, replay, "the stream sits where the replay does");
    let pack = sim.world().resource::<Content>().0;
    let job = sim.world().get::<Career>(applicant.1).map(|c| c.0);
    assert_eq!(
        job,
        hired.then(|| pack.career_paths[path].levels[0]),
        "the drawn path's first level, if the hire draw succeeds"
    );
    assert_eq!((path, hired), PINNED_PATH_AND_HIRE);
    assert!(sim.world().get::<Career>(refuser.1).is_none());
}
/// The restaurant kitchen (Bill's fit 0.1), and the hire draw succeeds.
const PINNED_PATH_AND_HIRE: (usize, bool) = (6, true);

/// [WS-search] item 2: over 10,000 draws on the shipped fits of one person,
/// each path's share is within 1.5 percentage points of its softmax weight.
#[test]
fn the_search_follows_the_fit_softmax() {
    let temperature = 0.25;
    let mut sim = shipped_with(|t| t.career_search_temperature = temperature);
    let people = jobless(&mut sim);
    let scores = fits(&sim, people[1].1);
    let best = scores.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let weights: Vec<f64> = scores
        .iter()
        .map(|fit| f64::from((fit - best) / temperature).exp())
        .collect();
    let total: f64 = weights.iter().sum();
    let mut careers = Careers::default();
    let pack = sim.world().resource::<Content>().0;
    let mut counts = vec![0u32; scores.len()];
    for _ in 0..10_000 {
        let path = search_path(sim.world(), pack, people[1].1, &mut careers).expect("a path");
        counts[path as usize] += 1;
    }
    assert_eq!(careers.draws, 10_000, "one careers draw per path choice");
    for (count, weight) in counts.iter().zip(&weights) {
        let share = f64::from(*count) / 10_000.0;
        assert!(
            (share - weight / total).abs() <= 0.015,
            "{counts:?} {scores:?}"
        );
    }
}

/// [WS-search] item 3: at temperature 0 the search is the best-fit rule
/// before this change, with no path draw: apply then hire, and the best
/// fitting path's first level.
#[test]
fn temperature_zero_is_the_best_fit_search_with_no_path_draw() {
    let mut sim = shipped_with(|t| {
        t.career_search_chance = 1.0;
        t.career_search_temperature = 0.0;
    });
    let people = jobless(&mut sim);
    for (id, _) in &people[1..] {
        sim.world_mut()
            .resource_mut::<Careers>()
            .set_search(*id, false);
    }
    let person = people[0].1;
    let pack = sim.world().resource::<Content>().0;
    let best = best_path(sim.world(), pack, person, None, f32::NEG_INFINITY).expect("a path");
    let mut replay = SimRng::from_seed(CAREERS_SEED);
    let mut attempts = 0;
    loop {
        attempts += 1;
        let apply = replay.next_f32();
        assert!(apply < 1.0);
        let hire = replay.next_f32();
        let scores = fits(&sim, person);
        if hire < hire_chance(scores[best as usize]) {
            break;
        }
    }
    let mut searches = 0;
    while sim.world().get::<Career>(person).is_none() {
        search(sim.world_mut());
        searches += 1;
    }
    assert_eq!(searches, attempts);
    let careers = sim.world().resource::<Careers>();
    assert_eq!(careers.draws, 2 * attempts, "apply and hire only");
    assert_eq!(careers.rng, replay);
    assert_eq!(
        sim.world().get::<Career>(person).map(|c| c.0),
        Some(pack.career_paths[best as usize].levels[0])
    );
    assert_eq!((best, attempts), PINNED_BEST_AND_ATTEMPTS);
}
/// The library fits the shipped worker best; hired on the third day.
const PINNED_BEST_AND_ATTEMPTS: (u32, u64) = (5, 3);

/// [WS-search]: at the shipped temperature, over 10,000 path choices for
/// Casey, the best fit is chosen less than always and more often than every
/// path that fits clearly worse (by more than 0.05). Paths within float
/// rounding of the best, such as Casey's four fits of 0.2, are its equals.
#[test]
fn a_better_fit_is_more_likely_but_not_certain() {
    let mut sim = shipped_with(|t| t.career_search_temperature = 0.25);
    let people = jobless(&mut sim);
    let person = people[2].1;
    let pack = sim.world().resource::<Content>().0;
    let scores = fits(&sim, person);
    let best = best_path(sim.world(), pack, person, None, f32::NEG_INFINITY).expect("a path");
    let top = scores[best as usize];
    let mut careers = Careers::default();
    let mut counts = vec![0u32; scores.len()];
    for _ in 0..10_000 {
        counts[search_path(sim.world(), pack, person, &mut careers).expect("a path") as usize] += 1;
    }
    let chosen = counts[best as usize];
    assert!(chosen < 10_000, "not certain: {counts:?}");
    let mut worse = 0;
    for (index, count) in counts.iter().enumerate() {
        if scores[index] < top - 0.05 {
            worse += 1;
            assert!(chosen > *count, "{counts:?} {scores:?}");
        }
    }
    assert!(worse >= 3, "Casey has clearly worse paths: {scores:?}");
}
