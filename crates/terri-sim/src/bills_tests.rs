//! The household's monthly bills: issue 298,
//! `docs/specs/2026-10-18-wages-and-bills.md`.
use super::*;
use crate::{Content, Sim};
use terri_core::layout::{EdgeAxis, WallEdge};
use terri_core::{Agent, CommandQueue, Eating, SimCommand, StepWork};

const DAY: u64 = 1440;

fn pack() -> &'static ContentPack {
    terri_data::pack()
}

/// The shipped lot and its furniture with nobody living there, so a day
/// passes without anyone choosing anything.
fn house() -> Sim {
    Sim::new_from_lot_and_content(&pack().lot, Content(pack()))
}

/// The shipped lot with its pack edited, still empty of people.
fn house_with(edit: impl FnOnce(&mut ContentPack)) -> Sim {
    let mut pack = pack().clone();
    edit(&mut pack);
    let pack: &'static ContentPack = Box::leak(Box::new(pack));
    Sim::new_from_lot_and_content(&pack.lot, Content(pack))
}

fn bills(sim: &Sim) -> &Bills {
    sim.world().resource::<Bills>()
}

fn bills_mut(sim: &mut Sim) -> Mut<'_, Bills> {
    sim.world_mut().resource_mut::<Bills>()
}

fn use_index(id: &str) -> usize {
    pack().bills.uses.iter().position(|k| k.id == id).unwrap()
}

fn daily_index(id: &str) -> usize {
    pack().bills.daily.iter().position(|k| k.id == id).unwrap()
}

/// Dense counts by kind id, for fixture months.
fn dense(kinds: &[terri_data::BillKind], rows: &[(&str, u32)]) -> Vec<u32> {
    let mut counts = vec![0; kinds.len()];
    for (id, count) in rows {
        counts[kinds.iter().position(|k| k.id == *id).unwrap()] = *count;
    }
    counts
}

fn set_tick(sim: &mut Sim, tick: u64) {
    sim.world_mut().resource_mut::<SimClock>().tick = tick;
}

fn run_ticks(sim: &mut Sim, ticks: u64) {
    for _ in 0..ticks {
        sim.tick();
    }
}

/// The shipped lot's size and front door with `walls` and no furniture.
/// A doorway nobody can enclose with is added when `walls` is empty, so
/// the layout stays edge-based.
fn lot_with(walls: Vec<WallEdge>) -> Sim {
    let mut lot = pack().lot.clone();
    lot.placements.clear();
    lot.wall_edges = if walls.is_empty() {
        vec![WallEdge {
            axis: EdgeAxis::Vertical,
            x: 1,
            y: 1,
            doorway: true,
        }]
    } else {
        walls
    };
    Sim::new_from_lot_and_content(&lot, Content(pack()))
}

/// The four walls around the tiles `x..x + size` by `y..y + size`, with a
/// doorway in the south wall.
fn square_room(x: u32, y: u32, size: u32) -> Vec<WallEdge> {
    let mut edges = Vec::new();
    for i in 0..size {
        for (axis, ex, ey) in [
            (EdgeAxis::Horizontal, x + i, y),
            (EdgeAxis::Horizontal, x + i, y + size),
            (EdgeAxis::Vertical, x, y + i),
            (EdgeAxis::Vertical, x + size, y + i),
        ] {
            edges.push(WallEdge {
                axis,
                x: ex,
                y: ey,
                doorway: axis == EdgeAxis::Horizontal && ey == y + size && i == 0,
            });
        }
    }
    edges
}

/// A full fixture month, ending the day before tick `7 * DAY`: seven days
/// in the shipped house, the measured usage of [WB-numbers] rounded to
/// whole uses, every daily object counted every day and 13 trips.
fn fixture_month() -> Bills {
    let tuning = &pack().bills;
    Bills {
        last_counted_day: Some(6),
        month_days: 7,
        indoor_tile_days: 192 * 7,
        outdoor_tile_days: 112 * 7,
        uses: dense(
            &tuning.uses,
            &[
                ("shower", 14),
                ("bath", 7),
                ("hand_wash", 23),
                ("toilet", 34),
                ("dishes", 2),
                ("television", 11),
                ("radio", 16),
                ("stove", 5),
            ],
        ),
        daily: dense(
            &tuning.daily,
            &[("fridge", 7), ("lamp", 7), ("aquarium", 7)],
        ),
        commutes: 13,
        previous: None,
        bills: Vec::new(),
    }
}

// ---------------------------------------------------------------- rent ---

/// [WB-rent]: the house's five rooms are 192 indoor tiles, and the yard is
/// 112 outdoor tiles once the street column is left out.
#[test]
fn the_shipped_lot_has_192_indoor_and_112_outdoor_rent_tiles() {
    let sim = house();
    assert_eq!(crate::rooms::rent_tiles(sim.world()), Some((192, 112)));
    let full = Bills {
        month_days: 7,
        indoor_tile_days: 192 * 7,
        outdoor_tile_days: 112 * 7,
        ..Bills::default()
    };
    assert_eq!(month_amounts(&full, &pack().bills)[RENT as usize], 29_360);
}

