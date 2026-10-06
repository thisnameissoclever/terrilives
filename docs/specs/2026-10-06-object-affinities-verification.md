# Object affinities verification

Status: implementation evidence for `2026-10-06-object-affinities.md` on branch `twcl/object-affinities`. Each guard-deletion row names a guard that was deleted or changed, the test that then failed, and the failing assertion, after which the source was restored byte for byte. The restore was proved by comparing `git hash-object` of the file before the change and after the restore; each row's hash identifies the exact file it was run against.

## Contents

- [Evidence map](#evidence-map)
- [Compiler](#compiler)
- [Values, save and hash](#values-save-and-hash)
- [Trait values and later edits](#trait-values-and-later-edits)
- [Mood and bother](#mood-and-bother)
- [Mutation run on the affinity module](#mutation-run-on-the-affinity-module)
- [Existing tests that moved](#existing-tests-that-moved)
- [Boundary and HUD tests](#boundary-and-hud-tests)
- [Displayed browser](#displayed-browser)
- [Delivery](#delivery)

## Evidence map

| [OA-evidence] item | Where it is proved |
|---|---|
| 1. Compile | [Compiler](#compiler); the golden pack bytes grew only by appended fields, recorded in the bodies of commits `ba8759d6`, `7cca654c` and the final fix wave's tuning commit |
| 2. Values | [Values, save and hash](#values-save-and-hash) for the spawn draw, the twin worlds and Bill's 0.8; [Trait values and later edits](#trait-values-and-later-edits) for the four-way trait rule and for a trait added or removed later through Edit Sims |
| 3. Save | [Values, save and hash](#values-save-and-hash) |
| 4. Mood | [Mood and bother](#mood-and-bother) |
| 5. Use | [Mood and bother](#mood-and-bother) |
| 6. Boundary and HUD | [Boundary and HUD tests](#boundary-and-hud-tests) and [Displayed browser](#displayed-browser) |
| 7. Existing tests | [Existing tests that moved](#existing-tests-that-moved); `cargo test --workspace` passed at every commit on the branch, and the trace example ran with exit 0 at `9bda8d20` |

## Compiler

Recorded on commit `ba8759d6`. The tests were written after the implementation, so each check was broken in place in `crates/terri-data/src/compile.rs`, `cargo test -p terri-data --lib -- affinit` was run, and the file was restored from a byte snapshot whose SHA-256 digest matched before and after.

| Mutation | Test that failed |
|---|---|
| Duplicate kind check disabled | `rejects_bad_affinity_kinds` |
| Blank id or label check disabled | `rejects_bad_affinity_kinds` |
| `smell` accepted as a presence reach | `rejects_bad_affinity_kinds` |
| Shared object check disabled | `rejects_bad_affinity_kinds` |
| Claimed object never recorded | `rejects_bad_affinity_kinds` |
| Empty object list check disabled | `rejects_bad_affinity_kinds` |
| `use` kind without interactions accepted | `rejects_bad_affinity_kinds` |
| Unknown trait tag accepted | `rejects_bad_affinity_kinds` |
| Sort of each kind's object indices removed | `compiles_affinity_kinds_in_file_order_with_object_indices` |
| `check_affinity_tuning` call removed | `rejects_affinity_tuning_out_of_range` |
| `affinity_from_trait <= 1.0` changed to `<= 2.0` | `rejects_affinity_tuning_out_of_range` |
| Threshold `< 1.0` changed to `<= 1.0` | `rejects_affinity_tuning_out_of_range` |

## Values, save and hash

Recorded before commit `e51a7991`. The trait override, the hash block and the decoder count named in the plan are rows 1, 8 and 11.

| Guard | File | Mutation | Test | Failing assertion | Before | After |
|---|---|---|---|---|---|---|
| Trait override | `crates/terri-sim/src/affinity.rs` | the tagged arm returns `drawn` | `a_trait_overrides_the_value_but_not_the_draw_count` | `affinity.rs:176`, `["television_devotee"]`, left -0.59979916, right 0.8 | 0b2730750e257166fce54e0aee58342bd8d2d1bc | 0b2730750e257166fce54e0aee58342bd8d2d1bc |
| Seed-once path | `crates/terri-sim/src/save/affinities.rs` | `restore(None)` returns without `seed_everyone` | `a_save_without_the_field_draws_once_in_entity_order_from_the_saved_generator` | `affinities_tests.rs:161`, left `[(34, None), (35, None), (36, None)]`, right the three drawn rows | 5a1026c7e23dcefb06d99ebdbdb106f80284302a | 5a1026c7e23dcefb06d99ebdbdb106f80284302a |
| Seed sorts by entity index | `crates/terri-sim/src/save/affinities.rs` | sort deleted | `the_seed_sorts_reordered_storage_before_drawing` | `affinities_tests.rs:242`, left `[0.1598401, 0.018624306, 0.8014362, -0.9780706]`, right `[-0.3529495, 0.5220926, -0.38813293, -0.7406806]` | 5a1026c7e23dcefb06d99ebdbdb106f80284302a | 5a1026c7e23dcefb06d99ebdbdb106f80284302a |
| Instincts migrate before the seed | `crates/terri-sim/src/save/affinities.rs` | `self_preservation::migrate` call deleted | `a_save_without_instincts_or_affinities_draws_the_instincts_first` | `affinities_tests.rs:204`, left `[(34, 51), (35, 47), (36, 54)]`, right `[(34, 61), (35, 53), (36, 36)]` | 5a1026c7e23dcefb06d99ebdbdb106f80284302a | 5a1026c7e23dcefb06d99ebdbdb106f80284302a |
| Ordering validation | `crates/terri-sim/src/save/affinities.rs` | `windows(2)` check never fires | `invalid_rows_refuse_the_load_without_touching_the_live_world` | `affinities_tests.rs:354`, rows `[(36, "plants", 0.5), (34, "plants", 0.5)]`, left `Ok(())`, right `Err(InvalidValue)` | 5a1026c7e23dcefb06d99ebdbdb106f80284302a | 5a1026c7e23dcefb06d99ebdbdb106f80284302a |
| Range refusal | `crates/terri-sim/src/save/affinities.rs` | `(-1.0..=1.0).contains` deleted | `invalid_rows_refuse_the_load_without_touching_the_live_world` | `affinities_tests.rs:354`, rows `[(34, "plants", 1.5)]`, left `Ok(())`, right `Err(InvalidValue)` | 5a1026c7e23dcefb06d99ebdbdb106f80284302a | 5a1026c7e23dcefb06d99ebdbdb106f80284302a |
| Zero-row refusal | `crates/terri-sim/src/save/affinities.rs` | `value != 0.0` deleted | `invalid_rows_refuse_the_load_without_touching_the_live_world` | `affinities_tests.rs:354`, rows `[(34, "plants", 0.0)]`, left `Ok(())`, right `Err(InvalidValue)` | 5a1026c7e23dcefb06d99ebdbdb106f80284302a | 5a1026c7e23dcefb06d99ebdbdb106f80284302a |
| Hash block | `crates/terri-sim/src/lib.rs` | block guarded by `if false &&` | `the_hash_sees_an_affinity_value_and_its_owner` | `lib.rs:5289`, `a value`, left and right both 15226196462055106400 | 276d14a498117f9c9edaaf34d2669710d5d5bb6f | 276d14a498117f9c9edaaf34d2669710d5d5bb6f |
| Hash reads only non-zero values | `crates/terri-sim/src/affinity.rs` | zero filter in `hash_rows` deleted | `a_world_with_no_affinity_values_hashes_as_before` | `lib.rs:5254`, `all zeros hashes as none`, left 8767833260480357810, right 15226196462055106400 | 0b2730750e257166fce54e0aee58342bd8d2d1bc | 0b2730750e257166fce54e0aee58342bd8d2d1bc |
| Spawn draw | `crates/terri-sim/src/household.rs` | draw taken from a clone of the generator | `spawn_member_draws_affinities_right_after_the_instinct` | `household_tests.rs:703`, generator left state 4386294410950687285, right 7946971071676559169 | 8d7e5aa1be1e40e09d3765ade7ae9da833f3885c | 8d7e5aa1be1e40e09d3765ade7ae9da833f3885c |
| Decoder count | `crates/terri-wasm/src/lib.rs` | `APPENDED_LISTS = 14` | `decode_pads_the_affinities_list` | `save_v3_tests.rs:1647`, `a payload without any appended field decodes` | e597b04103e40644130d6cb7b77da6582771cbf9 | e597b04103e40644130d6cb7b77da6582771cbf9 |
| Decoder invented-field check | `crates/terri-wasm/src/lib.rs` | `affinities.is_some()` removed from `invented` | `decode_pads_the_affinities_list` | `save_v3_tests.rs:1611`, `a pre-affinity save` (the shifted array refuses the stripped payload) | e597b04103e40644130d6cb7b77da6582771cbf9 | e597b04103e40644130d6cb7b77da6582771cbf9 |
| Decoder sleeping-places boundary | `crates/terri-wasm/src/lib.rs` | `pad <= 4` restored | `v5_required_tail_rejects_every_truncation_and_trailing_data` | `save_v3_tests.rs:865`, `a save written before shyness existed must still load` | e597b04103e40644130d6cb7b77da6582771cbf9 | e597b04103e40644130d6cb7b77da6582771cbf9 |

The tests behind these rows also cover what no guard row isolates. `the_shipped_household_draws_affinities_in_entity_order_after_each_instinct` shows the shipped household draws in entity order, that Bill holds 0.8 for television, that nobody else holds exactly 0.8 for it, and that two worlds from one seed agree in values and hash. `a_current_save_round_trips_affinity_rows_exactly` round-trips the rows. `a_save_without_the_field_draws_once_in_entity_order_from_the_saved_generator` loads a save written before this slice, checks that a second load of the same bytes seeds identically, and checks that the next save draws nothing more. `every_older_envelope_draws_affinities_after_the_instincts` covers save versions 1 to 4. `a_world_with_no_affinity_values_hashes_as_before` builds the shipped household with every value at 0.0 and again without the component and asserts equal hashes, then sets one value and asserts the hash moves.

## Trait values and later edits

A worn disposition trait with a kind's trait tag sets that kind's value by its score multiplier: 0.8 for one that loves, 0.4 for one that likes, -0.4 for one that dislikes and -0.8 for one that hates. `a_trait_overrides_the_value_but_not_the_draw_count` in `crates/terri-sim/src/affinity.rs` checks each band edge, the f32 on either side of 1, and Fish watcher's 0.4 for the aquarium, and that the generator ends in the same state in every case. `the_shipped_household_draws_affinities_in_entity_order_after_each_instinct` checks that Bill holds 0.8 for television and 0.4 for the aquarium.

`a_trait_edit_leaves_the_stored_affinity_values_alone` in `crates/terri-sim/src/edit_tests.rs` moves in a newcomer wearing Hates television, whose television value is then -0.8, and applies two edits through the real Edit Sims command: Tim gains Television devotee and the newcomer loses Hates television. Both edits are accepted and both trait lists change, and both people's stored values are exactly what they were, after the edit and thirty ticks later.

| Guard | File | Mutation | Test | Failing assertion | Before and after |
|---|---|---|---|---|---|
| Edit path leaves values alone | `crates/terri-sim/src/edit.rs` | the edit also inserts a fresh `affinity::draw` from the new trait list | `a_trait_edit_leaves_the_stored_affinity_values_alone` | `edit_tests.rs:2124`, `Tim after the edit`, left `[0.57429683, -0.831455, 0.8, 0.2950046]`, right `[-0.5451999, 0.07803571, 0.5654713, 0.2073077]` | 2ce18b9c35df27c43070ddcd8f147a9fd6842456, unchanged |
| Mild value for a trait that likes | `crates/terri-sim/src/affinity.rs` | the `score_multiplier > 1.0` arm deleted | `a_trait_overrides_the_value_but_not_the_draw_count` | `affinity.rs:485`, `multiplier 1.4999999`, left -0.59979916, right 0.4 | 258ee94833d47960d8fabfa6f4240e6da3406d10, unchanged |
| Mild value for a trait that dislikes | `crates/terri-sim/src/affinity.rs` | the `score_multiplier < 1.0` arm deleted | `a_trait_overrides_the_value_but_not_the_draw_count` | `affinity.rs:485`, `multiplier 0.99999994`, left -0.59979916, right -0.4 | 258ee94833d47960d8fabfa6f4240e6da3406d10, unchanged |
| Aquarium trait tag | `content/objects.toml` | `trait_tag = "aquarium"` deleted | `the_shipped_household_draws_affinities_in_entity_order_after_each_instinct` | `household_tests.rs:766`, `Fish watcher likes, mildly`, left -0.79253554, right 0.4 | 8ccccff3f04d6b1b5c2126ed4993063e9e7141e1, unchanged |
| Likes band range check | `crates/terri-data/src/compile.rs` | the `affinity_band_likes` rule replaced by `true` | `rejects_affinity_tuning_out_of_range` | `compile.rs:9375`, `affinity_band_likes`, left `AffinityTuningOutOfRange { key: "affinity_band_loves" }`, right `{ key: "affinity_band_likes" }` | 7339bd7ea72de0ce37ed0d802184c7b9e53d7649, unchanged |
| Loves band above likes | `crates/terri-data/src/compile.rs` | `affinity_band_loves > affinity_band_likes &&` deleted | `rejects_affinity_tuning_out_of_range` | `compile.rs:9373`, `unwrap_err()` on an `Ok` value: the pack compiled with `affinity_band_loves: -inf` | 7339bd7ea72de0ce37ed0d802184c7b9e53d7649, unchanged |
| Mild value below the strong one | `crates/terri-data/src/compile.rs` | `&& affinity_from_mild_trait < affinity_from_trait` deleted | `rejects_affinity_tuning_out_of_range` | `compile.rs:9373`, `unwrap_err()` on an `Ok` value: the pack compiled with `affinity_from_mild_trait: inf` | 7339bd7ea72de0ce37ed0d802184c7b9e53d7649, unchanged |

## Mood and bother

The rows below ran on `crates/terri-sim/src/affinity.rs` with each test run alone (`--exact`), and every run exited 101. The threshold gate, the extra cap, the self-use exclusion and the room check named in the plan are the first six rows.

Recorded before commit `9bda8d20`; blob `0d4dcda3ff49c0ee7d020f32162b41f72d1576d6` before and after every row.

| Guard | Mutation | Test | Failing assertion |
|---|---|---|---|
| Presence threshold gate | delete `if value.abs() < tuning.affinity_presence_threshold { return None; }` | `presence_scores_one_plant_and_caps_the_extras` | `affinity_tests.rs:142`: left `[("Likes the plants here", 1.99999)]`, right `[]` |
| Use threshold gate | delete `.filter(\|&(_, value)\| value <= -threshold)` | `a_lover_gets_nothing_from_another_watcher_and_a_walker_bothers_nobody` | `affinity_tests.rs:670`: left `[("Bothered by Casey using the television", -2.999985)]`, right `[]` |
| Extra cap | `(count - 1).min(cap)` becomes `(count - 1)` | `presence_scores_one_plant_and_caps_the_extras` | `affinity_tests.rs:155`, "a fifth plant is past the cap": left 22.0, right 19.0 |
| Self-use exclusion | delete `.filter(\|&person\| person != subject)` | `a_hater_is_not_bothered_by_their_own_use` | `affinity_tests.rs:486`, "his own use": left `[("Bothered by Bill using the television", -15.0)]`, right `[]` |
| Room check, presence | delete `if tile_room(&rooms, position) != Some(room) { continue; }` | `presence_counts_only_the_room_the_person_stands_in` | `affinity_tests.rs:178`: left `[("Likes the plants here", 13.0), ("Likes the aquarium here", 10.0)]`, right `[("Likes the plants here", 10.0)]` |
| Room check, use | delete `.filter(\|&person\| room_of(world, person, rooms) == Some(room))` | `a_watcher_in_another_room_bothers_nobody` | `affinity_tests.rs:608`, "the kitchen side of the doorway": left `[("Bothered by Casey using the television", -15.0)]`, right `[]` |
| Bother's bump | delete `feelings.bump(responsible, requested);` | `a_hater_is_bothered_by_another_watcher_and_their_feeling_falls` | `affinity_tests.rs:451`: `(effect.actual - effect.requested).abs() < 1e-6` failed |
| Walker check | delete `if world.get::<Path>(person).is_some() { return None; }` | `a_lover_gets_nothing_from_another_watcher_and_a_walker_bothers_nobody` | `affinity_tests.rs:662`, "en route": left `[("Bothered by Casey using the television", -15.0)]`, right `[]` |
| At-work exclusion | delete `if world.get::<AtWork>(person).is_some() { return None; }` | `presence_counts_only_the_room_the_person_stands_in` | `affinity_tests.rs:215`, "at work": left `[("Likes the plants here", 10.0)]`, right `[]` |

Recorded before commit `574f0235`; blob `61fe0059ee9391a023d314f5453b15f34189a7b5` before and after every row.

| Guard | Mutation | Test | Failing assertion |
|---|---|---|---|
| Use match, object and row | `\|\|` becomes `&&` in `using_kind` | `a_running_interaction_that_differs_from_the_target_is_not_use` | `affinity_tests.rs:762`, "the target is another object on the same row": left `[("Bothered by Casey using the television", -15.0)]`, right `[]` |
| Zero is not a like | `Some(Ordering::Greater)` becomes `Some(Ordering::Greater \| Ordering::Equal)` | `a_zero_value_reads_nothing_under_a_zero_threshold` | `affinity_tests.rs:779`, "plants 0.0": left `[("Likes the plants here", 0.0)]`, right `[]` |
| Zero is not a dislike | `Some(Ordering::Less)` becomes `Some(Ordering::Less \| Ordering::Equal)` | `a_zero_value_reads_nothing_under_a_zero_threshold` | `affinity_tests.rs:779`, "plants 0.0": left `[("Bothered by the plants here", 0.0)]`, right `[]` |
| Use zero gate | delete `value < 0.0 &&` | `a_zero_value_reads_nothing_under_a_zero_threshold` | `affinity_tests.rs:793`, "television 0.0": left `[("Bothered by Casey using the television", 0.0)]`, right `[]` |
| Zero request skip | delete `if requested == 0.0 { continue; }` | `a_zero_feeling_rate_changes_and_records_nothing` | `affinity_tests.rs:823`: left 1, right 0 (one zero effect recorded) |
| Unnamed user skip | restore the `Somebody` fallback | `a_user_without_a_name_gives_no_moodlet` | `affinity_tests.rs:834`: left `[("Bothered by Somebody using the television", -15.0)]`, right `[]` |

The figures in [OA-evidence] items 4 and 5 are asserted directly. `presence_scores_one_plant_and_caps_the_extras` reads +10 and -10 at 1.0 and -1.0 beside one plant, nothing at 0.1, and 13, 16 and 19 as plants are added, with 19 again for a fifth. `presence_counts_only_the_room_the_person_stands_in` reads nothing in the yard and nothing for a person at work. `affinity_moodlets_come_after_feeling_sick` places the new rows after `Feeling sick`. `a_hater_is_bothered_by_another_watcher_and_their_feeling_falls` reads -15 and a fall of 0.03 in feeling over a 60-tick hour, with one Nuisance effect per tick. `a_lover_gets_nothing_from_another_watcher_and_a_walker_bothers_nobody` shows that a person walking to the television bothers nobody and that a person at 1.0 reads nothing.

Two people cannot use the television at once in play, because every interaction except sleep admits one user at a time. The second-watcher case in `a_hater_is_not_bothered_by_their_own_use` is therefore built by setting components by hand; the reachable form, a television watcher bothered by a housemate on the radio, is played for real in the same test.

## Mutation run on the affinity module

Recorded on commit `574f0235`, with cargo-mutants 27.1.0:

`cargo mutants --package terri-sim --file crates/terri-sim/src/affinity.rs --test-workspace true --timeout-multiplier 4 --minimum-test-timeout 120 --build-timeout 600 -j 3`

These are the CI flags with a file filter in place of the shard. The run exited 0 and tested 97 mutants in 38 minutes: 94 caught, 0 missed, 0 timed out and 3 unviable. The three unviable mutants replace the return value of `presence_moodlets`, `nuisances` and `use_moodlets` with `vec![Default::default()]`, which does not compile because `Moodlet` and the nuisance type have no `Default`.

## Existing tests that moved

Each spawned person now takes four more draws from the world generator, and a save without the field draws values on load. These pins moved, each with the reason in its commit body.

- `household::tests::self_preservation_seed_precedes_household_draws_and_legacy_move_in` and `self_preservation_override_preserves_zero_and_refuses_invalid_before_draws`: the expected generator also takes the affinity draws.
- `mood::tests::repeated_snacks_make_a_person_sick_and_decay_heals_them`: the first sick snack moved from the tenth to the eleventh, because snack chains have drawn lengths.
- `save::tests::every_tick_of_a_played_stretch_produces_a_loadable_save`: the shipped seed's 2000-tick run no longer walks over to talk, so the fixture uses seed 2, which reaches both coverage arms. Every assertion is unchanged.
- `domestic::tests::toilet_completion_survives_suspended_meal_and_cleanup_including_save_load`: a housemate now finishes a toilet visit of their own during the meal run. Only a completion by a housemate who stood at the toilet on the tick before while the actor did not is counted separately, and the test asserts that count exactly: one in the meal run, zero in the cleanup run.
- The legacy-load helpers in `crates/terri-sim/src/save.rs` and `crates/terri-wasm/src/lib.rs`, renamed `after_legacy_load_draws`, and the wasm save tests that compare a legacy load with its saved generator now include the affinity draws.
- `web/tests/aquarium.test.ts`: the released save's next save keeps every loaded byte except the generator, and its hash moved from 13907076554945442085 to 11804688860418536815, measured natively in debug and release. It moved again, to 4526374402505414594, when the aquarium kind took the trait tag `aquarium`, so Bill's Fish watcher sets 0.4 in place of a drawn value; with the tag removed the release wasm reproduces 11804688860418536815.
- `web/tests/skills-panel.test.ts`: the Skills markup is now followed by `<details id="affinities-block">` rather than the end of the Overview section; the Likes and dislikes test asserts the rest of that markup and its place after Skills.

The bare-agent golden scenario `world_hash_matches_its_golden_vector` and its web copy did not move.

## Boundary and HUD tests

The wasm boundary tests are in `crates/terri-wasm/src/affinity_boundary_tests.rs` and ran in both the debug and the release profile (`cargo test -p terri-wasm --release affinity_boundary`). The word for each value is chosen in Rust by `affinity::band` from `affinity_band_loves` and `affinity_band_likes` in `content/tuning.toml`, and crosses the boundary as a word; the web code keeps no edges.

| Test | What it proves |
|---|---|
| `band_words` (`crates/terri-sim/src/affinity_tests.rs`) | At the shipped edges, 1.0, 0.6, 0.59, 0.2, 0.19, 0.0, -0.19, -0.2, -0.59, -0.6 and -1.0 read Loves, Loves, Likes, Likes, Indifferent, Indifferent, Indifferent, Dislikes, Dislikes, Hates and Hates. With the edges retuned to 0.75 and 0.375, the words move with them. |
| `affinity_labels_follow_pack_order` | `affinity_labels` is `["plants", "aquarium", "television", "radio"]`, equal to the pack's labels in order. With the content swapped for a pack whose labels differ from the ids, it returns the new labels, so the read is the label a player sees and not the id a save names. |
| `affinity_words_of_words_each_persons_stored_values_in_kind_order` | For Tim, Bill and Casey, `Sim::affinities_of` equals the stored `Affinities` component and `affinity_words_of` gives the band of each stored value, four words. Bill holds 0.4 (Likes) for the aquarium and 0.8 (Loves) for television. The reads leave the save bytes and the world hash unchanged. A replaced component `[-1.0, 0.25, 0.0, 0.6]` reads Hates, Likes, Indifferent, Loves, and with the edges retuned to 0.75 and 0.5 the same values read Hates, Indifferent, Indifferent, Likes. |
| `affinity_words_of_rejects_non_people_in_release` | Tim reads four words, then dies of hunger through the mortality setting. Index 0 (a placed object), `u32::MAX` and Tim's retired index read `[]` words and no values, Bill still reads four words, and the reads leave the save bytes and the world hash unchanged. |

The web tests are in `web/tests/affinities-panel.test.ts` and `web/tests/bridge.test.ts`.

| Test | What it proves |
|---|---|
| `affinitiesPanelState` | Unselected without asking the bridge; ready with four rows in kind order, each label capitalised (`Plants`) and the word the bridge gave; unavailable for no reading, an empty reading, a reading shorter or longer than the labels, and an empty label list. The panel's source holds no edges and no `band` function. |
| `AffinitiesPanel` | Reads nothing while closed, throttles reads while open, forces a fresh read when asked, and refuses a refresh interval of 0, -1, NaN or infinity. |
| `createAffinitiesPanelSurface` | Shows `Select a person to see their likes and dislikes.` and then `Likes and dislikes unavailable`, with `data-state` on the block; draws `Plants: Loves`, `Aquarium: Likes`, `Television: Indifferent` and `Radio: Hates` as four `li.affinity-row` items; reuses rows and writes no unchanged text across refreshes; removes the rows once nobody is selected. |
| The disclosure in the page | `#affinities-block`, `#affinities-empty` and `#affinity-list` each appear once in `index.html` and are requested by `main.ts`; the block ships closed directly after Skills inside Overview; `main.ts` refreshes it on opening, at start, after Load and after an edit, and on visible frames. |
| The bridge read | Copies a reading of the five words; returns null without calling the module for an index of -1, 0.5, NaN, infinity or 2^32; returns null for an empty reading or one holding any other word, including a lower-case `likes` or an empty string. |
| `reads each person's likes and dislikes through release wasm without changing saves` (`bridge.test.ts`) | Through the release wasm artifact, the labels are the four kinds, every person reads four words equal to the handle's, Bill reads Likes for the aquarium and Loves for television, an object and the indices -1, 1.5, NaN, 2^32 and `0xffffffff` read null, and the save bytes and the world hash are unchanged. |

The memory proof in `scripts/audio-browser-proof.cjs` now also requires `#affinities-block` to be closed when it checks the deselected HUD, as it already did for Skills, and `web/tests/audio-memory-report.test.js` covers that case.

### Guard deletions for the boundary and HUD

Recorded on the working tree of the final fix wave's commit. The `band_words` rows ran `cargo test -p terri-sim -- --exact`; the other Rust rows ran `cargo test -p terri-wasm --release -- --exact` on the named test; each web row ran `npx vitest run tests/affinities-panel.test.ts -t` with the named test's title.

| Guard | Mutation | Test | Failing assertion | Before and after |
|---|---|---|---|---|
| Loves edge read from tuning (`crates/terri-sim/src/affinity.rs`) | `value >= tuning.affinity_band_loves` becomes `value >= 0.6` | `band_words` | `affinity_tests.rs:877`, `retuned 0.7`, left `"Loves"`, right `"Likes"` | 258ee94833d47960d8fabfa6f4240e6da3406d10, unchanged |
| Likes edge read from tuning | `value >= tuning.affinity_band_likes` becomes `value >= 0.2` | `band_words` | `affinity_tests.rs:877`, `retuned 0.37`, left `"Likes"`, right `"Indifferent"` | 258ee94833d47960d8fabfa6f4240e6da3406d10, unchanged |
| Word from the stored value in `Sim::affinity_words_of` (`crates/terri-sim/src/lib.rs`) | `band(value, tuning)` becomes `band(-value, tuning)` | `affinity_words_of_words_each_persons_stored_values_in_kind_order` | `affinity_boundary_tests.rs:98`, `Tim`, left `["Likes", "Indifferent", "Dislikes", "Dislikes"]`, right `["Dislikes", "Indifferent", "Likes", "Likes"]` | 093c379d5e8b3cb741fa4d3c1832ea86e30d1263, unchanged |
| Person filter in `Sim::affinities_of` | `&terri_core::Agent` becomes `Option<&terri_core::Agent>` in the query | `affinity_words_of_rejects_non_people_in_release` | `affinity_boundary_tests.rs:183`, message `0`: the placed object at index 0 read four words | 093c379d5e8b3cb741fa4d3c1832ea86e30d1263, unchanged |
| Label, not id, in `Sim::affinity_labels` | `kind.label` becomes `kind.id` | `affinity_labels_follow_pack_order` | `affinity_boundary_tests.rs:64`, left `["plants", "aquarium", "television", "radio"]`, right `["plants label", "aquarium label", "television label", "radio label"]` | 093c379d5e8b3cb741fa4d3c1832ea86e30d1263, unchanged |
| Word check in `SimBridge.affinityWordsOf` (`web/src/bridge.ts`) | `!words.every(isAffinityWord)` deleted | `rejects an empty reading and one holding any other word` | `["Likes","Adores","Likes","Likes"]`: expected the reading to be null | c072494133656739503be022aab0e6770b0cc268, unchanged |
| Entity check in `SimBridge.affinityWordsOf` | `if (!isU32(entityIndex)) return null;` deleted | `rejects invalid entity -1 before calling WASM`, and the same for 0.5, NaN, infinity and 4294967296 | expected `['Likes', 'Likes', 'Likes', 'Likes']` to be null, in all five cases | c072494133656739503be022aab0e6770b0cc268, unchanged |
| Length match in `affinitiesPanelState` (`web/src/ui/affinities-panel.ts`) | `words.length !== labels.length` deleted | `is unavailable without a reading, with an empty one, or with one that does not match the labels` | `["Likes","Likes","Likes"]`: expected a ready state to deeply equal `{ kind: 'unavailable' }` | 4d18f0452c2f1733b176efe7ebd37e34b8e71099, unchanged |
| Capitalised row label | `rowLabel` returns the label unchanged | `gives one row per kind in order, the label capitalised and the word from the bridge`, `draws one row per kind reading label and word` | the rows read `plants` where `Plants` was expected | 4d18f0452c2f1733b176efe7ebd37e34b8e71099, unchanged |

## Displayed browser

Code checked: the working tree of `twcl/object-affinities` on top of `574f0235`, before the Task 4 commit. That page chose each word in TypeScript with the edges 0.6 and 0.2, which `content/tuning.toml` now holds and the simulation applies; the screenshots were not retaken after the word moved into the simulation and the aquarium took its trait tag, and the release-wasm bridge test covers the word read. The bundle `assets/index-Dfx1iJg6.js` was built with `npm run build` from the wasm package built by `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, and served with `npm run preview -- --port 4173 --strictPort` from `web/` at `https://localhost:4173/`. Nothing else was listening on 4173 or 5174 before the server started.

The check used the Playwright plugin's Chromium, which ran about 57 frames a second by the page's own frame-timing log. Before the game page opened, `terrilives.audio-preferences.v1` already held `{"version":1,"muted":true,"effectsLevel":0,"voicesLevel":0}`; the page was first opened on the changelog, which runs no game, to read it. The Options flyout showed `Sound: off`, and the preference was unchanged when the page closed, so nothing needed restoring. The first-run Help was already dismissed in that browser profile.

That profile held another session's saved household, `terri-save-1.bin` in the site's private file storage (3488 bytes, SHA-256 `1b47dbcaed86a1e2290d3d1f3e712731abd38223fd28bdc6b669b5b11b2a3eec`). It was copied to a backup file in the same storage and the copy's digest checked. The page loaded that save on Day 2 at 01:02; the game was paused at once, and `New game` then `Start over` gave the shipped lot. In the script's final step the backup was written back over the save, compared byte for byte and found equal with the same SHA-256, and the backup removed, leaving only `terri-save-1.bin`. No day boundary passed after the new game, so no autosave ran.

A new game in the browser draws a fresh seed, so the values differ from game to game and from the release-profile tests, which use the shipped seed. In this game Tim read `Plants: Indifferent`, `Aquarium: Likes`, `Television: Likes` and `Radio: Dislikes`. His plant value was inside -0.2 to 0.2, so the living room would show no moodlet for him, but his aquarium value qualified, and he is the person shown. Tim was ordered to `Watch the fish` and the game run at 3x until the mood panel listed the moodlet, a bounded wait of up to 60 seconds that ended after about 2 seconds of real time; the game was then paused. A housemate was at the aquarium, and Tim was handling correspondence at the desk in the same room with two orders waiting. His moodlets read `Low spirits -18` and `Likes the aquarium here +5.8`, which is 10 points times his value of about 0.58 for one aquarium.

1. [Desktop, 1280 by 800, the section](../assets/review-evidence/object-affinities/desktop-likes.png): Sim details on Overview for Tim, with `Likes and dislikes` open after Skills and its four rows, at Day 1, 01:11.
2. [Desktop, 1280 by 800, the moodlet](../assets/review-evidence/object-affinities/desktop-moodlet.png): the same sheet at 02:13 with `Likes the aquarium here +5.8` in the mood rows above Career and the four rows below.
3. [Phone, 375 by 812](../assets/review-evidence/object-affinities/phone-likes.png): the compact sheet scrolled to show the moodlet and the open section with its four rows. The section's box was 322 pixels wide from x = 19, no element of it extended past the right edge, and the document's scroll width equalled its 375-pixel client width.

Console: every page load logged periodic frame-timing entries and one error, the 404 for `favicon.ico`. No warnings.

Cleanup: the viewport was reset to 1280 by 800 and the Playwright page closed in the `finally` block of the script's final step. Stopping the background task that ran `npm run preview` left its `node vite preview` child (process 33928, this worktree's path and flags) listening on 4173, so that process was stopped by its process id, and `Get-NetTCPConnection -LocalPort 4173 -State Listen` then returned nothing. The Playwright snapshot and console files this check wrote under the ignored `.playwright-mcp/` folder were deleted; files there from other sessions were left alone.

Not checked: a `Bothered by` presence moodlet or the television bother in the browser (the Rust tests above cover both); a physical phone, since the phone check used a resized desktop viewport without a mobile user agent or touch input; light and dark theme variants.

## Delivery

The implementation and this record are on branch `twcl/object-affinities`. Push, merge and deployment are recorded separately in the delivery report.
