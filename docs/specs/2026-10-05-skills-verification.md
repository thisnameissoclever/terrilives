# Skills verification

Status: implementation evidence for `2026-10-05-skills.md`. Each table row names a guard that was deleted, the test that then failed, and the failing assertion, after which the source was restored byte for byte.

## Guard deletions

| Guard | Test | Failing assertion |
|---|---|---|
| The level boundary comparison in `standing` in `crates/terri-sim/src/skills.rs`, `practice < next`, replaced by `practice <= next` | `the_ladder_steps_at_exact_boundaries` | `assertion left == right failed`, left `Standing { level: 1, progress: 0.99999994, mastery: 0.19999999 }`, right `Standing { level: 2, progress: 0.0, mastery: 0.2 }`: practice exactly at level 2's cost stayed on level 1 |
| The clamp at the top of the ladder in `practise`, `.min(ladder.max_practice(skill.levels))` | `practice_tops_out_and_an_untagged_attempt_teaches_nothing` | `assertion left == right failed: clamped at the top`, left `3.3402903`, right `3.3252902` |
| The same clamp | `completion_teaches_capabilities_and_manages_conditions` | `assertion left == right failed`, left `3.3352902`, right `3.3252902` |
| The `max` in the shared seed behind `seed_from_capabilities`, `current.max(wanted)`, replaced by `wanted` | `spawning_and_editing_seed_practice_from_capability_start_levels_and_never_lower_it` | `assertion left == right failed: re-adding the trait never lowers it`, left `0.6253906`, right `3.3252902` |
| The fallback to the trait state in `roll_fumble` in `crates/terri-sim/src/systems/trait_effects.rs`, `.unwrap_or(*state)`, replaced by `.unwrap_or(0.0)` | `the_fumble_roll_reads_skill_mastery_and_keeps_its_draw_count` | `assertion left == right failed: the state of 1 passes without a skill (seed 0)`, left `Some(0.0)`, right `None` |
| The same fallback | `the_fumble_roll_is_level_shaped_and_consumes_rng_pass_or_fail` | `assertion left == right failed`, left `Some(0.25)`, right `None` |
| The `practise` call in `tick_interactions` in `crates/terri-sim/src/systems/interact.rs` | `a_completed_tagged_interaction_teaches_each_person_once_and_an_interrupted_one_nothing` | `assertion left == right failed: one attempt's practice, worn or not (wearing true)`, left `0.303125`, right `0.31812498` |
| The same call | `a_fumbled_meal_starves_the_soul_but_teaches_the_hands` | `the attempt never ran its course (fumble seen: true)`: the completed meal left no practice |
| The `practise` call in `tick_chain_steps` in `crates/terri-sim/src/systems/chain.rs` | `a_tagged_chain_step_teaches_each_participant_once` | `assertion left == right failed: the tagged step taught once and managed the condition once`, left `Some((0.0, 0.75))`, right `Some((0.015, 0.75))` |
| The same call | `a_fumbled_step_ruins_the_terminal_delivery` | `assertion left == right failed: and yet the tagged step taught at its own completion`, left `0.0`, right `0.015` |
| The `practise` call in `tick_social` in `crates/terri-sim/src/systems/social.rs` | `a_social_completion_teaches_both_participants` | `assertion left == right failed: both sides learned one attempt's practice on the same tick`, left `None`, right `Some((0.02, 0.02))` |
| The one-time seed for a save without a skills field in `restore` in `crates/terri-sim/src/save/skills.rs`, `seed_everyone(world, pack)` | `a_legacy_save_seeds_practice_from_capability_states_once` | `assertion failed: (cooking_mastery(&loaded, casey) - 0.7).abs() < 1e-5` |
| The same seed | `a_load_seeds_practice_from_saved_capability_states` | `assertion failed: (mastery(&loaded, casey, "cooking") - 0.7).abs() < 1e-5` |
| The same seed | `every_older_envelope_seeds_practice_from_capability_states` | the cooking mastery assertion, with message `V1` |
| The seed for envelopes V1 to V4 in the four older loaders in `crates/terri-sim/src/lib.rs`, `save::skills::restore(&mut restored.world, content, None)` | `every_older_envelope_seeds_practice_from_capability_states` | the cooking mastery assertion, with message `V1` |
| The empty `Skills` a present field installs on every person in `restore` | `a_present_empty_field_seeds_nothing` | `assertion left == right failed: person 34`, left `None`, right `Some([])` |
| The ordering check in `restore`, rows strictly ascending by entity index then id | `invalid_rows_refuse_the_load_without_touching_the_live_world` | `assertion left == right failed: [(36, "cooking", 0.1), (34, "cooking", 0.1)]`, left `Ok(())`, right `Err(InvalidValue)` |
| The living-person check in `restore`, `world.get::<Agent>(entity).is_some()` | `invalid_rows_refuse_the_load_without_touching_the_live_world` | `assertion left == right failed: [(0, "cooking", 0.1)]`, left `Ok(())`, right `Err(InvalidValue)`: a row on a placed object loaded |
| The known-id check in `restore`, `.ok_or(SaveError::InvalidContentReference)`, replaced by the first skill | `invalid_rows_refuse_the_load_without_touching_the_live_world` | `assertion left == right failed: [(34, "juggling", 0.1)]`, left `Ok(())`, right `Err(InvalidContentReference)` |
| The whole range check in `restore`, finite, above zero and at most the top of the ladder | `invalid_rows_refuse_the_load_without_touching_the_live_world` | `assertion left == right failed: [(34, "cooking", 3.3252904)]`, left `Ok(())`, right `Err(InvalidValue)`: one f32 step above the top loaded |
| Only the upper bound of that check, `practice <= top` | `invalid_rows_refuse_the_load_without_touching_the_live_world` | the same assertion on `[(34, "cooking", 3.3252904)]` |
| The entity index write in the `skills-v1` block of `Sim::world_hash` in `crates/terri-sim/src/lib.rs` | `the_world_hash_observes_practice_and_its_owner` | `assertion left != right failed: the same practice held by someone else`, both `15596589372039368716` |
| The skill id write in the same block | `the_world_hash_observes_practice_and_its_owner` | `assertion left != right failed: the same practice in another skill`, both `1298941223531281020` |
| The practice bits write in the same block | `the_world_hash_observes_practice_and_its_owner` | `assertion left != right failed: one f32 step of practice`, both `7968284513284597355` |
| The skills entry in the decoder's invented-field check in `decode_current_v5` in `crates/terri-wasm/src/lib.rs`, `usize::from(snapshot.skills.is_some())` | `skills_tail_loads_whole_absent_and_refuses_every_partial_row` | `decoder accepted a cut skills field at 1`: the lone `Some` marker was padded into an empty field |
| The mastery read for a capability in `Sim::traits_of`, replaced by the trait's own state | `traits_of_reports_mastery_for_capabilities_and_state_for_the_rest` | `assertion left == right failed: mastery, not the inert state`, left `0.9`, right `0.0` |
| The `practise` call in `tick_social` moved from the completion into the per-tick delivery, ahead of the countdown | `a_social_completion_teaches_both_participants` | `assertion left == right failed: nothing learned while the chat runs`, left `(0.40000004, 0.40000004)`, right `(0.0, 0.0)` |
| The `practise` call in `tick_social` moved to the talk's first tick, when `remaining_ticks` still equals the duration | `an_interrupted_conversation_teaches_neither_participant` | `assertion left == right failed`, left `(0.02, 0.02)`, right `(0.0, 0.0)`: the chat ended by an order to the partner taught both sides |
| The `practise` call in `tick_chain_steps` moved to the step's first tick of work, when `remaining_ticks` still equals the step's duration | `a_cancelled_chain_step_teaches_nothing` | `assertion left == right failed`, left `0.015`, right `0.0`: the cancelled Cook step taught |