/// [WB-rent]: one 4 by 4 room on the shipped lot is 16 indoor tiles and 288
/// outdoor ones, rent $135.20; with no wall at all every one of the 304
/// floor tiles off the street is outdoor, rent $120.80.
#[test]
fn the_tiny_house_and_the_wall_free_lot_count_as_the_spec_says() {
    let month = |indoor: u64, outdoor: u64| {
        month_amounts(
            &Bills {
                month_days: 7,
                indoor_tile_days: indoor * 7,
                outdoor_tile_days: outdoor * 7,
                ..Bills::default()
            },
            &pack().bills,
        )[RENT as usize]
    };
    let tiny = lot_with(square_room(2, 2, 4));
    assert_eq!(crate::rooms::rent_tiles(tiny.world()), Some((16, 288)));
    assert_eq!(month(16, 288), 13_520);
    let open = lot_with(Vec::new());
    assert_eq!(crate::rooms::rent_tiles(open.world()), Some((0, 304)));
    assert_eq!(month(0, 304), 12_080);
}

// ------------------------------------------------------- counting days ---

/// [WB-calendar]: a new game's very first tick counts its first day: one day
/// of base charges, the shipped house's rent tiles and each placed daily
/// object once.
#[test]
fn a_new_game_counts_its_first_day_on_its_first_tick() {
    let mut sim = house();
    assert!(bills(&sim).is_pristine());
    sim.tick();
    let counted = bills(&sim);
    assert_eq!(counted.last_counted_day, Some(0));
    assert_eq!(counted.month_days, 1);
    assert_eq!(
        (counted.indoor_tile_days, counted.outdoor_tile_days),
        (192, 112)
    );
    let mut daily = vec![0; pack().bills.daily.len()];
    daily[daily_index("aquarium")] = 1;
    daily[daily_index("fridge")] = 1;
    daily[daily_index("lamp")] = 1;
    assert_eq!(counted.daily, daily);
    assert!(counted.bills.is_empty());
}

/// [WB-panel]: before a new game's first tick counts its first day, rent
/// and the base charges are projected over the whole month, the same as
/// after it; only the first day's usage is added by the tick.
#[test]
fn the_first_month_is_projected_whole_before_the_first_tick() {
    let mut sim = house();
    let before = next_bills(sim.world());
    sim.tick();
    let after = next_bills(sim.world());
    assert_eq!(before.len(), 4);
    assert_eq!(before[0].expected_cents, 29_360, "a full month of rent");
    assert_eq!(before[0].expected_cents, after[0].expected_cents);
    let base = &pack().bills;
    assert_eq!(before[1].expected_cents, base.electricity_base_cents);
    assert_eq!(before[2].expected_cents, base.water_base_cents);
    assert_eq!(before[3].expected_cents, base.transportation_base_cents);
}

/// [WB-calendar]: a day is counted once, on the first tick processed in it,
/// and not on any other tick of that day.
#[test]
fn each_day_is_counted_once_on_its_first_processed_tick() {
    let mut sim = house();
    run_ticks(&mut sim, DAY - 1);
    assert_eq!(sim.world().resource::<SimClock>().tick, DAY - 1);
    assert_eq!(bills(&sim).month_days, 1, "the rest of day 0 adds nothing");
    assert_eq!(bills(&sim).indoor_tile_days, 192);
    sim.tick();
    assert_eq!(bills(&sim).last_counted_day, Some(1));
    assert_eq!(bills(&sim).month_days, 2, "day 1's first tick counts it");
    run_ticks(&mut sim, DAY - 1);
    assert_eq!(bills(&sim).month_days, 2);
    sim.tick();
    assert_eq!(bills(&sim).month_days, 3);
    assert_eq!(bills(&sim).indoor_tile_days, 192 * 3);
    assert_eq!(bills(&sim).daily[daily_index("lamp")], 3);
}

/// [WB-bills]: a whole fixture month issues its four bills on the next
/// month's first day, each with its one rounding step and the spec's
/// amounts for the shipped household's usage.
#[test]
fn a_full_month_issues_four_bills_with_the_exact_amounts() {
    let mut sim = house();
    sim.world_mut().insert_resource(fixture_month());
    set_tick(&mut sim, 7 * DAY);
    tick(sim.world_mut());
    let issued: Vec<(u32, u8, i64)> = bills(&sim)
        .bills
        .iter()
        .map(|b| (b.due_day, b.kind, b.amount_cents))
        .collect();
    // Rent $293.60. Electricity $30 and $10.98 of use: showers 210, baths
    // 175, television 220, radio 48, stove 200, fridge 140, lamp 35,
    // aquarium 70. Water $20 and $19.65: showers 840, baths 630, hand
    // washing 115, toilet 340, dishes 40. Transportation $10 and 13 trips.
    assert_eq!(
        issued,
        [
            (7, RENT, 29_360),
            (7, ELECTRICITY, 4_098),
            (7, WATER, 3_965),
            (7, TRANSPORTATION, 4_900),
        ]
    );
    // The new month has counted its first day; the old one's counts are
    // its "last month".
    let after = bills(&sim);
    assert_eq!(after.month_days, 1);
    assert_eq!(after.indoor_tile_days, 192);
    assert!(after.uses.is_empty());
    assert_eq!(after.commutes, 0);
    assert_eq!(
        after.previous,
        Some(PreviousUsage {
            electricity_cents: 1_098,
            water_cents: 1_965,
            commutes: 13,
        })
    );
}

