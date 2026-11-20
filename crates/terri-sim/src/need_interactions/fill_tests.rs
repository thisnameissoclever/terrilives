//! Issue 315: a toilet, shower or bath used for its full duration fills its
//! need to 100. The rules are in `docs/specs/2026-11-15-full-bathroom-use.md`.
//!
//! Expectations are computed from the pack's authored numbers by a closed
//! form that shares no code with the implementation, in `f64`, and the
//! starting levels are fractional ([L34]) so a rounding or truncation
//! mistake cannot hide behind whole numbers. The pinned lengths of the
//! shipped fixtures, 15, 37 and 43 ticks, are written out as literals.
use super::fill::{fill_need, fill_ticks, planned_ticks};
use crate::{Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::{
    Agent, CommandQueue, Eating, NeedId, Needs, Path, Personality, Position, SimCommand, SimRng,
    Target,
};
use terri_data::{CompiledInteraction, ContentPack};

const FIXTURES: [(&str, NeedId); 3] = [
    ("toilet", NeedId::Bladder),
    ("shower", NeedId::Hygiene),
    ("bathtub", NeedId::Hygiene),
];

fn action<'a>(pack: &'a ContentPack, kind: &str) -> &'a CompiledInteraction {
    &pack.object(pack.find(kind).unwrap()).interactions[0]
}

/// The authored rate of the action's need, before any multiplier.
fn authored_rate(act: &CompiledInteraction, need: NeedId) -> f64 {
    let (_, delta) = act
        .advertises
        .iter()
        .find(|(n, d)| usize::from(*n) == need.index() && *d > 0.)
        .expect("the action fills this need");
    f64::from(*delta) / f64::from(act.duration_ticks)
}

/// The number of ticks a use lasts, by closed form: the arrival tick
/// delivers without a drain before it (the drain of that tick ran before the
/// person arrived), and every later tick drains and then delivers.
fn closed_form_ticks(start: f64, rate: f64, drain: f64, floor: u32) -> u32 {
    let after_first = start + rate;
    let ticks = if after_first >= 100. {
        1
    } else {
        1 + ((100. - after_first) / (rate - drain)).ceil() as u32
    };
    ticks.max(floor)
}

/// A person standing at a fixture with nowhere left to walk, so the next
/// tick starts the use, with `need` at `level` and every other need at 50.
fn about_to_use(kind: &str, need: NeedId, level: f32) -> (Sim, Entity, Entity) {
    let mut sim = Sim::new_with_lot(8, 8);
    let pack = sim.world().resource::<Content>().0;
    let object = sim.spawn_object(Position { x: 2.0, y: 2.0 }, pack.find(kind).unwrap());
    let id = sim
        .world_mut()
        .resource_mut::<terri_core::SimIdAllocator>()
        .issue();
    let mut needs = Needs::all_at(50.);
    needs.set(need, level);
    let person = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 2.0, y: 3.0 },
            needs,
            Target {
                object,
                interaction: 0,
            },
            Path {
                steps: vec![],
                cursor: 0,
            },
        ))
        .id();
    (sim, person, object)
}

/// Ticks until the use ends, and the person's needs on the tick it ends.
fn run_to_the_end(sim: &mut Sim, person: Entity) -> (u32, Needs) {
    let mut started = false;
    for tick in 1..=2000u32 {
        sim.tick();
        let eating = sim.world().get::<Eating>(person).is_some();
        started |= eating;
        if started && !eating {
            return (tick, *sim.world().get::<Needs>(person).unwrap());
        }
    }
    panic!("the use never ended");
}

fn drain_of(pack: &ContentPack, need: NeedId) -> f64 {
    f64::from(pack.decay_per_tick[need.index()])
}

