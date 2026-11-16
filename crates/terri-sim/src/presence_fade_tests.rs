//! Tests for the lingering lift of liked furniture - issue 344,
//! [OA-presence] in `docs/specs/2026-10-06-object-affinities.md`.
//!
//! They stand on the shipped lot, whose rooms are: the kitchen, x 0 to 7 and
//! y 0 to 5; the living room, x 8 to 15 and y 0 to 5, with a potted plant at
//! (15, 0); and the study, x 6 to 11 and y 6 to 11, with a potted plant at
//! (10, 11) and the aquarium at (6, 10). Everything past x 15 or y 11 is the
//! yard. The shipped fade is 5 points per game hour, so one liked plant (10
//! points) fades over 120 ticks and four (19 points) over 228.

use super::*;
use terri_core::{Affinities, Position, SimClock, SimName};

use crate::Sim;

const PLANT_LIFT: f32 = 10.0;
/// Ticks one liked plant takes to fade at the shipped rate.
const PLANT_FADE_TICKS: u64 = 120;

fn shipped() -> Sim {
    Sim::new_from_shipped_lot()
}

fn person(sim: &mut Sim, name: &str) -> Entity {
    sim.world_mut()
        .query::<(Entity, &SimName)>()
        .iter(sim.world())
        .find(|(_, person)| person.0 == name)
        .unwrap_or_else(|| panic!("{name} is in the shipped household"))
        .0
}

fn kind(id: &str) -> u32 {
    terri_data::pack()
        .affinities
        .iter()
        .position(|kind| kind.id == id)
        .unwrap_or_else(|| panic!("content has no affinity kind {id}")) as u32
}

fn id_of(sim: &Sim, who: Entity) -> SimId {
    *sim.world().get::<SimId>(who).expect("a person has an id")
}

/// Gives `who` exactly these values, every other kind at 0.0.
fn set_values(sim: &mut Sim, who: Entity, values: &[(&str, f32)]) {
    let mut all = vec![0.0; terri_data::pack().affinities.len()];
    for &(id, value) in values {
        all[kind(id) as usize] = value;
    }
    sim.world_mut()
        .entity_mut(who)
        .insert(Affinities::from_values(all));
}

fn stand(sim: &mut Sim, who: Entity, x: f32, y: f32) {
    *sim.world_mut().get_mut::<Position>(who).unwrap() = Position { x, y };
}

/// Stands `who` beside the living room's one plant.
fn beside_the_plant(sim: &mut Sim, who: Entity) {
    stand(sim, who, 14.0, 1.0);
}

/// Stands `who` in the kitchen, which has nothing liked in it.
fn in_the_kitchen(sim: &mut Sim, who: Entity) {
    stand(sim, who, 4.0, 2.0);
}

fn set_clock(sim: &mut Sim, tick: u64) {
    sim.world_mut().resource_mut::<SimClock>().tick = tick;
}

fn refresh(sim: &mut Sim) {
    refresh_all(sim.world_mut());
}

fn end_tick(sim: &Sim, who: Entity, kind_id: &str) -> Option<u64> {
    sim.world()
        .resource::<PresenceFade>()
        .end_tick(id_of(sim, who), kind(kind_id))
}

/// What `who` reads for the presence moodlets, in the order mood lists them.
fn lifts(sim: &Sim, who: Entity) -> Vec<(String, f32)> {
    sim.mood_of(who.index_u32())
        .expect("a living person has a mood")
        .moodlets
        .into_iter()
        .filter(|moodlet| {
            moodlet.label.starts_with("Likes the ") || moodlet.label.starts_with("Enjoyed the ")
        })
        .map(|moodlet| (moodlet.label, moodlet.score))
        .collect()
}

