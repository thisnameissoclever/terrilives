//! Job search as each person's own setting: issue 297,
//! `docs/specs/2026-10-18-job-search-per-person.md`.
use super::*;
use crate::Sim;
use terri_core::{CommandQueue, SimCommand};

/// A new game run from Monday's first tick to Thursday at 10:00: the
/// unemployed look for work at the search tick of Monday, Tuesday,
/// Wednesday and Thursday, and anyone hired has started a shift.
const THROUGH_THURSDAY: u64 = 1440 * 3 + 600;

/// The retained schema-seventeen fixture from main at 2b15dcfea records
/// this career stream after 4,920 ticks. Its former whole-world hash was
/// 0xABCB_AD06_F384_DDFF; approved need and social balance changes now alter
/// that broader state. Keep exact hiring, schedules and stream state here.
/// See crates/terri-wasm/tests/fixtures/job-search-v17/README.md.
const MAIN_DRAWS: u64 = 6;

fn employed(sim: &mut Sim) -> usize {
    sim.world_mut()
        .query_filtered::<Entity, (With<Agent>, With<Career>)>()
        .iter(sim.world())
        .count()
}

/// The shipped lot with the search certain to apply, so a test controls
/// who is hired by the setting alone.
fn eager() -> Sim {
    let mut sim = Sim::new_from_shipped_lot();
    let mut pack = terri_data::pack().clone();
    pack.tuning.career_search_chance = 1.0;
    let pack: &'static ContentPack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    sim
}

fn issue(sim: &mut Sim, command: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(command);
    sim.flush_commands();
}

/// Every living person's entity, in id order.
fn household(sim: &mut Sim) -> Vec<(SimId, Entity)> {
    people(sim.world_mut())
}

/// The shipped worker, made unemployed, with their id.
fn unemployed_worker(sim: &mut Sim) -> (SimId, Entity) {
    let (id, entity) = household(sim)
        .into_iter()
        .find(|(_, entity)| sim.world().get::<Career>(*entity).is_some())
        .expect("the shipped household has a worker");
    sim.world_mut().entity_mut(entity).remove::<Career>();
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .remove(&id);
    (id, entity)
}

fn search_of(sim: &Sim, entity: Entity) -> Option<bool> {
    sim.job_search_of(entity.index_u32())
}