#[test]
fn only_the_three_bathroom_activities_fill_and_both_sinks_do_not() {
    let pack = terri_data::pack();
    for (kind, need) in FIXTURES {
        assert_eq!(fill_need(action(pack, kind)), Some(need), "{kind}");
    }
    for kind in [
        "sink",
        "kitchen_sink",
        "bed",
        "double_bed",
        "radio",
        "chair",
    ] {
        assert_eq!(fill_need(action(pack, kind)), None, "{kind}");
    }
    // The activity decides, not the object or the advert: the shower's own
    // action with its activity removed is no longer a fill.
    let mut shower = action(pack, "shower").clone();
    shower.activity = None;
    assert_eq!(fill_need(&shower), None);
    let mut handwash = action(pack, "shower").clone();
    handwash.activity = Some(terri_data::pack::CompiledActivity::WashingHands);
    assert_eq!(fill_need(&handwash), None);
}

#[test]
fn a_full_use_takes_the_closed_form_number_of_ticks_from_any_start() {
    let pack = terri_data::pack();
    let floor = pack.tuning.min_interaction_ticks;
    for (kind, need) in FIXTURES {
        let act = action(pack, kind);
        for start in [0.0, 37.5, 80.25, 99.5] {
            let mut needs = Needs::all_at(50.);
            needs.set(need, start);
            let expected = closed_form_ticks(
                f64::from(start),
                authored_rate(act, need),
                drain_of(pack, need),
                floor,
            );
            assert_eq!(
                fill_ticks(pack, act, &needs, None, 1.),
                Some(expected),
                "{kind} from {start}"
            );
        }
    }
}

#[test]
fn shipped_full_uses_from_an_empty_bar_take_15_37_and_43_ticks() {
    let pack = terri_data::pack();
    for (kind, need, ticks) in [
        ("toilet", NeedId::Bladder, 15),
        ("shower", NeedId::Hygiene, 37),
        ("bathtub", NeedId::Hygiene, 43),
    ] {
        let mut needs = Needs::all_at(50.);
        needs.set(need, 0.);
        assert_eq!(
            fill_ticks(pack, action(pack, kind), &needs, None, 1.),
            Some(ticks),
            "{kind}"
        );
    }
}

#[test]
fn a_satisfaction_multiplier_scales_the_rate_and_so_the_length() {
    let pack = terri_data::pack();
    let floor = pack.tuning.min_interaction_ticks;
    let act = action(pack, "shower");
    let mut needs = Needs::all_at(50.);
    needs.set(NeedId::Hygiene, 52.5);
    for satisfaction in [1.5_f32, 0.5] {
        let mut personality = Personality::neutral();
        personality.satisfaction[NeedId::Hygiene.index()] = satisfaction;
        let expected = closed_form_ticks(
            52.5,
            authored_rate(act, NeedId::Hygiene) * f64::from(satisfaction),
            drain_of(pack, NeedId::Hygiene),
            floor,
        );
        assert_eq!(
            fill_ticks(pack, act, &needs, Some(&personality), 1.),
            Some(expected),
            "satisfaction {satisfaction}"
        );
    }
    // A multiplier on another need changes nothing.
    let mut other = Personality::neutral();
    other.satisfaction[NeedId::Comfort.index()] = 3.;
    assert_eq!(
        fill_ticks(pack, act, &needs, Some(&other), 1.),
        fill_ticks(pack, act, &needs, None, 1.)
    );
}

#[test]
fn a_fumbled_attempt_fills_more_slowly_by_its_delta_scale() {
    let pack = terri_data::pack();
    let act = action(pack, "toilet");
    let mut needs = Needs::all_at(50.);
    needs.set(NeedId::Bladder, 20.25);
    let expected = closed_form_ticks(
        20.25,
        authored_rate(act, NeedId::Bladder) * 0.5,
        drain_of(pack, NeedId::Bladder),
        pack.tuning.min_interaction_ticks,
    );
    assert_eq!(fill_ticks(pack, act, &needs, None, 0.5), Some(expected));
}