/// The one lift `who` reads, with its label, within a small tolerance for
/// the divide by sixty.
fn assert_one_lift(sim: &Sim, who: Entity, label: &str, score: f32, context: &str) {
    let read = lifts(sim, who);
    assert_eq!(read.len(), 1, "{context}: {read:?}");
    assert_eq!(read[0].0, label, "{context}");
    assert!(
        (read[0].1 - score).abs() < 1e-4,
        "{context}: read {} wanted {score}",
        read[0].1
    );
}

/// [OA-presence], issue 344: a lift does not end when the person leaves the
/// room. It starts from what the room gave and falls by the fade rate each
/// game hour, a sixtieth of that each tick, reaching zero after 120 ticks
/// for one plant, and it is called "Enjoyed the plants" once they are gone.
#[test]
fn the_lift_fades_after_the_person_leaves_and_reaches_zero() {
    let mut sim = shipped();
    let tim = person(&mut sim, "Tim");
    set_values(&mut sim, tim, &[("plants", 1.0)]);
    set_clock(&mut sim, 100);
    beside_the_plant(&mut sim, tim);
    refresh(&mut sim);
    assert_one_lift(&sim, tim, "Likes the plants here", PLANT_LIFT, "beside it");
    assert_eq!(end_tick(&sim, tim, "plants"), Some(100 + PLANT_FADE_TICKS));

    in_the_kitchen(&mut sim, tim);
    for (elapsed, expected) in [
        (0, 10.0),
        (1, 119.0 * 5.0 / 60.0),
        (30, 7.5),
        (60, 5.0),
        (90, 2.5),
        (119, 5.0 / 60.0),
    ] {
        set_clock(&mut sim, 100 + elapsed);
        assert_one_lift(
            &sim,
            tim,
            "Enjoyed the plants",
            expected,
            &format!("{elapsed} ticks after leaving"),
        );
    }
    for gone in [
        100 + PLANT_FADE_TICKS,
        100 + PLANT_FADE_TICKS + 1,
        1_000_000,
    ] {
        set_clock(&mut sim, gone);
        assert_eq!(lifts(&sim, tim), vec![], "tick {gone}: fully faded");
        assert!(
            sim.mood_of(tim.index_u32())
                .unwrap()
                .moodlets
                .iter()
                .all(|moodlet| !moodlet.label.contains("plants")),
            "tick {gone}: the fade has no moodlet left, and none below zero"
        );
    }
}

/// The lift scales with what the room gave: a person who half likes plants
/// gets 5 points and takes 60 ticks to lose them.
#[test]
fn a_smaller_lift_fades_in_proportionally_fewer_ticks() {
    let mut sim = shipped();
    let tim = person(&mut sim, "Tim");
    set_values(&mut sim, tim, &[("plants", 0.5)]);
    set_clock(&mut sim, 10);
    beside_the_plant(&mut sim, tim);
    refresh(&mut sim);
    assert_eq!(end_tick(&sim, tim, "plants"), Some(10 + 60));
    in_the_kitchen(&mut sim, tim);
    set_clock(&mut sim, 40);
    assert_one_lift(&sim, tim, "Enjoyed the plants", 2.5, "half way");
    set_clock(&mut sim, 70);
    assert_eq!(lifts(&sim, tim), vec![]);
}