/// Rule 3: leaving everyone's search on preserves the published hires,
/// career assignments, schedules and career random stream. Mood, need and
/// attendance performance are independently affected by gameplay balance.
/// Issue 296 changed the shipped careers and the search, so this runs under
/// the career content and search from before it
/// (`test_content::pre_shift_careers`), which the published values still
/// describe.
#[test]
fn every_search_on_keeps_published_hires_schedules_and_career_randomness() {
    let mut sim = Sim::new_from_shipped_lot();
    let pack = crate::test_content::pre_shift_careers(terri_data::pack());
    sim.world_mut().insert_resource(Content(pack));
    let before = employed(&mut sim);
    for _ in 0..THROUGH_THURSDAY {
        sim.tick();
    }
    assert!(employed(&mut sim) > before, "the run must hire someone");
    let people = household(&mut sim);
    let careers = sim.world().resource::<Careers>();
    assert_eq!(careers.draws, MAIN_DRAWS);
    let mut expected_rng = SimRng::from_seed(0x4341_5245_4552_5331);
    for _ in 0..MAIN_DRAWS {
        expected_rng.next_u32();
    }
    assert_eq!(careers.rng, expected_rng, "exact published career stream");
    let outcomes: Vec<_> = people
        .iter()
        .map(|(id, person)| {
            let job = sim
                .world()
                .get::<Career>(*person)
                .expect("the published household is employed");
            let definition = &sim.world().resource::<Content>().0.careers[job.0 as usize];
            let record = careers.records.get(id).expect("every hire owns a record");
            assert_eq!(
                (
                    record.consecutive_poor,
                    record.consecutive_good,
                    record.review_due
                ),
                (0, 0, None)
            );
            assert!(
                record.history.is_empty(),
                "no weekly review before Thursday"
            );
            (
                id.0,
                job.0,
                definition.id.as_str(),
                definition.working_days,
                definition.shift_start,
                definition.shift_ticks,
                record.pay,
                sim.world()
                    .get::<AtWork>(*person)
                    .map(|work| work.remaining_ticks),
                sim.world().get::<Commuting>(*person).is_some(),
            )
        })
        .collect();
    assert_eq!(
        outcomes,
        vec![
            (0, 0, "office_job", 31, 360, 480, 120, Some(240), false),
            (1, 0, "office_job", 31, 360, 480, 120, Some(240), false),
            (
                2,
                4,
                "cafe_lowly_barista",
                62,
                330,
                420,
                80,
                Some(150),
                false
            ),
        ]
    );
    assert_eq!(
        careers.records.len(),
        3,
        "no missing or invented career records"
    );
    let attendance = crate::attendance::to_saved(sim.world());
    let completed: Vec<_> = attendance
        .outcomes
        .iter()
        .map(|row| (row.sim, row.career, row.start_tick, row.end_tick))
        .collect();
    assert_eq!(
        completed,
        vec![
            (0, 0, 360, 840),
            (2, 4, 1770, 2190),
            (0, 0, 1800, 2280),
            (2, 4, 3210, 3630),
            (0, 0, 3240, 3720),
            (1, 0, 3240, 3720),
        ],
        "the published hires start the same scheduled shifts"
    );
    let ongoing: Vec<_> = attendance
        .shifts
        .iter()
        .map(|row| {
            (
                row.sim,
                row.career,
                row.start_tick,
                row.end_tick,
                row.pay_cents,
                row.settled,
                row.legacy,
            )
        })
        .collect();
    assert_eq!(
        ongoing,
        vec![
            (0, 0, 4680, 5160, 12000, false, false),
            (1, 0, 4680, 5160, 12000, false, false),
            (2, 4, 4650, 5070, 8000, false, false),
        ]
    );
}

/// Issue 296 ([WS-determinism], "Movement of pinned values" class 3): the
/// shipped household run to Thursday 10:00 on the shipped careers, with the
/// chance-based path choice, shift draws and the shift hash section, pinned
/// as an exact outcome: the world hash, the careers stream's draw count,
/// the shift stream's draw count, and each person's job and held shift.
/// Issue 296 moved these values from the published run above.
#[test]
fn the_shipped_household_hash_and_draws_through_thursday() {
    let mut sim = Sim::new_from_shipped_lot();
    for _ in 0..THROUGH_THURSDAY {
        sim.tick();
    }
    let people = household(&mut sim);
    let pack = sim.world().resource::<Content>().0;
    let jobs: Vec<(u32, Option<&str>, Option<&str>)> = people
        .iter()
        .map(|(id, person)| {
            let shift = crate::shifts::shift_of(sim.world(), pack, *person);
            (
                id.0,
                crate::careers::job_of(sim.world(), pack, *person).map(|job| job.id.as_str()),
                shift.map(|shift| shift.id),
            )
        })
        .collect();
    let careers = sim.world().resource::<Careers>();
    assert_eq!(
        (sim.world_hash(), careers.draws, careers.shift_draws),
        SHIPPED_THURSDAY,
        "{jobs:?}"
    );
    assert_eq!(jobs, SHIPPED_THURSDAY_JOBS);
}
/// Seven careers draws, and two shift draws: one for each search hire, as
/// both hired levels offer more than one shift. Issue 339 moved the hash
/// from 17413157888741130017: a returning reader no longer waits out another
/// reader's walk to the bookcase, so Tim leaves on time on Monday. The draw
/// counts and every job and shift are unchanged. Issue 338 moved the hash
/// from 18180649999092761866 on purpose: a housemate no longer chooses a chat
/// with someone asleep, so at 05:16 on Monday Tim's choice no longer has a
/// chat with the sleeping Bill among its candidates, the same draw picks
/// another action, and the household's days differ from then on. The draw
/// counts and every job and shift are again unchanged.
const SHIPPED_THURSDAY: (u64, u64, u64) = (17945103458811991316, 7, 2);
const SHIPPED_THURSDAY_JOBS: [(u32, Option<&str>, Option<&str>); 3] = [
    (0, Some("office_job"), Some("standard")),
    (1, Some("kitchen_porter"), Some("standard")),
    (2, Some("night_watch_guard"), Some("weekend_nights")),
];

