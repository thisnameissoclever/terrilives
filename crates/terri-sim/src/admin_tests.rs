//! The admin session and Undo (issue 312, [AP-undo] and [AP-tests-sim]
//! items 2, 5, 6, 7 and 8 in `docs/specs/2026-11-20-admin-panel.md`).
//!
//! The real edits are later tasks, so these tests use the stub edits of
//! `admin::tests_stub`: `AdjustFunds` adds to the funds and
//! `SetSatisfaction` sets a person's life satisfaction, both hashed.
use crate::admin::{
    tests_stub::FAILS_POST_CONDITION, AdminApplyRefusal, AdminOpenError, AdminRefusal,
    AdminSession, AdminUndoError,
};
use crate::build_transaction::BuildCommitError;
use crate::Sim;
use terri_core::admin::{AdminChange, AdminEdit};
use terri_core::{Agent, CommandQueue, Funds, Satisfaction, SimClock, SimId};

fn change(edits: Vec<AdminEdit>) -> AdminChange {
    AdminChange { edits }
}

fn funds(cents: i64) -> AdminChange {
    change(vec![AdminEdit::AdjustFunds { cents }])
}

fn satisfaction(sim: u32, value: f32) -> AdminChange {
    change(vec![AdminEdit::SetSatisfaction { sim, value }])
}

/// Every living person's SimId, ascending.
fn people(sim: &mut Sim) -> Vec<u32> {
    let mut ids: Vec<u32> = sim
        .world_mut()
        .query::<(&Agent, &SimId)>()
        .iter(sim.world())
        .map(|(_, id)| id.0)
        .collect();
    ids.sort_unstable();
    ids
}

fn satisfaction_of(sim: &mut Sim, id: u32) -> f32 {
    sim.world_mut()
        .query::<(&SimId, &Satisfaction)>()
        .iter(sim.world())
        .find(|(sim_id, _)| sim_id.0 == id)
        .map(|(_, satisfaction)| satisfaction.value())
        .expect("a living person")
}

fn cents(sim: &Sim) -> i64 {
    sim.world().resource::<Funds>().0
}

fn opened() -> Sim {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_admin().expect("the shipped lot opens the panel");
    sim
}

/// [AP-tests-sim] item 7: no game time passes while the session is open, and
/// it passes again once the session ends.
#[test]
fn tick_advances_no_clock_while_a_session_is_open() {
    let mut sim = opened();
    let tick = sim.world().resource::<SimClock>().tick;
    let hash = sim.world_hash();
    for _ in 0..30 {
        sim.tick();
    }
    assert_eq!(sim.world().resource::<SimClock>().tick, tick);
    assert_eq!(sim.world_hash(), hash, "nothing ran under the baseline");
    sim.end_admin();
    sim.tick();
    assert_eq!(sim.world().resource::<SimClock>().tick, tick + 1);
}

/// [AP-tests-sim] item 7: Build refuses to open during a session and the
/// session refuses to open during Build; neither opens twice.
#[test]
fn build_mode_and_the_admin_session_refuse_each_other() {
    let mut sim = opened();
    assert_eq!(sim.begin_build(), Err(BuildCommitError::AdminActive));
    assert!(!sim.build_active());
    assert_eq!(sim.begin_admin(), Err(AdminOpenError::AlreadyOpen));
    sim.end_admin();
    assert!(!sim.admin_active());
    sim.begin_build().unwrap();
    assert_eq!(sim.begin_admin(), Err(AdminOpenError::BuildActive));
    assert!(!sim.admin_active());
    sim.end_build().unwrap();
    assert_eq!(sim.begin_admin(), Ok(()));
}

/// [AP-tests-sim] item 7: with no session an edit is refused as
/// `NoSession` and nothing changes.
#[test]
fn an_edit_with_no_session_is_refused() {
    let mut sim = Sim::new_from_shipped_lot();
    let hash = sim.world_hash();
    assert_eq!(
        sim.admin_apply(funds(100)),
        Err(AdminApplyRefusal {
            edit: 0,
            reason: AdminRefusal::NoSession
        })
    );
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.admin_undo(), Err(AdminUndoError::NotOpen));
    let mut sim = opened();
    sim.end_admin();
    assert_eq!(
        sim.admin_apply(funds(100))
            .map_err(|refusal| refusal.reason),
        Err(AdminRefusal::NoSession)
    );
}

