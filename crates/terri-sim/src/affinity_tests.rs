//! Tests for the presence and use moodlets, the bother and the band words -
//! [OA-presence], [OA-use] and [OA-hud] in
//! `docs/specs/2026-10-06-object-affinities.md`, and Review focus 1 to 3 of
//! the object-affinities plan.
//!
//! The room tests stand on the shipped lot, whose rooms are: the kitchen,
//! x 0 to 7 and y 0 to 5; the living room, x 8 to 15 and y 0 to 5, with a
//! potted plant at (15, 0) and the television at (10, 3); and the study, x 6
//! to 11 and y 6 to 11, with a potted plant at (10, 11) and the aquarium at
//! (6, 10). Everything past x 15 or y 11 is the yard.

use super::*;
use crate::mood::Moodlet;
use crate::relationship_effects::{RelationshipCause, RelationshipEffect};
use crate::{Content, Sim};
use terri_core::{Career, CommandQueue, Habituation, Needs, ObjectDefId, SimCommand, SimName};

/// The shipped household on the shipped lot.
fn shipped() -> Sim {
    Sim::new_from_shipped_lot()
}

fn clock(sim: &Sim) -> u64 {
    sim.world().resource::<SimClock>().tick
}

fn person(sim: &mut Sim, name: &str) -> Entity {
    sim.world_mut()
        .query::<(Entity, &SimName)>()
        .iter(sim.world())
        .find(|(_, person)| person.0 == name)
        .unwrap_or_else(|| panic!("{name} is in the shipped household"))
        .0
}

fn kind(id: &str) -> usize {
    terri_data::pack()
        .affinities
        .iter()
        .position(|kind| kind.id == id)
        .unwrap_or_else(|| panic!("content has no affinity kind {id}"))
}

fn object_def(id: &str) -> ObjectDefId {
    terri_data::pack()
        .find(id)
        .unwrap_or_else(|| panic!("content has no object {id}"))
}

/// The row of `interaction` in the shipped object `object`.
fn row(object: &str, interaction: &str) -> u32 {
    terri_data::pack()
        .object(object_def(object))
        .interactions
        .iter()
        .position(|candidate| candidate.id == interaction)
        .unwrap_or_else(|| panic!("{object} has no interaction {interaction}")) as u32
}

/// The lowest-indexed placed object of the shipped kind `id`.
fn placed(sim: &mut Sim, id: &str) -> Entity {
    let def = object_def(id);
    sim.world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .filter(|(_, object)| object.0 == def)
        .map(|(entity, _)| entity)
        .min_by_key(|entity| entity.index())
        .unwrap_or_else(|| panic!("the shipped lot has a {id}"))
}

/// Gives `who` exactly these values, every other kind at 0.0.
fn set_values(sim: &mut Sim, who: Entity, values: &[(&str, f32)]) {
    let mut all = vec![0.0; terri_data::pack().affinities.len()];
    for &(id, value) in values {
        all[kind(id)] = value;
    }
    sim.world_mut()
        .entity_mut(who)
        .insert(Affinities::from_values(all));
}

fn stand(sim: &mut Sim, who: Entity, x: f32, y: f32) {
    *sim.world_mut().get_mut::<Position>(who).unwrap() = Position { x, y };
}

fn spawn_plant(sim: &mut Sim, x: f32, y: f32) -> Entity {
    sim.spawn_object(Position { x, y }, object_def("potted_plant"))
}

/// The moodlets this slice adds, in the order mood lists them.
fn affinity_moodlets(sim: &Sim, who: Entity) -> Vec<(String, f32)> {
    sim.mood_of(who.index_u32())
        .expect("a living person has a mood")
        .moodlets
        .into_iter()
        .filter(|moodlet| {
            moodlet.label.starts_with("Likes the ") || moodlet.label.starts_with("Bothered by ")
        })
        .map(|Moodlet { label, score }| (label, score))
        .collect()
}

fn likes_plants(score: f32) -> Vec<(String, f32)> {
    vec![("Likes the plants here".to_string(), score)]
}

