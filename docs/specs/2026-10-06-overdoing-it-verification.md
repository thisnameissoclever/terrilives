# Overdoing it verification

Status: implementation evidence for `2026-10-06-overdoing-it.md`. Each table row names a guard that was deleted, the test that then failed, and the failing assertion, after which the source was restored byte for byte. The restore was proved by comparing `git hash-object` of the file before the deletion and after the restore.

## Guard deletions

| Guard | Test | Failing assertion | `git hash-object` before and after |
|---|---|---|---|
| The cap in `Habituation::bump` in `crates/terri-core/src/components.rs`, `(self.0[i].2 + amount).min(cap)`, replaced by `self.0[i].2 + amount` | `habituation_caps_at_the_tuned_maximum_and_keeps_its_keys_sorted` | `assertion left == right failed: must cap at the tuned maximum`, left `4.4000006`, right `3.0` | `e55b1789030c411f22daac3a1431ef5079d46546`, unchanged |
| The same cap | `the_cap_holds_and_delivery_ignores_repetition` | `snack 12: 3.0569942 is above the cap` | `e55b1789030c411f22daac3a1431ef5079d46546`, unchanged |
| The appeal clamp in `benefit_scale` in `crates/terri-sim/src/systems/advertise.rs`, `habituation.clamp(0.0, 1.0)`, replaced by `habituation` | `benefit_scale_clamps_repetition_above_one` | `assertion left == right failed`, left `0.17499995`, right `0.45`: `benefit_scale(1.5, 0.45)`, the test's first assertion, read below the floor instead of equal to `benefit_scale(1.0, 0.45)` | `7652cb51e350b421172f5ea4e149a766233979bf`, unchanged |
| The repetition meter clamp in `details_of` in `crates/terri-sim/src/details.rs`, `repetition: repetition.min(1.0)`, replaced by `repetition` | `repetition_above_one_reports_a_full_meter` | `assertion left == right failed`, left `2.0`, right `1.0` | `8c7a01469755381610b0c9e5b05dc15af86521d6`, unchanged |
| The load validator's upper bound for saved habituation in `crates/terri-sim/src/save.rs`, `pack.tuning.habituation_max`, replaced by `f32::MAX` | `habituation_above_the_tuned_maximum_refuses_the_load` | `assertion left == right failed`, left `Ok(())`, right `Err(InvalidValue)`: a value of 3.001 loaded | `9bfcc298c46bf2a4c16116f1095aee664aa81b56`, unchanged |
| The same upper bound | `habituation_and_disposition_entries_require_valid_unique_content_rows` | `assertion left == right failed: habituation above the tuned maximum`, left `Ok(())`, right `Err(InvalidValue)` | `9bfcc298c46bf2a4c16116f1095aee664aa81b56`, unchanged |
| The same upper bound, through the public save boundary | `overdone_habituation_loads_through_the_public_boundary` in `crates/terri-wasm/src/save_v3_tests.rs` | `assertion failed: !handle.load_bytes(&v5_bytes(&with_value(max + 0.001)))` | `9bfcc298c46bf2a4c16116f1095aee664aa81b56`, unchanged |
| The cap passed on the single-interaction completion path in `tick_interactions` in `crates/terri-sim/src/systems/interact.rs`, `let cap = content.0.tuning.habituation_max;`, replaced by `let cap = 1.0;` | `repeated_single_interactions_pass_one_and_stop_at_the_tuned_cap` | `watch 5 must charge habituation: 0.9989 then 0.9989`: the telly's habituation stopped one tick's decay below 1 | `ef101dcca8fbe870a2e246797010a27a33bb7a1a`, unchanged |
| The overdoing threshold's strictness in `overdoing_moodlets` in `crates/terri-sim/src/mood.rs`, `value > tuning.overdoing_threshold`, replaced by `value >= tuning.overdoing_threshold` | `exactly_at_the_threshold_is_not_overdoing` | `assertion left == right failed: a value exactly at the threshold is not overdoing`, left `[Moodlet { label: "Overdoing Watch TV", score: -0.0 }]`, right `[]` | `0aca63a6b32c3acac6f23d8abbfe7ba5f42ee319`, unchanged |
| The food gate in `overdoing_moodlets`, `value >= tuning.sick_threshold && is_food(pack, object, row)`, replaced by `value >= tuning.sick_threshold` | `feeling_sick_appears_once_per_person_and_only_for_food` | `assertion left == right failed: an activity that does not feed never makes anyone sick`: Watch TV at the cap added `Feeling sick` | `0aca63a6b32c3acac6f23d8abbfe7ba5f42ee319`, unchanged |
| The positive-delta test in `is_food`, `NeedId::Hunger.index() && delta > 0.0`, replaced by `NeedId::Hunger.index()` | `feeling_sick_appears_once_per_person_and_only_for_food` | `a row that costs hunger does not feed` | `0aca63a6b32c3acac6f23d8abbfe7ba5f42ee319`, unchanged |
| The sick threshold's inclusiveness in `overdoing_moodlets`, `value >= tuning.sick_threshold`, replaced by `value > tuning.sick_threshold` | `feeling_sick_appears_once_per_person_and_only_for_food` | `assertion left == right failed: two food rows at the threshold make one person sick once`: `Feeling sick` missing at exactly 2.5 | `0aca63a6b32c3acac6f23d8abbfe7ba5f42ee319`, unchanged |
| The once-per-person rule in `overdoing_moodlets`: the single `Feeling sick` after the loop replaced by one pushed for each qualifying food row | `feeling_sick_appears_once_per_person_and_only_for_food` | `assertion left == right failed: two food rows at the threshold make one person sick once`, left `["Overdoing Grab a snack", "Feeling sick", "Overdoing Cook dinner", "Feeling sick"]` | `0aca63a6b32c3acac6f23d8abbfe7ba5f42ee319`, unchanged |
| The append position in `derive_mood`, `moodlets.extend(overdoing_moodlets(pack, habituation))` after the `Dirty dishes` block, moved before it | `new_moodlets_come_after_every_existing_one_in_habituation_order` | `assertion left == right failed: the new moodlets come last, in habituation order, then Feeling sick`, left `[]` | `0aca63a6b32c3acac6f23d8abbfe7ba5f42ee319`, unchanged |
| The range in `overdoing_score`, `/ (tuning.habituation_max - tuning.overdoing_threshold)`, replaced by `/ tuning.habituation_max` | `overdoing_score_grows_linearly_to_the_penalty_at_the_cap` | `assertion left == right failed`, left `-3.3333333`, right `-5.0` | `0aca63a6b32c3acac6f23d8abbfe7ba5f42ee319`, unchanged |