## Restoration

A script read each file's bytes, wrote the mutated text, ran `cargo test -p terri-sim --lib -- <filters>` with its output saved to a log, and wrote the original bytes back in a `finally` block. `git hash-object` on the file before the mutation and after the restoration matched for every row: `crates/terri-sim/src/skills.rs` was `48eb1cdedb11d5fd6a07a0bfa087132fff0efd49`, `crates/terri-sim/src/systems/trait_effects.rs` was `0bbb5294d80dd1dbaae3a0cbcb399c8b88363456`, `crates/terri-sim/src/systems/interact.rs` was `496c2dde290016ebab46dd5bbf3a4df7b945397b`, `crates/terri-sim/src/systems/chain.rs` was `a638b032cd2ec1ab26a8a5e09decf3c01d651bab`, `crates/terri-sim/src/systems/social.rs` was `56f06f9c8a5958387a942f906e58644046e237ed` and `crates/terri-sim/src/lib.rs` was `62a9ec9ad18ca0ea2d6353b0fd38b48594357273`.

For the three rows that move a `practise` call, the same script method applied each move, ran `cargo test -p terri-sim --lib -- --exact <test>` with its output saved to a log, and restored the original bytes in a `finally` block. `git hash-object` before and after matched: `crates/terri-sim/src/systems/social.rs` was `56f06f9c8a5958387a942f906e58644046e237ed` and `crates/terri-sim/src/systems/chain.rs` was `a638b032cd2ec1ab26a8a5e09decf3c01d651bab`.

The save rows used the same script method, with `cargo test -p terri-sim --lib -- <filter>` or, for the decoder row, `cargo test -p terri-wasm --lib -- <filter>`. `git hash-object` before and after matched for every row: `crates/terri-sim/src/save/skills.rs` was `925c6b4547c06fb4e21a0edc931ae97d48c14c9c`, `crates/terri-sim/src/lib.rs` was `9746ad6667b7fe5b56df1ac9a63f300d423961fd` and `crates/terri-wasm/src/lib.rs` was `409634c376aa0854f9e189c06d9e092a29be4674`.

## Delivery

The implementation, its tests and this record are on branch `twcl/skills`. Pushing, merging and deployment are recorded separately, in the pull request and the delivery report; this record does not establish any of them.