/// [OA-presence], issue 344: coming back to liked furniture lifts the mood
/// up to what the room gives and no higher, and leaving again starts the
/// fade from there, so the end tick is a full fade from the return.
#[test]
fn returning_refreshes_the_lift_up_to_what_the_room_gives_and_never_above() {
    let mut sim = shipped();
    let tim = person(&mut sim, "Tim");
    set_values(&mut sim, tim, &[("plants", 1.0)]);
    set_clock(&mut sim, 100);
    beside_the_plant(&mut sim, tim);
    refresh(&mut sim);
    in_the_kitchen(&mut sim, tim);
    set_clock(&mut sim, 160);
    assert_one_lift(&sim, tim, "Enjoyed the plants", 5.0, "half faded");

    beside_the_plant(&mut sim, tim);
    assert_one_lift(
        &sim,
        tim,
        "Likes the plants here",
        PLANT_LIFT,
        "back beside it, before the refresh",
    );
    refresh(&mut sim);
    assert_eq!(
        end_tick(&sim, tim, "plants"),
        Some(160 + PLANT_FADE_TICKS),
        "a full fade from the return, not a tick more"
    );
    assert_one_lift(
        &sim,
        tim,
        "Likes the plants here",
        PLANT_LIFT,
        "back beside it, after the refresh: never above what the room gives",
    );

    in_the_kitchen(&mut sim, tim);
    assert_one_lift(
        &sim,
        tim,
        "Enjoyed the plants",
        PLANT_LIFT,
        "leaving again starts from the room's lift",
    );
    // Standing there for a long time keeps the end a full fade ahead.
    beside_the_plant(&mut sim, tim);
    for tick in 161..=200 {
        set_clock(&mut sim, tick);
        refresh(&mut sim);
        assert_eq!(end_tick(&sim, tim, "plants"), Some(tick + PLANT_FADE_TICKS));
        assert_one_lift(
            &sim,
            tim,
            "Likes the plants here",
            PLANT_LIFT,
            &format!("tick {tick}"),
        );
    }
}

/// The rate is the tuning's, not a constant: at twice the shipped rate one
/// plant fades in half the ticks, and a slower rate takes longer.
#[test]
fn the_fade_rate_comes_from_the_tuning() {
    for (rate, ticks) in [(10.0_f32, 60_u64), (2.5, 240), (5.0, 120)] {
        let mut pack = terri_data::pack().clone();
        pack.tuning.affinity_presence_fade_points_per_hour = rate;
        let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
        let mut sim = shipped();
        sim.world_mut().insert_resource(crate::Content(pack));
        let tim = person(&mut sim, "Tim");
        set_values(&mut sim, tim, &[("plants", 1.0)]);
        set_clock(&mut sim, 100);
        beside_the_plant(&mut sim, tim);
        refresh(&mut sim);
        assert_eq!(
            end_tick(&sim, tim, "plants"),
            Some(100 + ticks),
            "rate {rate}"
        );
        in_the_kitchen(&mut sim, tim);
        set_clock(&mut sim, 100 + ticks / 2);
        assert_one_lift(
            &sim,
            tim,
            "Enjoyed the plants",
            5.0,
            &format!("rate {rate}"),
        );
        set_clock(&mut sim, 100 + ticks);
        assert_eq!(lifts(&sim, tim), vec![], "rate {rate}");
    }
}

/// A smaller room never cuts a bigger lift short: a person who leaves four
/// plants (19 points) for one (10) keeps reading the bigger, still fading
/// lift, and the end tick does not move earlier.
#[test]
fn a_bigger_fading_lift_outlasts_a_smaller_room() {
    let mut sim = shipped();
    let tim = person(&mut sim, "Tim");
    set_values(&mut sim, tim, &[("plants", 1.0)]);
    for tile in [(9.0, 4.0), (13.0, 5.0), (15.0, 5.0)] {
        sim.spawn_object(
            Position {
                x: tile.0,
                y: tile.1,
            },
            terri_data::pack().find("potted_plant").unwrap(),
        );
    }
    set_clock(&mut sim, 100);
    beside_the_plant(&mut sim, tim);
    refresh(&mut sim);
    let bigger_end = 100 + 228;
    assert_eq!(end_tick(&sim, tim, "plants"), Some(bigger_end));

    // The study's one plant gives 10 points, and 60 ticks have passed.
    stand(&mut sim, tim, 8.0, 8.0);
    set_clock(&mut sim, 160);
    let read = lifts(&sim, tim);
    assert_eq!(read.len(), 1, "{read:?}");
    assert_eq!(read[0].0, "Likes the plants here", "they are among plants");
    assert!(
        (read[0].1 - 14.0).abs() < 1e-4,
        "19 less 60 ticks of fade, above the room's 10: {}",
        read[0].1
    );
    refresh(&mut sim);
    assert_eq!(
        end_tick(&sim, tim, "plants"),
        Some(bigger_end),
        "a smaller room does not shorten the fade"
    );
}