## Public save boundary

`overdone_habituation_loads_through_the_public_boundary` in `crates/terri-wasm/src/save_v3_tests.rs` builds a V5 save whose first household member holds a fridge `Grab a snack` habituation row. Through `SimHandle::load_bytes`, a value of 2.0 loads, the restored snapshot equals the one written, and `save_bytes` returns the same bytes. Values of 3.001 (just above `habituation_max`) and 3.5 are refused, and `save_bytes` and the world hash are unchanged after each refusal. The test passes in a debug build and with `cargo test -p terri-wasm --release overdone_habituation`.

## Played snack counts

`repeated_snacks_make_a_person_sick_and_decay_heals_them` in `crates/terri-sim/src/mood.rs` orders Tim to grab a snack again each time the previous snack chain ends. Because the simulation is deterministic, it pins the counts exactly: `Overdoing Grab a snack` first appears after the fourth snack and `Feeling sick` after the tenth.

## Displayed browser

Commit checked: the game code of `c8224d85` on `twcl/acclimation`. The bundle `assets/index-JMIc4X4Z.js` was built with `npm run build` after `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, and served with `npx vite preview --port 4173 --strictPort` from `web/` at `https://localhost:4173/`. The working tree also held this task's uncommitted test and documentation edits, which do not change the built game.