#[test]
fn a_model_that_authors_twice_the_rate_fills_in_about_half_the_ticks() {
    let pack = terri_data::pack();
    let basic = action(pack, "shower");
    let mut better = basic.clone();
    for (_, delta) in &mut better.advertises {
        if *delta > 0. {
            *delta *= 2.;
        }
    }
    let mut needs = Needs::all_at(50.);
    needs.set(NeedId::Hygiene, 0.);
    let slow = fill_ticks(pack, basic, &needs, None, 1.).unwrap();
    let fast = fill_ticks(pack, &better, &needs, None, 1.).unwrap();
    let expected = closed_form_ticks(
        0.,
        authored_rate(&better, NeedId::Hygiene),
        drain_of(pack, NeedId::Hygiene),
        pack.tuning.min_interaction_ticks,
    );
    assert_eq!(fast, expected);
    assert!(
        fast * 2 <= slow + 3 && fast * 2 + 3 >= slow,
        "{fast} against {slow}"
    );
}

#[test]
fn the_floor_applies_near_full_and_the_cap_applies_for_a_tiny_rate() {
    let pack = terri_data::pack();
    let floor = pack.tuning.min_interaction_ticks;
    let cap = pack.tuning.need_fill_max_ticks;
    let act = action(pack, "toilet");
    let mut nearly_full = Needs::all_at(50.);
    nearly_full.set(NeedId::Bladder, 99.9);
    assert_eq!(fill_ticks(pack, act, &nearly_full, None, 1.), Some(floor));
    let mut full = Needs::all_at(100.);
    full.set(NeedId::Hunger, 3.);
    assert_eq!(fill_ticks(pack, act, &full, None, 1.), Some(floor));

    // A rate just above the drain would need far more than the cap.
    let drain = drain_of(pack, NeedId::Bladder);
    let mut slow = Personality::neutral();
    slow.satisfaction[NeedId::Bladder.index()] =
        ((drain * 1.05) / authored_rate(act, NeedId::Bladder)) as f32;
    let mut empty = Needs::all_at(50.);
    empty.set(NeedId::Bladder, 0.);
    assert_eq!(
        fill_ticks(pack, act, &empty, Some(&slow), 1.),
        Some(cap),
        "a barely positive net rate stops at the limit"
    );
}

#[test]
fn a_net_rate_at_or_below_zero_leaves_the_drawn_length() {
    let pack = terri_data::pack();
    let act = action(pack, "toilet");
    let drain = drain_of(pack, NeedId::Bladder);
    let mut empty = Needs::all_at(50.);
    empty.set(NeedId::Bladder, 0.);
    let rate = authored_rate(act, NeedId::Bladder);
    for scale in [drain / rate, drain / rate * 0.5, 0.0] {
        let mut personality = Personality::neutral();
        personality.satisfaction[NeedId::Bladder.index()] = scale as f32;
        assert_eq!(
            fill_ticks(pack, act, &empty, Some(&personality), 1.),
            None,
            "{scale}"
        );
    }
}

#[test]
fn any_other_action_has_no_fill_length() {
    let pack = terri_data::pack();
    let mut needs = Needs::all_at(50.);
    needs.set(NeedId::Hygiene, 0.);
    for kind in ["sink", "kitchen_sink", "bed", "radio"] {
        assert_eq!(
            fill_ticks(pack, action(pack, kind), &needs, None, 1.),
            None,
            "{kind}"
        );
        // Forecasts use the authored length for them.
        assert_eq!(
            planned_ticks(pack, action(pack, kind), &needs, None),
            action(pack, kind).duration_ticks,
            "{kind}"
        );
    }
}