/// Each kind fades on its own clock, and the moodlets come in kinds order
/// whichever are nearby and whichever are fading.
#[test]
fn each_kind_fades_separately_and_is_named_for_its_own_state() {
    let mut sim = shipped();
    let tim = person(&mut sim, "Tim");
    set_values(&mut sim, tim, &[("plants", 1.0), ("aquarium", 1.0)]);
    set_clock(&mut sim, 50);
    stand(&mut sim, tim, 8.0, 8.0);
    refresh(&mut sim);
    assert_eq!(
        lifts(&sim, tim),
        vec![
            ("Likes the plants here".to_string(), 10.0),
            ("Likes the aquarium here".to_string(), 10.0),
        ]
    );
    assert_eq!(end_tick(&sim, tim, "plants"), Some(50 + PLANT_FADE_TICKS));
    assert_eq!(end_tick(&sim, tim, "aquarium"), Some(50 + PLANT_FADE_TICKS));

    // The living room has a plant and no aquarium.
    beside_the_plant(&mut sim, tim);
    set_clock(&mut sim, 110);
    refresh(&mut sim);
    let read = lifts(&sim, tim);
    assert_eq!(read.len(), 2, "{read:?}");
    assert_eq!(read[0], ("Likes the plants here".to_string(), 10.0));
    assert_eq!(read[1].0, "Enjoyed the aquarium");
    assert!((read[1].1 - 5.0).abs() < 1e-4, "{}", read[1].1);
    assert_eq!(end_tick(&sim, tim, "plants"), Some(110 + PLANT_FADE_TICKS));
    assert_eq!(end_tick(&sim, tim, "aquarium"), Some(50 + PLANT_FADE_TICKS));
}

/// A person who walks out to work, or into the yard, is no longer among the
/// furniture: the lift fades rather than ending.
#[test]
fn leaving_for_work_or_the_yard_fades_the_lift() {
    let mut sim = shipped();
    let tim = person(&mut sim, "Tim");
    set_values(&mut sim, tim, &[("plants", 1.0)]);
    set_clock(&mut sim, 100);
    beside_the_plant(&mut sim, tim);
    refresh(&mut sim);

    set_clock(&mut sim, 130);
    sim.world_mut().entity_mut(tim).insert(terri_core::AtWork {
        remaining_ticks: 10,
    });
    assert_one_lift(&sim, tim, "Enjoyed the plants", 7.5, "at work");
    refresh(&mut sim);
    assert_eq!(
        end_tick(&sim, tim, "plants"),
        Some(100 + PLANT_FADE_TICKS),
        "being at work records nothing new"
    );
    sim.world_mut()
        .entity_mut(tim)
        .remove::<terri_core::AtWork>();
    stand(&mut sim, tim, 17.0, 2.0);
    assert_one_lift(&sim, tim, "Enjoyed the plants", 7.5, "in the yard");
}

/// Presence never lowers mood, and nothing fades for what is not liked: a
/// dislike, a value under the threshold and a kind with no presence reach
/// record no row.
#[test]
fn only_a_liked_presence_kind_leaves_a_fade() {
    let mut sim = shipped();
    let tim = person(&mut sim, "Tim");
    set_clock(&mut sim, 100);
    for (values, why) in [
        (vec![("plants", -1.0)], "hated"),
        (vec![("plants", -0.5)], "disliked"),
        (vec![("plants", 0.0)], "indifferent"),
        (vec![("plants", 0.199_999)], "under the threshold"),
        (vec![("television", 1.0)], "a use kind, loved"),
    ] {
        set_values(&mut sim, tim, &values);
        beside_the_plant(&mut sim, tim);
        refresh(&mut sim);
        assert!(
            sim.world().resource::<PresenceFade>().entries().is_empty(),
            "{why}"
        );
        in_the_kitchen(&mut sim, tim);
        set_clock(&mut sim, 101);
        assert_eq!(lifts(&sim, tim), vec![], "{why}");
        set_clock(&mut sim, 100);
    }
    // The threshold itself counts.
    set_values(&mut sim, tim, &[("plants", 0.2)]);
    beside_the_plant(&mut sim, tim);
    refresh(&mut sim);
    assert_eq!(end_tick(&sim, tim, "plants"), Some(100 + 24));
}