/// [OA-presence]: one plant in the room gives the whole presence points at
/// a value of 1.0, signed by the value; a value below the threshold gives
/// nothing; each further plant adds the extra points up to the cap.
#[test]
fn presence_scores_one_plant_and_caps_the_extras() {
    let mut sim = shipped();
    let tuning = terri_data::pack().tuning;
    assert_eq!(
        (
            tuning.affinity_presence_points,
            tuning.affinity_presence_extra_points,
            tuning.affinity_presence_extra_cap,
            tuning.affinity_presence_threshold
        ),
        (10.0, 3.0, 3, 0.2),
        "the shipped numbers this test is written against"
    );
    let tim = person(&mut sim, "Tim");
    stand(&mut sim, tim, 14.0, 1.0);

    set_values(&mut sim, tim, &[("plants", 1.0)]);
    assert_eq!(affinity_moodlets(&sim, tim), likes_plants(10.0));
    set_values(&mut sim, tim, &[("plants", -1.0)]);
    assert_eq!(
        affinity_moodlets(&sim, tim),
        vec![("Bothered by the plants here".to_string(), -10.0)]
    );
    set_values(&mut sim, tim, &[("plants", 0.5)]);
    assert_eq!(affinity_moodlets(&sim, tim), likes_plants(5.0));

    // The threshold is inclusive: 0.2 counts, anything below it does not.
    set_values(&mut sim, tim, &[("plants", 0.2)]);
    assert_eq!(affinity_moodlets(&sim, tim), likes_plants(2.0));
    set_values(&mut sim, tim, &[("plants", 0.199_999)]);
    assert_eq!(affinity_moodlets(&sim, tim), vec![]);
    set_values(&mut sim, tim, &[("plants", 0.1)]);
    assert_eq!(affinity_moodlets(&sim, tim), vec![]);
    set_values(&mut sim, tim, &[("plants", -0.1)]);
    assert_eq!(affinity_moodlets(&sim, tim), vec![]);

    // Each further plant in the room adds 3 at 1.0, up to three of them.
    set_values(&mut sim, tim, &[("plants", 1.0)]);
    for (tile, expected) in [((9.0, 4.0), 13.0), ((13.0, 5.0), 16.0), ((15.0, 5.0), 19.0)] {
        spawn_plant(&mut sim, tile.0, tile.1);
        assert_eq!(affinity_moodlets(&sim, tim), likes_plants(expected));
    }
    spawn_plant(&mut sim, 14.0, 5.0);
    assert_eq!(
        affinity_moodlets(&sim, tim),
        likes_plants(19.0),
        "a fifth plant is past the cap"
    );
    set_values(&mut sim, tim, &[("plants", -0.5)]);
    assert_eq!(
        affinity_moodlets(&sim, tim),
        vec![("Bothered by the plants here".to_string(), -9.5)]
    );
}