#[test]
fn a_full_use_ends_with_the_need_at_exactly_100() {
    for (kind, need) in FIXTURES {
        for start in [0.0, 37.5, 80.25] {
            let (mut sim, person, _) = about_to_use(kind, need, start);
            let pack = sim.world().resource::<Content>().0;
            // The harness starts the person standing at the fixture, so the
            // tick they arrive on drains them once before the use is planned.
            let at_arrival = (f64::from(start) - drain_of(pack, need)).max(0.);
            let expected = closed_form_ticks(
                at_arrival,
                authored_rate(action(pack, kind), need),
                drain_of(pack, need),
                pack.tuning.min_interaction_ticks,
            );
            let (ticks, needs) = run_to_the_end(&mut sim, person);
            assert_eq!(needs.get(need), 100., "{kind} from {start}");
            assert_eq!(ticks, expected, "{kind} from {start}");
        }
    }
}

/// The arrival tick delivers without a drain before it: its drain ran before
/// the person arrived. A person whose need would be filled one tick sooner
/// than the length with a drain on the arrival tick too is the one case the
/// two conventions give different lengths for, so the start is chosen to sit
/// just under a whole number of ticks, by half the extra tick's drain.
#[test]
fn the_arrival_tick_delivers_without_a_drain_before_it() {
    let pack = terri_data::pack();
    for (kind, need, extra) in [
        ("toilet", NeedId::Bladder, 12_u32),
        ("shower", NeedId::Hygiene, 20),
        ("bathtub", NeedId::Hygiene, 20),
    ] {
        let act = action(pack, kind);
        let rate = authored_rate(act, need);
        let drain = drain_of(pack, need);
        let net = rate - drain;
        // The level on arrival from which the use needs exactly `extra` more
        // ticks after the arrival tick, less half a tick of drain's worth.
        let on_arrival = 100. - rate - (f64::from(extra) - drain / net / 2.) * net;
        let mut arriving = Needs::all_at(50.);
        arriving.set(need, on_arrival as f32);
        assert_eq!(
            fill_ticks(pack, act, &arriving, None, 1.),
            Some(extra + 1),
            "{kind}: fill length from {on_arrival}"
        );
        // And in play: the person drains once on the arrival tick before the
        // use is planned, so they start a drain higher.
        let (mut sim, person, _) = about_to_use(kind, need, (on_arrival + drain) as f32);
        let (ticks, ended) = run_to_the_end(&mut sim, person);
        assert_eq!(ticks, extra + 1, "{kind}: played length");
        assert_eq!(ended.get(need), 100., "{kind}");
    }
}

/// Plays one use from an empty bar and checks the need is below 100 on the
/// tick before the use ended and exactly 100 on the tick it ended.
fn assert_full_exactly_when_it_ends(kind: &str, need: NeedId) {
    let (mut sim, person, _) = about_to_use(kind, need, 0.);
    let mut last = 0.;
    let mut started = false;
    for _ in 0..2000 {
        sim.tick();
        if sim.world().get::<Eating>(person).is_none() {
            assert!(started, "{kind}: the use never began");
            assert_eq!(
                sim.world().get::<Needs>(person).unwrap().get(need),
                100.,
                "{kind}"
            );
            assert!(last < 100., "{kind}: full a tick before it ended: {last}");
            return;
        }
        started = true;
        last = sim.world().get::<Needs>(person).unwrap().get(need);
    }
    panic!("{kind}: the use never ended");
}

#[test]
fn a_use_never_ends_one_tick_short_of_full() {
    for (kind, need) in FIXTURES {
        assert_full_exactly_when_it_ends(kind, need);
    }
}

#[test]
fn an_interrupted_shower_leaves_hygiene_partly_filled() {
    let (mut sim, person, _) = about_to_use("shower", NeedId::Hygiene, 12.5);
    let pack = sim.world().resource::<Content>().0;
    let rate = authored_rate(action(pack, "shower"), NeedId::Hygiene);
    let drain = drain_of(pack, NeedId::Hygiene);
    let other = sim.spawn_object(Position { x: 5.0, y: 5.0 }, pack.find("radio").unwrap());
    for _ in 0..10 {
        sim.tick();
    }
    assert!(sim.world().get::<Eating>(person).is_some());
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: person.index_u32(),
            object: other.index_u32(),
            interaction: 0,
        });
    sim.tick();
    assert!(
        sim.world().get::<Eating>(person).is_none(),
        "the order must end the shower"
    );
    let hygiene = f64::from(
        sim.world()
            .get::<Needs>(person)
            .unwrap()
            .get(NeedId::Hygiene),
    );
    // Ten ticks of the use deliver and drain; the eleventh tick takes the
    // order first and then drains once more, delivering nothing.
    let expected = 12.5 + 10. * rate - 11. * drain;
    assert!(
        hygiene > 12.5 && hygiene < 100.,
        "partly filled, read {hygiene}"
    );
    assert!(
        (hygiene - expected).abs() < 0.001,
        "read {hygiene}, expected {expected}"
    );
}