/// [WB-bills]: a part month's base charges and rent are its share of the
/// month, with one rounding step, up, per bill: three days of the shipped
/// rent is 88080 / 7 = 12582.86, charged as 12583 cents.
#[test]
fn a_partial_month_rounds_each_bill_once_up_to_the_cent() {
    let month = Bills {
        month_days: 3,
        indoor_tile_days: 192 * 3,
        outdoor_tile_days: 112 * 3,
        commutes: 2,
        ..Bills::default()
    };
    assert_eq!(
        month_amounts(&month, &pack().bills),
        // 3000 * 3 / 7 = 1285.7, 2000 * 3 / 7 = 857.1, 1000 * 3 / 7 = 428.6.
        [12_583, 1_286, 858, 429 + 600]
    );
}

/// [WB-bills]: a bill that comes to nothing is not issued, and the bills of
/// a month are issued in the order rent, electricity, water,
/// transportation.
#[test]
fn a_zero_bill_is_not_issued() {
    let mut sim = house_with(|pack| {
        pack.bills.electricity_base_cents = 0;
        pack.bills.transportation_base_cents = 0;
    });
    sim.world_mut().insert_resource(Bills {
        uses: Vec::new(),
        daily: Vec::new(),
        commutes: 0,
        ..fixture_month()
    });
    set_tick(&mut sim, 7 * DAY);
    tick(sim.world_mut());
    let kinds: Vec<u8> = bills(&sim).bills.iter().map(|b| b.kind).collect();
    assert_eq!(kinds, [RENT, WATER]);
}

#[test]
fn bills_are_issued_in_the_order_rent_electricity_water_transportation() {
    let mut sim = house();
    sim.world_mut().insert_resource(fixture_month());
    set_tick(&mut sim, 7 * DAY);
    tick(sim.world_mut());
    let kinds: Vec<u8> = bills(&sim).bills.iter().map(|b| b.kind).collect();
    assert_eq!(kinds, [RENT, ELECTRICITY, WATER, TRANSPORTATION]);
    assert_eq!([RENT, ELECTRICITY, WATER, TRANSPORTATION], [0, 1, 2, 3]);
}

/// [WB-rent]: rent is measured from the confirmed layout once a day. A room
/// still in an open Build session counts nothing; once confirmed, it counts
/// from the next day, and the day already counted is left alone.
#[test]
fn rent_ignores_an_unconfirmed_draft_and_follows_a_confirmed_layout_from_the_next_day() {
    let mut sim = house();
    sim.tick();
    assert_eq!(bills(&sim).indoor_tile_days, 192);
    sim.begin_build().expect("the shipped house opens Build");
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::BuildRoom {
            x0: 16,
            y0: 12,
            x1: 17,
            y1: 13,
            doorway: Some(terri_core::layout::WallLine {
                axis: EdgeAxis::Horizontal,
                x: 16,
                y: 12,
            }),
        });
    sim.flush_commands();
    assert_eq!(
        crate::rooms::rent_tiles(sim.world()),
        Some((192, 112)),
        "a draft room is not the confirmed layout"
    );
    let token = sim
        .prepare_build_commit(crate::rooms::RoomChoices::default())
        .expect("the yard room confirms")
        .token;
    sim.commit_build(token).expect("commit");
    sim.end_build().expect("leave Build");
    assert_eq!(crate::rooms::rent_tiles(sim.world()), Some((196, 108)));
    run_ticks(&mut sim, DAY - 2);
    assert_eq!(
        bills(&sim).indoor_tile_days,
        192,
        "the day already counted keeps its rent"
    );
    sim.tick();
    assert_eq!(bills(&sim).indoor_tile_days, 192 + 196);
    assert_eq!(bills(&sim).outdoor_tile_days, 112 + 108);
}

// ------------------------------------------------------------- usage ---

/// A person in the shipped house's hall, away from everything they might
/// be sent to use.
fn person(sim: &mut Sim) -> Entity {
    let person = sim.spawn_agent(terri_core::Position { x: 17.0, y: 14.0 }, 100.0);
    sim.world_mut().entity_mut(person).insert((
        terri_core::IntentQueue::default(),
        terri_core::Needs::all_at(100.0),
    ));
    person
}