/// Review focus 1: only the room the person stands in counts. Either side
/// of the kitchen's doorway into the living room is a different room, the
/// living room's plant is not the study's, and nobody in the yard or at
/// work reads anything, even beside a plant.
#[test]
fn presence_counts_only_the_room_the_person_stands_in() {
    let mut sim = shipped();
    let tim = person(&mut sim, "Tim");
    set_values(&mut sim, tim, &[("plants", 1.0), ("aquarium", 1.0)]);

    stand(&mut sim, tim, 14.0, 1.0);
    assert_eq!(
        affinity_moodlets(&sim, tim),
        likes_plants(10.0),
        "one plant, not the study's as well, and no aquarium"
    );
    stand(&mut sim, tim, 8.0, 2.0);
    assert_eq!(affinity_moodlets(&sim, tim), likes_plants(10.0));
    stand(&mut sim, tim, 7.0, 2.0);
    assert_eq!(
        affinity_moodlets(&sim, tim),
        vec![],
        "the kitchen side of the doorway"
    );
    stand(&mut sim, tim, 8.0, 8.0);
    assert_eq!(
        affinity_moodlets(&sim, tim),
        vec![
            ("Likes the plants here".to_string(), 10.0),
            ("Likes the aquarium here".to_string(), 10.0),
        ],
        "the study's plant and aquarium, in kinds order"
    );
    // A position rounds to its tile: 7.6 is the living room's 8.
    stand(&mut sim, tim, 7.6, 2.4);
    assert_eq!(affinity_moodlets(&sim, tim), likes_plants(10.0));

    // A plant in the yard counts for nobody, outside or in.
    spawn_plant(&mut sim, 18.0, 2.0);
    stand(&mut sim, tim, 17.0, 2.0);
    assert_eq!(affinity_moodlets(&sim, tim), vec![], "the yard is no room");
    stand(&mut sim, tim, 14.0, 1.0);
    assert_eq!(affinity_moodlets(&sim, tim), likes_plants(10.0));

    // A worker's position is frozen where they left; at work they are out.
    sim.world_mut().entity_mut(tim).insert(terri_core::AtWork {
        remaining_ticks: 10,
    });
    assert_eq!(affinity_moodlets(&sim, tim), vec![], "at work");
    sim.world_mut()
        .entity_mut(tim)
        .remove::<terri_core::AtWork>();
    assert_eq!(affinity_moodlets(&sim, tim), likes_plants(10.0));
}

/// Puts `who` at the television's watching interaction as if it had
/// arrived: the target, the running interaction and no path.
fn watching_by_hand(sim: &mut Sim, who: Entity, x: f32, y: f32) {
    let television = placed(sim, "television");
    let watch = row("television", "watch_tv");
    stand(sim, who, x, y);
    sim.world_mut().entity_mut(who).remove::<Path>().insert((
        Target {
            object: television,
            interaction: watch,
        },
        Eating {
            object: object_def("television"),
            interaction: watch,
            remaining_ticks: 30,
        },
    ));
}

/// [OA-presence], [OA-use]: the affinity moodlets come after everything
/// mood listed before them, `Feeling sick` included, presence before use.
#[test]
fn affinity_moodlets_come_after_feeling_sick() {
    let mut sim = shipped();
    let tim = person(&mut sim, "Tim");
    let casey = person(&mut sim, "Casey");
    stand(&mut sim, tim, 14.0, 1.0);
    set_values(&mut sim, tim, &[("plants", 1.0), ("television", -1.0)]);
    let tuning = terri_data::pack().tuning;
    let mut habits = Habituation::default();
    habits.bump(
        object_def("fridge"),
        row("fridge", "grab_snack"),
        tuning.habituation_max,
        tuning.habituation_max,
    );
    sim.world_mut().entity_mut(tim).insert(habits);
    watching_by_hand(&mut sim, casey, 11.0, 4.0);

    let labels: Vec<String> = sim
        .mood_of(tim.index_u32())
        .unwrap()
        .moodlets
        .into_iter()
        .map(|moodlet| moodlet.label)
        .collect();
    assert!(labels.len() > 4, "something comes before: {labels:?}");
    assert_eq!(
        labels[labels.len() - 4..],
        [
            "Overdoing Grab a snack".to_string(),
            "Feeling sick".to_string(),
            "Likes the plants here".to_string(),
            "Bothered by Casey using the television".to_string(),
        ],
        "{labels:?}"
    );
}

/// A world where only the bother moves feelings: no proximity, friction or
/// decay, so a feeling change is the nuisance alone.
fn quiet_relationships(sim: &mut Sim) {
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.relationships.proximity_per_hour = 0.0;
    pack.tuning.relationships.friction_per_hour = 0.0;
    pack.tuning.relationship_decay_per_tick = 0.0;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
}

/// Bill and Casey alone in the house, with no shift to leave for and full
/// needs, and Tim gone so his choices cannot crowd the television.
fn bill_and_casey() -> (Sim, Entity, Entity) {
    let mut sim = shipped();
    quiet_relationships(&mut sim);
    let tim = person(&mut sim, "Tim");
    sim.world_mut().despawn(tim);
    let bill = person(&mut sim, "Bill");
    let casey = person(&mut sim, "Casey");
    for who in [bill, casey] {
        sim.world_mut()
            .entity_mut(who)
            .remove::<Career>()
            .insert(Needs::all_at(100.0));
        set_values(&mut sim, who, &[]);
    }
    (sim, bill, casey)
}