/// A malformed change is refused at admission and never staged.
#[test]
fn a_malformed_change_is_refused_before_it_is_staged() {
    let mut sim = opened();
    let hash = sim.world_hash();
    assert_eq!(
        sim.admin_apply(change(Vec::new())),
        Err(AdminApplyRefusal {
            edit: 0,
            reason: AdminRefusal::Malformed
        })
    );
    assert_eq!(
        sim.admin_apply(change(vec![
            AdminEdit::AdjustFunds { cents: 1 },
            AdminEdit::AdjustFunds { cents: 2 },
        ])),
        Err(AdminApplyRefusal {
            edit: 1,
            reason: AdminRefusal::Malformed
        })
    );
    assert_eq!(
        sim.admin_apply(satisfaction(0, f32::NAN)),
        Err(AdminApplyRefusal {
            edit: 0,
            reason: AdminRefusal::OutOfRange
        })
    );
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.admin_undo_depth(), 0);
    assert!(sim.world().resource::<CommandQueue>().is_empty());
}

/// [AP-tests-sim] item 2: a change whose third edit is refused changes
/// nothing, and the refusal names that edit.
#[test]
fn a_change_with_a_refused_edit_changes_nothing() {
    let mut sim = opened();
    let first = people(&mut sim)[0];
    let before = satisfaction_of(&mut sim, first);
    let money = cents(&sim);
    let hash = sim.world_hash();
    assert_eq!(
        sim.admin_apply(change(vec![
            AdminEdit::SetSatisfaction {
                sim: first,
                value: 3.0
            },
            AdminEdit::AdjustFunds { cents: 500 },
            AdminEdit::SetSatisfaction {
                sim: 99_999,
                value: 4.0
            },
        ])),
        Err(AdminApplyRefusal {
            edit: 2,
            reason: AdminRefusal::NotAPerson
        })
    );
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(satisfaction_of(&mut sim, first), before);
    assert_eq!(cents(&sim), money);
    assert_eq!(sim.admin_undo_depth(), 0);
    // The same change without the bad edit applies, as one journal entry.
    assert_eq!(
        sim.admin_apply(change(vec![
            AdminEdit::SetSatisfaction {
                sim: first,
                value: 3.0
            },
            AdminEdit::AdjustFunds { cents: 500 },
        ])),
        Ok(1)
    );
    assert_eq!(satisfaction_of(&mut sim, first), 3.0);
    assert_eq!(cents(&sim), money + 500);
}

/// The twenty changes of the Undo sequence: funds adjustments and
/// satisfaction settings across every person, some in one change together.
fn sequence(people: &[u32]) -> Vec<AdminChange> {
    (0..20u32)
        .map(|step| {
            let person = people[step as usize % people.len()];
            match step % 3 {
                0 => funds(i64::from(step) * 1_000 - 7_000),
                1 => satisfaction(person, (step * 4) as f32 + 0.5),
                _ => change(vec![
                    AdminEdit::SetSatisfaction {
                        sim: person,
                        value: 100.0 - step as f32,
                    },
                    AdminEdit::AdjustFunds {
                        cents: -i64::from(step),
                    },
                ]),
            }
        })
        .collect()
}

/// [AP-tests-sim] item 5 with the stub edits: twenty changes, then twenty
/// Undos. After each Undo the world hashes as it did before the undone
/// change, the funds and every satisfaction read as they did, and the last
/// Undo leaves the baseline. The rebuilt world then plays on exactly as one
/// that never opened the panel.
#[test]
fn undo_steps_back_through_every_change_exactly() {
    let mut sim = opened();
    let mut twin = opened();
    twin.end_admin();
    let ids = people(&mut sim);
    let read = |sim: &mut Sim| {
        let satisfactions: Vec<u32> = ids
            .iter()
            .map(|id| satisfaction_of(sim, *id).to_bits())
            .collect();
        (sim.world_hash(), cents(sim), satisfactions)
    };
    let baseline = read(&mut sim);
    let mut before = Vec::new();
    for (step, change) in sequence(&ids).into_iter().enumerate() {
        before.push(read(&mut sim));
        assert_eq!(sim.admin_apply(change), Ok(step + 1));
        assert!(sim.world().resource::<CommandQueue>().is_empty());
        assert_ne!(
            read(&mut sim).0,
            before[step].0,
            "step {step} moved the hash"
        );
    }
    while let Some(expected) = before.pop() {
        assert_eq!(sim.admin_undo(), Ok(()));
        assert_eq!(sim.admin_undo_depth(), before.len());
        assert_eq!(read(&mut sim), expected, "undo to depth {}", before.len());
    }
    assert_eq!(read(&mut sim), baseline);
    assert_eq!(sim.admin_undo(), Err(AdminUndoError::NothingToUndo));
    assert!(sim.admin_active(), "Undo keeps the session open");
    sim.end_admin();
    for tick in 0..240 {
        sim.tick();
        twin.tick();
        assert_eq!(sim.world_hash(), twin.world_hash(), "tick {tick}");
    }
}

