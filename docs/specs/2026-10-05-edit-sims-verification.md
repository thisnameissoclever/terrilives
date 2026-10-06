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

Every mutated build compiled, and each test failed at run time with exit code 101.

## Restoration

A script read each file's bytes, wrote the mutated text, ran `cargo test -p terri-sim -- --exact edit::tests::<test>` with its output saved to a log, and wrote the original bytes back in a `finally` block. `git hash-object` on the file before the mutation and after the restoration matched for every row. For the first seven rows, `crates/terri-sim/src/edit.rs` was `0e733613b3d84ac1963ebf13d9fc84a84edd6f22` and `crates/terri-sim/src/household.rs` was `7dffd2a8d82a116f20966fbfdd4fb86cbdb52907`. For the handled-count and check-order rows, `crates/terri-sim/src/edit.rs` was `4d2d91ec1ca2abce8b64397a39d3243cbd728beb` and `crates/terri-sim/src/lib.rs` was `a750a7609e0dea5b362c76d7c34c2aba0fe74ebd`. The two versions of `edit.rs` differ only in the doc comment on `EditRefusal`.