/// The placed object whose definition carries action `action`, and that
/// action's index there.
fn placed_with(sim: &mut Sim, action: &str) -> (Entity, u32) {
    let pack = pack();
    let mut objects: Vec<(Entity, terri_data::ObjectDefId)> = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .map(|(entity, object)| (entity, object.0))
        .collect();
    objects.sort_by_key(|(entity, _)| entity.index());
    objects
        .into_iter()
        .find_map(|(entity, definition)| {
            pack.object(definition)
                .interactions
                .iter()
                .position(|a| a.id == action)
                .map(|index| (entity, index as u32))
        })
        .unwrap_or_else(|| panic!("the shipped house has an object with {action}"))
}

fn order(sim: &mut Sim, agent: Entity, object: Entity, interaction: u32) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: agent.index_u32(),
            object: object.index_u32(),
            interaction,
        });
    sim.flush_commands();
}

fn uses_of(sim: &Sim, kind: &str) -> u32 {
    bills(sim).uses.get(use_index(kind)).copied().unwrap_or(0)
}

/// Ticks until `done`, or fails after `budget` ticks naming `what`.
fn until(sim: &mut Sim, what: &str, budget: u32, done: impl Fn(&Sim) -> bool) {
    for _ in 0..budget {
        if done(sim) {
            return;
        }
        sim.tick();
    }
    assert!(done(sim), "{what} within {budget} ticks");
}

fn eating(sim: &Sim, agent: Entity) -> bool {
    sim.world().get::<Eating>(agent).is_some()
}

/// [WB-usage]: each shipped action carrying a use kind counts it once, on
/// the tick its physical work starts: not when it is ordered, not during
/// the walk, and not again while it runs or when it ends.
#[test]
fn each_shipped_use_kind_counts_once_at_physical_start() {
    for (action, kind) in [
        ("take_shower", "shower"),
        ("soak", "bath"),
        ("wash_hands", "hand_wash"),
        ("wash_up", "hand_wash"),
        ("relieve_self", "toilet"),
        ("watch_tv", "television"),
        ("listen", "radio"),
    ] {
        let mut sim = house();
        sim.tick();
        let agent = person(&mut sim);
        let (object, interaction) = placed_with(&mut sim, action);
        order(&mut sim, agent, object, interaction);
        sim.tick();
        assert!(!eating(&sim, agent), "{action}: the walk comes first");
        assert_eq!(uses_of(&sim, kind), 0, "{action}: ordering costs nothing");
        until(&mut sim, action, 400, |sim| eating(sim, agent));
        assert_eq!(uses_of(&sim, kind), 1, "{action}: counted at its start");
        until(&mut sim, action, 400, |sim| !eating(sim, agent));
        assert_eq!(uses_of(&sim, kind), 1, "{action}: counted once");
        let others: u32 = bills(&sim).uses.iter().sum::<u32>() - 1;
        assert_eq!(others, 0, "{action}: no other kind moved");
    }
}

/// [WB-usage]: the dinner chain charges the stove when its Cook step starts
/// and not again for Simmer and stir; washing up charges dish washing when
/// the Wash dishes step starts.
#[test]
fn the_cook_and_wash_dishes_steps_count_their_uses_once() {
    let mut sim = house();
    sim.tick();
    let agent = person(&mut sim);
    sim.world_mut()
        .get_mut::<terri_core::Needs>(agent)
        .unwrap()
        .set(terri_core::NeedId::Hunger, 10.0);
    let (fridge, cook) = placed_with(&mut sim, "cook_dinner");
    order(&mut sim, agent, fridge, cook);
    let chain = pack()
        .chains
        .iter()
        .position(|c| c.id == "cook_dinner")
        .unwrap() as u32;
    let cook_step = pack().chains[chain as usize]
        .steps
        .iter()
        .position(|s| s.label == "Cook")
        .unwrap() as u32;
    let on_step = |sim: &Sim, step: u32| {
        sim.world().get::<StepWork>(agent).is_some()
            && sim
                .world()
                .get::<terri_core::ChainState>(agent)
                .is_some_and(|c| c.chain == chain && c.step == step)
    };
    until(&mut sim, "the Cook step", 2_000, |sim| {
        on_step(sim, cook_step) || uses_of(sim, "stove") > 0
    });
    assert!(on_step(&sim, cook_step));
    assert_eq!(uses_of(&sim, "stove"), 1);
    until(&mut sim, "the end of dinner", 4_000, |sim| {
        sim.world().get::<terri_core::ChainState>(agent).is_none()
    });
    assert_eq!(uses_of(&sim, "stove"), 1, "Simmer and stir charges nothing");
    let (sink, clean) = placed_with(&mut sim, "clean_dishes");
    order(&mut sim, agent, sink, clean);
    until(&mut sim, "washing up", 2_000, |sim| {
        uses_of(sim, "dishes") > 0
    });
    assert_eq!(uses_of(&sim, "dishes"), 1);
    until(&mut sim, "the end of washing up", 2_000, |sim| {
        sim.world().get::<terri_core::ChainState>(agent).is_none()
    });
    assert_eq!(uses_of(&sim, "dishes"), 1);
}