/// Rule 1: every person in a new game, and every newcomer, looks for work.
#[test]
fn everyone_starts_with_the_search_on_and_so_does_a_newcomer() {
    let mut sim = Sim::new_from_shipped_lot();
    let people = household(&mut sim);
    assert!(people.len() > 1);
    for (_, entity) in &people {
        assert_eq!(search_of(&sim, *entity), Some(true));
    }
    // Even after the old household-wide command turned everyone off.
    issue(
        &mut sim,
        SimCommand::SetCareerAutonomy {
            change: true,
            search: false,
        },
    );
    issue(
        &mut sim,
        SimCommand::AddHousemate {
            name: "Newcomer".to_string(),
            personality: 0,
            traits: vec![],
        },
    );
    let newcomer = sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_housemate_result
        .and_then(|result| result.sim)
        .expect("moved in");
    assert_eq!(sim.job_search_of(newcomer), Some(true));
    for (_, entity) in &people {
        assert_eq!(search_of(&sim, *entity), Some(false));
    }
}

/// Rules 2 and 3: the command turns one person's search off and on; off,
/// the person is never hired and the stream is never drawn for them.
#[test]
fn a_person_whose_search_is_off_is_never_hired_and_draws_nothing() {
    let mut sim = eager();
    let (_, entity) = unemployed_worker(&mut sim);
    let agent = entity.index_u32();
    // Everyone else is employed or off, so every draw would be this person's.
    for (_, other) in household(&mut sim) {
        if other != entity {
            issue(
                &mut sim,
                SimCommand::SetJobSearch {
                    agent: other.index_u32(),
                    search: false,
                },
            );
        }
    }
    issue(
        &mut sim,
        SimCommand::SetJobSearch {
            agent,
            search: false,
        },
    );
    assert_eq!(search_of(&sim, entity), Some(false));
    for _ in 0..20 {
        search(sim.world_mut());
    }
    assert!(sim.world().get::<Career>(entity).is_none(), "never hired");
    assert_eq!(sim.world().resource::<Careers>().draws, 0, "nothing drawn");
    issue(
        &mut sim,
        SimCommand::SetJobSearch {
            agent,
            search: true,
        },
    );
    assert_eq!(search_of(&sim, entity), Some(true));
    let mut hired = false;
    for _ in 0..40 {
        search(sim.world_mut());
        if sim.world().get::<Career>(entity).is_some() {
            hired = true;
            break;
        }
    }
    assert!(hired, "hired within forty working days once on");
}

/// Rule 3: turning one person off leaves the rest of the household
/// searching; the person who stays on is hired exactly as when they are
/// the only one looking.
#[test]
fn turning_one_person_off_leaves_the_others_looking() {
    let mut sim = eager();
    let (_, worker) = unemployed_worker(&mut sim);
    let others: Vec<Entity> = household(&mut sim)
        .into_iter()
        .map(|(_, entity)| entity)
        .filter(|entity| *entity != worker)
        .filter(|entity| sim.world().get::<Career>(*entity).is_none())
        .collect();
    assert!(!others.is_empty(), "the shipped household has unemployed");
    issue(
        &mut sim,
        SimCommand::SetJobSearch {
            agent: worker.index_u32(),
            search: false,
        },
    );
    for _ in 0..40 {
        search(sim.world_mut());
    }
    assert!(sim.world().get::<Career>(worker).is_none());
    assert!(
        others
            .iter()
            .any(|entity| sim.world().get::<Career>(*entity).is_some()),
        "the others still find work"
    );
}