fn order(sim: &mut Sim, who: Entity, object: &str, interaction: &str) {
    let object_entity = placed(sim, object);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: who.index_u32(),
            object: object_entity.index_u32(),
            interaction: row(object, interaction),
        });
}

/// Whether `who` is actually using `object`: the running interaction
/// matches the target and there is no path left to walk.
fn is_using(sim: &Sim, who: Entity, object: &str) -> bool {
    let world = sim.world();
    world.get::<Path>(who).is_none()
        && world.get::<Eating>(who).is_some_and(|eating| {
            world.get::<Target>(who).is_some_and(|target| {
                eating.object == object_def(object)
                    && world.get::<SmartObject>(target.object).map(|o| o.0) == Some(eating.object)
                    && target.interaction == eating.interaction
            })
        })
}

/// Ticks until every `(who, object)` is actually using it, at most `bound`
/// ticks, asserting it happened and that the clock moved once per tick;
/// then stretches each running interaction so it outlasts the test.
/// `during` sees the world after every tick of the approach.
fn tick_until_using(
    sim: &mut Sim,
    users: &[(Entity, &str)],
    bound: u32,
    mut during: impl FnMut(&Sim),
) {
    let start = clock(sim);
    let mut ticks = 0_u64;
    let mut arrived = false;
    for _ in 0..bound {
        sim.tick();
        ticks += 1;
        during(sim);
        if users
            .iter()
            .all(|&(who, object)| is_using(sim, who, object))
        {
            arrived = true;
            break;
        }
    }
    assert!(
        arrived,
        "everyone must be using their object within {bound} ticks"
    );
    assert_eq!(clock(sim), start + ticks, "one clock tick per loop tick");
    for &(who, _) in users {
        sim.world_mut()
            .get_mut::<Eating>(who)
            .unwrap()
            .remaining_ticks = 5_000;
    }
}

fn feeling(sim: &Sim, who: Entity, toward: Entity) -> f32 {
    let toward = *sim.world().get::<SimId>(toward).unwrap();
    sim.world()
        .get::<Relationships>(who)
        .map_or(0.0, |feelings| feelings.feeling(toward))
}

fn nuisances_this_tick(sim: &Sim) -> Vec<RelationshipEffect> {
    sim.relationship_effects()
        .iter()
        .filter(|effect| effect.cause == RelationshipCause::Nuisance)
        .copied()
        .collect()
}

fn bothered_by_casey(score: f32) -> Vec<(String, f32)> {
    vec![("Bothered by Casey using the television".to_string(), score)]
}