/// [WB-usage]: a walk abandoned before the person reaches the shower counts
/// nothing.
#[test]
fn an_abandoned_walk_counts_nothing() {
    let mut sim = house();
    sim.tick();
    let agent = person(&mut sim);
    let (shower, interaction) = placed_with(&mut sim, "take_shower");
    order(&mut sim, agent, shower, interaction);
    run_ticks(&mut sim, 2);
    assert!(!eating(&sim, agent));
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: agent.index_u32(),
        });
    run_ticks(&mut sim, 200);
    assert_eq!(uses_of(&sim, "shower"), 0);
}

/// [WB-usage]: an interrupted shower has already run its water and still
/// counts, once; the radio the person is sent to instead counts its own use.
#[test]
fn an_interrupted_shower_still_counts() {
    let mut sim = house();
    sim.tick();
    let agent = person(&mut sim);
    let (shower, interaction) = placed_with(&mut sim, "take_shower");
    order(&mut sim, agent, shower, interaction);
    until(&mut sim, "the shower", 400, |sim| eating(sim, agent));
    let (radio, listen) = placed_with(&mut sim, "listen");
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: agent.index_u32(),
        });
    order(&mut sim, agent, radio, listen);
    until(&mut sim, "the radio instead", 400, |sim| {
        sim.world()
            .get::<Eating>(agent)
            .is_some_and(|e| e.interaction == listen && uses_of(sim, "radio") == 1)
    });
    assert_eq!(
        uses_of(&sim, "shower"),
        1,
        "the cut-short shower still counts"
    );
}

/// [WB-usage]: each viewer's session counts, so two people watching one
/// television count two uses.
#[test]
fn two_viewers_count_two_television_uses() {
    let mut sim = house();
    sim.tick();
    let first = person(&mut sim);
    let second = person(&mut sim);
    let (television, interaction) = placed_with(&mut sim, "watch_tv");
    order(&mut sim, first, television, interaction);
    order(&mut sim, second, television, interaction);
    until(&mut sim, "both viewers", 400, |sim| {
        eating(sim, first) && eating(sim, second)
    });
    assert_eq!(uses_of(&sim, "television"), 2);
}

/// [WB-usage]: daily kinds count each placed object every day: a second
/// lamp counts two lamps a day, and a fridge that has been sold stops
/// counting from the next day.
#[test]
fn daily_kinds_count_per_placed_object_per_day() {
    let mut sim = house();
    sim.world_mut().resource_mut::<Funds>().0 = 1_000_000;
    sim.tick();
    let lamp = daily_index("lamp");
    let fridge = daily_index("fridge");
    assert_eq!((bills(&sim).daily[lamp], bills(&sim).daily[fridge]), (1, 1));
    let floor_lamp = pack().find("floor_lamp").unwrap();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::BuyObject {
            definition: floor_lamp.0,
            x: 17,
            y: 13,
            facing: terri_core::Facing::SouthEast,
        });
    let (fridge_entity, _) = placed_with(&mut sim, "cook_dinner");
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SellObject {
            object: fridge_entity.index_u32(),
        });
    sim.flush_commands();
    assert!(
        sim.world().get_entity(fridge_entity).is_err()
            || sim.world().get::<SmartObject>(fridge_entity).is_none(),
        "the fridge is sold"
    );
    run_ticks(&mut sim, DAY);
    assert_eq!(bills(&sim).month_days, 2);
    assert_eq!(bills(&sim).daily[lamp], 1 + 2, "two lamps on day 1");
    assert_eq!(bills(&sim).daily[fridge], 1, "no fridge on day 1");
}

// ------------------------------------------------------------- trips ---

/// The shipped household with the job search off, Tim's office shift cut
/// to 06:00 to 09:00 every day so a test sees it settle quickly, and a
/// 900-tick object in the yard to keep him home with. Returns the sim, Tim
/// and the object.
fn worker_world() -> (Sim, Entity, Entity) {
    let mut pack = pack().clone();
    for job in pack.careers.iter_mut().filter(|job| job.id == "office_job") {
        job.shift_ticks = 180;
        job.working_days = 0b1111111;
    }
    let hold = terri_data::ObjectDefId(pack.objects.len() as u32);
    pack.objects.push(crate::test_content::object(
        "bills_hold",
        &[(terri_core::NeedId::Fun, 10.0)],
        900,
    ));
    let pack: &'static ContentPack = Box::leak(Box::new(pack));
    let mut sim = Sim::new_household_with_content(Content(pack), pack.tuning.rng_seed);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetCareerAutonomy {
            change: false,
            search: false,
        });
    sim.flush_commands();
    let tim = sim
        .world_mut()
        .query_filtered::<Entity, With<terri_core::Career>>()
        .iter(sim.world())
        .next()
        .expect("the shipped worker");
    let object = sim.spawn_object(terri_core::Position { x: 17.0, y: 14.0 }, hold);
    (sim, tim, object)
}

fn trips(sim: &Sim) -> u32 {
    bills(sim).commutes
}