/// Rule 2: the commands are settings; they are not counted with the
/// career commands, a command naming no living person changes nothing,
/// and the change setting stays one household setting.
#[test]
fn the_setting_commands_touch_only_what_they_name() {
    let mut sim = Sim::new_from_shipped_lot();
    let base = sim.world_hash();
    let furniture = sim
        .world_mut()
        .query_filtered::<Entity, Without<Agent>>()
        .iter(sim.world())
        .next()
        .expect("the lot has furniture")
        .index_u32();
    for agent in [furniture, 99_999] {
        issue(
            &mut sim,
            SimCommand::SetJobSearch {
                agent,
                search: false,
            },
        );
        assert_eq!(sim.job_search_of(agent), None);
    }
    assert_eq!(sim.world_hash(), base, "nobody's setting changed");
    issue(&mut sim, SimCommand::SetCareerChange { change: false });
    assert!(!sim.career_change_autonomy());
    let people = household(&mut sim);
    for (_, entity) in &people {
        assert_eq!(search_of(&sim, *entity), Some(true));
    }
    issue(&mut sim, SimCommand::SetCareerChange { change: true });
    assert!(sim.career_change_autonomy());
    assert_eq!(sim.world().resource::<Careers>().commands, 0);
    assert_eq!(sim.world_hash(), base, "back to a new game's state");
}

/// The legacy household-wide command, which older saves can hold queued,
/// sets the change setting and every living person's search.
#[test]
fn the_older_household_command_sets_every_living_person() {
    let mut sim = Sim::new_from_shipped_lot();
    issue(
        &mut sim,
        SimCommand::SetCareerAutonomy {
            change: false,
            search: false,
        },
    );
    assert!(!sim.career_change_autonomy());
    let people = household(&mut sim);
    for (_, entity) in &people {
        assert_eq!(search_of(&sim, *entity), Some(false));
    }
    issue(
        &mut sim,
        SimCommand::SetCareerAutonomy {
            change: true,
            search: true,
        },
    );
    for (_, entity) in &people {
        assert_eq!(search_of(&sim, *entity), Some(true));
    }
    assert!(sim.world().resource::<Careers>().is_pristine());
}

/// Rule 4: the setting is in the world hash only once someone's is off,
/// so an untouched world hashes as it always did.
#[test]
fn the_hash_sees_each_persons_setting() {
    let mut sim = Sim::new_from_shipped_lot();
    let base = sim.world_hash();
    let people = household(&mut sim);
    let (first, second) = (people[0].1, people[1].1);
    issue(
        &mut sim,
        SimCommand::SetJobSearch {
            agent: first.index_u32(),
            search: false,
        },
    );
    let first_off = sim.world_hash();
    assert_ne!(first_off, base);
    issue(
        &mut sim,
        SimCommand::SetJobSearch {
            agent: first.index_u32(),
            search: true,
        },
    );
    issue(
        &mut sim,
        SimCommand::SetJobSearch {
            agent: second.index_u32(),
            search: false,
        },
    );
    let second_off = sim.world_hash();
    assert_ne!(second_off, base);
    assert_ne!(second_off, first_off, "the hash names who is off");
    issue(
        &mut sim,
        SimCommand::SetJobSearch {
            agent: second.index_u32(),
            search: true,
        },
    );
    assert_eq!(sim.world_hash(), base);
}

/// A death drops the person's setting with their other records, so the
/// next save loads.
#[test]
fn a_death_drops_the_setting() {
    let mut sim = Sim::new_from_shipped_lot();
    let (id, entity) = household(&mut sim)[0];
    issue(
        &mut sim,
        SimCommand::SetJobSearch {
            agent: entity.index_u32(),
            search: false,
        },
    );
    crate::mortality::remove_person(sim.world_mut(), entity);
    sim.world_mut().despawn(entity);
    assert!(sim.world().resource::<Careers>().searches(id));
    let saved = sim.save_snapshot_v18();
    assert!(saved.job_search_off.is_empty());
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v18(saved).expect("loads");
    assert_eq!(restored.world_hash(), sim.world_hash());
}

