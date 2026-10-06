# Overdoing it verification

Status: implementation evidence for `2026-10-06-overdoing-it.md`. Each table row names a guard that was deleted, the test that then failed, and the failing assertion, after which the source was restored byte for byte. The restore was proved by comparing `git hash-object` of the file before the deletion and after the restore.

## Guard deletions

| Guard | Test | Failing assertion | `git hash-object` before and after |
|---|---|---|---|
| The cap in `Habituation::bump` in `crates/terri-core/src/components.rs`, `(self.0[i].2 + amount).min(cap)`, replaced by `self.0[i].2 + amount` | `habituation_caps_at_the_tuned_maximum_and_keeps_its_keys_sorted` | `assertion left == right failed: must cap at the tuned maximum`, left `4.4000006`, right `3.0` | `e55b1789030c411f22daac3a1431ef5079d46546`, unchanged |
| The same cap | `the_cap_holds_and_delivery_ignores_repetition` | `snack 12: 3.0569942 is above the cap` | `e55b1789030c411f22daac3a1431ef5079d46546`, unchanged |
| The appeal clamp in `benefit_scale` in `crates/terri-sim/src/systems/advertise.rs`, `habituation.clamp(0.0, 1.0)`, replaced by `habituation` | `benefit_scale_clamps_repetition_above_one` | `assertion left == right failed`, left `0.17499995`, right `0.45`: a repetition of 1.5 read below the floor | `7652cb51e350b421172f5ea4e149a766233979bf`, unchanged |
| The repetition meter clamp in `details_of` in `crates/terri-sim/src/details.rs`, `repetition: repetition.min(1.0)`, replaced by `repetition` | `repetition_above_one_reports_a_full_meter` | `assertion left == right failed`, left `2.0`, right `1.0` | `8c7a01469755381610b0c9e5b05dc15af86521d6`, unchanged |
| The load validator's upper bound for saved habituation in `crates/terri-sim/src/save.rs`, `pack.tuning.habituation_max`, replaced by `f32::MAX` | `habituation_above_the_tuned_maximum_refuses_the_load` | `assertion left == right failed`, left `Ok(())`, right `Err(InvalidValue)`: a value of 3.001 loaded | `9bfcc298c46bf2a4c16116f1095aee664aa81b56`, unchanged |
| The same upper bound | `habituation_and_disposition_entries_require_valid_unique_content_rows` | `assertion left == right failed: habituation above the tuned maximum`, left `Ok(())`, right `Err(InvalidValue)` | `9bfcc298c46bf2a4c16116f1095aee664aa81b56`, unchanged |
| The same upper bound, through the public save boundary | `overdone_habituation_loads_through_the_public_boundary` in `crates/terri-wasm/src/save_v3_tests.rs` | `assertion failed: !handle.load_bytes(&v5_bytes(&with_value(max + 0.001)))` | `9bfcc298c46bf2a4c16116f1095aee664aa81b56`, unchanged |