fn settled_outcomes(sim: &Sim) -> usize {
    sim.world()
        .resource::<crate::attendance::Attendance>()
        .outcomes
        .len()
}

/// [WB-bills]: a shift worked and paid is one trip to work, counted when it
/// settles.
#[test]
fn a_trip_counts_once_per_settled_shift_with_time_worked() {
    let (mut sim, _, _) = worker_world();
    until(&mut sim, "the first shift settled", 900, |sim| {
        settled_outcomes(sim) == 1
    });
    assert_eq!(trips(&sim), 1);
    until(&mut sim, "the second shift settled", 2_000, |sim| {
        settled_outcomes(sim) == 2
    });
    assert_eq!(trips(&sim), 2);
}

/// [WB-bills]: a shift missed entirely is settled with no time worked and
/// is no trip.
#[test]
fn a_missed_shift_counts_no_trip() {
    let (mut sim, actor, object) = worker_world();
    run_ticks(&mut sim, 300);
    order(&mut sim, actor, object, 0);
    until(&mut sim, "the missed shift settled", 900, |sim| {
        settled_outcomes(sim) == 1
    });
    let outcome = sim
        .world()
        .resource::<crate::attendance::Attendance>()
        .outcomes[0]
        .clone();
    assert_eq!(outcome.worked_minutes, 0.0, "the fixture keeps them home");
    assert_eq!(trips(&sim), 0);
}

/// [WB-bills]: a worker sent home by a player order and back to the same
/// shift makes one trip, because the shift settles once.
#[test]
fn a_worker_sent_home_and_back_counts_one_trip() {
    let (mut sim, actor, object) = worker_world();
    until(&mut sim, "the worker at work", 900, |sim| {
        sim.world().get::<terri_core::AtWork>(actor).is_some()
    });
    order(&mut sim, actor, object, 0);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: actor.index_u32(),
        });
    until(&mut sim, "the shift settled", 900, |sim| {
        settled_outcomes(sim) == 1
    });
    assert!(
        sim.world()
            .resource::<crate::attendance::Attendance>()
            .outcomes[0]
            .worked_minutes
            > 0.0
    );
    assert_eq!(trips(&sim), 1);
}

// ------------------------------------------------------ determinism ---

/// [WB-determinism]: a world without a lot never leaves the pristine
/// record, and the bills add nothing to its hash.
#[test]
fn a_world_without_a_lot_stays_pristine_and_hashes_as_before() {
    let mut sim = Sim::new_with_lot(12, 12);
    let agent = sim.spawn_agent(terri_core::Position { x: 3.0, y: 3.0 }, 50.0);
    sim.world_mut()
        .entity_mut(agent)
        .insert(terri_core::IntentQueue::default());
    run_ticks(&mut sim, DAY + 10);
    assert!(bills(&sim).is_pristine());
    let mut with_bills = FnvHasher::default();
    with_bills.write_u64(7);
    hash(sim.world(), &mut with_bills);
    let mut without = FnvHasher::default();
    without.write_u64(7);
    assert_eq!(with_bills.finish(), without.finish());
}

/// [WB-determinism]: once counted, the record is in the hash: changing one
/// field moves it, and restoring the field restores it.
#[test]
fn a_counted_day_moves_the_hash() {
    let mut sim = house();
    let pristine = sim.world_hash();
    sim.tick();
    let counted = sim.world_hash();
    assert_ne!(pristine, counted);
    bills_mut(&mut sim).month_days += 1;
    assert_ne!(sim.world_hash(), counted, "the hash reads month_days");
    bills_mut(&mut sim).month_days -= 1;
    assert_eq!(sim.world_hash(), counted);
    bills_mut(&mut sim).commutes += 1;
    assert_ne!(sim.world_hash(), counted, "the hash reads the trips");
    bills_mut(&mut sim).commutes -= 1;
    bills_mut(&mut sim).bills.push(Bill {
        due_day: 0,
        kind: RENT,
        amount_cents: 1,
        late_fee_cents: 0,
        paid_day: None,
    });
    assert_ne!(sim.world_hash(), counted, "the hash reads the bills");
}

// ----------------------------------------------------------- paying ---

/// A house with the given bills due on day 7 and the day already counted,
/// at `tick`, with `funds` cents.
fn owing(bills: Vec<Bill>, funds: i64, tick: u64) -> Sim {
    let mut sim = house();
    let day = day_index(tick, 1440);
    sim.world_mut().insert_resource(Bills {
        last_counted_day: Some(day),
        month_days: day % 7 + 1,
        bills,
        ..Bills::default()
    });
    sim.world_mut().resource_mut::<Funds>().0 = funds;
    set_tick(&mut sim, tick);
    sim
}

fn due(kind: u8, amount_cents: i64) -> Bill {
    Bill {
        due_day: 7,
        kind,
        amount_cents,
        late_fee_cents: 0,
        paid_day: None,
    }
}

fn paid_days(sim: &Sim) -> Vec<Option<u32>> {
    bills(sim).bills.iter().map(|b| b.paid_day).collect()
}