/// Undo then a new change: the journal continues from the undone depth, and
/// a later Undo takes back only the new change.
#[test]
fn a_change_after_undo_replaces_the_undone_one() {
    let mut sim = opened();
    let start = cents(&sim);
    assert_eq!(sim.admin_apply(funds(100)), Ok(1));
    assert_eq!(sim.admin_apply(funds(200)), Ok(2));
    sim.admin_undo().unwrap();
    assert_eq!(cents(&sim), start + 100);
    assert_eq!(sim.admin_apply(funds(5)), Ok(2));
    assert_eq!(cents(&sim), start + 105);
    sim.admin_undo().unwrap();
    assert_eq!(cents(&sim), start + 100);
    sim.admin_undo().unwrap();
    assert_eq!(cents(&sim), start);
}

/// [AP-tests-sim] item 6: with one journal entry's recorded hash corrupted,
/// Undo reports the mismatch at that entry and the live world and journal
/// are unchanged. A corrupted baseline hash is caught before any replay.
#[test]
fn undo_detects_a_bad_replay_and_keeps_the_live_world() {
    let mut sim = opened();
    let first = people(&mut sim)[0];
    sim.admin_apply(funds(100)).unwrap();
    sim.admin_apply(satisfaction(first, 7.0)).unwrap();
    sim.admin_apply(funds(-30)).unwrap();
    let hash = sim.world_hash();
    let money = cents(&sim);
    sim.world_mut().resource_mut::<AdminSession>().journal[1].hash_after ^= 1;
    assert_eq!(
        sim.admin_undo(),
        Err(AdminUndoError::Mismatch { entry: Some(1) })
    );
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(cents(&sim), money);
    assert_eq!(satisfaction_of(&mut sim, first), 7.0);
    assert_eq!(sim.admin_undo_depth(), 3);
    // With the recorded hash put back, the same Undo works.
    sim.world_mut().resource_mut::<AdminSession>().journal[1].hash_after ^= 1;
    assert_eq!(sim.admin_undo(), Ok(()));
    assert_eq!(cents(&sim), money + 30);
}

/// The baseline's own hash is checked before anything is replayed.
#[test]
fn undo_checks_the_restored_baseline_first() {
    let mut sim = opened();
    sim.admin_apply(funds(100)).unwrap();
    let hash = sim.world_hash();
    crate::admin::tests_stub::corrupt_baseline_hash(sim.world_mut());
    assert_eq!(
        sim.admin_undo(),
        Err(AdminUndoError::Mismatch { entry: None })
    );
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.admin_undo_depth(), 1);
}

/// [AP-cmd-drain] item 4: a change that fails its post-condition is taken
/// back by rebuilding the last good world, reported as `WouldNotLoad`, and
/// not journaled.
#[test]
fn a_change_that_fails_its_post_condition_is_taken_back() {
    let mut sim = opened();
    sim.admin_apply(funds(100)).unwrap();
    let hash = sim.world_hash();
    let money = cents(&sim);
    assert_eq!(
        sim.admin_apply(funds(FAILS_POST_CONDITION)),
        Err(AdminApplyRefusal {
            edit: 0,
            reason: AdminRefusal::WouldNotLoad
        })
    );
    assert_eq!(cents(&sim), money);
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.admin_undo_depth(), 1);
    sim.admin_undo().unwrap();
    assert_eq!(cents(&sim), money - 100);
}