#[test]
fn the_duration_draw_is_still_taken_for_a_fill() {
    // One draw, always: a fill that skipped it would shift every later
    // random decision in every world that ever uses a bathroom.
    let (mut fills, person, _) = about_to_use("toilet", NeedId::Bladder, 30.);
    let (mut control, other, _) = about_to_use("toilet", NeedId::Bladder, 30.);
    let mut pack = control.world().resource::<Content>().0.clone();
    let model = pack.find("toilet").unwrap();
    pack.objects[model.0 as usize].interactions[0].activity = None;
    control
        .world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    fills.tick();
    control.tick();
    assert!(fills.world().get::<Eating>(person).is_some());
    assert!(control.world().get::<Eating>(other).is_some());
    assert_eq!(
        fills.world().resource::<SimRng>(),
        control.world().resource::<SimRng>(),
        "the fill took a different number of draws than the drawn length"
    );
}

#[test]
fn a_player_ordered_shower_fills_the_same_way() {
    let mut sim = Sim::new_with_lot(8, 8);
    let pack = sim.world().resource::<Content>().0;
    let shower = sim.spawn_object(Position { x: 2.0, y: 2.0 }, pack.find("shower").unwrap());
    let person = sim.spawn_agent(Position { x: 2.0, y: 6.0 }, 50.);
    sim.world_mut()
        .get_mut::<Needs>(person)
        .unwrap()
        .set(NeedId::Hygiene, 33.75);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: person.index_u32(),
            object: shower.index_u32(),
            interaction: 0,
        });
    let mut started = false;
    for _ in 0..600 {
        sim.tick();
        let eating = sim.world().get::<Eating>(person).is_some();
        if started && !eating {
            assert_eq!(
                sim.world()
                    .get::<Needs>(person)
                    .unwrap()
                    .get(NeedId::Hygiene),
                100.
            );
            return;
        }
        started |= eating;
    }
    panic!("the ordered shower never finished");
}

#[test]
fn other_effects_keep_their_per_minute_rates_during_a_fill() {
    let (mut sim, person, _) = about_to_use("shower", NeedId::Hygiene, 0.);
    let pack = sim.world().resource::<Content>().0;
    let act = action(pack, "shower");
    let (_, energy) = act
        .advertises
        .iter()
        .find(|(n, _)| usize::from(*n) == NeedId::Energy.index())
        .expect("a shower costs Energy");
    let per_tick = f64::from(*energy) / f64::from(act.duration_ticks);
    let drain = drain_of(pack, NeedId::Energy);
    let (ticks, needs) = run_to_the_end(&mut sim, person);
    // The cost arrives every tick of the use, in full, and Energy also
    // drains on every tick of it, the arrival tick's included.
    let expected = 50. + per_tick * f64::from(ticks) - drain * f64::from(ticks);
    assert!(per_tick < 0.);
    assert!(
        (f64::from(needs.get(NeedId::Energy)) - expected).abs() < 0.001,
        "read {}, expected {expected} over {ticks} ticks",
        needs.get(NeedId::Energy)
    );
}

