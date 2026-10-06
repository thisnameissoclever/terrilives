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
| The `practise` call in `tick_social` in `crates/terri-sim/src/systems/social.rs` | `a_social_completion_teaches_both_participants` | `assertion left == right failed: each side learned exactly one attempt's practice`, left `(0.0, 0.0)`, right `(0.02, 0.02)` |
| The one-time seed for a save without a skills field in `restore` in `crates/terri-sim/src/save/skills.rs`, `seed_everyone(world, pack)` | `a_legacy_save_seeds_practice_from_capability_states_once` | `assertion failed: (cooking_mastery(&loaded, casey) - 0.7).abs() < 1e-5` |
| The same seed | `a_load_seeds_practice_from_saved_capability_states` | `assertion failed: (mastery(&loaded, casey, "cooking") - 0.7).abs() < 1e-5` |
| The same seed | `every_older_envelope_seeds_practice_from_capability_states` | the cooking mastery assertion, with message `V1` |
| The seed for envelopes V1 to V4 in the four older loaders in `crates/terri-sim/src/lib.rs`, `save::skills::restore(&mut restored.world, content, None)` | `every_older_envelope_seeds_practice_from_capability_states` | the cooking mastery assertion, with message `V1` |
| The empty `Skills` a present field installs on every person in `restore` | `a_present_empty_field_seeds_nothing` | `assertion left == right failed: person 34`, left `None`, right `Some([])` |
| The ordering check in `restore`, rows strictly ascending by entity index then id | `invalid_rows_refuse_the_load_without_touching_the_live_world` | `assertion left == right failed: [(36, "cooking", 0.1), (34, "cooking", 0.1)]`, left `Ok(())`, right `Err(InvalidValue)` |
| The living-person check in `restore`, `world.get::<Agent>(entity).is_some()` | `invalid_rows_refuse_the_load_without_touching_the_live_world` | `assertion left == right failed: [(0, "cooking", 0.1)]`, left `Ok(())`, right `Err(InvalidValue)`: a row on a placed object loaded |
| The known-id check in `restore`, `.ok_or(SaveError::InvalidContentReference)`, replaced by the first skill | `invalid_rows_refuse_the_load_without_touching_the_live_world` | `assertion left == right failed: [(34, "juggling", 0.1)]`, left `Ok(())`, right `Err(InvalidContentReference)` |
| The range check in `restore`, finite and above zero | `invalid_rows_refuse_the_load_without_touching_the_live_world` | `assertion left == right failed: [(34, "cooking", inf)]`, left `Ok(())`, right `Err(InvalidValue)` |
| The clamp of saved practice to the top of the current ladder in `restore`, `practice.min(top)` | `practice_above_the_ladder_top_loads_clamped_to_it` | `assertion left == right failed: practice above the top loads as the top`: Casey loaded with `(0, 1.0000002), (2, 4.0000005)` where the top is `1.0000001` |
| The empty `Skills` that `SimHandle::spawn_agent` in `crates/terri-wasm/src/lib.rs` gives a spawned agent | `a_spawned_agent_learns_and_its_reload_continues_identically` | `the ordered read taught the spawned agent`: the completed read left no practice |
| The trait-state fallback in `Sim::traits_of`, `.unwrap_or(value)`, replaced by `.unwrap_or(0.0)` | `the_fumble_roll_reads_skill_mastery_and_keeps_its_draw_count` | `assertion left == right failed`, left `[(1, 0.0)]`, right `[(1, 0.37)]`: with no skill on the tag the panel would not show the trait state |
| The entity index write in the `skills-v1` block of `Sim::world_hash` in `crates/terri-sim/src/lib.rs` | `the_world_hash_observes_practice_and_its_owner` | `assertion left != right failed: the same practice held by someone else`, both `15596589372039368716` |
| The skill id write in the same block | `the_world_hash_observes_practice_and_its_owner` | `assertion left != right failed: the same practice in another skill`, both `1298941223531281020` |
| The practice bits write in the same block | `the_world_hash_observes_practice_and_its_owner` | `assertion left != right failed: one f32 step of practice`, both `7968284513284597355` |
| The skills entry in the decoder's invented-field check in `decode_current_v5` in `crates/terri-wasm/src/lib.rs`, `usize::from(snapshot.skills.is_some())` | `skills_tail_loads_whole_absent_and_refuses_every_partial_row` | `decoder accepted a cut skills field at 1`: the lone `Some` marker was padded into an empty field |
| The mastery read for a capability in `Sim::traits_of`, replaced by the trait's own state | `traits_of_reports_mastery_for_capabilities_and_state_for_the_rest` | `assertion left == right failed: mastery, not the inert state`, left `0.9`, right `0.0` |
| The `practise` call in `tick_social` moved from the completion into the per-tick delivery, ahead of the countdown | `a_social_completion_teaches_both_participants` | `assertion left == right failed: nothing learned while the chat runs`, left `(0.40000004, 0.40000004)`, right `(0.0, 0.0)` |
| The `practise` call in `tick_social` moved to the talk's first tick, when `remaining_ticks` still equals the duration | `an_interrupted_conversation_teaches_neither_participant` | `assertion left == right failed`, left `(0.02, 0.02)`, right `(0.0, 0.0)`: the chat ended by an order to the partner taught both sides |
| The `practise` call in `tick_chain_steps` moved to the step's first tick of work, when `remaining_ticks` still equals the step's duration | `a_cancelled_chain_step_teaches_nothing` | `assertion left == right failed`, left `0.015`, right `0.0`: the cancelled Cook step taught |