/// [WB-paying]: bills are paid on the tick they are issued when Funds cover
/// them, and Funds fall by exactly their amounts.
#[test]
fn bills_are_paid_on_the_tick_they_are_issued_when_funds_cover_them() {
    let mut sim = house();
    sim.world_mut().insert_resource(fixture_month());
    sim.world_mut().resource_mut::<Funds>().0 = 50_000;
    set_tick(&mut sim, 7 * DAY);
    tick(sim.world_mut());
    assert_eq!(paid_days(&sim), [Some(7); 4]);
    assert_eq!(
        sim.world().resource::<Funds>().0,
        50_000 - (29_360 + 4_098 + 3_965 + 4_900)
    );
}

/// [WB-paying]: payment walks the bills oldest first, in kind order within
/// a month, and stops at the first one Funds cannot cover, even when a
/// later, smaller one would fit.
#[test]
fn payment_is_oldest_first_and_stops_at_the_first_unaffordable_bill() {
    let older = Bill {
        due_day: 0,
        ..due(WATER, 1_000)
    };
    let mut sim = owing(
        vec![older, due(RENT, 3_000), due(ELECTRICITY, 500)],
        3_500,
        7 * DAY + 5,
    );
    tick(sim.world_mut());
    assert_eq!(paid_days(&sim), [Some(7), None, None]);
    assert_eq!(
        sim.world().resource::<Funds>().0,
        2_500,
        "the 500 waits behind rent"
    );
    sim.world_mut().resource_mut::<Funds>().0 = 3_500;
    tick(sim.world_mut());
    assert_eq!(paid_days(&sim), [Some(7), Some(7), Some(7)]);
    assert_eq!(sim.world().resource::<Funds>().0, 0);
}

/// [WB-paying]: a bill is never paid in part, and Funds never go below
/// zero, even a cent short.
#[test]
fn a_bill_is_never_paid_in_part_and_funds_never_go_below_zero() {
    let mut sim = owing(vec![due(RENT, 29_360)], 29_359, 7 * DAY + 1);
    tick(sim.world_mut());
    assert_eq!(paid_days(&sim), [None]);
    assert_eq!(sim.world().resource::<Funds>().0, 29_359);
    sim.world_mut().resource_mut::<Funds>().0 = 29_360;
    tick(sim.world_mut());
    assert_eq!(paid_days(&sim), [Some(7)]);
    assert_eq!(sim.world().resource::<Funds>().0, 0);
}

/// [WB-paying]: pay from a shift that settles in a tick is in Funds before
/// the bills look in the same tick, because the bills run right after the
/// paid return.
#[test]
fn pay_from_a_settling_shift_pays_a_waiting_bill_in_the_same_tick() {
    let (mut sim, _, _) = worker_world();
    sim.tick();
    assert_eq!(
        sim.world().resource::<Funds>().0,
        0,
        "a new game has no money"
    );
    let before = sim.world().resource::<SimClock>().tick;
    let outcome_pay = |sim: &Sim| {
        sim.world()
            .resource::<crate::attendance::Attendance>()
            .outcomes
            .first()
            .map(|outcome| outcome.pay_cents)
    };
    // The bill is exactly what the first shift will pay; a cut-short shift
    // pays less, so the bill is set from the attendance the shift will
    // settle with, by running a twin.
    let (mut twin, _, _) = worker_world();
    until(&mut twin, "the twin's shift settles", 900, |sim| {
        outcome_pay(sim).is_some()
    });
    let pay = outcome_pay(&twin).unwrap();
    assert!(pay > 0);
    sim.world_mut().resource_mut::<Bills>().bills = vec![Bill {
        due_day: 0,
        ..due(RENT, pay)
    }];
    let mut settled_at = None;
    for _ in 0..900 {
        sim.tick();
        if settled_outcomes(&sim) == 1 {
            settled_at = Some(sim.world().resource::<SimClock>().tick);
            break;
        }
    }
    assert!(settled_at.is_some(), "the shift settles");
    assert!(settled_at.unwrap() > before);
    assert_eq!(outcome_pay(&sim), Some(pay), "the twin settled the same");
    assert_eq!(
        bills(&sim).bills[0].paid_day,
        Some(0),
        "paid on the settling tick"
    );
    assert_eq!(sim.world().resource::<Funds>().0, 0);
}

// ------------------------------------------------------------- fees ---

/// [WB-paying]: within the grace, counting the due day, no fee is added.
#[test]
fn no_fee_is_added_within_the_grace_period() {
    let mut sim = owing(vec![due(RENT, 29_360)], 0, 7 * DAY);
    for day in 8..12u64 {
        set_tick(&mut sim, day * DAY);
        tick(sim.world_mut());
        assert_eq!(bills(&sim).bills[0].late_fee_cents, 0, "day index {day}");
        assert!(!any_overdue(sim.world()));
    }
}