The in-app browser pane loaded the game but did not run frames continuously while it was hidden: `requestAnimationFrame` delivered no frames over two seconds, and the clock advanced only when a screenshot was taken. The check therefore used the Playwright plugin's Chromium (Chrome 154 on Windows, with `navigator.gpu` present) at a 1280 by 800 viewport, which ran about 57 frames a second. Sound was muted before the game loaded by setting `terrilives.audio-preferences.v1` to `{"version":1,"muted":true,"effectsLevel":0,"voicesLevel":0}` and reloading; the Options flyout showed `Sound: off`. The first-run Help was already dismissed in that browser profile.

That profile held another session's saved household. Its save file was copied to a backup in the same browser storage, `New game` then `Start over` gave the shipped lot, and after the check the original save was written back byte for byte (3488 bytes, same checksum) and the backup removed.

Casey, whose Sim details show no career, was selected and Sim details was opened on Overview. Snacks were ordered one at a time from the fridge's action menu (`Grab a snack`), each as soon as the previous snack chain ended, at 3x speed. Readings from the Overview mood list after each snack:

| Snack | Game time | `Overdoing Grab a snack` | `Feeling sick` |
|---|---|---|---|
| 1 to 3 | Day 1, 03:35 to 06:22 | absent | absent |
| 4 | Day 1, 08:11 | -0.6 | absent |
| 5 | Day 1, 09:33 | -3.1 | absent |
| 6 | Day 1, 11:33 | -5.1 | absent |
| 7 | Day 1, 12:52 | -4.3 | absent |
| 8 | Day 1, 14:40 | -9.9 | absent |
| 9 | Day 1, 16:37 | -12 | absent |
| 10 | Day 1, 18:02 | -14.5 | absent |
| 11 | Day 1, 19:53 | -16.6 | -25 |

The penalty fell after snack 7, so that snack most likely ended without completing: no use was added while decay continued. The run did not record why it ended. In the browser `Feeling sick` arrived after the eleventh snack rather than the tenth, because each order waited for the previous chain to end and Casey walked between the fridge and the counter; the deterministic test above orders without that delay. Both rows sat last in the list, after `Dirty dishes`, with their signed scores, and the overall mood read `Miserable`.

1. [Desktop, 1280 by 800](../assets/review-evidence/overdoing/desktop-mood.png): the game paused at Day 1, 19:55 with Sim details open on Overview; the mood list shows `Overdoing Grab a snack` at -16.6 and `Feeling sick` at -25.
2. [Phone, 375 by 812](../assets/review-evidence/overdoing/phone-mood.png): the same state after closing and reopening Sim details; both rows are visible without scrolling. The document's scroll width equalled its 375-pixel client width, and no element extended past the right edge.

Console: 89 entries, all periodic frame-timing logs except one error, the 404 for `favicon.ico`. No warnings.

Cleanup: the Playwright page was closed, the in-app pane's only tab was closed, the preview server was stopped, and `Get-NetTCPConnection -LocalPort 4173 -State Listen` then returned nothing.

Not checked: decay clearing both moodlets in the browser (the deterministic test covers it); a physical phone; the phone check used a resized desktop viewport without a mobile user agent or touch input; light and dark theme variants of the panel.

One existing behaviour was observed and is recorded rather than changed here. With Queue mode on, eleven `Grab a snack` orders queued while paused were consumed within about ten game minutes of unpausing, and only one snack chain was seen running. The likely cause is in `serve_intents` in `crates/terri-sim/src/systems/action.rs`: a chain order is removed from the queue when its chain begins, so the next queued snack becomes the front order and is served at once, replacing the running chain. This branch does not touch that file, so queued snack orders cannot be used to overdo snacking until it is fixed.

## Delivery

The implementation and this record are on branch `twcl/acclimation`. Push, merge and deployment are recorded separately in the delivery report.
