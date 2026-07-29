use bevy_ecs::prelude::*;
use terri_core::{NeedId, Needs};

use crate::Content;

/// Every need decays, each at the rate `content/tuning.toml` declares
/// for it.
///
/// The rates moved there from `needs.toml` at M1c, per [D-1]: a decay
/// rate is system BALANCE rather than part of a need's identity, and
/// every knob a designer tunes lives in one file. `needs.toml` still
/// declares which needs exist, and the compile step checks the two
/// files agree.
///
/// The rates used to be a `HUNGER_DECAY_PER_TICK` constant here as well
/// as rows in the content file: two copies of one number with nothing
/// asserting they agreed. The content file is now the only copy, and it
/// is the only place a rate can be changed.
///
/// The lookup is `decay_per_tick[id.index()]` rather than a fixed slot,
/// and the rates in content are pairwise distinct, so a need drained at
/// another need's rate is visible. `needs_decay_at_different_rates` is
/// what keeps that precondition true; see [L26] for the one-layer-down
/// version of the same trap, where a uniform fixture hid
/// `decay[id.index()]` becoming `decay[0]`.
pub fn decay_needs(content: Res<Content>, mut query: Query<&mut Needs>) {
    let rates = &content.0.decay_per_tick;
    for mut needs in &mut query {
        for id in NeedId::ALL {
            needs.drain(id, rates[id.index()]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Sim;
    use terri_core::{Agent, SimClock};

    /// Replaces `hunger_decays_at_the_rate_content_declares`, which
    /// asserted the OPPOSITE of this for the other six needs: that they
    /// hold at their spawn level, because only hunger had a rate applied.
    /// That assertion was correct and deliberate until Task 7, and it
    /// failed loudly here, which is what it was for.
    ///
    /// Everything it pinned is carried over below, over all seven needs
    /// instead of one: the rate read from content rather than restated as
    /// a literal, the vacuity guard against a zero rate, and the seam
    /// between the clock and the schedule.
    #[test]
    fn every_need_decays_at_its_content_rate() {
        const TICKS: usize = 100;

        let mut sim = Sim::new();
        let id = sim
            .world_mut()
            .spawn((Agent, Needs::all_at(terri_core::NEED_MAX)))
            .id();

        for _ in 0..TICKS {
            sim.tick();
        }

        let needs = *sim.world().get::<Needs>(id).unwrap();
        let rates = terri_data::pack().decay_per_tick;
        for need in NeedId::ALL {
            let rate = rates[need.index()];
            // Vacuity guard. At a rate of zero the expected level is the
            // spawn level, so the assertion below would be satisfied by a
            // need the simulation never touches - which is exactly the
            // regression this test exists to catch. Zero is legal content
            // ([L27]), so this is reachable by a TOML edit rather than
            // only by a bug.
            //
            // Measured, per testing-protocol rule 1 applied to the guard
            // and not only to the mechanism: set comfort's rate to 0.0 in
            // content/tuning.toml and it is THIS line that fails, with
            // "comfort decays at zero". The level assertion below stays
            // green, because 100.0 - 0.0 * 100 is where comfort already
            // sits.
            assert!(
                rate > 0.0,
                "{} decays at zero, so its assertion below proves nothing",
                need.as_str()
            );
            let expected = terri_core::NEED_MAX - rate * TICKS as f32;
            assert!(
                (needs.get(need) - expected).abs() < 0.001,
                "{} expected ~{expected}, got {}",
                need.as_str(),
                needs.get(need)
            );
        }

        // Covers the seam between the clock and the schedule. Inherited
        // from `hunger_decays_at_the_rate_content_declares`, which this
        // test replaces - but its stated reason has expired and is not
        // repeated here. That comment claimed dropping `advance_clock`
        // from `add_systems` would otherwise leave the whole workspace
        // green, which was true when it was written and stopped being
        // true once `world_hash` began hashing the tick.
        //
        // Measured: removing `advance_clock` fails this assertion AND
        // `world_hash_matches_its_golden_vector`. The reason to keep it
        // is what it says rather than whether it is alone - this one
        // reports `0` against `100` and names the clock, where the golden
        // vector reports two 64-bit digests and could mean any change to
        // anything the simulation computes.
        assert_eq!(
            sim.world().resource::<SimClock>().tick,
            TICKS as u64,
            "the schedule must advance the clock; decay ran but the tick \
             did not move"
        );
    }

    #[test]
    fn needs_decay_at_different_rates() {
        // A single shared rate applied to all seven would satisfy
        // `every_need_decays_at_its_content_rate` if the content happened
        // to declare one rate for every need, so pin that it does not.
        //
        // Stronger than "some rate differs from the first": the rates
        // must be PAIRWISE distinct. `decay_needs` maps a need onto a
        // slot, and a mapping that swaps two needs sharing a rate is
        // invisible to any test built on that content - the same trap
        // [L26] recorded one layer down, where `decay[id.index()]`
        // becoming `decay[0]` survived twelve tests because every fixture
        // gave all seven needs the same rate.
        //
        // If a future balance pass gives two needs the same rate this
        // fails, and that failure is correct: it is the moment
        // `every_need_decays_at_its_content_rate` quietly stops being
        // able to tell those two apart.
        //
        // Measured: setting energy's rate to hunger's 0.104 fails here
        // with "hunger and energy decay at the same rate", and leaves
        // `every_need_decays_at_its_content_rate` green - which is the
        // whole point of having this test as well as that one.
        let rates = terri_data::pack().decay_per_tick;
        for a in NeedId::ALL {
            for b in NeedId::ALL {
                if a != b {
                    assert_ne!(
                        rates[a.index()],
                        rates[b.index()],
                        "{} and {} decay at the same rate, so no test can \
                         tell their slots apart",
                        a.as_str(),
                        b.as_str()
                    );
                }
            }
        }
    }

    #[test]
    fn no_need_goes_negative() {
        // Was `hunger_never_goes_negative`, over hunger alone. Decay now
        // drains all seven, so the floor has to hold for all seven: a
        // clamp applied per need rather than to the whole array would
        // leave six of them running to -100 and below, which every
        // deficit, every score and both world-hash digests would then
        // read as a valid level.
        //
        // Every need starts at 1.0, so the slowest rate in content still
        // crosses zero long before the loop ends.
        //
        // The widening is load-bearing rather than tidiness, and it was
        // measured. Make `Needs::drain` clamp only hunger and write the
        // other six straight into the array: this test is the ONLY thing
        // in the workspace that fails, at `energy fell past the floor,
        // left: -68.0002`.
        //
        // Note where that failure lands. The loop reaches ENERGY, so
        // hunger's own assertion passed - and hunger's assertion is the
        // whole of what `hunger_never_goes_negative` used to check, so
        // the version this replaces was green under that mutation. So
        // were both world-hash golden vectors, because their 100-tick
        // scenario never drives a need below zero in the first place.
        // See [L31].
        let mut sim = Sim::new();
        let id = sim.world_mut().spawn((Agent, Needs::all_at(1.0))).id();

        for _ in 0..1000 {
            sim.tick();
        }

        let needs = *sim.world().get::<Needs>(id).unwrap();
        for need in NeedId::ALL {
            assert_eq!(
                needs.get(need),
                0.0,
                "{} fell past the floor",
                need.as_str()
            );
        }
    }
}