#[test]
fn a_floor_bound_use_still_lasts_the_floor_and_stays_full() {
    for (kind, need) in FIXTURES {
        let (mut sim, person, _) = about_to_use(kind, need, 99.5);
        let floor = sim
            .world()
            .resource::<Content>()
            .0
            .tuning
            .min_interaction_ticks;
        let (ticks, needs) = run_to_the_end(&mut sim, person);
        assert_eq!(ticks, floor, "{kind}");
        assert_eq!(needs.get(need), 100., "{kind}");
    }
}

/// A use already running with a drawn length, as a game saved before the
/// change resumes it: the need fills at the new rate and the use ends on the
/// tick it is full, not at the old drawn length.
#[test]
fn a_use_resumed_from_a_save_with_a_long_drawn_length_ends_when_full() {
    let (mut sim, person, _) = about_to_use("shower", NeedId::Hygiene, 40.);
    let pack = sim.world().resource::<Content>().0;
    let model = pack.find("shower").unwrap();
    let floor = pack.tuning.min_interaction_ticks;
    sim.world_mut()
        .entity_mut(person)
        .remove::<Path>()
        .insert(Eating {
            object: model,
            interaction: 0,
            remaining_ticks: 120,
        });
    let (ticks, needs) = run_to_the_end(&mut sim, person);
    assert_eq!(needs.get(NeedId::Hygiene), 100.);
    assert!(ticks < 120 - floor, "ended after {ticks}, not when full");
}

#[test]
fn a_use_resumed_with_a_short_drawn_length_ends_partly_filled() {
    let (mut sim, person, _) = about_to_use("shower", NeedId::Hygiene, 20.);
    let pack = sim.world().resource::<Content>().0;
    let model = pack.find("shower").unwrap();
    sim.world_mut()
        .entity_mut(person)
        .remove::<Path>()
        .insert(Eating {
            object: model,
            interaction: 0,
            remaining_ticks: 5,
        });
    let (ticks, needs) = run_to_the_end(&mut sim, person);
    assert_eq!(ticks, 5);
    assert!(needs.get(NeedId::Hygiene) > 20. && needs.get(NeedId::Hygiene) < 100.);
}

#[test]
fn a_save_taken_mid_fill_continues_identically() {
    let (mut sim, person, _) = about_to_use("shower", NeedId::Hygiene, 7.5);
    for _ in 0..14 {
        sim.tick();
    }
    assert!(sim.world().get::<Eating>(person).is_some());
    let mut restored = Sim::new_with_lot(8, 8);
    restored
        .load_current_v6_view(sim.current_v6_view())
        .unwrap();
    for _ in 0..70 {
        sim.tick();
        restored.tick();
        assert_eq!(sim.world_hash(), restored.world_hash());
    }
    assert!(sim.world().get::<Eating>(person).is_none());
}

#[test]
fn a_forecast_plans_the_fill_length_for_a_fill_and_the_authored_length_otherwise() {
    let pack = terri_data::pack();
    let mut needs = Needs::all_at(50.);
    needs.set(NeedId::Bladder, 0.);
    needs.set(NeedId::Hygiene, 0.);
    let neutral = Personality::neutral();
    for (kind, need) in FIXTURES {
        let act = action(pack, kind);
        let after_walk = crate::systems::critical_choices::after_decay(pack, &needs, &neutral, 3);
        assert_eq!(
            super::fill::planned_ticks_after(pack, act, &needs, &neutral, 3),
            fill_ticks(pack, act, &after_walk, None, 1.).unwrap(),
            "{kind} planned from the needs the person arrives with"
        );
        assert_ne!(
            super::fill::planned_ticks_after(pack, act, &needs, &neutral, 0),
            act.duration_ticks,
            "{kind}: the authored length is not what a fill takes"
        );
        let _ = need;
    }
    for kind in ["sink", "kitchen_sink", "bed", "radio"] {
        let act = action(pack, kind);
        assert_eq!(
            super::fill::planned_ticks_after(pack, act, &needs, &neutral, 3),
            act.duration_ticks,
            "{kind}"
        );
    }
}