The `skills-v1` tag and the row count written before the rows have no deletion row of their own: both are pinned by the released-main world hash in `web/tests/aquarium.test.ts`, whose people hold practice, so removing either changes that value.

## Restoration

A script read each file's bytes, wrote the mutated text, ran `cargo test -p terri-sim --lib -- <filters>` with its output saved to a log, and wrote the original bytes back in a `finally` block. `git hash-object` on the file before the mutation and after the restoration matched for every row: `crates/terri-sim/src/skills.rs` was `48eb1cdedb11d5fd6a07a0bfa087132fff0efd49`, `crates/terri-sim/src/systems/trait_effects.rs` was `0bbb5294d80dd1dbaae3a0cbcb399c8b88363456`, `crates/terri-sim/src/systems/interact.rs` was `496c2dde290016ebab46dd5bbf3a4df7b945397b`, `crates/terri-sim/src/systems/chain.rs` was `a638b032cd2ec1ab26a8a5e09decf3c01d651bab`, `crates/terri-sim/src/systems/social.rs` was `56f06f9c8a5958387a942f906e58644046e237ed` and `crates/terri-sim/src/lib.rs` was `62a9ec9ad18ca0ea2d6353b0fd38b48594357273`.

For the three rows that move a `practise` call, the same script method applied each move, ran `cargo test -p terri-sim --lib -- --exact <test>` with its output saved to a log, and restored the original bytes in a `finally` block. `git hash-object` before and after matched: `crates/terri-sim/src/systems/social.rs` was `56f06f9c8a5958387a942f906e58644046e237ed` and `crates/terri-sim/src/systems/chain.rs` was `a638b032cd2ec1ab26a8a5e09decf3c01d651bab`.

The `tick_social` deletion row was measured again on 2026-10-05 against the rewritten test, with the same script method: the call was replaced by a statement that only borrows `skills`, and `cargo test -p terri-sim --lib -- --exact skills::tests::a_social_completion_teaches_both_participants` ran with its output saved to a log. `git hash-object crates/terri-sim/src/systems/social.rs` was `56f06f9c8a5958387a942f906e58644046e237ed` before the mutation and after the restoration.

The save rows used the same script method, with `cargo test -p terri-sim --lib -- <filter>` or, for the decoder row, `cargo test -p terri-wasm --lib -- <filter>`. `git hash-object` before and after matched for every row: `crates/terri-sim/src/save/skills.rs` was `925c6b4547c06fb4e21a0edc931ae97d48c14c9c`, `crates/terri-sim/src/lib.rs` was `9746ad6667b7fe5b56df1ac9a63f300d423961fd` and `crates/terri-wasm/src/lib.rs` was `409634c376aa0854f9e189c06d9e092a29be4674`.