/// [WB-paying]: a bill due on Day 8 (day index 7) gains its first fee on
/// the first tick of Day 13 (day index 12), and one more on each later
/// day's first tick only.
#[test]
fn a_late_fee_is_added_on_the_first_tick_of_each_day_after_grace() {
    let mut sim = owing(vec![due(RENT, 29_360)], 0, 11 * DAY + 1439);
    tick(sim.world_mut());
    assert_eq!(bills(&sim).bills[0].late_fee_cents, 0);
    set_tick(&mut sim, 12 * DAY);
    tick(sim.world_mut());
    assert_eq!(bills(&sim).bills[0].late_fee_cents, 1_468);
    set_tick(&mut sim, 12 * DAY + 600);
    tick(sim.world_mut());
    assert_eq!(bills(&sim).bills[0].late_fee_cents, 1_468, "once a day");
    set_tick(&mut sim, 13 * DAY);
    tick(sim.world_mut());
    assert_eq!(bills(&sim).bills[0].late_fee_cents, 2 * 1_468);
}

/// [WB-paying]: a fee is 5 percent of the bill rounded up to the cent, and
/// the fees stop exactly at the cap, the last one cut short to meet it.
#[test]
fn late_fees_round_up_to_the_cent_and_stop_exactly_at_the_cap() {
    // 5 percent of 1001 cents is 50.05, charged as 51; the cap is 500.
    let mut sim = owing(vec![due(WATER, 1_001)], 0, 11 * DAY + 1439);
    tick(sim.world_mut());
    let mut fees = Vec::new();
    for day in 12..24u64 {
        set_tick(&mut sim, day * DAY);
        tick(sim.world_mut());
        fees.push(bills(&sim).bills[0].late_fee_cents);
    }
    assert_eq!(
        fees,
        [51, 102, 153, 204, 255, 306, 357, 408, 459, 500, 500, 500]
    );
    assert_eq!(late_fee_cap(1_001, &pack().bills), 500);
    assert_eq!(late_fee_cap(29_360, &pack().bills), 14_680);
}

// ------------------------------------------------------------- mood ---

fn mood_labels(sim: &Sim, agent: Entity) -> Vec<(String, f32)> {
    sim.mood_of(agent.index_u32())
        .expect("a person")
        .moodlets
        .into_iter()
        .map(|m| (m.label, m.score))
        .collect()
}

fn behind(sim: &Sim, agent: Entity) -> Option<f32> {
    mood_labels(sim, agent)
        .into_iter()
        .find(|(label, _)| label == crate::mood::BEHIND_ON_BILLS)
        .map(|(_, score)| score)
}

/// [WB-paying]: Behind on bills appears only once a bill is past its grace,
/// not while it is merely due.
#[test]
fn behind_on_bills_appears_only_while_a_bill_is_overdue() {
    let mut sim = owing(vec![due(RENT, 29_360)], 0, 7 * DAY);
    let agent = person(&mut sim);
    assert_eq!(behind(&sim, agent), None, "due, not overdue");
    set_tick(&mut sim, 12 * DAY - 1);
    assert_eq!(behind(&sim, agent), None, "the last tick of the grace");
    set_tick(&mut sim, 12 * DAY);
    assert_eq!(behind(&sim, agent), Some(-8.0));
}

/// [WB-paying]: the moodlet ends on the tick the last overdue bill is paid.
#[test]
fn behind_on_bills_ends_on_the_tick_the_last_overdue_bill_is_paid() {
    let older = Bill {
        due_day: 0,
        ..due(WATER, 1_000)
    };
    let mut sim = owing(vec![older, due(RENT, 3_000)], 0, 12 * DAY);
    let agent = person(&mut sim);
    tick(sim.world_mut());
    assert!(behind(&sim, agent).is_some());
    sim.world_mut().resource_mut::<Funds>().0 = 1_000 + 350;
    tick(sim.world_mut());
    assert_eq!(paid_days(&sim)[0], Some(12));
    assert!(behind(&sim, agent).is_some(), "rent is still overdue");
    let rent = bills(&sim).bills[1].total_cents();
    sim.world_mut().resource_mut::<Funds>().0 = rent;
    tick(sim.world_mut());
    assert_eq!(behind(&sim, agent), None);
}

/// [WB-paying]: every living housemate carries it, at the tuned weight.
#[test]
fn behind_on_bills_lowers_mood_by_the_tuned_amount_for_every_living_housemate() {
    let mut sim = owing(vec![due(RENT, 29_360)], 0, 12 * DAY);
    let first = person(&mut sim);
    let second = person(&mut sim);
    for agent in [first, second] {
        assert_eq!(behind(&sim, agent), Some(-pack().bills.overdue_mood));
    }
    let mut lighter = house_with(|pack| pack.bills.overdue_mood = 3.5);
    lighter.world_mut().insert_resource(Bills {
        last_counted_day: Some(12),
        month_days: 6,
        bills: vec![due(RENT, 100)],
        ..Bills::default()
    });
    set_tick(&mut lighter, 12 * DAY);
    let agent = person(&mut lighter);
    assert_eq!(behind(&lighter, agent), Some(-3.5));
}