#[test]
fn the_forecast_of_a_fill_agrees_with_what_delivery_produces() {
    use crate::need_interactions::physical::{object_effects, ObjectContext};
    let pack = terri_data::pack();
    let neutral = Personality::neutral();
    for (kind, need) in FIXTURES {
        let act = action(pack, kind);
        for start in [0.0, 37.5] {
            let mut needs = Needs::all_at(50.);
            needs.set(need, start);
            let effects = object_effects(
                pack,
                act,
                &neutral,
                ObjectContext {
                    social_available: false,
                    shared: false,
                    seat_rate: 0.,
                    company: 1.,
                },
            );
            // One tick of travel: the tick the person arrives on drains them
            // before the use begins, as the harness below does.
            let forecast = crate::systems::critical_choices::object_outcome(
                pack, &needs, &neutral, act, effects, 1, false,
            );
            let (mut sim, person, _) = about_to_use(kind, need, start);
            let (ticks, end) = run_to_the_end(&mut sim, person);
            assert_eq!(
                forecast.completion_ticks,
                1 + ticks,
                "{kind} from {start}: forecast length"
            );
            // The forecast drains one tick more than play does, as every
            // forecast does, so each need may differ by at most one tick of
            // its own drain.
            for each in NeedId::ALL {
                let played = f64::from(end.get(each) - needs.get(each));
                let tolerance = drain_of(pack, each) + 0.001;
                assert!(
                    (f64::from(forecast.net_change[each.index()]) - played).abs() <= tolerance,
                    "{kind} from {start}, {each:?}: forecast {} against played {played}",
                    forecast.net_change[each.index()]
                );
            }
        }
    }
}

/// `select_action` builds its forecast of a shower through `object_outcome`,
/// so the forecast plans the fill length. A shower whose Hygiene rate is slow
/// (a fill of about 104 ticks against an authored 10) and whose Comfort rate
/// is just above Comfort's drain is the discriminating case: after a ten tile
/// walk, Comfort is net negative if the use is planned at the authored length
/// and net positive if it is planned at the fill length, so only the fill
/// length puts the fixture in Comfort's critical-relief group.
#[test]
fn the_decision_forecast_plans_a_shower_at_its_fill_length() {
    let mut sim = Sim::new_with_lot(16, 16);
    let mut pack = sim.world().resource::<Content>().0.clone();
    let shower = pack.find("shower").unwrap();
    {
        let action = &mut pack.objects[shower.0 as usize].interactions[0];
        action.advertises = vec![
            (NeedId::Hygiene.index() as u8, 10.),
            (NeedId::Comfort.index() as u8, 0.3),
        ];
        action.duration_ticks = 10;
    }
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    let object = sim.spawn_object(Position { x: 12., y: 2. }, shower);
    let person = sim.spawn_agent(Position { x: 2., y: 2. }, 100.);
    let mut needs = Needs::all_at(100.);
    needs.set(NeedId::Hygiene, 0.);
    needs.set(NeedId::Comfort, 15.);
    sim.world_mut().entity_mut(person).insert(needs);
    sim.tick();
    let decision = sim
        .world()
        .resource::<crate::systems::autonomy::DecisionTelemetry>()
        .0
        .iter()
        .find(|d| d.agent == person.index_u32())
        .expect("the person decided");
    let row = decision
        .choices
        .iter()
        .position(|c| c.0 == object.index_u32() && c.1 == 0)
        .expect("the shower is a candidate");
    assert_ne!(
        decision.relief_masks[row] & (1 << NeedId::Comfort.index()),
        0,
        "Comfort relief mask {:#b}: the forecast planned the authored length",
        decision.relief_masks[row]
    );
}