/// [AP-tests-sim] item 8: a save taken mid-session holds the edits applied
/// so far and no session. It reloads as an ordinary game with the panel
/// closed and continues tick for tick with the live world once that world
/// closes its panel, for one game day.
#[test]
fn a_save_taken_mid_session_holds_the_edits_and_no_session() {
    let mut sim = opened();
    let first = people(&mut sim)[0];
    sim.admin_apply(funds(123_456)).unwrap();
    sim.admin_apply(satisfaction(first, 91.25)).unwrap();
    let snapshot = sim
        .try_save_snapshot_v28()
        .expect("nothing admin is queued");
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v28(snapshot).expect("the save loads");
    assert!(!loaded.admin_active());
    assert_eq!(loaded.admin_undo_depth(), 0);
    assert_eq!(cents(&loaded), cents(&sim));
    assert_eq!(satisfaction_of(&mut loaded, first), 91.25);
    assert_eq!(loaded.world_hash(), sim.world_hash());
    sim.end_admin();
    for tick in 0..1440 {
        sim.tick();
        loaded.tick();
        assert_eq!(sim.world_hash(), loaded.world_hash(), "tick {tick}");
    }
}

/// The shipped lot played on until maintenance has work to do on a paused
/// frame: someone holds a seat and a social episode is in progress. Then the
/// panel opens.
fn busy_world() -> Sim {
    let mut sim = Sim::new_from_shipped_lot();
    let busy = |sim: &mut Sim| {
        let seated = sim
            .world_mut()
            .query::<&crate::seating::PhysicalClaim>()
            .iter(sim.world())
            .next()
            .is_some();
        let episodes = sim
            .world()
            .resource::<crate::social_episode::SocialEpisodes>();
        let social = !episodes.executions.is_empty() || !episodes.rendezvous.is_empty();
        seated && social
    };
    let mut ticks = 0;
    while !busy(&mut sim) {
        assert!(ticks < 3 * 1_440, "the lot gets busy within three days");
        sim.tick();
        ticks += 1;
    }
    sim.begin_admin().expect("the busy lot opens the panel");
    sim
}

/// Two living people neither at work nor commuting, for a fight.
fn free_pair(sim: &mut Sim) -> (u32, u32) {
    let free: Vec<u32> = people(sim)
        .into_iter()
        .filter(|id| {
            let entity = crate::edit::living_entity(sim.world(), *id).expect("living");
            sim.world().get::<terri_core::AtWork>(entity).is_none()
                && sim.world().get::<terri_core::Commuting>(entity).is_none()
        })
        .collect();
    assert!(free.len() >= 2, "two people are home: {free:?}");
    (free[0], free[1])
}

/// Undo in real play: many paused frames, each one `flush_commands`, run
/// between admin changes, on a world where the paused maintenance passes
/// have work (people seated, a social episode in progress, a fight queued).
/// After each Undo the world hashes as it did just before the undone change,
/// so neither the frames between changes nor the replay part the rebuilt
/// world from the live one, and the fully undone world plays on as one that
/// changed nothing.
#[test]
fn undo_is_exact_across_paused_frames_between_changes() {
    let mut sim = busy_world();
    let (a, b) = free_pair(&mut sim);
    let mut before = vec![sim.world_hash()];
    let changes = [
        change(vec![AdminEdit::StartFight { from: a, to: b }]),
        funds(4_200),
        satisfaction(b, 12.5),
    ];
    let last = changes.len() - 1;
    for (step, change) in changes.into_iter().enumerate() {
        assert_eq!(sim.admin_apply(change), Ok(step + 1), "change {step}");
        let applied = sim.world_hash();
        // Several frames between changes, and one after the last.
        let frames = if step == last { 1 } else { 6 };
        for frame in 0..frames {
            sim.flush_commands();
            assert_eq!(
                sim.world_hash(),
                applied,
                "change {step}: paused frame {frame} leaves the world as the change did"
            );
        }
        before.push(sim.world_hash());
    }
    before.pop();
    while let Some(expected) = before.pop() {
        assert_eq!(sim.admin_undo(), Ok(()), "undo to depth {}", before.len());
        assert_eq!(sim.admin_undo_depth(), before.len());
        assert_eq!(
            sim.world_hash(),
            expected,
            "undo to depth {} hashes as the world before the undone change",
            before.len()
        );
        sim.flush_commands();
        assert_eq!(sim.world_hash(), expected, "a paused frame after Undo");
    }
    // Back at the baseline, the world plays on as one that opened the panel
    // and changed nothing, so nothing unhashed parted them either.
    let mut twin = busy_world();
    twin.end_admin();
    sim.end_admin();
    for tick in 0..240 {
        sim.tick();
        twin.tick();
        assert_eq!(sim.world_hash(), twin.world_hash(), "tick {tick}");
    }
}