/// One row per person and kind, kept in order, and a person's rows go with
/// them when they die.
#[test]
fn a_dead_persons_fade_is_forgotten() {
    let mut sim = shipped();
    let tim = person(&mut sim, "Tim");
    let casey = person(&mut sim, "Casey");
    set_values(&mut sim, tim, &[("plants", 1.0)]);
    set_values(&mut sim, casey, &[("plants", 1.0)]);
    set_clock(&mut sim, 100);
    beside_the_plant(&mut sim, tim);
    beside_the_plant(&mut sim, casey);
    refresh(&mut sim);
    assert_eq!(sim.world().resource::<PresenceFade>().entries().len(), 2);
    let casey_id = id_of(&sim, casey);
    crate::mortality::remove_person(sim.world_mut(), casey);
    let remaining: Vec<SimId> = sim
        .world()
        .resource::<PresenceFade>()
        .entries()
        .iter()
        .map(|row| row.0)
        .collect();
    assert_eq!(remaining, vec![id_of(&sim, tim)]);
    assert!(!remaining.contains(&casey_id));
}

/// Fades that have ended are dropped by the tick, so the list stays as long
/// as the number of lifts still running, and a person who stays among liked
/// furniture keeps theirs.
#[test]
fn the_refresh_drops_ended_fades_and_keeps_current_ones() {
    let mut sim = shipped();
    let tim = person(&mut sim, "Tim");
    set_values(&mut sim, tim, &[("plants", 1.0)]);
    set_clock(&mut sim, 100);
    beside_the_plant(&mut sim, tim);
    refresh(&mut sim);
    in_the_kitchen(&mut sim, tim);
    set_clock(&mut sim, 100 + PLANT_FADE_TICKS - 1);
    refresh(&mut sim);
    assert_eq!(sim.world().resource::<PresenceFade>().entries().len(), 1);
    set_clock(&mut sim, 100 + PLANT_FADE_TICKS);
    refresh(&mut sim);
    assert!(sim.world().resource::<PresenceFade>().entries().is_empty());
}

/// The schedule runs the refresh: a person standing among liked furniture
/// when a real tick finishes has the lift recorded a full fade ahead of the
/// new clock, and reads it.
#[test]
fn a_real_tick_records_the_lift_of_whoever_stands_among_liked_furniture() {
    let mut sim = shipped();
    let tim = person(&mut sim, "Tim");
    set_values(&mut sim, tim, &[("plants", 1.0)]);
    beside_the_plant(&mut sim, tim);
    sim.tick();
    let now = sim.world().resource::<SimClock>().tick;
    assert_eq!(end_tick(&sim, tim, "plants"), Some(now + PLANT_FADE_TICKS));
    let read = lifts(&sim, tim);
    assert_eq!(read.len(), 1, "{read:?}");
    assert!(read[0].1 >= PLANT_LIFT - 1e-4, "{read:?}");
}