/// The chance each kind of object gets in `person`'s latest decision, summed
/// over its actions, from the decision telemetry.
fn decision_chances(sim: &mut Sim, person: Entity) -> std::collections::BTreeMap<String, f64> {
    let kinds: std::collections::BTreeMap<u32, String> = {
        let pack = sim.world().resource::<Content>().0;
        sim.world_mut()
            .query::<(Entity, &terri_core::SmartObject)>()
            .iter(sim.world())
            .map(|(entity, object)| (entity.index_u32(), pack.object(object.0).id.clone()))
            .collect()
    };
    let decision = sim
        .world()
        .resource::<crate::systems::autonomy::DecisionTelemetry>()
        .0
        .iter()
        .find(|d| d.agent == person.index_u32())
        .expect("the person decided")
        .clone();
    let mut chances = std::collections::BTreeMap::new();
    for choice in &decision.choices {
        if let Some(kind) = kinds.get(&choice.0) {
            *chances.entry(kind.clone()).or_insert(0.) += choice.4;
        }
    }
    chances
}

/// A raised shower rate raised the shower's ordinary score (it weighs the
/// authored delta over the authored duration), so a person who is nearly
/// out of Energy and merely dirty must still prefer sleep to a shower. The
/// critical-need policy keeps unrelated actions to a few percent of the
/// choice; this pins that the faster shower does not slip past it.
#[test]
fn a_person_with_critical_energy_and_low_hygiene_sleeps_rather_than_showers() {
    let (mut sim, bill, _casey) = crate::affinity::presence_and_use_tests::bill_and_casey();
    let mut needs = Needs::all_at(100.);
    needs.set(NeedId::Energy, 8.);
    needs.set(NeedId::Hygiene, 30.);
    sim.world_mut().entity_mut(bill).insert(needs);
    sim.tick();
    let chances = decision_chances(&mut sim, bill);
    let sleep = chances.get("bed").unwrap_or(&0.) + chances.get("double_bed").unwrap_or(&0.);
    let shower = *chances.get("shower").unwrap_or(&0.);
    assert!(
        sleep > 0.5 && shower < 0.1,
        "sleep {sleep}, shower {shower}: {chances:?}"
    );
}

/// The same for a person who is starving, dirty and gets little from
/// showers: they eat before they start a long shower.
#[test]
fn a_starving_dirty_person_who_gets_little_from_showers_eats_first() {
    let (mut sim, bill, _casey) = crate::affinity::presence_and_use_tests::bill_and_casey();
    let mut needs = Needs::all_at(100.);
    needs.set(NeedId::Hunger, 8.);
    needs.set(NeedId::Hygiene, 30.);
    let mut personality = sim
        .world()
        .get::<Personality>(bill)
        .cloned()
        .unwrap_or_else(Personality::neutral);
    personality.satisfaction[NeedId::Hygiene.index()] = 0.5;
    sim.world_mut()
        .entity_mut(bill)
        .insert((needs, personality));
    sim.tick();
    let chances = decision_chances(&mut sim, bill);
    let food: f64 = ["fridge", "dining_table", "stove", "counter"]
        .iter()
        .map(|kind| chances.get(*kind).unwrap_or(&0.))
        .sum();
    let shower = *chances.get("shower").unwrap_or(&0.);
    assert!(
        food > 0.5 && shower < 0.1,
        "food {food}, shower {shower}: {chances:?}"
    );
}

#[test]
fn only_the_new_pool_action_moves_the_published_content_fingerprint() {
    let shipped = terri_data::pack();
    assert_eq!(terri_data::content_fingerprint(shipped), 0x7229_9218_57a2_e3ae);

    // Keep the merged bathroom rates and fill tuning in the comparison.
    // Removing the one new action restores main's action table digest.
    let mut before_pool = shipped.clone();
    let pool = before_pool.find("pool").unwrap();
    let actions = &mut before_pool.objects[pool.0 as usize].interactions;
    assert_eq!(actions.iter().map(|action| action.id.as_str()).collect::<Vec<_>>(), ["hop_in"]);
    actions.clear();
    assert_eq!(terri_data::content_fingerprint(&before_pool), 0x5111_16ef_ac94_ae24);
}