/// A change that fails its post-condition when even the rebuild of the last
/// good world fails (the baseline's recorded hash is made wrong, the test
/// hook a restore that was not exact stands for) breaks the session loudly:
/// the edits the post-condition rejected stay in the live world, so every
/// later edit, Undo and save is refused while the panel stays open, and a
/// save stays refused after it closes, since the world would not load. The
/// panel cannot open on that world again.
#[test]
fn a_failed_rebuild_breaks_the_session_and_refuses_edits_undo_and_saves() {
    let mut sim = opened();
    sim.admin_apply(funds(100)).unwrap();
    assert!(!sim.admin_broken());
    crate::admin::tests_stub::corrupt_baseline_hash(sim.world_mut());
    let would_not_load = Err(AdminApplyRefusal {
        edit: 0,
        reason: AdminRefusal::WouldNotLoad,
    });
    assert_eq!(sim.admin_apply(funds(FAILS_POST_CONDITION)), would_not_load);
    assert!(sim.admin_broken(), "a failed rebuild breaks the session");
    let hash = sim.world_hash();
    let money = cents(&sim);
    assert_eq!(
        sim.admin_apply(funds(5)),
        would_not_load,
        "edits are refused"
    );
    assert_eq!(
        sim.admin_undo(),
        Err(AdminUndoError::Broken),
        "Undo is refused"
    );
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(cents(&sim), money);
    assert_eq!(
        sim.try_save_snapshot_v28().err(),
        Some(crate::SaveError::AdminSessionBroken),
        "no save is written while the panel is open"
    );
    sim.end_admin();
    assert_eq!(
        sim.try_save_snapshot_v28().err(),
        Some(crate::SaveError::AdminSessionBroken),
        "nor once it closes, since the world would not load"
    );
    assert!(
        sim.begin_admin().is_err(),
        "the panel cannot open again on it"
    );
}

/// A broken world blocks saving until a load replaces it, so Build refuses
/// to open on it too: ending or cancelling Build installs a restored world
/// that would drop the mark and let a save through.
#[test]
fn build_mode_refuses_to_open_on_a_broken_world() {
    let mut sim = opened();
    sim.admin_apply(funds(100)).unwrap();
    crate::admin::tests_stub::corrupt_baseline_hash(sim.world_mut());
    assert!(sim.admin_apply(funds(FAILS_POST_CONDITION)).is_err());
    assert!(sim.admin_broken());
    // Open session: the existing refusal stands.
    assert_eq!(sim.begin_build(), Err(BuildCommitError::AdminActive));
    sim.end_admin();
    let hash = sim.world_hash();
    assert_eq!(
        sim.begin_build(),
        Err(BuildCommitError::AdminBroken),
        "the session is closed but the world is still broken"
    );
    assert!(!sim.build_active(), "Build did not open");
    assert_eq!(sim.world_hash(), hash, "a refusal changes nothing");
    assert!(sim.admin_broken(), "the mark is still there");
    assert_eq!(
        sim.try_save_snapshot_v28().err(),
        Some(crate::SaveError::AdminSessionBroken),
        "saving stays refused until a load replaces the world"
    );
}

/// The drain reports every admin change it drains, and `admin_apply` reads
/// that report only when its sequence moved. A drain that left no new
/// result (the test hook applies the edit and reports nothing) is a refusal
/// that changed nothing: the last good world is put back and nothing is
/// journaled, rather than the previous change's result being read as this
/// one's.
#[test]
fn a_change_with_no_new_result_is_a_refusal_that_changes_nothing() {
    let mut sim = opened();
    // With no result at all yet, and then with an earlier one to mistake.
    for depth in [0, 1] {
        if depth == 1 {
            sim.admin_apply(funds(100)).unwrap();
        }
        let hash = sim.world_hash();
        let money = cents(&sim);
        let last = crate::admin::last_result(sim.world());
        assert_eq!(
            sim.admin_apply(funds(crate::admin::tests_stub::REPORTS_NOTHING)),
            Err(AdminApplyRefusal {
                edit: 0,
                reason: AdminRefusal::WouldNotLoad
            }),
            "depth {depth}"
        );
        assert_eq!(crate::admin::last_result(sim.world()), last);
        assert_eq!(sim.world_hash(), hash, "depth {depth}");
        assert_eq!(cents(&sim), money, "depth {depth}");
        assert_eq!(sim.admin_undo_depth(), depth);
        assert!(!sim.admin_broken());
    }
}