/// [OA-use]: Bill hates television and lounges in the living room while
/// Casey watches it. Bill reads the moodlet, and over an hour of ticks his
/// feeling toward Casey falls by `affinity_use_feeling_per_hour`, one
/// Nuisance effect per tick naming Casey as responsible.
#[test]
fn a_hater_is_bothered_by_another_watcher_and_their_feeling_falls() {
    let (mut sim, bill, casey) = bill_and_casey();
    let tuning = terri_data::pack().tuning;
    assert_eq!(
        (
            tuning.affinity_use_points,
            tuning.affinity_use_feeling_per_hour
        ),
        (15.0, 0.03),
        "the shipped numbers this test is written against"
    );
    set_values(&mut sim, bill, &[("television", -1.0)]);
    order(&mut sim, bill, "sofa", "lounge");
    order(&mut sim, casey, "television", "watch_tv");
    tick_until_using(
        &mut sim,
        &[(bill, "sofa"), (casey, "television")],
        400,
        |_| {},
    );

    assert_eq!(affinity_moodlets(&sim, bill), bothered_by_casey(-15.0));
    assert_eq!(affinity_moodlets(&sim, casey), vec![], "Casey holds 0.0");

    let bill_id = *sim.world().get::<SimId>(bill).unwrap();
    let casey_id = *sim.world().get::<SimId>(casey).unwrap();
    let before = feeling(&sim, bill, casey);
    let start = clock(&sim);
    for tick in 0..60_u64 {
        sim.tick();
        assert_eq!(
            clock(&sim),
            start + tick + 1,
            "one clock tick per loop tick"
        );
        assert!(
            is_using(&sim, casey, "television"),
            "tick {tick}: still watching"
        );
        let nuisances = nuisances_this_tick(&sim);
        assert_eq!(nuisances.len(), 1, "tick {tick}: {nuisances:?}");
        let effect = nuisances[0];
        assert_eq!(
            (effect.responsible, effect.affected, effect.event),
            (casey_id, bill_id, 0)
        );
        assert!(!effect.emergency && !effect.directed);
        assert_eq!(effect.tick, clock(&sim), "stamped with this tick");
        assert!(
            (effect.requested + 0.0005).abs() < 1e-9,
            "tick {tick}: {}",
            effect.requested
        );
        assert!((effect.actual - effect.requested).abs() < 1e-6);
        assert!(
            sim.relationship_effects()
                .iter()
                .filter(|e| e.affected == bill_id && e.responsible == casey_id)
                .all(|e| e.cause == RelationshipCause::Nuisance),
            "tick {tick}: only the nuisance moves Bill's feeling toward Casey"
        );
    }
    let fallen = before - feeling(&sim, bill, casey);
    assert!((fallen - 0.03).abs() < 1e-5, "fell by {fallen}");

    // Half the dislike, half the cost.
    set_values(&mut sim, bill, &[("television", -0.5)]);
    assert_eq!(affinity_moodlets(&sim, bill), bothered_by_casey(-7.5));
    sim.tick();
    let nuisances = nuisances_this_tick(&sim);
    assert_eq!(nuisances.len(), 1);
    assert!((nuisances[0].requested + 0.000_25).abs() < 1e-9);
}

/// Review focus 2: Bill hates television and the radio and is watching
/// the television himself. His own use bothers him not at all; Casey at
/// the radio does. The television admits one user at a time, so a second
/// watcher is set by hand, and of the two watchers only Casey counts.
#[test]
fn a_hater_is_not_bothered_by_their_own_use() {
    let (mut sim, bill, casey) = bill_and_casey();
    set_values(&mut sim, bill, &[("television", -1.0)]);
    stand(&mut sim, casey, 3.0, 9.0);
    order(&mut sim, bill, "television", "watch_tv");
    tick_until_using(&mut sim, &[(bill, "television")], 400, |_| {});
    for _ in 0..5 {
        sim.tick();
        assert!(is_using(&sim, bill, "television"));
        assert_eq!(affinity_moodlets(&sim, bill), vec![], "his own use");
        assert_eq!(nuisances_this_tick(&sim).len(), 0);
    }

    set_values(&mut sim, bill, &[("television", -1.0), ("radio", -1.0)]);
    order(&mut sim, casey, "radio", "listen");
    tick_until_using(
        &mut sim,
        &[(bill, "television"), (casey, "radio")],
        400,
        |_| {},
    );
    assert_eq!(
        affinity_moodlets(&sim, bill),
        vec![("Bothered by Casey using the radio".to_string(), -15.0)]
    );
    sim.tick();
    let casey_id = *sim.world().get::<SimId>(casey).unwrap();
    let bill_id = *sim.world().get::<SimId>(bill).unwrap();
    let nuisances = nuisances_this_tick(&sim);
    assert_eq!(nuisances.len(), 1, "{nuisances:?}");
    assert_eq!(
        (nuisances[0].responsible, nuisances[0].affected),
        (casey_id, bill_id)
    );
    assert_eq!(feeling(&sim, bill, bill), 0.0, "no feeling toward himself");

    // Casey on the television's other slot, beside Bill.
    watching_by_hand(&mut sim, casey, 11.0, 4.0);
    assert!(is_using(&sim, bill, "television") && is_using(&sim, casey, "television"));
    assert_eq!(affinity_moodlets(&sim, bill), bothered_by_casey(-15.0));
    crate::relationship_effects::reset(sim.world_mut());
    bother(sim.world_mut());
    let nuisances = nuisances_this_tick(&sim);
    assert_eq!(nuisances.len(), 1, "{nuisances:?}");
    assert_eq!(
        (nuisances[0].responsible, nuisances[0].affected),
        (casey_id, bill_id)
    );
}

