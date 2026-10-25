//! SEEDED history fixture for playing a real chore argument and its cleanup response.
#[path = "support/mod.rs"]
mod support;

use std::{fs, path::Path};
use support::CurrentSnapshotViews;
use terri_core::{
    chores::{ChoreAssignment, ChoreKey, ChoreKind, SavedChores},
    save::{SavedDishes, SavedDomestic, SavedPosition},
    save_v17::SavedOrderActor,
    save_v19::{DutyTimer, NeglectSource, NeglectTimer, SavedNeglect},
    save_v20::{
        ChoreObligation, GrievanceKind, GrievanceSubject, SavedConflictState, SavedGrievance,
    },
    Agent, CommandQueue, Entity, NeedId, Needs, Position, Relationships, SimClock, SimCommand,
    SimId, SimName, SimRng, SmartObject, Socialising, TileGrid,
};
use terri_sim::{Content, FightRules, Sim};

const NOW: u64 = 1_440;
const TIM: SimId = SimId(0);
const BILL: SimId = SimId(1);
const CASEY: SimId = SimId(2);

fn person(sim: &Sim, identity: SimId) -> Entity {
    sim.world()
        .try_query::<(Entity, &Agent, &SimId)>()
        .unwrap()
        .iter(sim.world())
        .find(|(_, _, id)| **id == identity)
        .unwrap()
        .0
}

fn furniture(sim: &Sim, model: &str) -> Entity {
    let pack = sim.world().resource::<Content>().0;
    sim.world()
        .try_query::<(Entity, &SmartObject)>()
        .unwrap()
        .iter(sim.world())
        .find(|(_, object)| pack.object(object.0).id == model)
        .unwrap()
        .0
}

fn staging_tiles(sim: &Sim, counter: Entity) -> (SavedPosition, SavedPosition) {
    let grid = sim.world().resource::<TileGrid>();
    let at = sim.world().get::<Position>(counter).unwrap();
    let model = sim.world().get::<SmartObject>(counter).unwrap();
    let footprint = sim
        .world()
        .resource::<Content>()
        .0
        .object(model.0)
        .footprint;
    let mut contacts = Vec::new();
    for y in 0..grid.height() as i32 {
        for x in 0..grid.width() as i32 {
            if grid.is_walkable(x, y)
                && grid.can_interact_with_rect((x, y), (at.x as i32, at.y as i32), footprint)
            {
                contacts.push(((x - at.x as i32).abs() + (y - at.y as i32).abs(), x, y));
            }
        }
    }
    contacts.sort_unstable();
    for (_, x, y) in contacts {
        for (dx, dy) in [(1, 0), (0, 1), (-1, 0), (0, -1)] {
            if grid.is_walkable(x + dx, y + dy) {
                return (
                    SavedPosition {
                        x: (x + dx) as f32,
                        y: (y + dy) as f32,
                    },
                    SavedPosition {
                        x: x as f32,
                        y: y as f32,
                    },
                );
            }
        }
    }
    panic!("the shipped counter needs two adjacent walkable staging tiles");
}

fn dish_units(sim: &Sim) -> u32 {
    sim.world()
        .resource::<SavedDomestic>()
        .dishes
        .iter()
        .map(|row| row.units)
        .sum()
}

fn opinions(sim: &Sim) -> [f32; 3] {
    [(TIM, BILL), (BILL, TIM), (CASEY, BILL)].map(|(from, to)| {
        sim.world()
            .get::<Relationships>(person(sim, from))
            .unwrap()
            .feeling(to)
    })
}

