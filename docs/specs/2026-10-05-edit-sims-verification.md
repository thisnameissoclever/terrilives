# Edit Sims verification

Status: implementation evidence for `2026-09-30-edit-sims.md`. Each table row
names a guard that was deleted, the test that then failed, and the failing
assertion, after which the source was restored byte for byte.

## Guard deletions

| Guard | Test | Failing assertion |
|---|---|---|
| `validate` in `crates/terri-sim/src/edit.rs` finds the person with `living_entity(...).ok_or(UnknownPerson)?`; replaced by the first `Agent` entity | `a_retired_sim_id_is_refused_even_when_its_entity_slot_is_reused` | `assertion left == right failed`, left `None`, right `Some(UnknownPerson)`: the retired SimId's edit was accepted |
| The `SelfTie` check in `validate` | `every_invalid_field_refuses_the_whole_edit_without_writing` | `assertion left == right failed: self tie`, left `None`, right `Some(SelfTie)` |
| The `RepeatedRelative` check in `validate` | `every_invalid_field_refuses_the_whole_edit_without_writing` | `assertion left == right failed: repeated relative`, left `None`, right `Some(RepeatedRelative)` |
| The `current.state(index).unwrap_or_else(...)` retention in `apply`; every trait took its authored state | `retained_traits_keep_their_exact_state_and_new_ones_start_authored` | `assertion left == right failed`, left `[(1, 0.25), (2, 0.6), (3, 0.0)]`, right `[(1, 0.77), (2, 0.6), (3, 0.0)]` |
| The cleanliness row update in `apply` | `an_explicit_personality_change_replaces_every_effect_including_chronotype_and_cleanliness` | `assertion left == right failed`, left `Some(0.9)`, right `Some(0.55)`: the row kept the old personality's score |
| The `chronotype_offset_ticks` assignment in `personality_from` in `crates/terri-sim/src/household.rs` | `an_explicit_personality_change_replaces_every_effect_including_chronotype_and_cleanliness` | `assertion left == right failed: the authored chronotype offset arrives with the personality`, left `0`, right `180` |
| The `Traits` replacement in `apply`; the built entries were discarded | `removing_a_trait_mid_action_does_not_recreate_it_at_completion` | `assertion left == right failed`, left `Some(0.05)`, right `None`: the kept trait learned at the attempt's completion |

Every mutated build compiled, and each test failed at run time with exit code 101.

## Restoration

A script read each file's bytes, wrote the mutated text, ran `cargo test -p terri-sim -- --exact edit::tests::<test>` with its output saved to a log, and wrote the original bytes back in a `finally` block. `git hash-object` on the file before the mutation and after the restoration matched for every row: `crates/terri-sim/src/edit.rs` was `0e733613b3d84ac1963ebf13d9fc84a84edd6f22` both times, and `crates/terri-sim/src/household.rs` was `7dffd2a8d82a116f20966fbfdd4fb86cbdb52907` both times.