/// Rule 5: schema eighteen saves each person's setting and round-trips it.
#[test]
fn schema_eighteen_round_trips_each_persons_setting() {
    let mut sim = Sim::new_from_shipped_lot();
    let people = household(&mut sim);
    issue(
        &mut sim,
        SimCommand::SetJobSearch {
            agent: people[1].1.index_u32(),
            search: false,
        },
    );
    let saved = sim.save_snapshot_v18();
    assert_eq!(saved.job_search_off, vec![people[1].0 .0]);
    let careers = &saved.legacy.legacy.legacy.legacy.careers;
    assert!(
        careers.autonomous_search,
        "the older field keeps a new game's value"
    );
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v18(saved.clone()).expect("loads");
    assert_eq!(search_of(&restored, people[1].1), Some(false));
    assert_eq!(search_of(&restored, people[0].1), Some(true));
    assert_eq!(restored.world_hash(), sim.world_hash());
    assert_eq!(restored.save_snapshot_v18(), saved);
}

/// Rule 5: a schema-eighteen list the world cannot account for refuses
/// the load and leaves the running game alone.
#[test]
fn schema_eighteen_refuses_a_list_the_world_cannot_account_for() {
    let mut sim = Sim::new_from_shipped_lot();
    let people = household(&mut sim);
    let clean = sim.save_snapshot_v18();
    let (a, b) = (people[0].0 .0, people[1].0 .0);
    type Change = Box<dyn Fn(&mut terri_core::SaveSnapshotV18)>;
    let cases: Vec<(&str, Change)> = vec![
        (
            "nobody with that id",
            Box::new(|s| s.job_search_off = vec![999]),
        ),
        (
            "out of order",
            Box::new(move |s| s.job_search_off = vec![b, a]),
        ),
        ("twice", Box::new(move |s| s.job_search_off = vec![a, a])),
        (
            "the older household field turned off",
            Box::new(|s| {
                s.legacy.legacy.legacy.legacy.careers.autonomous_search = false;
            }),
        ),
    ];
    for (case, change) in cases {
        let mut invalid = clean.clone();
        change(&mut invalid);
        let mut live = Sim::new_from_shipped_lot();
        let before = live.world_hash();
        assert!(
            live.load_snapshot_v18(invalid).is_err(),
            "{case} must refuse"
        );
        assert_eq!(live.world_hash(), before, "{case} changes nothing");
    }
}

/// Rule 6: every published reader that carries the household setting
/// gives each living person the saved value, so a player who turned the
/// search off keeps it off for everyone; schema thirteen, which predates
/// the setting, leaves everyone on.
#[test]
fn older_saves_give_everyone_the_household_setting() {
    let mut sim = Sim::new_from_shipped_lot();
    let people = household(&mut sim);
    let everyone = |sim: &Sim, expected: bool| {
        for (_, entity) in &people {
            assert_eq!(search_of(sim, *entity), Some(expected));
        }
    };
    for search in [false, true] {
        let mut v14 = sim.save_snapshot_v14();
        v14.careers.autonomous_search = search;
        let mut loaded = Sim::new_from_shipped_lot();
        loaded
            .load_snapshot_v14(v14)
            .expect("schema fourteen loads");
        everyone(&loaded, search);

        let mut v15 = sim.save_snapshot_v15();
        v15.legacy.careers.autonomous_search = search;
        let mut loaded = Sim::new_from_shipped_lot();
        loaded.load_snapshot_v15(v15).expect("schema fifteen loads");
        everyone(&loaded, search);

        let mut v16 = sim.save_snapshot_v16();
        v16.legacy.legacy.careers.autonomous_search = search;
        let mut loaded = Sim::new_from_shipped_lot();
        loaded.load_snapshot_v16(v16).expect("schema sixteen loads");
        everyone(&loaded, search);

        let mut v17 = sim.save_snapshot_v17();
        v17.legacy.legacy.legacy.careers.autonomous_search = search;
        let mut loaded = Sim::new_from_shipped_lot();
        loaded
            .load_snapshot_v17(v17)
            .expect("schema seventeen loads");
        everyone(&loaded, search);
        if !search {
            // A newcomer after the load starts on, as in a new game.
            assert_eq!(
                loaded.save_snapshot_v18().job_search_off,
                people.iter().map(|(id, _)| id.0).collect::<Vec<_>>()
            );
        }
    }
    let mut loaded = Sim::new_from_shipped_lot();
    issue(
        &mut loaded,
        SimCommand::SetCareerAutonomy {
            change: true,
            search: false,
        },
    );
    loaded
        .load_snapshot_v13(sim.save_snapshot_v13())
        .expect("schema thirteen loads");
    everyone(&loaded, true);
}