/// Two worlds that do the same things hold the same fades, in the same
/// order, whichever person is refreshed first.
#[test]
fn the_fades_are_kept_in_person_then_kind_order_and_are_deterministic() {
    let run = || {
        let mut sim = shipped();
        let people: Vec<Entity> = ["Casey", "Tim", "Bill"]
            .iter()
            .filter_map(|name| {
                sim.world_mut()
                    .query::<(Entity, &SimName)>()
                    .iter(sim.world())
                    .find(|(_, person)| person.0 == *name)
                    .map(|(entity, _)| entity)
            })
            .collect();
        for &who in &people {
            set_values(&mut sim, who, &[("plants", 1.0), ("aquarium", 1.0)]);
            stand(&mut sim, who, 8.0, 8.0);
        }
        set_clock(&mut sim, 7);
        refresh(&mut sim);
        let rows = sim.world().resource::<PresenceFade>().entries().to_vec();
        (rows, sim.world_hash())
    };
    let (rows, hash) = run();
    assert!(rows.len() >= 4, "{rows:?}");
    assert!(
        rows.windows(2)
            .all(|pair| (pair[0].0, pair[0].1) < (pair[1].0, pair[1].1)),
        "{rows:?}"
    );
    assert_eq!(run(), (rows, hash));
}

/// How many ticks a lift takes to fade: the lift over the rate per hour,
/// times sixty, rounded down so a refresh never gives more than the room.
#[test]
fn fade_ticks_divides_the_lift_by_the_rate_and_rounds_down() {
    assert_eq!(fade_ticks(10.0, 5.0), 120);
    assert_eq!(fade_ticks(19.0, 5.0), 228);
    assert_eq!(fade_ticks(5.0, 5.0), 60);
    assert_eq!(fade_ticks(10.0, 7.0), 85, "85.7 rounds down");
    assert_eq!(fade_ticks(0.04, 5.0), 0, "under a tick is no fade");
    // A fade never lasts past the longest a save may hold.
    assert_eq!(
        fade_ticks(1_000_000.0, 1.0),
        terri_data::LONGEST_PRESENCE_FADE_TICKS
    );
    assert_eq!(
        fade_ticks(f32::MAX, f32::MIN_POSITIVE),
        terri_data::LONGEST_PRESENCE_FADE_TICKS
    );
    // Nothing usable gives nothing.
    for (points, rate) in [
        (0.0, 5.0),
        (-3.0, 5.0),
        (f32::NAN, 5.0),
        (10.0, 0.0),
        (10.0, -5.0),
        (10.0, f32::NAN),
    ] {
        assert_eq!(fade_ticks(points, rate), 0, "{points} at {rate}");
    }
}

/// The unit behavior of the list itself.
mod list {
    use super::super::*;
    use terri_core::FnvHasher;

    const PLANTS: u32 = 0;
    const AQUARIUM: u32 = 1;

    #[test]
    fn one_row_per_person_and_kind_in_order_and_refresh_keeps_the_later_end() {
        let mut fade = PresenceFade::default();
        fade.refresh(SimId(3), AQUARIUM, 10, 100);
        fade.refresh(SimId(1), PLANTS, 10, 100);
        fade.refresh(SimId(3), PLANTS, 10, 100);
        assert_eq!(
            fade.entries(),
            &[
                (SimId(1), PLANTS, 110),
                (SimId(3), PLANTS, 110),
                (SimId(3), AQUARIUM, 110)
            ]
        );
        // A shorter fade from later never brings the end in.
        fade.refresh(SimId(1), PLANTS, 50, 20);
        assert_eq!(fade.end_tick(SimId(1), PLANTS), Some(110));
        // A longer one pushes it out.
        fade.refresh(SimId(1), PLANTS, 50, 100);
        assert_eq!(fade.end_tick(SimId(1), PLANTS), Some(150));
        assert_eq!(fade.entries().len(), 3, "still one row each");
        assert_eq!(fade.end_tick(SimId(2), PLANTS), None);
        // A fade of no ticks records nothing.
        fade.refresh(SimId(9), PLANTS, 50, 0);
        assert_eq!(fade.end_tick(SimId(9), PLANTS), None);
    }