/// Review focus 3: a watcher who leaves the room, or dies, stops bothering
/// on the next tick, and the feeling already lost stays lost.
#[test]
fn the_bother_stops_when_the_watcher_leaves() {
    for dies in [false, true] {
        let (mut sim, bill, casey) = bill_and_casey();
        set_values(&mut sim, bill, &[("television", -1.0)]);
        order(&mut sim, bill, "sofa", "lounge");
        order(&mut sim, casey, "television", "watch_tv");
        tick_until_using(
            &mut sim,
            &[(bill, "sofa"), (casey, "television")],
            400,
            |_| {},
        );
        for _ in 0..10 {
            sim.tick();
        }
        assert_eq!(affinity_moodlets(&sim, bill), bothered_by_casey(-15.0));
        let lost = feeling(&sim, bill, casey);
        assert!(lost < 0.0, "the bother has cost something: {lost}");
        let casey_id = *sim.world().get::<SimId>(casey).unwrap();

        if dies {
            sim.world_mut().despawn(casey);
        } else {
            // The player clears her orders and sends her to the bath.
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::CancelIntents {
                    agent: casey.index_u32(),
                });
            order(&mut sim, casey, "bathtub", "soak");
        }
        sim.tick();
        if !dies {
            assert!(!is_using(&sim, casey, "television"), "she has left it");
        }
        assert_eq!(affinity_moodlets(&sim, bill), vec![], "dies {dies}");
        assert_eq!(nuisances_this_tick(&sim).len(), 0, "dies {dies}");
        for _ in 0..10 {
            sim.tick();
            assert_eq!(nuisances_this_tick(&sim).len(), 0, "dies {dies}");
        }
        let kept = sim
            .world()
            .get::<Relationships>(bill)
            .unwrap()
            .feeling(casey_id);
        assert_eq!(kept, lost, "dies {dies}: the feeling lost stays");
    }
}

/// [OA-use]: only a user in the bothered person's own room counts. Bill,
/// who hates television, reads nothing and loses nothing while Casey
/// watches from the next room or he stands in the yard, and is bothered
/// again back in the living room.
#[test]
fn a_watcher_in_another_room_bothers_nobody() {
    let (mut sim, bill, casey) = bill_and_casey();
    set_values(&mut sim, bill, &[("television", -1.0)]);
    order(&mut sim, bill, "sofa", "lounge");
    order(&mut sim, casey, "television", "watch_tv");
    tick_until_using(
        &mut sim,
        &[(bill, "sofa"), (casey, "television")],
        400,
        |_| {},
    );
    let bother_once = |sim: &mut Sim| {
        crate::relationship_effects::reset(sim.world_mut());
        bother(sim.world_mut());
        nuisances_this_tick(sim).len()
    };
    for (x, y, place) in [
        (7.0, 2.0, "the kitchen side of the doorway"),
        (8.0, 8.0, "the study"),
        (17.0, 2.0, "the yard"),
    ] {
        stand(&mut sim, bill, x, y);
        assert!(is_using(&sim, casey, "television"), "{place}");
        assert_eq!(affinity_moodlets(&sim, bill), vec![], "{place}");
        assert_eq!(bother_once(&mut sim), 0, "{place}");
    }
    stand(&mut sim, bill, 8.0, 2.0);
    assert_eq!(affinity_moodlets(&sim, bill), bothered_by_casey(-15.0));
    assert_eq!(bother_once(&mut sim), 1);
}