fn write_phase(directory: &Path, phase: &str, sim: &Sim) -> String {
    let mut captured = support::capture(sim);
    let repairs = captured.0.legacy.conflicts.repairs.iter().map(|row| {
        format!(r#"{{"recipient":{},"accepted":{},"attempted":{},"working":{},"contributedUnits":{},"deadline":{}}}"#,
            row.recipient, row.accepted, row.attempted, row.working, row.contributed_units, row.deadline)
    }).collect::<Vec<_>>().join(",");
    let v5 = support::v5_mut(&mut captured);
    let domestic = v5.domestic.as_ref().unwrap();
    let indices = [TIM, BILL, CASEY].map(|id| person(sim, id).index_u32());
    let social = [TIM, BILL, CASEY].map(|id| {
        sim.world()
            .get::<Needs>(person(sim, id))
            .unwrap()
            .get(NeedId::Social)
    });
    let feeling = opinions(sim);
    let json = format!(
        r#"{{"phase":"{phase}","tick":{},"actorIndices":{:?},"social":{:?},"opinionsTimBill_BillTim_CaseyBill":{:?},"dishUnits":{},"cleanupActors":{:?},"repairs":[{repairs}],"worldHash":"{}"}}"#,
        sim.world().resource::<SimClock>().tick,
        indices,
        social,
        feeling,
        dish_units(sim),
        domestic
            .cleanup
            .iter()
            .map(|row| row.person)
            .collect::<Vec<_>>(),
        sim.world_hash()
    );
    fs::write(
        directory.join(format!("{phase}.save")),
        support::encode(sim),
    )
    .unwrap();
    fs::write(directory.join(format!("{phase}.json")), format!("{json}\n")).unwrap();
    json
}

fn queue_tv(sim: &mut Sim, identity: SimId, television: Entity, interaction: u32, count: usize) {
    let actor = person(sim, identity).index_u32();
    let mut commands = sim.world_mut().resource_mut::<CommandQueue>();
    for _ in 0..count {
        commands.push(SimCommand::UseObject {
            agent: actor,
            object: television.index_u32(),
            interaction,
        });
    }
}