/// Rule 6: the older writers carry the household field off only while
/// every living person's search is off, so such a game round-trips through
/// them exactly; a household with anyone on writes it on.
#[test]
fn older_writers_carry_the_setting_only_when_it_is_the_whole_household() {
    let mut sim = Sim::new_from_shipped_lot();
    let people = household(&mut sim);
    issue(
        &mut sim,
        SimCommand::SetJobSearch {
            agent: people[0].1.index_u32(),
            search: false,
        },
    );
    let partial = sim.save_snapshot_v17();
    assert!(partial.legacy.legacy.legacy.careers.autonomous_search);
    issue(
        &mut sim,
        SimCommand::SetCareerAutonomy {
            change: true,
            search: false,
        },
    );
    let whole = sim.save_snapshot_v17();
    assert!(!whole.legacy.legacy.legacy.careers.autonomous_search);
    assert!(
        sim.save_snapshot_v18()
            .legacy
            .legacy
            .legacy
            .legacy
            .careers
            .autonomous_search,
        "schema eighteen writes the older field on"
    );
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v17(whole).expect("loads");
    assert_eq!(restored.world_hash(), sim.world_hash());
}

fn queue(sim: &Sim) -> Vec<SimCommand> {
    sim.world().resource::<CommandQueue>().as_slice().to_vec()
}

/// [JS-save]: the settings commands staged just before a save ride schema
/// eighteen beside their queue positions, leaving the frozen schema-
/// seventeen command records as they were, and apply after the load.
#[test]
fn queued_settings_ride_schema_eighteen_and_apply_after_the_load() {
    use terri_core::save_v18::SavedQueuedSetting;
    let mut sim = Sim::new_from_shipped_lot();
    let people = household(&mut sim);
    let agent = people[1].1.index_u32();
    for command in [
        SimCommand::SetSpeed(2),
        SimCommand::SetJobSearch {
            agent,
            search: false,
        },
        SimCommand::SetSpeed(1),
        SimCommand::SetCareerChange { change: false },
    ] {
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
    }
    let staged = queue(&sim);
    let saved = sim.save_snapshot_v18();
    assert_eq!(
        saved.queued_settings,
        vec![
            (
                1,
                SavedQueuedSetting::JobSearch {
                    agent,
                    search: false
                }
            ),
            (3, SavedQueuedSetting::CareerChange { change: false }),
        ]
    );
    let frozen = &saved
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .world
        .queued_commands;
    assert_eq!(
        frozen,
        &vec![
            terri_core::SavedCommand::SetSpeed(2),
            terri_core::SavedCommand::SetSpeed(1)
        ],
        "the published command records hold only the ordinary commands"
    );
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v18(saved.clone()).expect("loads");
    assert_eq!(queue(&loaded), staged, "the queue keeps its order");
    assert_eq!(loaded.save_snapshot_v18(), saved);
    assert_eq!(loaded.world_hash(), sim.world_hash());
    loaded.flush_commands();
    sim.flush_commands();
    assert_eq!(search_of(&loaded, people[1].1), Some(false));
    assert!(!loaded.career_change_autonomy());
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

/// The older household command, staged just before a schema-seventeen
/// save, loads and turns every living person's search off when applied.
#[test]
fn a_queued_household_command_in_schema_seventeen_applies_after_the_load() {
    let mut sim = Sim::new_from_shipped_lot();
    let people = household(&mut sim);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetCareerAutonomy {
            change: true,
            search: false,
        });
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .load_snapshot_v17(sim.save_snapshot_v17())
        .expect("loads");
    assert_eq!(queue(&loaded), queue(&sim));
    for (_, entity) in &people {
        assert_eq!(search_of(&loaded, *entity), Some(true), "not yet applied");
    }
    loaded.flush_commands();
    for (_, entity) in &people {
        assert_eq!(search_of(&loaded, *entity), Some(false));
    }
}