    #[test]
    fn from_entries_sorts_and_keeps_the_first_duplicate() {
        let fade = PresenceFade::from_entries(vec![
            (SimId(7), PLANTS, 9),
            (SimId(2), AQUARIUM, 4),
            (SimId(7), PLANTS, 1),
            (SimId(2), PLANTS, 6),
        ]);
        assert_eq!(
            fade.entries(),
            &[
                (SimId(2), PLANTS, 6),
                (SimId(2), AQUARIUM, 4),
                (SimId(7), PLANTS, 9)
            ]
        );
    }

    /// The lift left is the ticks to the end times the rate per hour over
    /// sixty, and never below zero, whatever the clock says.
    #[test]
    fn the_lift_is_the_remaining_fade_and_floors_at_zero() {
        let mut fade = PresenceFade::default();
        fade.refresh(SimId(1), PLANTS, 100, 120);
        for (now, expected) in [(100, 10.0), (160, 5.0), (190, 2.5), (220, 0.0)] {
            assert_eq!(fade.lift(SimId(1), PLANTS, now, 5.0), expected, "{now}");
        }
        for now in [221, 5_000, u64::MAX] {
            assert_eq!(fade.lift(SimId(1), PLANTS, now, 5.0), 0.0, "{now}");
        }
        // The rate scales it.
        assert_eq!(fade.lift(SimId(1), PLANTS, 160, 10.0), 10.0);
        // Nobody else, no other kind.
        assert_eq!(fade.lift(SimId(2), PLANTS, 100, 5.0), 0.0);
        assert_eq!(fade.lift(SimId(1), AQUARIUM, 100, 5.0), 0.0);
    }

    #[test]
    fn forget_and_expire_drop_rows() {
        let mut fade = PresenceFade::default();
        fade.refresh(SimId(1), PLANTS, 0, 100);
        fade.refresh(SimId(1), AQUARIUM, 0, 50);
        fade.refresh(SimId(2), PLANTS, 0, 200);
        fade.expire(49);
        assert_eq!(fade.entries().len(), 3);
        fade.expire(50);
        assert_eq!(
            fade.entries(),
            &[(SimId(1), PLANTS, 100), (SimId(2), PLANTS, 200)],
            "a fade ending at this tick is already over"
        );
        fade.forget(SimId(1));
        assert_eq!(fade.entries(), &[(SimId(2), PLANTS, 200)]);
        fade.expire(u64::MAX);
        assert!(fade.entries().is_empty());
    }

    /// The digest sees the list only when it holds something, sees every
    /// field of every row, and tells the tag apart.
    #[test]
    fn hash_observes_every_field_and_ignores_an_empty_list() {
        let digest = |fade: &PresenceFade, tag: &[u8]| {
            let mut hash = FnvHasher::default();
            fade.hash_into(&mut hash, tag);
            hash.finish()
        };
        let nothing = FnvHasher::default().finish();
        assert_eq!(digest(&PresenceFade::default(), b"a"), nothing);
        let mut one = PresenceFade::default();
        one.refresh(SimId(1), PLANTS, 0, 10);
        let base = digest(&one, b"a");
        assert_ne!(base, nothing, "a row is hashed");
        assert_ne!(digest(&one, b"b"), base, "the tag is hashed");
        let mut later = PresenceFade::default();
        later.refresh(SimId(1), PLANTS, 0, 11);
        assert_ne!(digest(&later, b"a"), base, "the end tick is hashed");
        let mut other_kind = PresenceFade::default();
        other_kind.refresh(SimId(1), AQUARIUM, 0, 10);
        assert_ne!(digest(&other_kind, b"a"), base, "the kind is hashed");
        let mut other_person = PresenceFade::default();
        other_person.refresh(SimId(2), PLANTS, 0, 10);
        assert_ne!(digest(&other_person, b"a"), base, "the person is hashed");
        let mut two = one.clone();
        two.refresh(SimId(2), PLANTS, 0, 10);
        assert_ne!(digest(&two, b"a"), base, "a second row is hashed");
    }
}
