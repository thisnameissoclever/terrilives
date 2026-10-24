//! Schema twenty-one and the world hash carry each person's held shift and
//! the shift stream: issue 296, `docs/specs/2026-10-18-shifts-and-careers.md`,
//! [WS-save] and [WS-determinism].
use crate::careers::Careers;
use crate::{Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::save_v21::{SavedHeldShift, SavedQueuedShiftCommand};
use terri_core::{Agent, Career, CommandQueue, SaveSnapshotV21, SimCommand, SimId, SimRng};

/// Every living person with their id, in id order.
fn household(sim: &mut Sim) -> Vec<(SimId, Entity)> {
    let mut people: Vec<(SimId, Entity)> = sim
        .world_mut()
        .query_filtered::<(Entity, &SimId), With<Agent>>()
        .iter(sim.world())
        .map(|(entity, id)| (*id, entity))
        .collect();
    people.sort_by_key(|(id, _)| *id);
    people
}

fn issue(sim: &mut Sim, command: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(command);
    sim.flush_commands();
}

fn path_index(sim: &Sim, id: &str) -> u32 {
    sim.world()
        .resource::<Content>()
        .0
        .career_paths
        .iter()
        .position(|path| path.id == id)
        .expect("shipped") as u32
}

/// The held shift index of `sim`, 0 without a record.
fn held(sim: &Sim, id: SimId) -> u32 {
    sim.world()
        .resource::<Careers>()
        .record(id)
        .map_or(0, |record| record.shift)
}

fn stream(sim: &Sim) -> (SimRng, u64) {
    let careers = sim.world().resource::<Careers>();
    (careers.shift_rng.clone(), careers.shift_draws)
}

/// The shipped household with the worker on the cafe's late shift by
/// choice and Bill on the cafe by chance, so one held shift is chosen, one
/// is drawn, and the shift stream has moved.
fn shifted() -> (Sim, Vec<(SimId, Entity)>) {
    let mut sim = Sim::new_from_shipped_lot();
    let people = household(&mut sim);
    let cafe = path_index(&sim, "cafe");
    let worker = people
        .iter()
        .find(|(_, entity)| sim.world().get::<Career>(*entity).is_some())
        .expect("a worker")
        .1;
    let first = sim.world().resource::<Content>().0.career_paths[cafe as usize].levels[0];
    let late = sim.world().resource::<Content>().0.careers[first as usize]
        .shift_index("late")
        .expect("the cafe lists a late shift") as u32;
    issue(
        &mut sim,
        SimCommand::AssignCareerShift {
            agent: worker.index_u32(),
            path: cafe,
            shift: late,
        },
    );
    let other = people
        .iter()
        .find(|(_, entity)| *entity != worker)
        .expect("a housemate")
        .1;
    issue(
        &mut sim,
        SimCommand::AssignCareer {
            agent: other.index_u32(),
            path: cafe,
        },
    );
    assert_eq!(stream(&sim).1, 1, "one shift drawn");
    (sim, people)
}

/// [WS-determinism] item 3: a world in which everyone holds the standard
/// shift and the shift stream is undrawn hashes exactly as before issue
/// 296's hash section existed. The pinned value is the hash the code
/// computed before the section was added, for the shipped household run to
/// Monday 10:00 under the career content from before shifts.
#[test]
fn the_hash_is_unchanged_while_everyone_holds_the_standard_shift() {
    let mut sim = Sim::new_from_shipped_lot();
    let pack = crate::test_content::pre_shift_careers(terri_data::pack());
    sim.world_mut().insert_resource(Content(pack));
    // Through Monday's 09:00 search, so the careers block is in the hash.
    for _ in 0..600 {
        sim.tick();
    }
    assert!(!sim.world().resource::<Careers>().is_pristine());
    assert_eq!(stream(&sim).1, 0, "no shift was drawn");
    assert!(sim
        .world()
        .resource::<Careers>()
        .records
        .values()
        .all(|record| record.shift == 0));
    assert_eq!(sim.world_hash(), STANDARD_ONLY_HASH);
}
/// Computed at fead3700b, before the shift section of the hash existed.
const STANDARD_ONLY_HASH: u64 = 6850362082045180278;

/// [WS-determinism] item 3: the hash sees a chosen shift, a drawn one, and
/// which shift a person holds.
#[test]
fn the_hash_sees_a_drawn_or_chosen_shift() {
    let mut sim = Sim::new_from_shipped_lot();
    let people = household(&mut sim);
    let worker = people
        .iter()
        .find(|(_, entity)| sim.world().get::<Career>(*entity).is_some())
        .copied()
        .expect("a worker");
    // The cafe's first level lists three shifts; its `day` shift is renamed
    // here to `dawn`, as long as `late`, so the hash can tell which one is
    // held only by the id's bytes.
    let cafe = path_index(&sim, "cafe");
    let mut pack = sim.world().resource::<Content>().0.clone();
    let row = pack.career_paths[cafe as usize].levels[0];
    let day = pack.careers[row as usize]
        .shifts
        .iter_mut()
        .find(|shift| shift.id == "day")
        .expect("the cafe lists a day shift");
    day.id = "dawn".to_string();
    let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    let base = sim.world_hash();
    let job = pack.careers[row as usize].clone();
    sim.world_mut().entity_mut(worker.1).insert(Career(row));
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .insert(worker.0, crate::careers::Record::new(&job));
    let with_record = sim.world_hash();
    assert_ne!(with_record, base, "a record is part of the careers block");
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .get_mut(&worker.0)
        .unwrap()
        .shift = 1;
    let first = sim.world_hash();
    assert_ne!(first, with_record, "a chosen shift moves the hash");
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .get_mut(&worker.0)
        .unwrap()
        .shift = 2;
    assert_ne!(sim.world_hash(), first, "the hash names the held shift");
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .get_mut(&worker.0)
        .unwrap()
        .shift = 0;
    assert_eq!(sim.world_hash(), with_record);
    {
        let mut careers = sim.world_mut().resource_mut::<Careers>();
        careers.shift_draws += 1;
        careers.shift_rng.next_u32();
    }
    assert_ne!(sim.world_hash(), with_record, "a draw moves the hash");
    {
        let mut careers = sim.world_mut().resource_mut::<Careers>();
        careers.shift_rng.next_u32();
    }
    let advanced = sim.world_hash();
    {
        let mut careers = sim.world_mut().resource_mut::<Careers>();
        careers.shift_draws += 1;
    }
    assert_ne!(sim.world_hash(), advanced, "the draw count is hashed");
}

/// [WS-save]: schema twenty-one saves the chosen and drawn shifts and the
/// stream, and the load reproduces the world exactly.
#[test]
fn schema_twenty_one_round_trips_held_shifts_and_the_stream() {
    let (sim, people) = shifted();
    let saved = sim.save_snapshot_v21();
    assert_eq!(saved.shifts.draws, 1);
    assert_eq!(saved.shifts.rng, stream(&sim).0);
    let listed: Vec<u32> = saved.shifts.held.iter().map(|row| row.sim).collect();
    let expected: Vec<u32> = people
        .iter()
        .filter(|(id, _)| held(&sim, *id) != 0)
        .map(|(id, _)| id.0)
        .collect();
    assert_eq!(listed, expected);
    assert!(saved.shifts.held.iter().any(|row| row.shift == "late"));
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v21(saved.clone()).expect("loads");
    for (id, _) in &people {
        assert_eq!(held(&loaded, *id), held(&sim, *id), "{id:?}");
    }
    assert_eq!(stream(&loaded), stream(&sim));
    assert_eq!(loaded.world_hash(), sim.world_hash());
    assert_eq!(loaded.save_snapshot_v21(), saved);
}

/// [WS-save]: queued shift commands ride schema twenty-one beside their
/// positions in the whole queue, among a setting and ordinary commands.
#[test]
fn schema_twenty_one_round_trips_queued_shift_commands() {
    let mut sim = Sim::new_from_shipped_lot();
    let people = household(&mut sim);
    let agent = people[0].1.index_u32();
    for command in [
        SimCommand::SetSpeed(2),
        SimCommand::ChangeShift { agent, shift: 1 },
        SimCommand::SetJobSearch {
            agent,
            search: false,
        },
        SimCommand::AssignCareerShift {
            agent,
            path: 1,
            shift: 2,
        },
        SimCommand::SetSpeed(1),
    ] {
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
    }
    let staged = sim.world().resource::<CommandQueue>().as_slice().to_vec();
    let saved = sim.save_snapshot_v21();
    assert_eq!(
        saved.queued_shift_commands,
        vec![
            (1, SavedQueuedShiftCommand::ChangeShift { agent, shift: 1 }),
            (
                3,
                SavedQueuedShiftCommand::AssignCareerShift {
                    agent,
                    path: 1,
                    shift: 2
                }
            ),
        ]
    );
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v21(saved.clone()).expect("loads");
    assert_eq!(
        loaded.world().resource::<CommandQueue>().as_slice(),
        staged.as_slice()
    );
    assert_eq!(loaded.save_snapshot_v21(), saved);
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

fn row(sim: u32, shift: &str) -> SavedHeldShift {
    SavedHeldShift {
        sim,
        shift: shift.to_string(),
    }
}

/// [WS-save]: a schema-twenty-one payload the world cannot account for
/// refuses the load and leaves the running game unchanged.
#[test]
fn schema_twenty_one_refuses_what_the_world_cannot_account_for() {
    let (sim, people) = shifted();
    let clean = sim.save_snapshot_v21();
    let unemployed = people
        .iter()
        .find(|(id, _)| {
            held(&sim, *id) == 0 && sim.world().resource::<Careers>().record(*id).is_none()
        })
        .expect("an unemployed housemate")
        .0
         .0;
    let first = clean.shifts.held[0].clone();
    type Change = Box<dyn Fn(&mut SaveSnapshotV21)>;
    let cases: Vec<(&str, Change)> = vec![
        (
            "nobody with that id",
            Box::new(|s| s.shifts.held = vec![row(999, "late")]),
        ),
        (
            "a person with no job",
            Box::new(move |s| s.shifts.held = vec![row(unemployed, "late")]),
        ),
        (
            "the standard shift listed",
            Box::new(move |s| s.shifts.held = vec![row(first.sim, "standard")]),
        ),
        (
            "a shift the level does not list",
            Box::new(move |s| s.shifts.held = vec![row(first.sim, "nights")]),
        ),
        (
            "one person twice",
            Box::new(move |s| {
                let again = s.shifts.held[0].clone();
                s.shifts.held.insert(0, again);
            }),
        ),
        (
            "out of order",
            Box::new(move |s| {
                if s.shifts.held.len() > 1 {
                    s.shifts.held.reverse();
                } else {
                    let first = s.shifts.held[0].clone();
                    s.shifts.held.insert(0, row(first.sim + 1, "late"));
                }
            }),
        ),
        (
            "a queued shift command past the queue",
            Box::new(|s| {
                s.queued_shift_commands = vec![(
                    5,
                    SavedQueuedShiftCommand::ChangeShift { agent: 0, shift: 1 },
                )]
            }),
        ),
        (
            "queued shift commands out of order",
            Box::new(|s| {
                let row = SavedQueuedShiftCommand::ChangeShift { agent: 0, shift: 1 };
                s.queued_shift_commands = vec![(1, row), (0, row)]
            }),
        ),
    ];
    // The shipped worker holds a job but has no career record until their
    // first shift, so a payload naming them cannot be installed.
    let mut fresh = Sim::new_from_shipped_lot();
    let fresh_worker = household(&mut fresh)
        .into_iter()
        .find(|(_, entity)| fresh.world().get::<Career>(*entity).is_some())
        .expect("a worker")
        .0;
    assert!(fresh
        .world()
        .resource::<Careers>()
        .record(fresh_worker)
        .is_none());
    let mut no_record = fresh.save_snapshot_v21();
    no_record.shifts.held = vec![row(fresh_worker.0, "late")];
    let mut live = Sim::new_from_shipped_lot();
    let before = (live.world_hash(), live.save_snapshot_v21());
    assert!(
        live.load_snapshot_v21(no_record).is_err(),
        "a person with a job and no record must refuse"
    );
    assert_eq!((live.world_hash(), live.save_snapshot_v21()), before);
    for (case, change) in cases {
        let mut invalid = clean.clone();
        change(&mut invalid);
        let mut live = Sim::new_from_shipped_lot();
        let before = (live.world_hash(), live.save_snapshot_v21());
        assert!(
            live.load_snapshot_v21(invalid).is_err(),
            "{case} must refuse"
        );
        assert_eq!(
            (live.world_hash(), live.save_snapshot_v21()),
            before,
            "{case} changes nothing"
        );
    }
}

/// [WS-save]: every writer from schema fourteen to twenty saves exactly
/// what it saves for the same queue without the shift commands: the
/// commands are left out with the positions they would count.
#[test]
fn older_writers_leave_queued_shift_commands_out() {
    let mut with = Sim::new_from_shipped_lot();
    let mut without = Sim::new_from_shipped_lot();
    let people = household(&mut with);
    let agent = people[0].1.index_u32();
    let chat = with
        .world()
        .resource::<Content>()
        .0
        .social
        .iter()
        .position(|action| action.id == "chat")
        .expect("shipped Chat") as u32;
    // A confirmed work order rides beside its queue position from schema
    // seventeen, as the settings do from eighteen; neither may move when the
    // shift commands around them are left out.
    let ordinary = [
        SimCommand::SetSpeed(2),
        SimCommand::SetJobSearch {
            agent,
            search: false,
        },
        SimCommand::ConfirmedOrder {
            fingerprint: 7,
            command: SimCommand::TalkTo {
                agent,
                target: people[1].1.index_u32(),
                interaction: chat,
            }
            .into_player_order()
            .expect("a player order"),
        },
        SimCommand::SetSpeed(1),
    ];
    for command in ordinary.iter().cloned() {
        without
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(command);
    }
    for command in [
        ordinary[0].clone(),
        SimCommand::ChangeShift { agent, shift: 1 },
        ordinary[1].clone(),
        SimCommand::AssignCareerShift {
            agent,
            path: 1,
            shift: 0,
        },
        ordinary[2].clone(),
        SimCommand::ChangeShift { agent, shift: 2 },
        ordinary[3].clone(),
    ] {
        with.world_mut()
            .resource_mut::<CommandQueue>()
            .push(command);
    }
    assert_eq!(with.save_snapshot_v14(), without.save_snapshot_v14());
    assert_eq!(with.save_snapshot_v15(), without.save_snapshot_v15());
    assert_eq!(with.save_snapshot_v16(), without.save_snapshot_v16());
    assert_eq!(with.save_snapshot_v17(), without.save_snapshot_v17());
    assert_eq!(with.save_snapshot_v18(), without.save_snapshot_v18());
    assert_eq!(with.save_snapshot_v19(), without.save_snapshot_v19());
    assert_eq!(with.save_snapshot_v20(), without.save_snapshot_v20());
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .load_snapshot_v20(with.save_snapshot_v20())
        .expect("loads");
    assert_eq!(
        loaded.world().resource::<CommandQueue>().as_slice(),
        ordinary.as_slice(),
        "the rest of the queue loads in order"
    );
}

/// [WS-save]: a schema-twenty save of a world whose shifts were drawn and
/// chosen loads with everyone on their level's standard shift, the shift
/// stream at its seed and no draws, as every older save does; the careers
/// stream continues from its saved state.
#[test]
fn schema_twenty_loads_everyone_on_the_standard_shift() {
    let (sim, people) = shifted();
    let older = sim.save_snapshot_v20();
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v20(older).expect("loads");
    for (id, _) in &people {
        assert_eq!(held(&loaded, *id), 0, "{id:?}");
    }
    assert_eq!(
        stream(&loaded),
        (SimRng::from_seed(crate::shifts::SHIFTS_SEED), 0)
    );
    let careers = sim.world().resource::<Careers>();
    let restored = loaded.world().resource::<Careers>();
    assert_eq!(
        (&restored.rng, restored.draws),
        (&careers.rng, careers.draws)
    );
}

/// [WS-choose] step 6: a Build session's cancel and end restore the
/// baseline with every held shift and the shift stream as they were.
#[test]
fn a_build_transaction_keeps_the_held_shift() {
    let (mut sim, people) = shifted();
    let before: Vec<u32> = people.iter().map(|(id, _)| held(&sim, *id)).collect();
    let stream_before = stream(&sim);
    assert!(before.iter().any(|shift| *shift != 0));
    sim.begin_build().expect("build starts");
    assert_eq!(
        sim.save_snapshot_v21().shifts.held.len(),
        before.iter().filter(|s| **s != 0).count()
    );
    sim.cancel_build().expect("cancel restores the baseline");
    let after: Vec<u32> = people.iter().map(|(id, _)| held(&sim, *id)).collect();
    assert_eq!(after, before);
    assert_eq!(stream(&sim), stream_before);
    sim.end_build().expect("end restores the baseline");
    let after: Vec<u32> = people.iter().map(|(id, _)| held(&sim, *id)).collect();
    assert_eq!(after, before);
    assert_eq!(stream(&sim), stream_before);
}

/// A reading order deferred the late cafe worker's 13:00 departure. The
/// world is valid, but the schema-twenty restore checked the deferral
/// against the standard shift before the held shifts were installed, so
/// the save and a Build mode round trip refused it (review of 2026-10-23).
/// The deferral is now checked against every shift the level lists, as
/// saved attendance is.
fn late_worker_with_a_deferred_departure() -> Sim {
    let (mut sim, people) = shifted();
    let pack = sim.world().resource::<Content>().0;
    let (_, worker) = *people
        .iter()
        .find(|(id, entity)| {
            let held = held(&sim, *id);
            sim.world()
                .get::<Career>(*entity)
                .and_then(|career| pack.careers[career.0 as usize].shift(held as usize))
                .is_some_and(|shift| shift.id == "late")
        })
        .expect("the late cafe worker");
    let row = sim.world().get::<Career>(worker).expect("employed").0;
    // Monday 13:20; the cafe's late shift starts at 13:00 and works Mondays.
    sim.world_mut().resource_mut::<terri_core::SimClock>().tick = 800;
    sim.world_mut()
        .entity_mut(worker)
        .insert(crate::reading::PendingShift {
            scheduled_tick: 780,
            career: row,
        });
    let world = sim.world();
    assert!(
        crate::reading::persistence::validate(world, world.resource::<terri_core::TileGrid>())
            .is_ok(),
        "the live world is valid"
    );
    sim
}

#[test]
fn a_deferred_departure_on_a_held_shift_survives_a_save() {
    let sim = late_worker_with_a_deferred_departure();
    let saved = sim.save_snapshot_v21();
    let mut loaded = Sim::new_from_shipped_lot();
    assert_eq!(loaded.load_snapshot_v21(saved.clone()), Ok(()));
    assert_eq!(loaded.save_snapshot_v21(), saved);
}

#[test]
fn a_deferred_departure_on_a_held_shift_survives_build_mode() {
    let mut sim = late_worker_with_a_deferred_departure();
    let before = sim.save_snapshot_v21();
    sim.begin_build().expect("build starts");
    sim.cancel_build().expect("cancel restores the baseline");
    assert_eq!(sim.save_snapshot_v21(), before);
}

/// The owner's ruling of 2026-10-23: the day of a shift change is part of
/// the world while it is today. It changes the hash, survives a save and a
/// load, and a row naming another day refuses to load; once the day has
/// passed, nothing of it is hashed or saved.
#[test]
fn a_shift_change_today_is_hashed_saved_and_checked() {
    let (mut sim, people) = shifted();
    let (id, worker) = *people
        .iter()
        .find(|(id, _)| held(&sim, *id) != 0)
        .expect("someone on another shift");
    let before = sim.world_hash();
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: worker.index_u32(),
            shift: 0,
        },
    );
    assert_eq!(
        sim.world()
            .resource::<Careers>()
            .last_result
            .map(|r| r.reason),
        Some(None),
        "the change applies at home"
    );
    let saved = sim.save_snapshot_v21();
    assert_eq!(
        saved.shifts.changed_today,
        vec![terri_core::save_v21::SavedShiftChange { sim: id.0, day: 0 }]
    );
    let mut loaded = Sim::new_from_shipped_lot();
    assert_eq!(loaded.load_snapshot_v21(saved.clone()), Ok(()));
    assert_eq!(loaded.world_hash(), sim.world_hash());
    assert_eq!(loaded.save_snapshot_v21(), saved);

    let mut other_day = saved.clone();
    other_day.shifts.changed_today[0].day = 1;
    let mut refused = Sim::new_from_shipped_lot();
    let untouched = refused.world_hash();
    assert_eq!(
        refused.load_snapshot_v21(other_day),
        Err(crate::SaveError::InvalidValue)
    );
    assert_eq!(
        refused.world_hash(),
        untouched,
        "a refused load changes nothing"
    );

    // The change is what made the hash move: the same world with the day
    // forgotten hashes as a world without a change today would.
    let mut forgotten = Sim::new_from_shipped_lot();
    forgotten.load_snapshot_v21(saved).expect("loads");
    forgotten
        .world_mut()
        .resource_mut::<Careers>()
        .shift_changed
        .clear();
    assert_ne!(forgotten.world_hash(), sim.world_hash());
    assert_ne!(before, sim.world_hash());

    // A day later the change no longer matters, and nothing of it remains.
    for _ in 0..1440 {
        sim.tick();
    }
    assert!(sim.save_snapshot_v21().shifts.changed_today.is_empty());
}