/// [OA-use]: a person who likes television gets nothing from another's
/// use, nor does a dislike weaker than the threshold, and a person still
/// walking to the television bothers nobody.
#[test]
fn a_lover_gets_nothing_from_another_watcher_and_a_walker_bothers_nobody() {
    let (mut sim, bill, casey) = bill_and_casey();
    set_values(&mut sim, bill, &[("television", -1.0)]);
    order(&mut sim, bill, "sofa", "lounge");
    order(&mut sim, casey, "television", "watch_tv");
    let mut walking_in_the_room = 0;
    tick_until_using(
        &mut sim,
        &[(bill, "sofa"), (casey, "television")],
        400,
        |sim| {
            let casey_room = {
                let rooms = RoomRegions::from_world(sim.world());
                room_of(sim.world(), casey, &rooms)
            };
            let living_room = {
                let rooms = RoomRegions::from_world(sim.world());
                rooms.at((14, 1))
            };
            if sim.world().get::<Path>(casey).is_some() && casey_room == living_room {
                walking_in_the_room += 1;
                assert!(
                    !affinity_moodlets(sim, bill)
                        .iter()
                        .any(|(label, _)| label.contains("Casey")),
                    "a walker bothers nobody"
                );
                assert_eq!(nuisances_this_tick(sim).len(), 0);
            }
        },
    );
    assert!(
        walking_in_the_room > 0,
        "Casey walked through the living room on her way"
    );
    assert_eq!(affinity_moodlets(&sim, bill), bothered_by_casey(-15.0));

    // Running the interaction with a path still to walk is not using it.
    sim.world_mut().entity_mut(casey).insert(Path {
        steps: vec![(11, 4)],
        cursor: 0,
    });
    assert_eq!(affinity_moodlets(&sim, bill), vec![], "en route");
    sim.world_mut().entity_mut(casey).remove::<Path>();
    assert_eq!(affinity_moodlets(&sim, bill), bothered_by_casey(-15.0));

    // The use threshold is inclusive at -0.2.
    set_values(&mut sim, bill, &[("television", -0.2)]);
    assert_eq!(affinity_moodlets(&sim, bill), bothered_by_casey(-3.0));
    set_values(&mut sim, bill, &[("television", -0.199_999)]);
    assert_eq!(affinity_moodlets(&sim, bill), vec![]);

    let before = feeling(&sim, bill, casey);
    for value in [1.0, 0.5, -0.1] {
        set_values(&mut sim, bill, &[("television", value)]);
        assert_eq!(affinity_moodlets(&sim, bill), vec![], "value {value}");
        sim.tick();
        assert!(is_using(&sim, casey, "television"));
        assert_eq!(nuisances_this_tick(&sim).len(), 0, "value {value}");
    }
    assert_eq!(feeling(&sim, bill, casey), before);
}

/// [OA-use]: the bother is per use kind. The radio is a use kind too, and
/// a hater of the radio is not bothered by the television.
#[test]
fn the_bother_belongs_to_the_kind_in_use() {
    let (mut sim, bill, casey) = bill_and_casey();
    set_values(&mut sim, bill, &[("radio", -1.0)]);
    order(&mut sim, bill, "sofa", "lounge");
    order(&mut sim, casey, "television", "watch_tv");
    tick_until_using(
        &mut sim,
        &[(bill, "sofa"), (casey, "television")],
        400,
        |_| {},
    );
    assert_eq!(affinity_moodlets(&sim, bill), vec![]);
    sim.tick();
    assert_eq!(nuisances_this_tick(&sim).len(), 0);
}

#[test]
fn band_words() {
    assert_eq!(band(1.0), "Loves");
    assert_eq!(band(0.6), "Loves");
    assert_eq!(band(0.59), "Likes");
    assert_eq!(band(0.2), "Likes");
    assert_eq!(band(0.19), "Indifferent");
    assert_eq!(band(0.0), "Indifferent");
    assert_eq!(band(-0.19), "Indifferent");
    assert_eq!(band(-0.2), "Dislikes");
    assert_eq!(band(-0.59), "Dislikes");
    assert_eq!(band(-0.6), "Hates");
    assert_eq!(band(-1.0), "Hates");
}