The range, clamp, `spawn_agent` and `traits_of` fallback rows were measured on the flat ladder (`skill_level_growth` 1.0) with the same script method. `git hash-object` before and after matched: `crates/terri-sim/src/save/skills.rs` was `04c05311b676b76e0690a2d31a4d6cdfdd595abc`, `crates/terri-wasm/src/lib.rs` was `2eef97f47c91cb372110f7919c637ee7f4b4c70f` and `crates/terri-sim/src/lib.rs` was `667bcf1a1123c60236dd8b57c8c53c94f4a3fff8`. Rows measured earlier quote values from the ladder then shipped (`skill_level_growth` 1.25).

## Displayed browser

On 2026-10-05 the site built by `npm run build` at commit `3c5ddbb0` was served from `web/` with `npx vite preview --port 4173 --strictPort`, which serves HTTPS with a local certificate. The page loaded bundle `assets/index-dlApCgxu.js`, the bundle that build wrote. The in-app browser pane opened the page with a zero-sized, hidden viewport and the game clock stayed at Day 1, 00:00, so the pass used the Playwright Chromium instead, in a new browser context with no saved game. The sound preference `terrilives.audio-preferences.v1` was set to muted, with effects and voices at zero, before any page script ran.

1. The first-run Help guide was dismissed with Got it, Casey was selected in the household roster, and Sim details opened on Overview. The game ran from Day 1, 00:14 to 13:29 before the speed was set to Pause, and the clock then stayed at 13:29 for 2.5 seconds. Casey was in the Cook step of Cook lunch, which had not yet completed.
2. At 1440 by 900 the Skills disclosure opened and listed Cooking `Level 2 of 10, 50% to the next level`, Fitness `Level 0 of 10, 0% to the next level` and Reading `Level 5 of 10, 80% to the next level`, each with its description (image 1). Cooking matches the 0.25 start level of Can't cook. Reading matches the 0.58 start level of Slow reader, which Casey also wears. The screenshot was taken on the 1.25 ladder before the final fix wave flattened it and added a half-percent rounding allowance below the 99% cap; on the shipped code the same mastery reads 80%, which the web tests pin.
3. The Traits tab showed `Skill 25%` on Can't cook and `Skill 58%` on Slow reader (image 2). Both panels now floor with the same half-percent allowance and cap at 99% below the top, so the same Reading mastery reads 58% in one place and level 5, 80% in the other.
4. At 375 by 812 the open Skills disclosure showed all three skills inside the Overview sheet (image 3). At both sizes the document's scroll width equalled the viewport width, and at 375 no visible element extended past either edge.

Console: listeners attached before a reload of the new context recorded 69 messages, all the game's periodic frame-timing lines (`entities 37 frames ...`). There were no errors, warnings, page errors, failed requests or HTTP error responses. An earlier load in the Playwright default context, which held a saved game from an earlier session and was closed without interaction, logged one error: a 404 for `/favicon.ico`.

Images:

1. [Desktop Overview with the Skills disclosure open](../assets/review-evidence/skills/desktop-overview.png)
2. [Desktop Traits tab with Skill 25% on Can't cook](../assets/review-evidence/skills/desktop-traits.png)
3. [Phone-width Overview with the Skills disclosure open](../assets/review-evidence/skills/phone-overview.png)

Cleanup: the Playwright context was closed in a `finally` block, followed by the Playwright page and the browser pane tab. The preview server was stopped, and `Get-NetTCPConnection -LocalPort 4173 -State Listen` then returned nothing.

Not checked in the browser: the phone width was a 375 by 812 viewport without touch input or a mobile user agent, and no physical phone was used. A skill rising during play, a skill at the top of its ladder (`Level 10 of 10`), the debug overlay, the Edit housemate removal note, keyboard and screen-reader use, and the [SK-evidence] item 6 claim that reading the panels leaves save bytes unchanged were not exercised in this pass.

## Delivery

The implementation, its tests, the displayed pass and this record are on branch `twcl/skills`. Pushing, merging and deployment are recorded separately, in the pull request and the delivery report; this record does not establish any of them.