/// Schema eighteen round-trips a household with everyone off and one with
/// an empty list.
#[test]
fn schema_eighteen_round_trips_everyone_off_and_an_empty_list() {
    let mut empty = Sim::new_from_shipped_lot();
    let saved = empty.save_snapshot_v18();
    assert!(saved.job_search_off.is_empty() && saved.queued_settings.is_empty());
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v18(saved.clone()).expect("loads");
    assert_eq!(loaded.save_snapshot_v18(), saved);
    assert_eq!(loaded.world_hash(), empty.world_hash());

    issue(
        &mut empty,
        SimCommand::SetCareerAutonomy {
            change: true,
            search: false,
        },
    );
    let people = household(&mut empty);
    let saved = empty.save_snapshot_v18();
    assert_eq!(
        saved.job_search_off,
        people.iter().map(|(id, _)| id.0).collect::<Vec<_>>()
    );
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v18(saved.clone()).expect("loads");
    assert_eq!(loaded.save_snapshot_v18(), saved);
    assert_eq!(loaded.world_hash(), empty.world_hash());
}

/// A queued setting the schema-eighteen queue cannot place refuses the
/// load and leaves the running game alone.
#[test]
fn schema_eighteen_refuses_misplaced_queued_settings() {
    use terri_core::save_v18::SavedQueuedSetting;
    let mut sim = Sim::new_from_shipped_lot();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetSpeed(2));
    let clean = sim.save_snapshot_v18();
    let change = SavedQueuedSetting::CareerChange { change: false };
    for (case, rows) in [
        ("past the queue", vec![(2, change)]),
        ("out of order", vec![(1, change), (0, change)]),
        ("one position twice", vec![(0, change), (0, change)]),
    ] {
        let mut invalid = clean.clone();
        invalid.queued_settings = rows;
        let mut live = Sim::new_from_shipped_lot();
        let before = live.world_hash();
        assert!(
            live.load_snapshot_v18(invalid).is_err(),
            "{case} must refuse"
        );
        assert_eq!(live.world_hash(), before, "{case} changes nothing");
    }
    let mut valid = clean;
    valid.queued_settings = vec![(0, change), (2, change)];
    Sim::new_from_shipped_lot()
        .load_snapshot_v18(valid)
        .expect("before and after the ordinary command");
}

/// During a Build session the schema-seventeen projection comes from the
/// committed baseline and still carries the household field off when
/// everyone is off.
#[test]
fn the_build_baseline_projects_the_household_field() {
    let mut sim = Sim::new_from_shipped_lot();
    issue(
        &mut sim,
        SimCommand::SetCareerAutonomy {
            change: true,
            search: false,
        },
    );
    assert!(
        !sim.save_snapshot_v17()
            .legacy
            .legacy
            .legacy
            .careers
            .autonomous_search
    );
    sim.begin_build().expect("build starts");
    assert!(
        !sim.save_snapshot_v17()
            .legacy
            .legacy
            .legacy
            .careers
            .autonomous_search,
        "the baseline's projection matches the live one"
    );
}