fn main() {
    let directory = std::path::PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("task-owned output directory"),
    );
    fs::create_dir_all(&directory).unwrap();
    let mut sim = Sim::new_from_shipped_lot();
    assert_eq!(
        sim.world().resource::<Content>().0.tuning.fight_rules,
        FightRules::Attributed
    );
    for (id, name) in [(TIM, "Tim"), (BILL, "Bill"), (CASEY, "Casey")] {
        assert_eq!(
            sim.world().get::<SimName>(person(&sim, id)).unwrap().0,
            name
        );
    }
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetChoreBoard { enabled: false });
    sim.flush_commands();
    let counter = furniture(&sim, "counter");
    let television = furniture(&sim, "television");
    let pack = sim.world().resource::<Content>().0;
    let tv_interaction = pack
        .object(sim.world().get::<SmartObject>(television).unwrap().0)
        .interactions
        .iter()
        .position(|action| action.id == "watch_tv")
        .unwrap() as u32;
    let fight = pack
        .social
        .iter()
        .position(|action| action.id == "fight")
        .unwrap() as u32;
    let (tim_at, bill_at) = staging_tiles(&sim, counter);
    let (seed, chore_rng, first_draw) = (0..100_000u64)
        .find_map(|seed| {
            let rng = SimRng::from_seed(seed);
            let mut probe = rng.clone();
            let draw = probe.next_f32();
            (draw < 0.05).then_some((seed, rng, draw))
        })
        .expect("a seed whose first genuine response draw is below the minimum acceptance chance");
    let mut cleanliness: Vec<_> = [TIM, BILL, CASEY]
        .into_iter()
        .map(|id| {
            let person = person(&sim, id);
            (
                person.index_u32(),
                terri_sim::domestic::cleanliness(sim.world(), person),
            )
        })
        .collect();
    cleanliness.sort_by_key(|row| row.0);
    let mut snapshot = support::capture(&sim);
    let tim_index = person(&sim, TIM).index_u32();
    let bill_index = person(&sim, BILL).index_u32();
    let v5 = support::v5_mut(&mut snapshot);
    v5.world.tick = NOW;
    for row in v5.world.entities.iter_mut().filter(|row| row.agent) {
        row.needs = Some([100.; 7]);
        row.personality.as_mut().unwrap().drain = [0.; 7];
        row.selected = row.sim_id == Some(TIM.0);
        row.relationships = Some(
            [TIM, BILL, CASEY]
                .into_iter()
                .filter(|id| Some(id.0) != row.sim_id)
                .map(|id| (id.0, 0.2))
                .collect(),
        );
        if row.index == tim_index {
            row.position = Some(tim_at);
        }
        if row.index == bill_index {
            row.position = Some(bill_at);
        }
    }
    let domestic = v5.domestic.get_or_insert_with(SavedDomestic::default);
    domestic.cleanliness = cleanliness;
    domestic.dishes = vec![SavedDishes {
        id: 0,
        surface: counter.index_u32(),
        owner: BILL.0,
        units: 6,
    }];
    domestic.next_dish = 1;
    domestic.cleanup.clear();
    domestic.visits.clear();
    let key = ChoreKey {
        kind: ChoreKind::Dishes,
        target: 0,
    };
    let chores = v5.chores.as_mut().unwrap();
    chores.board_enabled = false;
    chores.assignments = vec![ChoreAssignment {
        key,
        owner: BILL.0,
        week: 0,
    }];
    chores.week = Some(0);
    chores.episodes.clear();
    chores.last_age_tick = NOW;
    chores.rng = Some(chore_rng.clone());
    snapshot.neglect = SavedNeglect {
        sources: vec![NeglectTimer {
            source: NeglectSource::Dish(0),
            actionable_since: 0,
            maximum_since: Some(0),
        }],
        duties: vec![DutyTimer {
            key,
            owner: BILL.0,
            actionable_since: 0,
            maximum_since: Some(0),
        }],
        matured_episodes: vec![],
    };
    let obligation = ChoreObligation {
        key,
        owner: BILL.0,
        actionable_since: 0,
    };
    snapshot.0.legacy.conflicts = SavedConflictState {
        next_id: 3,
        grievances: [TIM, CASEY]
            .into_iter()
            .enumerate()
            .map(|(index, affected)| SavedGrievance {
                id: index as u64 + 1,
                affected: affected.0,
                responsible: BILL.0,
                kind: GrievanceKind::Chore,
                subject: GrievanceSubject::Chore(obligation),
                occurred_at: NOW - 30,
                last_seen: NOW,
                active_until: NOW + 360,
                forget_at: NOW + 10_080,
                severity: 0.25,
                last_fought: None,
            })
            .collect(),
        ..Default::default()
    };
    sim.load_current_snapshot(snapshot)
        .expect("seeded review setup must pass strict current admission");
    queue_tv(&mut sim, CASEY, television, tv_interaction, 20);
    sim.flush_commands();
    let ready = write_phase(&directory, "ready", &sim);
    let tim = person(&sim, TIM);
    let bill = person(&sim, BILL);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::TalkToFirst {
            agent: tim.index_u32(),
            target: bill.index_u32(),
            interaction: fight,
        });
    let mut running = false;
    for _ in 0..60 {
        sim.tick();
        if sim
            .world()
            .get::<Socialising>(person(&sim, TIM))
            .is_some_and(|talk| talk.partner == person(&sim, BILL))
        {
            running = true;
            break;
        }
    }
    assert!(running, "the real player Fight must reach its recipient");
    let argument = support::capture(&sim);
    let context = argument
        .0
        .legacy
        .conflicts
        .fights
        .iter()
        .find(|row| row.initiator == SavedOrderActor::Sim(TIM.0))
        .unwrap();
    assert_eq!(context.topic_code, 24);
    assert_eq!(context.grievance, Some(1));
    assert!(!context.autonomous);
    sim.sync_render_buffer();
    let row = sim
        .render_buffer()
        .ids
        .iter()
        .position(|id| *id == person(&sim, TIM).index_u32())
        .unwrap();
    assert_eq!(sim.render_buffer().conversation_topics[row], 24);
    let running = write_phase(&directory, "running", &sim);
    // A real protected order keeps the initiator from volunteering for the recipient's work.
    queue_tv(&mut sim, TIM, television, tv_interaction, 12);
    let mut response = None;
    for _ in 0..180 {
        sim.tick();
        let current = sim.save_snapshot_v20();
        if current
            .conflicts
            .repairs
            .iter()
            .any(|row| row.recipient == BILL.0)
        {
            response = Some(current);
            break;
        }
    }
    let response =
        response.expect("a completed relevant argument must create its real response window");
    let repair = response
        .conflicts
        .repairs
        .iter()
        .find(|row| row.recipient == BILL.0)
        .unwrap();
    assert!(
        repair.accepted,
        "the preserved first response draw guarantees acceptance without tuning changes"
    );
    let mut expected_rng = chore_rng;
    assert_eq!(expected_rng.next_f32(), first_draw);
    assert_eq!(
        sim.world().resource::<SavedChores>().rng.as_ref(),
        Some(&expected_rng),
        "acceptance spends exactly the original first chore draw"
    );
    let after_fight = opinions(&sim);
    let response = write_phase(&directory, "response", &sim);
    let mut working = None;
    let mut actual_washed = 0;
    let deadline = sim.world().resource::<SimClock>().tick + 240;
    while sim.world().resource::<SimClock>().tick <= deadline && dish_units(&sim) > 0 {
        let worker = person(&sim, BILL).index_u32();
        let before = dish_units(&sim);
        let bill_working = sim
            .world()
            .resource::<SavedDomestic>()
            .cleanup
            .iter()
            .any(|row| row.person == worker);
        assert!(
            sim.world()
                .resource::<SavedDomestic>()
                .cleanup
                .iter()
                .all(|row| row.person == worker),
            "protected observers must not steal the requested cleanup"
        );
        sim.tick();
        let remaining = dish_units(&sim);
        if remaining < before {
            assert!(
                bill_working,
                "real removed dish units must belong to the recipient's admitted cleanup"
            );
            actual_washed += before - remaining;
        }
        if working.is_none()
            && sim
                .world()
                .resource::<SavedDomestic>()
                .cleanup
                .iter()
                .any(|row| row.person == worker)
        {
            working = Some(write_phase(&directory, "working", &sim));
        }
    }
    assert!(
        working.is_some(),
        "the accepted recipient must start real cleanup"
    );
    assert_eq!(actual_washed, 6);
    assert_eq!(dish_units(&sim), 0);
    assert!(sim.save_snapshot_v20().conflicts.repairs.is_empty());
    assert!(
        sim.world().resource::<SimClock>().tick < NOW + 360,
        "finish before the earliest morning job boundary"
    );
    let after = opinions(&sim);
    assert!(
        after
            .into_iter()
            .zip(after_fight)
            .all(|(end, start)| end > start),
        "recipient completion must improve all three measured directed opinions"
    );
    let after = write_phase(&directory, "after", &sim);
    let summary = format!(
        r#"{{"scenario":"SEEDED history fixture, not annoyance-producer proof","rules":"live Attributed; no tuning overrides","controls":"full shipped household and family ties; personal Needs100 and drain0; board disabled; six dish units; protected TV orders for observers","choreSeed":{seed},"firstActualResponseDraw":{first_draw},"actualRecipientDishUnits":{actual_washed},"limits":"Seeded grievance history and chore timing are controlled inputs. Fights, response acceptance, cleanup, relationship changes and all snapshots use real production paths. Opinion deltas also include ordinary ongoing relationship effects.","phases":[{ready},{running},{response},{},{after}]}}"#,
        working.unwrap()
    );
    fs::write(directory.join("facts.json"), format!("{summary}\n")).unwrap();
    fs::write(directory.join("README.txt"), "SEEDED history fixture for played review, not historical producer proof.\nLoad ready.save to begin, running.save for the real red Dishes argument, response.save for its saved acceptance, working.save during real cleanup, or after.save for completed reconciliation.\nInspect facts.json for measured actor indices, Social needs, directed opinions, accepted response, remaining dishes and actual recipient work. All emitted saves pass strict current capture, reload and equality.\n").unwrap();
    println!("Validated seeded chore-fight review at {}; Bill washed {actual_washed} actual units; first response draw {first_draw}", directory.display());
}
