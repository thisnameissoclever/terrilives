# Edit Sims verification

Status: implementation evidence for `2026-09-30-edit-sims.md`. Each table row names a guard that was deleted, the test that then failed, and the failing assertion, after which the source was restored byte for byte.

## Guard deletions

| Guard | Test | Failing assertion |
|---|---|---|
| `validate` in `crates/terri-sim/src/edit.rs` finds the person with `living_entity(...).ok_or(UnknownPerson)?`; replaced by the first `Agent` entity | `a_retired_sim_id_is_refused_after_a_newcomer_arrives` | `assertion left == right failed`, left `None`, right `Some(UnknownPerson)`: the retired SimId's edit was accepted |
| The `SelfTie` check in `validate` | `every_invalid_field_refuses_the_whole_edit_without_writing` | `assertion left == right failed: self tie`, left `None`, right `Some(SelfTie)` |
| The `RepeatedRelative` check in `validate` | `every_invalid_field_refuses_the_whole_edit_without_writing` | `assertion left == right failed: repeated relative`, left `None`, right `Some(RepeatedRelative)` |
| The `current.state(index).unwrap_or_else(...)` retention in `apply`; every trait took its authored state | `retained_traits_keep_their_exact_state_and_new_ones_start_authored` | `assertion left == right failed`, left `[(1, 0.25), (2, 0.6), (3, 0.0)]`, right `[(1, 0.77), (2, 0.6), (3, 0.0)]` |
| The cleanliness row update in `apply` | `an_explicit_personality_change_replaces_every_effect_including_chronotype_and_cleanliness` | `assertion left == right failed`, left `Some(0.9)`, right `Some(0.55)`: the row kept the old personality's score |
| The `chronotype_offset_ticks` assignment in `personality_from` in `crates/terri-sim/src/household.rs` | `an_explicit_personality_change_replaces_every_effect_including_chronotype_and_cleanliness` | `assertion left == right failed: the authored chronotype offset arrives with the personality`, left `0`, right `180` |
| The `Traits` replacement in `apply`; the built entries were discarded | `removing_a_trait_mid_action_does_not_recreate_it_at_completion` | `assertion left == right failed`, left `Some(0.05)`, right `None`: the kept trait learned at the attempt's completion |
| `Sim::adopt` in `crates/terri-sim/src/lib.rs` starts the restored world with a fresh `LotEditState`; mutated to copy `last_edit_result` across a load | `world_replacement_restarts_the_handled_count` | `assertion left == right failed`, left `Some(EditResult { sim: Some(34), reason: None, handled: 2 })`, right `None` |
| `validate` checks the person before the name; the two lines swapped | `the_earliest_failing_check_decides_the_refusal` | `assertion left == right failed: person before name`, left `Some(BadName)`, right `Some(UnknownPerson)` |
| `validate` checks the name before the traits; a trait check added above the name check | `the_earliest_failing_check_decides_the_refusal` | `assertion left == right failed: personality before traits`, left `Some(UnknownTrait)`, right `Some(UnknownPersonality)` |
| `validate` checks the personality before the traits; a trait check added above the personality check | `the_earliest_failing_check_decides_the_refusal` | `assertion left == right failed: personality before traits`, left `Some(UnknownTrait)`, right `Some(UnknownPersonality)` |
| `validate` checks the traits before the ties; the trait check moved below the tie loop | `the_earliest_failing_check_decides_the_refusal` | `assertion left == right failed: traits before ties`, left `Some(SelfTie)`, right `Some(RepeatedTrait)` |
| `validate` checks each tie in submitted order; a self-tie pass over every tie added before the loop | `the_earliest_failing_check_decides_the_refusal` | `assertion left == right failed: an earlier unknown relative before a later self-tie`, left `Some(SelfTie)`, right `Some(UnknownRelative)` |
| `validate` checks each tie in submitted order; an unknown-relative pass over every tie added before the loop | `the_earliest_failing_check_decides_the_refusal` | `assertion left == right failed: an earlier self-tie before a later unknown relative`, left `Some(UnknownRelative)`, right `Some(SelfTie)` |
| The `drain` loop in the `personality-effects-v1` block of `Sim::world_hash` in `crates/terri-sim/src/lib.rs` | `the_world_hash_observes_each_personality_effect_and_not_the_name` | `assertion left != right failed: drain is hashed`, both sides `11216851037778154306` |
| The `satisfaction` loop in the same block | `the_world_hash_observes_each_personality_effect_and_not_the_name` | `assertion left != right failed: satisfaction is hashed`, both sides `4297862101932424422` |
| The dispositions loop in the same block, leaving the row count written | `the_world_hash_observes_each_personality_effect_and_not_the_name` | `assertion left != right failed: disposition weights are hashed`, both sides `7031647427592287524`: a changed weight with an unchanged row count went unseen |
| The block's `if !effects.is_empty()` sparseness condition, replaced by `if true` | `world_hash_matches_its_golden_vector` | `assertion left == right failed: the world hash of a fixed scenario at tick 100 changed`, left `9758347640304546991`, right `2432540155843995156`: bare agents gained an empty block |
| The chronotype comparison in `archetype_of` in `crates/terri-sim/src/edit.rs`; each archetype's effects took the person's own offset before comparing | `the_archetype_is_derived_only_from_a_complete_exact_match` | `assertion left == right failed`, left `Some(0)`, right `None`: the legacy zero chronotype still matched |
| The ambiguity check `matches.next().is_none()` in `archetype_of`, replaced by `Some(first)` | `two_archetypes_with_identical_effects_match_neither` | `assertion left == right failed: two equal archetypes are ambiguous`, left `Some(0)`, right `None` |
| The `Agent` check in `archetype_of` | `two_archetypes_with_identical_effects_match_neither` | `assertion left == right failed: a personality without a person matches nothing`, left `Some(2)`, right `None` |

Every mutated build compiled, and each test failed at run time with exit code 101.

## Restoration

A script read each file's bytes, wrote the mutated text, ran `cargo test -p terri-sim -- --exact edit::tests::<test>` with its output saved to a log, and wrote the original bytes back in a `finally` block. `git hash-object` on the file before the mutation and after the restoration matched for every row. For the first seven rows, `crates/terri-sim/src/edit.rs` was `0e733613b3d84ac1963ebf13d9fc84a84edd6f22` and `crates/terri-sim/src/household.rs` was `7dffd2a8d82a116f20966fbfdd4fb86cbdb52907`. For the handled-count and check-order rows, `crates/terri-sim/src/edit.rs` was `4d2d91ec1ca2abce8b64397a39d3243cbd728beb` and `crates/terri-sim/src/lib.rs` was `a750a7609e0dea5b362c76d7c34c2aba0fe74ebd`. The two versions of `edit.rs` differ only in the doc comment on `EditRefusal`.

For the personality-effect rows, a script mutated one exact span, ran `cargo test -p terri-sim --lib -- --exact <test>` with its output saved to a log, and wrote the original bytes back in a `finally` block. `git hash-object` before the mutation and after the restoration matched for every row: `crates/terri-sim/src/lib.rs` was `ab990ec43fad2ad5c78ba493cd0401aa698b47e3` and `crates/terri-sim/src/edit.rs` was `af8c349b0c82f2f23a2383b675e40df1f1154fda`.
